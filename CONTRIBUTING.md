# Contributing

Use Node.js 20+ and Python 3.10+. Install dependencies as described in the README, then run both offline test suites before submitting a change.

For downloader changes, add regression tests for the affected failure path using mocked responses. For search changes, use synthetic PDFs and report coverage as well as matches. Keep government smoke tests opt-in; do not add bulk downloads to CI. National metadata verification must not download electoral-roll documents. Use `node scripts/verify-india-capture.js` for the offline browser capture check. National CAPTCHA and roll selection remain user actions in the visible browser.

Bug reports should include the command, runtime versions, error, and expected behavior. Replace private search queries with synthetic examples. Do not attach electoral rolls, voter details, real search results, or unredacted HTML captures. Describe selector changes or provide a minimal synthetic HTML example instead.

Keep generated data, caches, node_modules, and credentials out of commits. Use `npm run release:prepare` to export a source-only copy when publishing from a working directory containing downloaded data.
