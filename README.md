# pdfdiff

Compare two issues of technical PDF drawings in your browser. The existing single-page overlay, swipe, measurement and annotation tools remain available. **Batch workspace** adds complete drawing-package review.

## Run

Serve this directory over HTTP (or deploy it as static files, for example with GitHub Pages):

```sh
python3 -m http.server 8001 --bind 127.0.0.1
```

There is no application build, backend, package installation or mandatory API key. Keep `index.html`, `app.js`, `core.js`, `workspace.js`, `styles.css` and `assets/` together. Use a modern browser with Web Crypto, native dialogs, canvas and Web Workers. Automated validation runs in Chromium; directory selection depends on browser support. Use a secure context (HTTPS, or localhost for development) for file fingerprinting.

## Review a package

1. Open **Batch workspace** and add the old and new issues using multiple PDFs, folders or ZIP files. Imports are limited to 500 PDFs / 500 MB per import and 250 MB per individual file to limit browser memory use.
2. Filename matching ignores separators, explicit revision/version markers and date tokens. Drawing numbers are preserved. A normalized name must be unique on both sides to pair automatically; ambiguous or missing counterparts remain unpaired. Use the new-file selector to resolve them.
3. Use **Page pairing** to check reordered, inserted or deleted pages. Distinct text signatures and PDF page labels are used first; same-length documents fall back to page order. Unresolved old and new pages require confirmation. Each new page can only be assigned once.
4. Optionally mark **Excluded areas** for the whole package or a specific file pair. Rectangles use relative page coordinates, apply to both versions and all pages, and exclude intersecting labels and pixels. Recompute after editing them.
5. **Compare all pairs** processes every mapped page, one pair at a time. **Pause after page** keeps completed results; the next run resumes pending work. A corrupt PDF or failed page is reported without stopping other files. Retrying reruns failed pages.
6. **Review results** shows text/dimension and visual findings, old/new excerpts, heuristic match scores, review status and comments. **Locate on drawing** opens the existing viewer. Manual alignment invalidates the affected page; rerun the package to update it. Matching notes survive recalculation when the same finding is detected at the same position.
7. Export a package **CSV** or **PDF report**, or **Save project** to keep pairing, results, exclusions and review notes.

### Project files

Project JSON files contain results and image excerpts, but **not original PDFs or API credentials**. Results can be reviewed immediately after reopening. Reattach the original sources to reopen full drawings or rerun comparison: SHA-256 content fingerprints prevent silently attaching a different revision. Keep project files with the corresponding source packages. A new project replaces the current workspace only after confirmation.

### What the results mean

- **No detected differences** means none were found at the selected sensitivity; it is not proof of identical drawings.
- **Needs review** indicates uncertain alignment or low-scoring matches. Scores are heuristics, not calibrated probabilities.
- **No text layer** means text comparison was incomplete. Scanned pages can still have visual findings. Optional **OCR scanned pages** uses Tesseract locally, with English or English + Hungarian models. OCR-derived findings are always marked for verification.
- **Processing error**, **Pending**, new/removed pages and unpaired files are explicitly included in exports.
- Text grouping suppresses formatting-only whitespace/thousands-separator changes. Native text is masked from the visual detector to avoid duplicate findings. Geometry detection uses aligned raster images up to 1000 pixels on the longest edge, antialias tolerance and adjustable sensitivity. Small details can be missed; use the full-resolution viewer for final review. Page-size differences and insufficient anchors are flagged. At most 100 visual regions per page are itemized; additional regions are explicitly flagged. Excerpts are stored for the first 200 findings per page.

### AI and network dependencies

AI interpretation is optional and uses the existing provider-key controls. By default only the previewed text differences are sent. If drawing images are enabled, configured exclusion rectangles are masked first. AI responses are scoped to the source files, page and comparison settings; late responses are discarded after navigation or recomputation. Bulk processing itself never makes paid AI calls.

PDF.js, jsPDF, AutoTable and optional JSZip load from `cdnjs.cloudflare.com`. Fonts use Google Fonts; OCR loads pinned Tesseract 5.1.1 code and English/Hungarian models through `cdn.jsdelivr.net`. Downloaded OCR data can be cached by the browser. The report font is bundled under `assets/` with its SIL Open Font License. Google Analytics is optional and is not needed for comparison.

## Tests

Core comparison tests use Node's built-in runner:

```sh
node --test tests/core.test.js
```

Browser tests generate PDFs (including scanned and corrupt examples), run an isolated local HTTP server, and verify uploads, all-page results, exported PDF contents, project restoration, review notes, excluded regions and stale AI response handling. They make no paid AI calls.

```sh
python3 -m pip install -r requirements-dev.txt
# Install Chromium through your OS or Playwright; point CHROMIUM_PATH at the executable.
CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_smoke.py
# Include the actual OCR model/worker (~11 MB English model download):
PDFDIFF_TEST_OCR=1 python3 tests/browser_smoke.py
```

In cloud machines where Chromium does not trust the platform HTTPS proxy but the system Python CA bundle does, set `PDFDIFF_TLS_BRIDGE=1` for the test. This test-only bridge retrieves public CDN/font assets with normal system TLS verification. It does not disable certificate checks, add trust anchors, change application source paths, or intercept AI endpoints. The tests locally stub the AI function to exercise response races without credentials.
