# Verification record

## National mode (v1.2.0)

On 12 October 2026, the official national ECI page returned HTTP 200. A read-only check matched all **36 state/UT codes and labels** in `lib/states.js` against the live public application bundle. The [ECI announcement published by PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2154489&lang=2&reg=48) identifies this as the national electoral-roll download portal.

The new mode opens that portal in a visible browser, requires the user to select the roll and complete portal checks, and captures resulting PDF/ZIP file downloads. It preserves the existing automated UP archive adapter. It does not provide an unattended nationwide downloader.

Offline validation: 16 Node tests and 5 Python tests passed. A Chromium integration check passed with an intercepted page and a synthetic PDF blob, covering browser download capture, validated saving, and duplicate detection. No electoral-roll data was retained during national-mode development. The source release contains no voter data.

**Live limitation:** the ECI page did not finish rendering its controls during headless browser inspection. No national PDF download or CAPTCHA flow was verified end to end. The live metadata check establishes the current registry, not availability of every constituency's roll. The assisted mode still needs an interactive check on the user's connection. It captures actual selected files rather than claiming completeness for all states.

## Previous UP archive checks (v1.1.0)

Checked on **12 October 2026**, Asia/Kolkata, from the development machine. The source was the official UP CEO archive at https://ceouttarpradesh.nic.in/rollpdf/rollpdf.aspx.

## Live checks

- The government page returned HTTP 200 in Chromium.
- Selected district Moradabad and constituency Kanth using the live dropdowns.
- Loaded 50 download rows on page 1 and 50 on page 2; page 2 began with part 51.
- Downloaded AC 8, part 51 through the government CAPTCHA modal: 2,304,168 bytes; SHA-256 `fb897e9f8394ccef02208035ddb3a6f1c5b8e5df289e7b518f94399d6bdef8e9`.
- Separately downloaded AC 8, part 151 through the direct downloader into a fresh output directory. PyMuPDF opened it successfully with 29 pages.
- Searched that fresh PDF with a synthetic query: all 29 pages searched, no unreadable files or pages without text. Exported JSON and CSV.
- A one-part browser CLI run also completed successfully for Kanth part 1.

Downloaded evidence, manifests, extracted text, search results, candidate images, and debug captures were removed during cleanup. The source export contains no downloaded rolls or derived personal-data artifacts. The initial browser attempt timed out while waiting for `domcontentloaded` after a postback; the final code waits for navigation commit and the required page controls instead. The later live checks passed with that change.

## Offline checks

Automated tests cover argument validation, wrong-AC/corrupt-file resume, transient failures, permanent 404s, rate-limit delays, bounded retries, rejected HTML/truncated PDFs, failure exit status, manifests, resume without requests, missing-text coverage, corrupt PDFs, long-line search, cache invalidation, and Unicode normalization. Fixtures contain synthetic data.

An earlier local audit opened all 379 existing PDFs successfully. That audit checks the existing collection, not government availability or archive completeness.

## Limits

The live smoke test verifies one district/constituency and two result pages, not every page, constituency, or PDF. It does not establish that this archive contains current rolls. OCR is optional and was not exercised in the live check. Windows was tested locally; Linux CI is configured but has not yet run on a hosted runner. Network availability and government markup can change.
