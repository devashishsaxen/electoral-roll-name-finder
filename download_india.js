'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { setTimeout: sleep } = require('node:timers/promises');
const { chromium } = require('playwright');
const { component, validPdf, atomicWrite } = require('./fetch_direct');
const { STATES, resolveState, portalUrl } = require('./lib/states');

function parseArgs(args) {
  const options = { output: 'downloads', 'max-downloads': '0', 'idle-timeout': '1800' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    if (args[i] === '--list-states') return { list: true };
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !['state', 'output', 'max-downloads', 'idle-timeout'].includes(key)) throw new Error(`Unknown option: ${args[i]}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    options[key] = args[++i];
  }
  if (!options.state) throw new Error('Supply --state NAME or CODE; use --list-states to choose.');
  for (const key of ['max-downloads', 'idle-timeout']) {
    if (!/^\d+$/.test(options[key]) || !Number.isSafeInteger(Number(options[key]))) throw new Error(`${key} must be an integer`);
    options[key] = Number(options[key]);
  }
  if (options['idle-timeout'] < 30 || options['idle-timeout'] > 86400) throw new Error('--idle-timeout must be 30–86400 seconds');
  const state = resolveState(options.state);
  return { state, directory: path.resolve(options.output, `${state.code}_${component(state.name)}`), maximum: options['max-downloads'], idleTimeout: options['idle-timeout'] * 1000 };
}
function validZip(buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) return false;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      return buffer.readUInt16LE(offset + 10) > 0 && buffer.readUInt16LE(offset + 4) === 0 && buffer.readUInt16LE(offset + 6) === 0;
    }
  }
  return false;
}
function officialPage(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && (parsed.hostname === 'eci.gov.in' || parsed.hostname.endsWith('.eci.gov.in')); }
  catch { return false; }
}
function publicUrl(url) {
  try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`; }
  catch { return ''; }
}
async function saveDownload(download, directory) {
  const temporary = path.join(directory, `${crypto.randomUUID()}.partial`);
  try {
    await download.saveAs(temporary);
    const bytes = fs.readFileSync(temporary);
    const extension = validPdf(bytes) ? '.pdf' : validZip(bytes) ? '.zip' : null;
    if (!extension) throw new Error('Not a complete PDF or supported ZIP; the portal may have returned an error');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    let stem;
    try { stem = component(path.parse(path.basename(download.suggestedFilename())).name).slice(0, 48); }
    catch { stem = 'roll'; }
    const filename = `${stem}_${sha256.slice(0, 16)}${extension}`;
    const destination = path.join(directory, filename);
    const alreadySaved = fs.existsSync(destination) && crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex') === sha256;
    if (!alreadySaved) atomicWrite(destination, bytes);
    return { filename, bytes: bytes.length, sha256, status: alreadySaved ? 'verified-existing' : 'downloaded', format: extension.slice(1) };
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    await download.delete().catch(() => {});
  }
}
async function main(args = process.argv.slice(2)) {
  const config = parseArgs(args);
  if (config.help) {
    console.log('National assisted download: node download_india.js --state "Karnataka"\nOptions: --list-states, --output downloads, --max-downloads 0 (unlimited), --idle-timeout 1800 (seconds)\nSelect district/constituency/year in the browser and complete CAPTCHA yourself. Press Enter here when finished.'); return;
  }
  if (config.list) { for (const state of STATES) console.log(`${state.code}  ${state.name}`); return; }
  fs.mkdirSync(config.directory, { recursive: true });
  const lockPath = path.join(config.directory, '.download.lock');
  const lock = fs.openSync(lockPath, 'wx');
  const results = [];
  const pending = new Set();
  let browser;
  let input;
  let stopped = false;
  let accepted = 0;
  let lastActivity = Date.now();
  let runStatus = 'running';
  const stop = () => { stopped = true; };
  const manifestPath = path.join(config.directory, `session-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.json`);
  const manifest = () => atomicWrite(manifestPath, JSON.stringify({ source: portalUrl(config.state), requestedState: config.state, mode: 'eci-assisted', runStatus, updatedAt: new Date().toISOString(), results }, null, 2));
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ acceptDownloads: true });
    context.on('close', stop);
    browser.on('disconnected', stop);
    const attach = page => {
      page.on('download', download => {
        if (stopped || (config.maximum && accepted >= config.maximum)) return;
        if (!officialPage(page.url())) { console.error('Ignoring download initiated outside the official ECI portal.'); return; }
        accepted++; lastActivity = Date.now();
        const sourcePage = publicUrl(page.url());
        const task = (async () => {
          let result;
          try { result = { ...await saveDownload(download, config.directory), sourcePage }; }
          catch (error) { result = { status: 'failed', error: error.message, sourcePage }; }
          results.push(result); lastActivity = Date.now(); manifest();
          console.log(`${result.status}: ${result.filename || result.error}`);
        })().catch(error => { console.error(`Saving report failed: ${error.message}`); process.exitCode = 1; stop(); });
        pending.add(task);
        task.finally(() => pending.delete(task));
      });
      page.on('close', () => { if (!context.pages().length) stop(); });
    };
    context.on('page', attach);
    const page = await context.newPage();
    console.log(`Opening ${config.state.name}: ${portalUrl(config.state)}`);
    console.log('Choose the district, constituency, roll/year, language and parts in the browser. Complete the CAPTCHA and use the official download button.');
    console.log('Keep this session on the requested state. ZIP bundles are saved intact; extract them locally before searching.');
    console.log(`Output: ${config.directory}\nPress Enter here to finish, or close the browser. Each PDF/ZIP download counts as one file.`);
    input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.on('line', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    manifest();
    try { await page.goto(portalUrl(config.state), { waitUntil: 'commit', timeout: 60000 }); }
    catch (error) { if (!stopped) console.error(`Portal navigation failed: ${error.message}. Retry in the browser or close it to finish.`); }
    while (!stopped) {
      if (config.maximum && accepted >= config.maximum && !pending.size) break;
      if (!pending.size && Date.now() - lastActivity >= config.idleTimeout) { console.error('Session idle timeout reached.'); runStatus = 'idle-timeout'; break; }
      await sleep(250);
    }
    stopped = true;
    await Promise.all([...pending]);
    if (runStatus === 'running') runStatus = results.some(result => result.status === 'failed') ? 'incomplete' : results.length ? 'complete-selection' : 'no-downloads';
    manifest();
    if (!results.length || results.some(result => result.status === 'failed')) process.exitCode = 1;
    console.log(`Saved/verified ${results.filter(result => result.status !== 'failed').length} files; failed ${results.filter(result => result.status === 'failed').length}. Report: ${path.basename(manifestPath)}`);
  } finally {
    stopped = true;
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (input) input.close();
    try { if (browser) await browser.close(); }
    finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
  }
}
module.exports = { parseArgs, validZip, officialPage, publicUrl, saveDownload, main };
if (require.main === module) main().catch(error => { console.error(`Fatal: ${error.message}`); process.exitCode = 1; });
