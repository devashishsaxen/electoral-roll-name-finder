'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { component, validPdf, existingParts, atomicWrite } = require('./fetch_direct');
const URL = 'https://ceouttarpradesh.nic.in/rollpdf/rollpdf.aspx';
const GRID = '#ctl00_ContentPlaceHolder1_ElecRollGrd';

function positive(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}
async function selectLabel(page, selector, label) {
  await page.waitForFunction(({ selector, label }) => [...document.querySelectorAll(`${selector} option`)].some(option => option.textContent.trim().toLowerCase() === label.trim().toLowerCase()), { selector, label }, { timeout: 60000 });
  const option = await page.locator(`${selector} option`).evaluateAll((options, wanted) => options.find(option => option.textContent.trim().toLowerCase() === wanted.trim().toLowerCase())?.value, label);
  if (!option) throw new Error(`Option unavailable: ${label}`);
  await page.locator(selector).selectOption(option);
}
async function loadResults(page, district, ac) {
  await page.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'commit', timeout: 60000 }),
    selectLabel(page, '#ctl00_ContentPlaceHolder1_DDLDistrict', district),
  ]);
  await page.locator('#ctl00_ContentPlaceHolder1_DDL_AC option').first().waitFor({ state: 'attached' });
  await selectLabel(page, '#ctl00_ContentPlaceHolder1_DDL_AC', ac);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'commit', timeout: 60000 }),
    page.getByRole('button', { name: 'Show', exact: true }).click(),
  ]);
  await page.locator(`${GRID} a[id$="lnkDownload"]`).first().waitFor();
}
async function goToPage(page, target) {
  if (target === 1) return;
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'commit', timeout: 60000 }),
    page.evaluate(number => window.__doPostBack('ctl00$ContentPlaceHolder1$ElecRollGrd', `Page$${number}`), target),
  ]);
  await page.waitForFunction(({ grid, number }) => [...document.querySelectorAll(`${grid} table span`)].some(node => node.textContent.trim() === String(number)), { grid: GRID, number: target }, { timeout: 60000 });
}
async function catalog(page) {
  return page.locator(`${GRID} a[id$="lnkDownload"]`).evaluateAll(links => links.map(link => {
    const cells = [...link.closest('tr').cells].map(cell => cell.innerText.trim());
    const match = (link.getAttribute('onclick') || '').match(/Erollpdf\/AC(\d+)\/AC\d+P(\d+)\.pdf/i);
    if (!match) throw new Error('Government PDF link format changed');
    return { ac: Number(match[1]), part: Number(match[2]), station: cells[2], linkId: link.id };
  }));
}
async function downloadRow(page, row, directory) {
  await page.locator(`[id="${row.linkId}"]`).click();
  await page.locator('#captchaModal').waitFor({ state: 'visible' });
  const captcha = (await page.locator('#captchaText').innerText()).trim();
  if (!/^[A-Z0-9]{4,8}$/i.test(captcha)) throw new Error('Unexpected CAPTCHA text; inspect the government page');
  await page.locator('#captchaInput').fill(captcha);
  const event = page.waitForEvent('download', { timeout: 60000 });
  // Observe failures immediately even if the click itself throws.
  event.catch(() => {});
  await page.locator('#captchaModal').getByRole('button', { name: 'Submit', exact: true }).click();
  const download = await event;
  const temporary = path.join(directory, `${crypto.randomUUID()}.partial`);
  const filename = `AC${row.ac}_Part${row.part}.pdf`;
  try {
    await download.saveAs(temporary);
    const bytes = fs.readFileSync(temporary);
    if (!validPdf(bytes)) throw new Error('Downloaded file is not a complete PDF');
    atomicWrite(path.join(directory, filename), bytes);
    return { ...row, filename, status: 'downloaded', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    await download.delete().catch(() => {});
  }
}
async function main() {
  const district = process.env.DISTRICT || 'Moradabad';
  const ac = process.env.AC || 'Moradabad West';
  const startPage = positive(process.env.PAGE, 1, 'PAGE');
  const limit = positive(process.env.MAX_ROWS, Infinity, 'MAX_ROWS');
  const allPages = process.env.ALL_PAGES !== 'false';
  const directory = path.resolve(__dirname, 'downloads', component(district), component(ac));
  fs.mkdirSync(directory, { recursive: true });
  const lockPath = path.join(directory, '.download.lock');
  const lock = fs.openSync(lockPath, 'wx');
  let browser;
  const results = [];
  const seen = new Set();
  let runStatus = 'running';
  let runError;
  const manifest = () => atomicWrite(path.join(directory, 'browser-manifest.json'), JSON.stringify({ district, ac, startPage, allPages, limit: Number.isFinite(limit) ? limit : null, runStatus, error: runError, updatedAt: new Date().toISOString(), results }, null, 2));
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.dismiss());
    await loadResults(page, district, ac);
    if (startPage > 1) await goToPage(page, startPage);
    let currentPage = startPage;
    while (results.length < limit) {
      const rows = await catalog(page);
      if (!rows.length) throw new Error(`No download rows on page ${currentPage}`);
      const have = existingParts(directory, rows[0].ac);
      for (const row of rows) {
        if (results.length >= limit) break;
        const key = `${row.ac}:${row.part}`;
        if (seen.has(key)) throw new Error(`Pagination repeated ${key}`);
        seen.add(key);
        let result = { ...row, page: currentPage, status: 'failed' };
        if (have.has(row.part)) result = { ...result, status: 'verified-existing', filename: path.basename(have.get(row.part)) };
        else {
          for (let attempt = 0; attempt < 3; attempt++) {
            try { result = { ...await downloadRow(page, row, directory), page: currentPage }; break; }
            catch (error) {
              result.error = error.message;
              if (process.env.DEBUG_CAPTCHA === '1') {
                fs.mkdirSync('debug', { recursive: true });
                await page.screenshot({ path: `debug/failed-part${row.part}.png`, fullPage: true }).catch(() => {});
                fs.writeFileSync(`debug/failed-part${row.part}.html`, await page.content());
              }
              if (attempt < 2) {
                await page.waitForTimeout(2000 * (attempt + 1));
                await loadResults(page, district, ac);
                if (currentPage > 1) await goToPage(page, currentPage);
              }
            }
          }
          await page.waitForTimeout(1500);
        }
        results.push(result); manifest();
        console.log(`Page ${currentPage}, part ${row.part}: ${result.status}`);
      }
      if (!allPages || results.length >= limit) break;
      const hasNext = await page.locator(`${GRID} a`).evaluateAll((links, next) => links.some(link => (link.getAttribute('href') || '').includes(`'Page$${next}'`)), currentPage + 1);
      if (!hasNext) break;
      await goToPage(page, ++currentPage);
    }
    const failures = results.filter(result => result.status === 'failed');
    runStatus = failures.length ? 'incomplete' : 'complete-selection';
    console.log(`Processed ${results.length} parts; failed ${failures.length}. See browser-manifest.json.`);
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    runStatus = 'failed'; runError = error.message; throw error;
  } finally {
    try { manifest(); }
    finally {
      try { if (browser) await browser.close(); }
      finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
    }
  }
}
module.exports = { positive, selectLabel, loadResults, goToPage, catalog, downloadRow };
if (require.main === module) main().catch(error => { console.error(`Fatal: ${error.message}`); process.exitCode = 1; });
