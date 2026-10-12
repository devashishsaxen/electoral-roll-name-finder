# Electoral Roll Name Finder

Created and maintained by **[Devashish Saxena](https://github.com/devashishsaxen)**.

[GitHub repository](https://github.com/devashishsaxen/electoral-roll-name-finder)

Download and search Indian electoral-roll PDFs locally. Version **1.2.0** adds national state/UT selection while preserving the automated UP archive workflows.

Download electoral-roll PDFs through the [Election Commission of India's national portal](https://voters.eci.gov.in/download-eroll), covering all **28 states and 8 union territories**, then search them locally. An unattended adapter remains available for the [UP CEO archive](https://ceouttarpradesh.nic.in/rollpdf/rollpdf.aspx). Independent project; not affiliated with the government.

National support is **assisted**: select the roll and complete the portal's CAPTCHA in a visible browser; the tool captures, validates and saves PDF/ZIP downloads. It does not automatically download every state or bypass portal checks. Publication dates, languages and available parts depend on the official portal.

## Coverage

| Mode | Coverage | User interaction | Verification |
| --- | --- | --- | --- |
| National ECI portal | All 28 states and 8 UTs in the state registry | Select roll/parts and complete CAPTCHA in the browser | All 36 codes checked against ECI; capture tested with synthetic files; live national download remains unverified |
| UP browser archive | Uttar Pradesh archive | Automated selection, pagination and text CAPTCHA | Live download and pagination checked for Moradabad/Kanth |
| UP direct download | Known UP AC/part ranges | Supply the AC number and part range | Live PDF download checked |
| Local PDF search | PDFs from any state/UT | Supply a directory and query | Synthetic tests and a downloaded UP PDF checked |

These modes cover documents available through their respective portals. They do not guarantee that every roll is current, every part is available, or every PDF has searchable text.

## Requirements

- Node.js 20 or newer (Node 22 recommended).
- Python 3.10 or newer for searching.
- Chromium installed through Playwright for the browser workflow.

```sh
npm ci
npm run install-browsers
python -m pip install -r requirements.txt
```

For Linux CI or a fresh Linux host, `npx playwright install --with-deps chromium` also installs browser system dependencies. Direct downloads do not require a browser. Search does not require Node.js.

## Download from any state or UT

Quick start after installing dependencies:

```sh
node download_india.js --state "Karnataka"
```

1. Confirm the state in the browser.
2. Choose the district, constituency, roll/year, language and parts.
3. Complete CAPTCHA and click the portal's download button.
4. Wait for the terminal to report `downloaded` or `verified-existing`.
5. Press Enter in the terminal when finished.

List states or select another state by name:

```sh
node download_india.js --list-states
node download_india.js --state "Karnataka"
node download_india.js --state "Tamil Nadu" --max-downloads 2
node download_india.js --state "Delhi"
```

You can also use `npm start -- --state "Karnataka"`. In Windows PowerShell, use `npm.cmd start -- --state "Karnataka"` if the npm PowerShell wrapper drops arguments.

Names or official ECI codes are accepted: `--state S13` for Maharashtra and `--state S24` for Uttar Pradesh. The browser opens the national portal with that state's code. Verify the selected state in the page; if the portal ignores the query parameter, select the state there yourself. Choose district, constituency, roll/year, language and parts, complete CAPTCHA, and click the official download button. These controls remain under your control to accommodate portal changes and different publication types.

Keep the browser on the requested state. To download another state, finish and start a separate session. The directory and manifest record the **requested state**, not independently verified contents of each PDF. Wait for `downloaded` or `verified-existing` before closing the browser. Finish by pressing Enter in the terminal or closing the browser. `--max-downloads` counts file events; a ZIP containing several PDFs counts as one download.

Files go to `downloads/<ECI-code>_<state-name>/` with a sanitized original name and content-hash suffix. Different rolls with the same suggested filename do not overwrite each other. Identical files are detected after downloading; this does not avoid the portal's network transfer. ZIP bundles stay intact: extract them locally before searching. PDF validation checks header/end markers; ZIP validation checks local-header/end-record markers. These are lightweight checks, not full structural audits.

Each session writes a separate JSON manifest with checksums and status. Query strings are omitted from captured source-page URLs. Downloads and manifest filenames may contain personal data and stay ignored by Git. No browser profile, login cookies or CAPTCHA answers are persisted by this application. If login is required, complete it in the visible browser.

| Option | Default | Meaning |
| --- | --- | --- |
| `--state` | required | State/UT name or ECI code |
| `--list-states` | not enabled | List all 36 choices without opening the browser |
| `--output` | `downloads` | Parent download folder |
| `--max-downloads` | `0` | File events to accept; 0 means unlimited |
| `--idle-timeout` | `1800` | Seconds without accepted/completed downloads before ending; 30-86400 |

A session with no successful downloads or any failed download returns status 1. A successful session records only selected files; it does not establish constituency completeness. Captures are limited to downloads initiated from HTTPS ECI pages. If the portal shows a blank page or unavailable controls, reload it in the visible browser or retry later.

`npm run verify:india` checks the official page and all 36 codes without downloading voter data. `node scripts/verify-india-capture.js` tests Chromium download capture with synthetic fixtures and intercepted HTTP. See [VERIFICATION.md](VERIFICATION.md) for the current test scope and limits.

## Download from the UP archive automatically

```sh
npm run download:up
```

Defaults: district **Moradabad**, AC **Moradabad West**, headless browser, all result pages. Files go to `downloads/<district>/<AC>/AC<number>_Part<number>.pdf`. The script uses the dropdowns and the site's text CAPTCHA modal, and saves the browser download. It verifies pagination before continuing.

PowerShell example:

```powershell
$env:DISTRICT = 'Moradabad'
$env:AC = 'Kanth'
$env:HEADLESS = 'false'
$env:MAX_ROWS = '2'
npm run download:up
```

Bash example:

```sh
DISTRICT=Moradabad AC=Kanth HEADLESS=false MAX_ROWS=2 npm run download:up
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISTRICT` | `Moradabad` | Exact district label, ignoring case |
| `AC` | `Moradabad West` | Exact constituency label, ignoring case |
| `HEADLESS` | `true` | Set `false` to show the browser |
| `PAGE` | `1` | First results page to process |
| `ALL_PAGES` | `true` | Set `false` to process only `PAGE` |
| `MAX_ROWS` | unlimited | Maximum parts processed across pages, including skipped files |
| `DEBUG_CAPTCHA` | unset | Set `1` to save HTML/screenshots after failures |

The final summary describes the processed selection; limits or a later starting page do not imply the whole constituency is complete. `browser-manifest.json` records successes and failures. Incomplete runs exit with status 1. A fatal navigation error also returns status 1.

## Download a known UP archive part range directly

```sh
node fetch_direct.js --ac 8 --name Kanth --district Moradabad --from 151 --to 152
node fetch_direct.js --help
```

This downloads the published static PDF URLs. Confirm the AC number and available parts against the government table; a numeric range does not discover missing or newly added parts. Defaults are AC 8, Kanth, Moradabad, parts 1–226.

Options: `--concurrency` (default 1, maximum 3), `--timeout` (default 60000 ms), `--retries` (default 3 additional attempts), `--delay` (default 1500 ms, minimum 1000 ms between request starts), and `--output` (default `downloads`). Names determine the output directory; they do not select an AC on the server.

Transient failures retry with increasing delays. Rate-limit responses honor `Retry-After`, capped at five minutes. Permanent client errors such as 404 do not retry. Both methods check the PDF header and end marker, write through temporary files, and validate files before skipping them. This is a lightweight completeness check, not a full structural PDF audit. A valid existing file is not automatically refreshed if the government replaces it.

`manifest-AC<number>.json` records the latest selected run, including checksums and errors; previous manifests are replaced. Rerunning the same selection retries missing or invalid PDFs. Do not run multiple downloaders for the same output directory. If a crash leaves `.download.lock`, inspect its PID and remove that file only after confirming the process has stopped. Existing station-named files are recognized if the AC and part match.

## Search PDFs

Search a state folder, including PDFs in its subfolders. Extract any ZIP bundles first:

```sh
python search_rolls.py downloads/S10_Karnataka --query "Example" --output results/search.json --csv results/search.csv
```

For files downloaded through the UP archive mode:

```sh
python search_rolls.py downloads/Moradabad/Kanth --query "Example" --output results/search.json --csv results/search.csv
```

Use a name in the document's language and script; replace `Example` with your own query. Repeat `--query` for multiple literal terms. Exact search supports any script represented correctly in the PDF's text layer. `--mode skeleton` is specific to Devanagari: it removes vowel signs and selected marks to find candidates affected by extraction errors. Approximate matches can produce false positives and need visual review. Neither mode guarantees a match if the text layer has damaged consonants, missing text, or different spelling.

Results include every matching line, source PDF, page, query, and match type. No 60-character line cutoff or 50-result cap applies. `--context 4` includes nearby lines for review; proximity does not establish that names belong to the same voter or family. Matches are case-sensitive literal substrings, not regular expressions or structured voter records.

The report separates successfully searched files, unreadable PDFs, and pages without extractable text. Exit status 1 means coverage is incomplete, even if some matches were found. No files or invalid arguments return status 2. Zero matches with complete coverage returns status 0.

Extracted text is cached under `.cache/text`, keyed by PDF content, extraction version, and OCR settings. Use `--no-cache` to disable it. The cache contains document text and should remain local.

Optional `--ocr` attempts OCR on pages with no text. It requires Tesseract and both Hindi (`hin`) and English (`eng`) language data configured for PyMuPDF. OCR failures appear in coverage errors. Pages with a damaged but nonempty text layer are not automatically OCR'd.

The older `search_names.py`, `search_context.py`, `search_skeleton.py`, and `search_skeleton_context.py` commands forward to the new engine. They now require a directory and `--query`; personal hardcoded targets have been removed.

## Verification and tests

```sh
npm test
python -m unittest discover -s tests -p "test_*.py"
```

Tests use synthetic fixtures and mocked HTTP responses, with no government traffic. CI runs them on Windows and Linux. To run the opt-in live smoke test:

```sh
node scripts/verify-government.js
```

The UP-specific live smoke test selects Moradabad/Kanth, checks two result pages, and downloads **one PDF** through the site's CAPTCHA modal. Its report and PDF remain in `.verification/browser`. Government availability may vary; a successful smoke test does not verify every constituency or part.

National checks are separate:

```sh
npm run verify:india
node scripts/verify-india-capture.js
```

The first command checks live ECI page/state metadata without downloading rolls. The second uses synthetic files to test browser download capture. Neither verifies a live national CAPTCHA/download flow. See [VERIFICATION.md](VERIFICATION.md) for recorded results.

## Troubleshooting

| Problem | Action |
| --- | --- |
| National portal is blank or controls do not load | Reload in the visible browser or retry later; a successful metadata check does not establish that the page renders |
| Wrong state appears | Select the requested state in the page before downloading |
| A ZIP downloads | Extract it locally, then search the extracted PDFs |
| No matches are found | Check the query's script and the report's coverage/errors; pages may require OCR |
| `.download.lock` already exists | Confirm the previous downloader has stopped before removing its stale lock |
| PowerShell drops npm arguments | Use the direct `node` commands above or invoke `npm.cmd` |

## Prepare a public release

```sh
npm run release:check
npm run release:prepare
```

The export is created at `release/india-electoral-roll-downloader` using an explicit source-file list. Publish that folder as the repository root. The exporter refuses to overwrite an existing export. It includes code, docs, license, tests, and CI; it excludes PDFs, names/search outputs, candidate images, debug pages, caches, and dependencies. `.gitignore` also excludes these artifacts from this working directory. It does not remove anything previously tracked by Git.

Keep downloads and search outputs local; electoral rolls and derived results contain personal information. No roll data is bundled with this project.

To remove generated data from this working directory, run the supplied cleanup script in PowerShell. It deletes downloads, search outputs, caches, debug captures and release exports, so retain anything you intend to keep elsewhere first:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cleanup-personal-data.ps1
```

License: MIT; see [LICENSE](LICENSE). See [CONTRIBUTING.md](CONTRIBUTING.md) for changes and bug reports.

The latest live test scope and results are recorded in [VERIFICATION.md](VERIFICATION.md).
