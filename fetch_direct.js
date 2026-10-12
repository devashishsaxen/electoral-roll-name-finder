'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const BASE = 'https://ceouttarpradesh.nic.in/rollpdf/Erollpdf';

function component(value) {
  const safe = value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/[. ]+$/g, '');
  if (!safe || safe === '.' || safe === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) throw new Error('Invalid directory name');
  return safe;
}
function parseArgs(args) {
  const values = { ac: '8', name: 'Kanth', district: 'Moradabad', from: '1', to: '226', concurrency: '1', timeout: '60000', retries: '3', delay: '1500', output: 'downloads' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') return { help: true };
    const key = args[i].slice(2);
    if (!args[i].startsWith('--') || !Object.hasOwn(values, key)) throw new Error(`Unknown argument: ${args[i]}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`);
    values[key] = args[++i];
  }
  for (const key of ['ac', 'from', 'to', 'concurrency', 'timeout', 'retries', 'delay']) {
    if (!/^\d+$/.test(values[key])) throw new Error(`${key} must be an integer`);
    values[key] = Number(values[key]);
    if (!Number.isSafeInteger(values[key])) throw new Error(`${key} is too large`);
  }
  if (values.ac < 1 || values.ac > 403 || values.from < 1 || values.to < values.from || values.to > 10000) throw new Error('Invalid AC or part range (AC 1–403, parts 1–10000)');
  if (values.concurrency < 1 || values.concurrency > 3 || values.timeout < 1000 || values.timeout > 300000 || values.retries > 5 || values.delay < 1000) throw new Error('Use concurrency 1–3, timeout 1000–300000 ms, retries 0–5, delay >=1000 ms');
  values.outputDir = path.resolve(values.output, component(values.district), component(values.name));
  return values;
}
function validPdf(buffer) {
  return buffer.length > 20 && buffer.subarray(0, 5).toString() === '%PDF-' && buffer.subarray(-2048).includes(Buffer.from('%%EOF'));
}
function existingParts(directory, ac) {
  const found = new Map();
  if (!fs.existsSync(directory)) return found;
  for (const filename of fs.readdirSync(directory)) {
    const match = filename.match(/^AC(\d+)_Part(\d+)(?:_[^\\/]*)?\.pdf$/i);
    if (!match || Number(match[1]) !== ac) continue;
    const full = path.join(directory, filename);
    if (fs.statSync(full).isFile() && validPdf(fs.readFileSync(full))) found.set(Number(match[2]), full);
  }
  return found;
}
function atomicWrite(filename, data) {
  const temporary = `${filename}.${crypto.randomUUID()}.partial`;
  try { fs.writeFileSync(temporary, data); fs.renameSync(temporary, filename); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
async function fetchPart(config, part, dependencies = {}) {
  const request = dependencies.fetch || fetch;
  const pause = dependencies.sleep || sleep;
  const url = `${BASE}/AC${String(config.ac).padStart(3, '0')}/AC${String(config.ac).padStart(3, '0')}P${part}.pdf`;
  for (let attempt = 0; attempt <= config.retries; attempt++) {
    let retryDelay = Math.min(30000, 1500 * 2 ** attempt);
    try {
      const response = await request(url, { signal: AbortSignal.timeout(config.timeout), headers: { 'User-Agent': 'UP-Electoral-Roll-Downloader/1.1', Referer: 'https://ceouttarpradesh.nic.in/rollpdf/rollpdf.aspx' } });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.permanent = response.status !== 408 && response.status !== 429 && response.status < 500;
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const requested = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(requested)) retryDelay = Math.max(retryDelay, Math.min(300000, requested));
        }
        if (response.body) await response.body.cancel();
        throw error;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!validPdf(buffer)) throw new Error('Response is not a complete PDF');
      const filename = path.join(config.outputDir, `AC${config.ac}_Part${part}.pdf`);
      try { atomicWrite(filename, buffer); } catch (error) { error.permanent = true; throw error; }
      return { part, url, filename: path.basename(filename), bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), status: 'downloaded' };
    } catch (error) {
      if (error.permanent || attempt === config.retries) throw error;
      await pause(retryDelay);
    }
  }
}
async function main(args = process.argv.slice(2)) {
  const config = parseArgs(args);
  if (config.help) { console.log('node fetch_direct.js --ac 8 --name Kanth --district Moradabad --from 1 --to 226\nOptions: --concurrency 1 (max 3), --timeout 60000, --retries 3, --delay 1500, --output downloads'); return; }
  fs.mkdirSync(config.outputDir, { recursive: true });
  const lockPath = path.join(config.outputDir, '.download.lock');
  const lock = fs.openSync(lockPath, 'wx');
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const have = existingParts(config.outputDir, config.ac);
    const results = [];
    const queue = [];
    for (let part = config.from; part <= config.to; part++) {
      if (have.has(part)) {
        const buffer = fs.readFileSync(have.get(part));
        results.push({ part, status: 'verified-existing', filename: path.basename(have.get(part)), bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
      } else queue.push(part);
    }
    const manifestPath = path.join(config.outputDir, `manifest-AC${config.ac}.json`);
    const save = () => atomicWrite(manifestPath, JSON.stringify({ ac: config.ac, district: config.district, name: config.name, from: config.from, to: config.to, updatedAt: new Date().toISOString(), results: [...results].sort((a, b) => a.part - b.part) }, null, 2));
    save();
    console.log(`AC ${config.ac}: ${results.length} verified, ${queue.length} to download.`);
    let gate = Promise.resolve();
    let lastStart = 0;
    const pacedFetch = async (...requestArgs) => {
      const slot = gate.then(async () => { await sleep(Math.max(0, config.delay - (Date.now() - lastStart))); lastStart = Date.now(); });
      gate = slot.catch(() => {});
      await slot;
      requestArgs[1].signal = AbortSignal.timeout(config.timeout);
      return fetch(...requestArgs);
    };
    async function worker() {
      while (queue.length) {
        const part = queue.shift();
        let result;
        try { result = await fetchPart(config, part, { fetch: pacedFetch }); }
        catch (error) { result = { part, status: 'failed', error: error.message }; }
        results.push(result); save();
        console.log(`Part ${part}: ${result.status}${result.error ? ` (${result.error})` : ''}`);
      }
    }
    await Promise.all(Array.from({ length: config.concurrency }, worker));
    const failed = results.filter(result => result.status === 'failed');
    console.log(`Complete: ${results.length - failed.length}/${config.to - config.from + 1}; failed: ${failed.map(result => result.part).join(', ') || 'none'}`);
    if (failed.length) process.exitCode = 1;
  } finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}
module.exports = { parseArgs, component, validPdf, existingParts, atomicWrite, fetchPart, main };
if (require.main === module) main().catch(error => { console.error(`Fatal: ${error.message}`); process.exitCode = 1; });
