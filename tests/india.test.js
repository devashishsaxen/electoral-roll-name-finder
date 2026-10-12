'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { STATES, resolveState, portalUrl } = require('../lib/states');
const { parseArgs, officialPage, publicUrl, validZip, saveDownload } = require('../download_india');
const pdf = Buffer.from('%PDF-1.7\nsynthetic fixture\n%%EOF\n');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'india-roll-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function fakeDownload(buffer, suggestion = 'example.pdf') {
  return { saveAs: async filename => fs.writeFileSync(filename, buffer), suggestedFilename: () => suggestion, delete: async () => {} };
}
test('national registry covers 28 states and 8 UTs with distinct official codes', () => {
  assert.equal(STATES.length, 36);
  assert.equal(STATES.filter(state => state.code.startsWith('S')).length, 28);
  assert.equal(STATES.filter(state => state.code.startsWith('U')).length, 8);
  assert.equal(new Set(STATES.map(state => state.code)).size, 36);
  for (const state of STATES) assert.equal(new URL(portalUrl(state)).searchParams.get('stateCode'), state.code);
  assert.equal(resolveState('up').code, 'S24');
  assert.equal(resolveState('DELHI').code, 'U05');
  assert.equal(resolveState('jammu & kashmir').code, 'U08');
  assert.equal(resolveState('Tamil Nadu').code, 'S22');
  assert.throws(() => resolveState('S09'));
});
test('national CLI rejects missing states and invalid limits', () => {
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--state', 'unknown']));
  assert.throws(() => parseArgs(['--state', 'Goa', '--idle-timeout', '1']));
  assert.throws(() => parseArgs(['--state', 'Goa', '--max-downloads', '-1']));
  assert.throws(() => parseArgs(['--state', 'Goa', '--output']));
  assert.throws(() => parseArgs(['--state', 'Goa', '--unsafe', 'true']));
  assert.equal(parseArgs(['--state', 'Karnataka']).state.code, 'S10');
});
test('capture is limited to official pages and strips URL query tokens from reports', () => {
  assert.equal(officialPage('https://voters.eci.gov.in/download-eroll'), true);
  assert.equal(officialPage('https://eci.gov.in/'), true);
  for (const url of ['https://eci.gov.in.example.org/', 'http://voters.eci.gov.in/', 'https://example.org/']) assert.equal(officialPage(url), false);
  assert.equal(publicUrl('https://voters.eci.gov.in/download-eroll?token=secret#fragment'), 'https://voters.eci.gov.in/download-eroll');
});
test('downloads retain distinct contents despite identical suggested names', async t => {
  const directory = fixture(t);
  const first = await saveDownload(fakeDownload(pdf), directory);
  const second = await saveDownload(fakeDownload(Buffer.from('%PDF-1.7\nother fixture\n%%EOF\n')), directory);
  assert.notEqual(first.filename, second.filename);
  assert.equal(fs.readdirSync(directory).length, 2);
  const repeat = await saveDownload(fakeDownload(pdf), directory);
  assert.equal(repeat.status, 'verified-existing');
  fs.writeFileSync(path.join(directory, first.filename), 'corrupt');
  assert.equal((await saveDownload(fakeDownload(pdf), directory)).status, 'downloaded');
  assert.deepEqual(fs.readFileSync(path.join(directory, first.filename)), pdf);
});
test('unsafe names are contained in the selected output directory', async t => {
  const directory = fixture(t);
  const result = await saveDownload(fakeDownload(pdf, '../../CON.pdf'), directory);
  assert.match(result.filename, /^roll_[a-f0-9]+\.pdf$/);
  assert.equal(fs.readdirSync(directory).length, 1);
});
test('error pages and truncated PDFs are rejected and temporary files removed', async t => {
  const directory = fixture(t);
  for (const buffer of [Buffer.from('<html>CAPTCHA required</html>'), Buffer.from('%PDF-1.7\ntruncated')]) await assert.rejects(saveDownload(fakeDownload(buffer), directory), /complete PDF/);
  assert.deepEqual(fs.readdirSync(directory), []);
});
test('ZIPs require a complete end record, not just the PK signature', async t => {
  const directory = fixture(t);
  const zip = Buffer.alloc(52);
  zip.writeUInt32LE(0x04034b50, 0);
  zip.writeUInt32LE(0x06054b50, 30);
  zip.writeUInt16LE(1, 40);
  assert.equal(validZip(zip), true);
  assert.equal(validZip(zip.subarray(0, 40)), false);
  assert.equal(validZip(Buffer.from('PK bogus file')), false);
  const result = await saveDownload(fakeDownload(zip, 'example.zip'), directory);
  assert.equal(result.format, 'zip');
});
