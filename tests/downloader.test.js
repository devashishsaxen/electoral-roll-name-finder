'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs, validPdf, existingParts, fetchPart, component } = require('../fetch_direct');
const pdf = Buffer.from('%PDF-1.7\nsynthetic test fixture\n%%EOF\n');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'roll-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
test('invalid arguments fail before any downloads', () => {
  for (const args of [['--concurrency', '0'], ['--concurrency', '4'], ['--ac', '8abc'], ['--from', '5', '--to', '2'], ['--to'], ['--unknown', 'x'], ['--delay', '0']]) assert.throws(() => parseArgs(args));
  assert.equal(parseArgs([]).concurrency, 1);
  assert.throws(() => component('..'));
  assert.throws(() => component('CON'));
  assert.equal(component('Moradabad West'), 'Moradabad_West');
});
test('resume ignores wrong AC, text files, and truncated PDFs', t => {
  const directory = fixture(t);
  fs.writeFileSync(path.join(directory, 'AC999_Part1.pdf'), pdf);
  fs.writeFileSync(path.join(directory, 'Part2.txt'), pdf);
  fs.writeFileSync(path.join(directory, 'AC8_Part3.pdf'), '%PDF-1.7\nincomplete');
  fs.writeFileSync(path.join(directory, 'AC8_Part4_Station.pdf'), pdf);
  assert.deepEqual([...existingParts(directory, 8).keys()], [4]);
  assert.equal(validPdf(Buffer.from('<html>error</html>')), false);
});
test('transient HTTP failures retry and atomically save a verified file', async t => {
  const directory = fixture(t);
  let calls = 0;
  const delays = [];
  const result = await fetchPart({ ac: 8, retries: 2, timeout: 1000, outputDir: directory }, 151, {
    fetch: async url => { assert.match(url, /AC008\/AC008P151\.pdf$/); return ++calls === 1 ? new Response('busy', { status: 503 }) : new Response(pdf); },
    sleep: async delay => delays.push(delay),
  });
  assert.equal(calls, 2);
  assert.equal(delays.length, 1);
  assert.equal(result.sha256.length, 64);
  assert.deepEqual(fs.readFileSync(path.join(directory, result.filename)), pdf);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.partial')), false);
});
test('404 does not retry', async t => {
  let calls = 0;
  await assert.rejects(fetchPart({ ac: 8, retries: 3, timeout: 1000, outputDir: fixture(t) }, 1, { fetch: async () => { calls++; return new Response('missing', { status: 404 }); }, sleep: async () => {} }), /HTTP 404/);
  assert.equal(calls, 1);
});
test('rate limiting honors Retry-After', async t => {
  let calls = 0;
  const delays = [];
  await fetchPart({ ac: 8, retries: 1, timeout: 1000, outputDir: fixture(t) }, 1, { fetch: async () => ++calls === 1 ? new Response('busy', { status: 429, headers: { 'Retry-After': '7' } }) : new Response(pdf), sleep: async delay => delays.push(delay) });
  assert.deepEqual(delays, [7000]);
});
test('timeout errors exhaust bounded retries', async t => {
  let calls = 0;
  await assert.rejects(fetchPart({ ac: 8, retries: 1, timeout: 1000, outputDir: fixture(t) }, 1, { fetch: async () => { calls++; throw new DOMException('timed out', 'TimeoutError'); }, sleep: async () => {} }), /timed out/);
  assert.equal(calls, 2);
});
test('HTML and truncated responses never become completed files', async t => {
  const directory = fixture(t);
  for (const body of ['<html>error</html>', '%PDF-1.7\ntruncated document']) {
    await assert.rejects(fetchPart({ ac: 8, retries: 0, timeout: 1000, outputDir: directory }, 1, { fetch: async () => new Response(body) }), /complete PDF/);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
});
test('CLI failures persist a manifest, release the lock, and exit nonzero', t => {
  const output = fixture(t);
  const source = `global.fetch = async () => new Response('missing', {status:404}); require('./fetch_direct').main(['--from','1','--to','1','--output',process.argv[1]]).catch(error=>{console.error(error);process.exitCode=1});`;
  const result = spawnSync(process.execPath, ['-e', source, output], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const directory = path.join(output, 'Moradabad', 'Kanth');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest-AC8.json')));
  assert.equal(manifest.results[0].status, 'failed');
  assert.equal(manifest.results[0].error, 'HTTP 404');
  assert.equal(fs.existsSync(path.join(directory, '.download.lock')), false);
});
test('CLI resumes validated files without making a request', t => {
  const output = fixture(t);
  const directory = path.join(output, 'Moradabad', 'Kanth');
  fs.mkdirSync(directory, {recursive:true});
  fs.writeFileSync(path.join(directory, 'AC8_Part1.pdf'), pdf);
  const source = `global.fetch = async () => {throw new Error('unexpected request')}; require('./fetch_direct').main(['--from','1','--to','1','--output',process.argv[1]]).catch(()=>{process.exitCode=1});`;
  const result = spawnSync(process.execPath, ['-e', source, output], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'manifest-AC8.json'))).results[0].status, 'verified-existing');
});
