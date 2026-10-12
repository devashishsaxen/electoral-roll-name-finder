'use strict';
// Opt-in live smoke test: two table pages and one PDF, no bulk download.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadResults, goToPage, catalog, downloadRow } = require('../download_rolls');
async function main() {
  const directory = path.resolve(__dirname, '../.verification/browser');
  fs.mkdirSync(directory, { recursive: true });
  const report = { checkedAt: new Date().toISOString(), source: 'https://ceouttarpradesh.nic.in/rollpdf/rollpdf.aspx', district: 'Moradabad', ac: 'Kanth' };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    page.on('dialog', dialog => dialog.dismiss());
    console.log('Opening government results page...');
    await loadResults(page, report.district, report.ac);
    const first = await catalog(page);
    report.page1Rows = first.length;
    console.log(`Page 1: ${first.length} rows`);
    await goToPage(page, 2);
    const second = await catalog(page);
    if (first[0].part === second[0].part) throw new Error('Page 2 repeats page 1');
    report.page2Rows = second.length;
    report.page2FirstPart = second[0].part;
    console.log(`Page 2: ${second.length} rows; downloading one PDF through the modal...`);
    const result = await downloadRow(page, second[0], directory);
    report.download = { ac: result.ac, part: result.part, bytes: result.bytes, sha256: result.sha256 };
    report.success = true;
  } catch (error) { report.success = false; report.error = error.message; process.exitCode = 1; }
  finally {
    await browser.close();
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
