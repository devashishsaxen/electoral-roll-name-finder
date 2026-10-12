'use strict';
// Read-only live metadata check: downloads no electoral-roll documents.
const assert = require('node:assert/strict');
const { STATES, portalUrl } = require('../lib/states');
const { setTimeout: sleep } = require('node:timers/promises');
async function main() {
  const response = await fetch(portalUrl('S10'), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`ECI page HTTP ${response.status}`);
  const html = await response.text();
  const source = [...html.matchAll(/src="([^"\s]+\.js)"/g)].map(match => new URL(match[1], response.url)).find(url => url.origin === 'https://voters.eci.gov.in' && /^\/static\/js\/main\.[a-z0-9]+\.js$/.test(url.pathname));
  if (!source) throw new Error('ECI application bundle was not found; portal markup may have changed');
  await sleep(1500);
  const bundle = await fetch(source, { signal: AbortSignal.timeout(30000) });
  if (!bundle.ok) throw new Error(`ECI application HTTP ${bundle.status}`);
  const js = await bundle.text();
  const liveStates = new Map([...js.matchAll(/([SU]\d\d):\{name:"([^"\\]+)"/g)].map(match => [match[1], match[2]]));
  for (const state of STATES) assert.equal(liveStates.get(state.code), state.name, `${state.code}: national registry differs from the live ECI application`);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: portalUrl('S10'), httpStatus: response.status, statesMatched: STATES.length, documentDownloads: 0, scope: 'Official page and state-code metadata only; CAPTCHA, rendered controls, and roll downloads require an interactive browser check.' }, null, 2));
}
main().catch(error => { console.error(`National metadata verification failed: ${error.message}`); process.exitCode = 1; });
