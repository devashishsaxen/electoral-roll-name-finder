'use strict';

// Codes and labels verified against the ECI portal's public application,
// 12 October 2026. S09 and U04 are not current portal entries.
const STATES = Object.freeze([
  ['S01', 'Andhra Pradesh'], ['S02', 'Arunachal Pradesh'], ['S03', 'Assam'],
  ['S04', 'Bihar'], ['S05', 'Goa'], ['S06', 'Gujarat'], ['S07', 'Haryana'],
  ['S08', 'Himachal Pradesh'], ['S10', 'Karnataka'], ['S11', 'Kerala'],
  ['S12', 'Madhya Pradesh'], ['S13', 'Maharashtra'], ['S14', 'Manipur'],
  ['S15', 'Meghalaya'], ['S16', 'Mizoram'], ['S17', 'Nagaland'], ['S18', 'Odisha'],
  ['S19', 'Punjab'], ['S20', 'Rajasthan'], ['S21', 'Sikkim'], ['S22', 'Tamil Nadu'],
  ['S23', 'Tripura'], ['S24', 'Uttar Pradesh'], ['S25', 'West Bengal'],
  ['S26', 'Chhattisgarh'], ['S27', 'Jharkhand'], ['S28', 'Uttarakhand'],
  ['S29', 'Telangana'], ['U01', 'Andaman & Nicobar Islands'], ['U02', 'Chandigarh'],
  ['U03', 'Dadra & Nagar Haveli and Daman & Diu'], ['U05', 'NCT OF Delhi'],
  ['U06', 'Lakshadweep'], ['U07', 'Puducherry'], ['U08', 'Jammu and Kashmir'],
  ['U09', 'Ladakh'],
].map(([code, name]) => Object.freeze({ code, name })));
const key = value => value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const ALIASES = { up: 'S24', uk: 'S28', delhi: 'U05', odissa: 'S18', orissa: 'S18', pondicherry: 'U07', jammuandkashmir: 'U08', andamanandnicobar: 'U01', dadraandnagarhavelianddamananddiu: 'U03' };
function resolveState(value) {
  const normalized = key(value);
  const state = STATES.find(state => key(state.code) === normalized || key(state.name) === normalized || state.code === ALIASES[normalized]);
  if (!state) throw new Error(`Unknown state/UT: ${value}. Run --list-states for accepted names and codes.`);
  return state;
}
function portalUrl(state) { return `https://voters.eci.gov.in/download-eroll?stateCode=${resolveState(state.code || state).code}`; }
module.exports = { STATES, resolveState, portalUrl };
