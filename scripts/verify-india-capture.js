'use strict';
// Offline Chromium check: all HTTP is intercepted, fixtures are synthetic.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { officialPage, saveDownload } = require('../download_india');
async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'india-capture-'));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ acceptDownloads: true });
    const pdf = Buffer.from('%PDF-1.7\nsynthetic browser fixture\n%%EOF\n');
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://voters.eci.gov.in') return route.abort();
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<a download="synthetic.pdf">Download synthetic fixture</a><script>document.querySelector('a').href=URL.createObjectURL(new Blob([${JSON.stringify(pdf.toString())}],{type:'application/pdf'}));</script>` });
    });
    await page.goto('https://voters.eci.gov.in/download-eroll?stateCode=S10');
    assert.equal(officialPage(page.url()), true);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link').click()]);
    const first = await saveDownload(download, directory);
    assert.deepEqual(fs.readFileSync(path.join(directory, first.filename)), pdf);
    const [repeat] = await Promise.all([page.waitForEvent('download'), page.getByRole('link').click()]);
    assert.equal((await saveDownload(repeat, directory)).status, 'verified-existing');
    assert.equal(fs.readdirSync(directory).length, 1);
    console.log('Offline Chromium capture passed: download event, PDF save, and duplicate detection. Government requests: 0.');
  } finally {
    if (browser) await browser.close();
    const allowed = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(directory).startsWith(allowed)) throw new Error('Temporary directory outside intended location');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
