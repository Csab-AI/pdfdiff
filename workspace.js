/* Batch workspace. Documents stay in this browser; exported projects contain
 * results/notes, not source PDFs or API credentials. */
(() => {
  "use strict";
  const C = PdfDiffCore;
  const state = {
    version: 1,
    files: { A: [], B: [] },
    pairs: [],
    regions: [],
    sensitivity: 35,
    ocr: false,
    ocrLanguage: "eng",
    busy: false,
    importing: false,
    stop: false,
    viewer: null,
  };
  const statusNames = {
    pending: "Pending",
    changed: "Changes found",
    "no-difference": "No detected differences",
    uncertain: "Needs review",
    "no-text": "No text layer · OCR needed",
    error: "Processing error",
    "added-page": "New page",
    "removed-page": "Removed page",
    mapping: "Review page pairing",
  };
  const reviewNames = {
    unreviewed: "Not reviewed",
    confirmed: "Real change",
    "false-positive": "False positive",
    discuss: "Needs discussion",
  };
  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (text, fn, cls = "b") => {
    const e = node("button", cls, text);
    e.type = "button";
    e.addEventListener("click", () =>
      Promise.resolve().then(fn).catch(showError),
    );
    return e;
  };
  const source = (side, id) => state.files[side].find((f) => f.id === id);
  const pairKey = (a, b) => a + "|" + (b || "");
  const settingKey = () =>
    JSON.stringify([
      state.sensitivity,
      state.ocr,
      state.ocrLanguage,
      state.regions,
    ]);
  const fileLabel = (f) => f?.path || f?.name || "—";
  const delay = () => new Promise((r) => setTimeout(r, 0));
  let activeReview = null,
    worker = null,
    workerLanguage = null,
    reviewToken = 0;
  const pane = node("section", "batch-workspace");
  pane.id = "batchPane";
  pane.hidden = true;
  pane.innerHTML = `<header class="batch-header"><div><div class="eyebrow">PDFDIFF / REVISION REVIEW</div><h1>Compare drawing packages</h1><p>Match files, check every page, review what changed.</p></div><div class="batch-actions" id="projectActions"></div></header>
  <div class="batch-message" id="batchMessage" role="status" aria-live="polite">Add the old and new packages. Clear filename matches are paired automatically.</div>
  <div class="batch-body"><div class="source-grid" id="sourceGrid"></div>
  <div class="batch-toolbar"><div id="runActions"></div><label>Visual sensitivity <select id="batchSensitivity"><option value="55">Low · larger changes</option><option value="35" selected>Medium</option><option value="20">High · finer changes</option></select></label><label><input type="checkbox" id="batchOCR"> OCR scanned pages</label><label>OCR language <select id="ocrLanguage"><option value="eng">English</option><option value="eng+hun">English + Hungarian</option></select></label><button class="b" id="globalRegions">Excluded areas</button></div>
  <p class="batch-note">Local processing, one document pair at a time. OCR downloads language models on first use. A saved project keeps results and notes; reattach the same PDFs to reopen drawings or rerun.</p>
  <div class="batch-progress"><progress id="batchProgress" max="1" value="0"></progress><span id="batchProgressText">Ready</span></div>
  <div class="results-heading"><h2>Files & results <span id="batchCounts"></span></h2><label>Filter <select id="resultFilter"><option value="all">All files</option><option value="changes">Changes</option><option value="review">Needs attention</option><option value="done">Processed</option></select></label></div>
  <div id="pairTable" class="pair-table"></div><div id="newFiles" class="unpaired-files"></div></div>`;
  document.body.append(pane);
  const openBtn = btn(
    "Batch workspace",
    () => {
      pane.hidden = false;
      render();
    },
    "b batch-open",
  );
  openBtn.id = "batchOpen";
  document.querySelector(".logo").after(openBtn);
  const message = (text, error = false) => {
    $("batchMessage").textContent = text;
    $("batchMessage").classList.toggle("error", error);
  };
  function showError(error) {
    console.error(error);
    message(error.message || String(error), true);
  }
  function requireIdle() {
    if (state.busy || state.importing)
      throw new Error(
        "Pause processing or wait for the current import before changing sources or settings.",
      );
  }
  function dialog(title) {
    const d = node("dialog", "batch-dialog");
    const header = node("header", "dialog-header");
    header.append(
      node("h2", "", title),
      btn("Close", () => d.close()),
    );
    d.append(header);
    document.body.append(d);
    d.addEventListener("close", () => d.remove());
    return d;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = node("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const projectInput = node("input");
  projectInput.type = "file";
  projectInput.accept = ".json";
  projectInput.hidden = true;
  projectInput.id = "projectInput";
  document.body.append(projectInput);
  projectInput.addEventListener("change", () => {
    if (projectInput.files[0])
      loadProject(projectInput.files[0]).catch(showError);
    projectInput.value = "";
  });
  $("projectActions").append(
    btn("Open project", () => projectInput.click()),
    btn("Save project", saveProject),
    btn("CSV", exportCSV),
    btn("PDF report", exportReport),
    btn("Back to drawing", () => {
      requireIdle();
      pane.hidden = true;
      openBtn.focus();
    }),
  );
  const runButton = btn("Compare all pairs", runBatch, "b primary");
  runButton.id = "batchRun";
  const pauseButton = btn("Pause after page", () => {
    state.stop = true;
    message(
      "Pausing after the current page finishes. Completed results are kept.",
    );
  });
  pauseButton.id = "batchPause";
  pauseButton.disabled = true;
  $("runActions").append(runButton, pauseButton);
  for (const side of ["A", "B"]) {
    const box = node("section", "source-box");
    box.dataset.side = side;
    box.append(
      node("span", "source-tag", side === "A" ? "OLD / A" : "NEW / B"),
      node("h2", "", side === "A" ? "Previous issue" : "New issue"),
      node("p", "", "Drop PDFs or ZIP archives here"),
    );
    const actions = node("div", "source-actions");
    for (const folder of [false, true]) {
      const input = node("input");
      input.type = "file";
      input.multiple = true;
      input.accept = ".pdf,.zip";
      input.hidden = true;
      input.id = "batch" + side + (folder ? "Folder" : "Files");
      if (folder) {
        input.setAttribute("webkitdirectory", "");
        input.setAttribute("directory", "");
      }
      input.addEventListener("change", () => {
        importFiles(side, [...input.files]).catch(showError);
        input.value = "";
      });
      actions.append(
        btn(folder ? "Choose folder" : "PDFs / ZIP", () => input.click()),
        input,
      );
    }
    actions.append(
      btn("Clear", () => {
        requireIdle();
        if (
          state.files[side].length &&
          confirm("Remove this source package and its comparison results?")
        ) {
          state.files[side] = [];
          state.pairs = [];
          state.viewer = null;
          clearViewerAnalysis();
          reconcilePairs();
          render();
        }
      }),
    );
    box.append(actions, node("p", "source-count", "No files"));
    $("sourceGrid").append(box);
    box.addEventListener("dragover", (e) => {
      e.preventDefault();
      box.classList.add("drag-over");
    });
    box.addEventListener("dragleave", () => box.classList.remove("drag-over"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("drag-over");
      importFiles(side, [...e.dataTransfer.files]).catch(showError);
    });
  }
  $("resultFilter").addEventListener("change", render);
  for (const id of ["batchSensitivity", "batchOCR", "ocrLanguage"])
    $(id).addEventListener("change", () => {
      try {
        requireIdle();
        state.sensitivity = Number($("batchSensitivity").value);
        state.ocr = $("batchOCR").checked;
        state.ocrLanguage = $("ocrLanguage").value;
        invalidateAll();
        render();
        message(
          "Comparison settings changed. Run the package again to update results.",
        );
      } catch (e) {
        syncSettings();
        showError(e);
      }
    });
  $("globalRegions").addEventListener("click", () =>
    openRegions(null).catch(showError),
  );
  function syncSettings() {
    $("batchSensitivity").value = String(state.sensitivity);
    $("batchOCR").checked = state.ocr;
    $("ocrLanguage").value = state.ocrLanguage;
  }
  function invalidateAll() {
    for (const p of state.pairs) {
      rememberReviews(p);
      p.results = {};
      p.error = null;
    }
    clearViewerAnalysis();
  }
  function clearViewerAnalysis() {
    invalidateAnalysis();
  }
  const libraryPromises = new Map();
  function loadLibrary(url, test) {
    if (test()) return Promise.resolve();
    if (libraryPromises.has(url)) return libraryPromises.get(url);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () =>
        test()
          ? resolve()
          : reject(new Error("Library did not initialize: " + url));
      script.onerror = () => reject(new Error("Could not load " + url));
      document.head.append(script);
    }).catch((e) => {
      libraryPromises.delete(url);
      throw e;
    });
    libraryPromises.set(url, promise);
    return promise;
  }
  async function importFiles(side, files) {
    requireIdle();
    state.importing = true;
    render();
    let count = 0,
      bytes = 0;
    try {
      const expanded = [];
      for (const file of files) {
        if (file.size > 250 * 1024 * 1024)
          throw new Error(
            "Each source file must be under 250 MB. Split larger packages before importing.",
          );
        if (/\.zip$/i.test(file.name)) {
          await loadLibrary(
            "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
            () => !!window.JSZip,
          );
          const zip = await JSZip.loadAsync(file);
          for (const entry of Object.values(zip.files))
            if (!entry.dir && /\.pdf$/i.test(entry.name)) {
              const declared = entry._data?.uncompressedSize || 0;
              if (
                declared > 250 * 1024 * 1024 ||
                bytes + declared > 500 * 1024 * 1024
              )
                throw new Error(
                  "Expanded package exceeds the 500 MB import limit. Import smaller groups.",
                );
              const blob = await entry.async("blob");
              bytes += blob.size;
              if (blob.size > 250 * 1024 * 1024 || bytes > 500 * 1024 * 1024)
                throw new Error("Expanded package is too large.");
              expanded.push({
                file: new File([blob], entry.name.split("/").pop(), {
                  type: "application/pdf",
                }),
                path: entry.name,
              });
              if (expanded.length > 500)
                throw new Error("Import up to 500 PDFs at a time.");
            }
        } else if (/\.pdf$/i.test(file.name)) {
          bytes += file.size;
          expanded.push({ file, path: file.webkitRelativePath || file.name });
        }
      }
      if (bytes > 500 * 1024 * 1024 || expanded.length > 500)
        throw new Error("Import up to 500 PDFs / 500 MB at a time.");
      for (const entry of expanded) {
        message(`Reading ${entry.path}…`);
        const buffer = await entry.file.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        const hash = Array.from(new Uint8Array(digest), (x) =>
          x.toString(16).padStart(2, "0"),
        ).join("");
        // Filename/path disambiguates identical content; content hash prevents stale reattachment.
        let exact = state.files[side].find(
          (f) => f.hash === hash && f.path === entry.path,
        );
        if (!exact) {
          const matches = state.files[side].filter(
            (f) => !f.file && f.hash === hash && f.name === entry.file.name,
          );
          if (matches.length === 1) exact = matches[0];
        }
        if (exact) {
          exact.file = entry.file;
          count++;
          continue;
        }
        if (state.files[side].some((f) => f.path === entry.path))
          throw new Error(
            `${entry.path} has different contents from the saved source. Clear that source package before replacing it.`,
          );
        state.files[side].push({
          id: hash + ":" + entry.path,
          hash,
          name: entry.file.name,
          path: entry.path,
          size: entry.file.size,
          file: entry.file,
        });
        count++;
        await delay();
      }
      reconcilePairs();
      message(
        `${count} PDF${count === 1 ? "" : "s"} attached to ${side === "A" ? "the old" : "the new"} package. Uncertain filename matches need your selection.`,
      );
    } finally {
      state.importing = false;
      reconcilePairs();
      render();
    }
  }
  function reconcilePairs() {
    const auto = C.pairFiles(state.files.A, state.files.B),
      previous = new Map(state.pairs.map((p) => [p.a, p]));
    const used = new Set(
      state.pairs
        .filter((p) => p.pairing === "manual" && p.b && source("B", p.b))
        .map((p) => p.b),
    );
    const pairs = [];
    for (const row of auto.pairs) {
      const old = previous.get(row.a);
      if (old?.pairing === "manual" && (!old.b || source("B", old.b))) {
        pairs.push(old);
        continue;
      }
      if (row.b && used.has(row.b)) {
        row.b = null;
        row.pairing = "ambiguous";
      }
      if (row.b) used.add(row.b);
      if (old && old.b === row.b) {
        old.pairing = row.pairing;
        pairs.push(old);
      } else
        pairs.push({
          ...row,
          id: pairKey(row.a, row.b),
          results: {},
          regions: [],
          mappings: null,
        });
    }
    state.pairs = pairs;
  }
  function pairStatus(pair) {
    if (!pair.b)
      return pair.pairing === "ambiguous"
        ? "Ambiguous filename"
        : "No matching new file";
    if (pair.error) return "Processing error";
    if (pair.mappingReview) return "Review page pairing";
    const r = Object.values(pair.results || {});
    if (!r.length) return "Pending";
    const found = r.reduce((n, r) => n + (r.findings?.length || 0), 0);
    const attention = r.some((r) =>
      ["no-text", "error", "uncertain"].includes(r.status),
    );
    return `${r.length}/${pair.mappings?.length || r.length} pages · ${found} findings${attention ? " · needs attention" : ""}`;
  }
  function render() {
    runButton.disabled =
      state.busy || state.importing || !state.pairs.some((p) => p.b);
    pauseButton.disabled = !state.busy;
    for (const id of [
      "batchSensitivity",
      "batchOCR",
      "ocrLanguage",
      "globalRegions",
    ])
      $(id).disabled = state.busy || state.importing;
    for (const side of ["A", "B"]) {
      const files = state.files[side];
      document.querySelector(
        `[data-side="${side}"] .source-count`,
      ).textContent =
        `${files.length} PDFs · ${files.filter((f) => f.file).length} attached`;
    }
    const table = $("pairTable");
    table.replaceChildren();
    if (!state.files.A.length) {
      table.append(
        node(
          "div",
          "batch-empty",
          "Add the old and new packages to create your comparison list.",
        ),
      );
    }
    const filter = $("resultFilter").value;
    for (const pair of state.pairs) {
      const results = Object.values(pair.results || {}),
        needs =
          !pair.b ||
          pair.error ||
          pair.mappingReview ||
          results.some((r) =>
            ["error", "no-text", "uncertain"].includes(r.status),
          );
      if (
        filter === "changes" &&
        !results.some(
          (r) =>
            r.findings?.length ||
            ["added-page", "removed-page"].includes(r.status),
        )
      )
        continue;
      if (filter === "review" && !needs) continue;
      if (filter === "done" && !results.length) continue;
      const row = node("article", "pair-row");
      row.dataset.pair = pair.id;
      const names = node("div", "pair-names");
      names.append(node("strong", "", fileLabel(source("A", pair.a))));
      const select = node("select");
      select.setAttribute(
        "aria-label",
        "New file for " + fileLabel(source("A", pair.a)),
      );
      select.append(new Option("— Select new file / unpaired —", ""));
      for (const file of state.files.B) {
        const opt = new Option(fileLabel(file), file.id);
        opt.disabled = state.pairs.some((p) => p !== pair && p.b === file.id);
        select.append(opt);
      }
      select.value = pair.b || "";
      select.disabled = state.busy || state.importing;
      select.addEventListener("change", () => {
        pair.b = select.value || null;
        pair.id = pairKey(pair.a, pair.b);
        pair.pairing = "manual";
        pair.results = {};
        pair.mappings = null;
        pair.error = null;
        pair.mappingReview = false;
        state.viewer = null;
        clearViewerAnalysis();
        render();
      });
      names.append(select);
      const status = node(
        "div",
        "pair-state" + (needs ? " attention" : ""),
        pairStatus(pair),
      );
      if (pair.error) status.append(node("small", "", pair.error));
      const actions = node("div", "pair-actions");
      const pageBtn = btn("Page pairing", () => editMappings(pair));
      pageBtn.disabled = !pair.b || state.busy || state.importing;
      const reviewBtn = btn("Review results", () => openReview(pair));
      reviewBtn.disabled = !results.length;
      const regionBtn = btn("Exclude areas", () => openRegions(pair));
      regionBtn.disabled = !pair.b || state.busy || state.importing;
      actions.append(pageBtn, regionBtn, reviewBtn);
      row.append(names, status, actions);
      table.append(row);
    }
    const used = new Set(state.pairs.map((p) => p.b));
    const unmatched = state.files.B.filter((f) => !used.has(f.id));
    $("newFiles").replaceChildren();
    if (unmatched.length) {
      $("newFiles").append(
        node("h3", "", `${unmatched.length} unpaired new files`),
        node(
          "p",
          "",
          "These may be new drawings or unresolved matches. They are listed in exports and are not reported as unchanged.",
        ),
      );
      for (const f of unmatched)
        $("newFiles").append(node("div", "", fileLabel(f)));
    }
    $("batchCounts").textContent =
      `${state.pairs.filter((p) => p.b).length} pairs`;
  }
  async function openDocument(file) {
    if (!file?.file)
      throw new Error(`Reattach the original PDF: ${fileLabel(file)}`);
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(await file.file.arrayBuffer()),
    });
    try {
      return await task.promise;
    } catch (e) {
      await task.destroy();
      throw e;
    }
  }
  async function withDocs(pair, fn) {
    let a, b;
    try {
      a = await openDocument(source("A", pair.a));
      b = await openDocument(source("B", pair.b));
      return await fn(a, b);
    } finally {
      if (a) await a.destroy();
      if (b) await b.destroy();
    }
  }
  async function pageText(doc, num) {
    const page = await doc.getPage(num),
      view = page.getViewport({ scale: 1 });
    try {
      const text = await page.getTextContent();
      return {
        page,
        width: view.width,
        height: view.height,
        text: C.groupText(
          text.items
            .filter((t) => t.str?.trim())
            .map((t) => {
              const m = pdfjsLib.Util.transform(view.transform, t.transform);
              return {
                str: t.str,
                x: m[4],
                y: m[5],
                w: t.width,
                h: Math.max(1, Math.hypot(m[2], m[3])),
              };
            }),
        ),
      };
    } catch (e) {
      throw new Error(`Text extraction failed on page ${num}: ${e.message}`);
    }
  }
  async function inventory(doc) {
    const labels = await doc.getPageLabels();
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const data = await pageText(doc, i);
      pages.push({ text: data.text, label: labels?.[i - 1] || String(i) });
      data.page.cleanup();
      await delay();
    }
    return pages;
  }
  async function ensureMappings(pair, a, b) {
    if (pair.mappings) return;
    const aa = await inventory(a),
      bb = await inventory(b);
    pair.pageCounts = [a.numPages, b.numPages];
    pair.mappings = C.pairPages(aa, bb);
    pair.mappingReview =
      pair.mappings.some((m) => m.a && !m.b) &&
      pair.mappings.some((m) => !m.a && m.b);
  }
  async function editMappings(pair) {
    requireIdle();
    message("Reading pages for pairing…");
    await withDocs(pair, async (a, b) => ensureMappings(pair, a, b));
    const d = dialog("Check page pairing");
    d.append(
      node(
        "p",
        "batch-note",
        "Text and PDF page labels can match reordered pages. “Order” means the same page number was used. Correct inserted, removed or ambiguous pages here.",
      ),
    );
    const selects = [];
    for (let a = 1; a <= pair.pageCounts[0]; a++) {
      const row = node("label", "mapping-row", `Old page ${a} → `),
        select = node("select");
      select.append(new Option("Removed page / no new counterpart", ""));
      for (let b = 1; b <= pair.pageCounts[1]; b++)
        select.append(new Option("New page " + b, String(b)));
      const current = pair.mappings.find((m) => m.a === a);
      select.value = current?.b ? String(current.b) : "";
      row.append(select, node("span", "muted", current?.method || ""));
      d.append(row);
      selects.push(select);
    }
    const error = node("p", "error");
    d.append(
      error,
      btn(
        "Save page pairing",
        () => {
          const values = selects.map((s) => Number(s.value) || null),
            used = values.filter(Boolean);
          if (new Set(used).size !== used.length) {
            error.textContent = "A new page can only be assigned once.";
            return;
          }
          pair.mappings = values.map((b, i) => ({
            a: i + 1,
            b,
            method: "manual",
          }));
          for (let b = 1; b <= pair.pageCounts[1]; b++)
            if (!used.includes(b))
              pair.mappings.push({ a: null, b, method: "manual" });
          pair.mappingReview = false;
          pair.results = {};
          pair.error = null;
          clearViewerAnalysis();
          d.close();
          render();
          message("Page pairing saved. Run comparison to update results.");
        },
        "b primary",
      ),
    );
    d.showModal();
    render();
  }
  function canvas(width, height) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(width));
    c.height = Math.max(1, Math.ceil(height));
    return c;
  }
  async function raster(data, scale) {
    const view = data.page.getViewport({ scale }),
      c = canvas(view.width, view.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await data.page.render({
      canvasContext: ctx,
      viewport: view,
      background: "rgb(255,255,255)",
    }).promise;
    return c;
  }
  function fitImage(source, width = 300) {
    if (!source) return null;
    const factor = Math.min(1, width / source.width),
      c = canvas(source.width * factor, source.height * factor);
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.72);
  }
  function crop(source, box, scale) {
    if (!source) return null;
    const pad = 12,
      x = Math.max(0, box.x * scale - pad),
      y = Math.max(0, (box.y - (box.baseline ? box.h : 0)) * scale - pad),
      w = Math.min(source.width - x, Math.max(40, box.w * scale + pad * 2)),
      h = Math.min(source.height - y, Math.max(28, box.h * scale + pad * 2));
    if (w <= 0 || h <= 0) return null;
    const factor = Math.min(1, 240 / w, 120 / h),
      c = canvas(w * factor, h * factor);
    c.getContext("2d").drawImage(source, x, y, w, h, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }
  async function ocrText(image, scale) {
    await loadLibrary(
      "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
      () => !!window.Tesseract,
    );
    if (worker && workerLanguage !== state.ocrLanguage) {
      await worker.terminate();
      worker = null;
    }
    if (!worker) {
      message("Loading OCR model. The first download can take a while…");
      worker = await Tesseract.createWorker(state.ocrLanguage, 1, {
        workerPath:
          "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
        langPath: "https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0",
        logger: (m) => {
          if (m.status === "recognizing text")
            $("batchProgressText").textContent =
              "OCR " + Math.round(m.progress * 100) + "%";
        },
      });
      workerLanguage = state.ocrLanguage;
    }
    const { data } = await worker.recognize(image);
    return (data.lines || [])
      .filter((line) => line.text?.trim())
      .map((line) => ({
        str: line.text.trim(),
        x: line.bbox.x0 / scale,
        y: line.bbox.y1 / scale,
        w: (line.bbox.x1 - line.bbox.x0) / scale,
        h: (line.bbox.y1 - line.bbox.y0) / scale,
        ocr: true,
        ocrScore: line.confidence,
      }));
  }
  function allRegions(pair) {
    return [...state.regions, ...(pair.regions || [])];
  }
  async function analyzePage(pair, docA, docB, mapping) {
    const result = {
      a: mapping.a,
      b: mapping.b,
      findings: [],
      signature: settingKey(),
      review: "unreviewed",
      note: "",
      method: mapping.method,
    };
    let aa = null,
      bb = null;
    try {
      if (mapping.a) aa = await pageText(docA, mapping.a);
      if (mapping.b) bb = await pageText(docB, mapping.b);
      const width = Math.max(aa?.width || 0, bb?.width || 0),
        height = Math.max(aa?.height || 0, bb?.height || 0),
        scale = Math.min(1.5, 1000 / Math.max(width, height));
      let imgA = aa ? await raster(aa, scale) : null,
        imgB = bb ? await raster(bb, scale) : null;
      result.width = width;
      result.height = height;
      result.previewA = fitImage(imgA);
      result.previewB = fitImage(imgB);
      if (!aa || !bb) {
        result.status = C.pageStatus(result);
        return result;
      }
      result.ocrUsed = false;
      if (state.ocr) {
        if (!aa.text.length) {
          aa.text = await ocrText(imgA, scale);
          result.ocrUsed = true;
        }
        if (!bb.text.length) {
          bb.text = await ocrText(imgB, scale);
          result.ocrUsed = true;
        }
      }
      result.noText = !aa.text.length || !bb.text.length;
      const key = `${mapping.a}:${mapping.b}`,
        automatic = C.alignment(
          aa.text.filter(
            (t) => !C.inRegions(t, allRegions(pair), width, height),
          ),
          bb.text.filter(
            (t) => !C.inRegions(t, allRegions(pair), width, height),
          ),
        ),
        manual = pair.alignments?.[key],
        transform = manual || automatic;
      result.transform = {
        x: transform.x,
        y: transform.y,
        r: transform.r || 0,
      };
      result.anchorCount = automatic.anchors;
      result.alignmentUncertain = !manual && !automatic.reliable;
      result.sizeMismatch =
        Math.abs(aa.width - bb.width) > 2 ||
        Math.abs(aa.height - bb.height) > 2;
      if (result.sizeMismatch) result.alignmentUncertain = true;
      const compared = C.compareText(aa.text, bb.text, {
        transform,
        width,
        height,
        widthB: bb.width,
        heightB: bb.height,
        regions: allRegions(pair),
      });
      result.formatting = compared.formatting.length;
      if (!result.noText) {
        for (const item of compared.changed)
          result.findings.push({
            type: item.dimension ? "dimension" : "changed",
            from: item.from,
            to: item.to,
            score: item.conf,
            box: { ...item.b, baseline: true },
          });
        for (const type of ["added", "removed"])
          for (const item of compared[type])
            result.findings.push({
              type,
              from: type === "removed" ? item.str : "",
              to: type === "added" ? item.str : "",
              score: item.conf,
              box: { ...item, baseline: true },
            });
      }
      const before = canvas(width * scale, height * scale),
        after = canvas(width * scale, height * scale);
      const ctxA = before.getContext("2d", { willReadFrequently: true }),
        ctxB = after.getContext("2d", { willReadFrequently: true });
      for (const ctx of [ctxA, ctxB]) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, before.width, before.height);
      }
      ctxA.drawImage(imgA, 0, 0);
      ctxB.save();
      ctxB.translate(
        (bb.width / 2 + transform.x) * scale,
        (bb.height / 2 + transform.y) * scale,
      );
      ctxB.rotate(((transform.r || 0) * Math.PI) / 180);
      ctxB.drawImage(imgB, -imgB.width / 2, -imgB.height / 2);
      ctxB.restore();
      const maskedA = canvas(before.width, before.height),
        maskedB = canvas(before.width, before.height),
        ma = maskedA.getContext("2d", { willReadFrequently: true }),
        mb = maskedB.getContext("2d", { willReadFrequently: true });
      ma.drawImage(before, 0, 0);
      mb.drawImage(after, 0, 0);
      for (const ctx of [ma, mb]) {
        ctx.fillStyle = "#fff";
        for (const r of allRegions(pair))
          ctx.fillRect(
            r.x * width * scale,
            r.y * height * scale,
            r.w * width * scale,
            r.h * height * scale,
          );
        // Native text already has its own detector. Keep scanned/OCR areas visible to visual comparison.
        if (!result.ocrUsed && !result.noText)
          for (const t of [...aa.text, ...compared.allB])
            ctx.fillRect(
              t.x * scale - 2,
              (t.y - t.h) * scale - 2,
              t.w * scale + 4,
              t.h * scale + 4,
            );
      }
      const diff = C.visualDiff(
        ma.getImageData(0, 0, ma.canvas.width, ma.canvas.height).data,
        mb.getImageData(0, 0, mb.canvas.width, mb.canvas.height).data,
        before.width,
        before.height,
        { threshold: state.sensitivity },
      );
      result.visualPixels = diff.pixels;
      result.visualRegions = diff.regions.length;
      result.truncatedVisual = Math.max(0, diff.regions.length - 100);
      if (result.truncatedVisual) result.alignmentUncertain = true;
      for (const region of diff.regions.slice(0, 100))
        result.findings.push({
          type: "visual",
          from: "Drawing geometry",
          to: "Visual change — verify",
          score: manual || automatic.reliable ? 70 : 40,
          box: {
            x: region.x / scale,
            y: region.y / scale,
            w: region.w / scale,
            h: region.h / scale,
          },
          pixels: region.pixels,
        });
      result.findings.forEach((finding, i) => {
        finding.id = `${key}:${i}`;
        finding.review = "unreviewed";
        finding.note = "";
        if (result.ocrUsed && finding.type !== "visual")
          finding.score = Math.min(finding.score, 50);
        if (i < 200) {
          finding.before = crop(before, finding.box, scale);
          finding.after = crop(after, finding.box, scale);
        }
      });
      result.previewA = fitImage(before);
      result.previewB = fitImage(after);
      result.status = C.pageStatus(result);
      return result;
    } finally {
      aa?.page.cleanup();
      bb?.page.cleanup();
    }
  }
  function findingKey(f) {
    return JSON.stringify([
      f.type,
      f.from,
      f.to,
      Math.round(f.box.x),
      Math.round(f.box.y),
    ]);
  }
  function rememberReviews(pair) {
    pair.reviewCache ||= {};
    for (const [key, result] of Object.entries(pair.results || {})) {
      const saved = (pair.reviewCache[key] ||= { findings: {} });
      saved.review = result.review || "unreviewed";
      saved.note = result.note || "";
      for (const f of result.findings || [])
        if (f.note || f.review !== "unreviewed")
          saved.findings[findingKey(f)] = { review: f.review, note: f.note };
    }
  }
  function restoreReviews(pair, result) {
    const saved = pair.reviewCache?.[`${result.a || 0}:${result.b || 0}`];
    if (!saved) return;
    result.review = reviewNames[saved.review] ? saved.review : "unreviewed";
    result.note = String(saved.note || "");
    for (const f of result.findings || []) {
      const old = saved.findings?.[findingKey(f)];
      if (old) {
        f.review = reviewNames[old.review] ? old.review : "unreviewed";
        f.note = String(old.note || "");
      }
    }
  }
  async function runBatch() {
    requireIdle();
    state.busy = true;
    $("batchProgressText").textContent = "Preparing files…";
    state.stop = false;
    clearViewerAnalysis();
    render();
    const queue = state.pairs.filter((p) => p.b),
      signature = settingKey();
    let completed = 0;
    $("batchProgress").max = Math.max(1, queue.length);
    $("batchProgress").value = 0;
    try {
      for (let pi = 0; pi < queue.length && !state.stop; pi++) {
        const pair = queue[pi];
        pair.error = null;
        try {
          await withDocs(pair, async (a, b) => {
            message(`Preparing ${fileLabel(source("A", pair.a))}…`);
            await ensureMappings(pair, a, b);
            if (pair.mappingReview) {
              message(
                "Some page pairs are ambiguous. Use “Page pairing” to confirm them; other files will continue.",
              );
              return;
            }
            for (let mi = 0; mi < pair.mappings.length && !state.stop; mi++) {
              const mapping = pair.mappings[mi],
                key = `${mapping.a || 0}:${mapping.b || 0}`,
                existing = pair.results[key];
              if (
                existing &&
                existing.signature === signature &&
                existing.status !== "error"
              )
                continue;
              $("batchProgressText").textContent =
                `Pair ${pi + 1}/${queue.length} · page ${mi + 1}/${pair.mappings.length}`;
              message(
                `Comparing ${fileLabel(source("A", pair.a))} · A ${mapping.a || "—"} / B ${mapping.b || "—"}`,
              );
              try {
                pair.results[key] = await analyzePage(pair, a, b, mapping);
                restoreReviews(pair, pair.results[key]);
              } catch (error) {
                pair.results[key] = {
                  a: mapping.a,
                  b: mapping.b,
                  status: "error",
                  error: error.message,
                  findings: [],
                  signature,
                };
              }
              $("batchProgress").value = pi + (mi + 1) / pair.mappings.length;
              render();
              await delay();
            }
          });
        } catch (error) {
          pair.error = error.message;
        }
        completed++;
        $("batchProgress").value = completed;
        render();
        await delay();
      }
      $("batchProgressText").textContent = state.stop
        ? "Paused · completed results retained"
        : "Finished";
      const failures =
        state.pairs.filter((p) => p.error || p.mappingReview).length +
        state.pairs
          .flatMap((p) => Object.values(p.results))
          .filter((r) => r.status === "error").length;
      message(
        state.stop
          ? "Paused. “Compare all pairs” resumes unfinished pages."
          : `Processing finished${failures ? ` · ${failures} errors or unresolved page pairings need attention` : ""}. Review findings before exporting.`,
      );
    } finally {
      state.busy = false;
      state.stop = false;
      if (worker) {
        await worker.terminate();
        worker = null;
        workerLanguage = null;
      }
      render();
    }
  }
  async function openRegions(pair) {
    requireIdle();
    const target = pair || state.pairs.find((p) => p.b);
    if (!target)
      throw new Error(
        "Pair two PDFs first so an example page can be displayed.",
      );
    const regions = (pair ? pair.regions : state.regions).map((r) => ({
      ...r,
    }));
    const d = dialog(
      pair
        ? "Exclude areas for this file pair"
        : "Exclude areas across the whole package",
    );
    d.classList.add("region-dialog");
    d.append(
      node(
        "p",
        "batch-note",
        "Drag rectangles over title blocks, stamps or other areas to ignore. Positions are relative to page size and apply to both versions on every page. Excluded areas are omitted from text and visual detection and AI inputs.",
      ),
    );
    const preview = canvas(1, 1);
    preview.className = "region-canvas";
    preview.setAttribute("aria-label", "Drag to mark an excluded rectangle");
    d.append(preview);
    const list = node("div", "region-list");
    d.append(list);
    let image = null,
      start = null,
      draft = null;
    function paint() {
      if (!image) return;
      const ctx = preview.getContext("2d");
      ctx.drawImage(image, 0, 0);
      ctx.fillStyle = "rgba(234,88,12,.22)";
      ctx.strokeStyle = "#ea580c";
      ctx.lineWidth = 2;
      for (const r of [...regions, ...(draft ? [draft] : [])]) {
        ctx.fillRect(
          r.x * preview.width,
          r.y * preview.height,
          r.w * preview.width,
          r.h * preview.height,
        );
        ctx.strokeRect(
          r.x * preview.width,
          r.y * preview.height,
          r.w * preview.width,
          r.h * preview.height,
        );
      }
      list.replaceChildren();
      regions.forEach((r, i) =>
        list.append(
          btn(`Remove area ${i + 1}`, () => {
            regions.splice(i, 1);
            paint();
          }),
        ),
      );
    }
    const point = (e) => {
      const b = preview.getBoundingClientRect();
      return {
        x: C.clamp((e.clientX - b.left) / b.width, 0, 1),
        y: C.clamp((e.clientY - b.top) / b.height, 0, 1),
      };
    };
    preview.addEventListener("pointerdown", (e) => {
      start = point(e);
      preview.setPointerCapture(e.pointerId);
    });
    preview.addEventListener("pointermove", (e) => {
      if (!start) return;
      const p = point(e);
      draft = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(start.x - p.x),
        h: Math.abs(start.y - p.y),
      };
      paint();
    });
    preview.addEventListener("pointerup", () => {
      if (draft && draft.w > 0.005 && draft.h > 0.005 && regions.length < 64)
        regions.push(draft);
      start = null;
      draft = null;
      paint();
    });
    d.append(
      btn(
        "Save exclusions",
        () => {
          if (pair) {
            rememberReviews(pair);
            pair.regions = regions;
            pair.results = {};
          } else {
            state.regions = regions;
            invalidateAll();
          }
          clearViewerAnalysis();
          d.close();
          render();
          message("Exclusions saved. Run comparison again to update findings.");
        },
        "b primary",
      ),
    );
    d.showModal();
    try {
      const doc = await openDocument(source("A", target.a));
      try {
        const data = await pageText(doc, 1);
        image = await raster(
          data,
          Math.min(1, 700 / Math.max(data.width, data.height)),
        );
        preview.width = image.width;
        preview.height = image.height;
        paint();
      } finally {
        await doc.destroy();
      }
    } catch (e) {
      d.close();
      throw e;
    }
  }
  function reviewSelect(value, onChange) {
    const select = node("select");
    select.setAttribute("aria-label", "Review status");
    for (const [key, name] of Object.entries(reviewNames))
      select.append(new Option(name, key));
    select.value = value || "unreviewed";
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
  function previewImages(before, after, cls = "finding-images") {
    const images = node("div", cls);
    for (const [label, url] of [
      ["OLD", before],
      ["NEW", after],
    ]) {
      const wrap = node("figure");
      wrap.append(node("figcaption", "", label));
      if (url) {
        const image = node("img");
        image.src = url;
        image.alt = label + " drawing excerpt";
        image.loading = "lazy";
        wrap.append(image);
      } else wrap.append(node("p", "muted", "No image"));
      images.append(wrap);
    }
    return images;
  }
  function openReview(pair) {
    const d = dialog(fileLabel(source("A", pair.a)));
    d.classList.add("review-dialog");
    activeReview = d;
    const tools = node("div", "review-tools");
    const filter = node("select");
    filter.setAttribute("aria-label", "Filter findings");
    for (const [value, label] of [
      ["all", "All findings"],
      ["uncertain", "Uncertain matches"],
      ["unreviewed", "Not reviewed"],
      ["dimension", "Dimensions"],
      ["visual", "Visual changes"],
    ])
      filter.append(new Option(label, value));
    tools.append(
      node("label", "", "Show "),
      filter,
      btn("Export these results", () => exportReport(pair)),
    );
    d.append(tools);
    const body = node("div");
    d.append(body);
    function paint() {
      body.replaceChildren();
      for (const result of Object.values(pair.results)) {
        const section = node("section", "page-result");
        section.append(
          node(
            "h3",
            "",
            `Old page ${result.a || "—"} → new page ${result.b || "—"}`,
          ),
          node(
            "span",
            "result-badge status-" + result.status,
            statusNames[result.status] || result.status,
          ),
        );
        if (result.error) section.append(node("p", "error", result.error));
        const notices = [];
        if (result.noText)
          notices.push(
            "At least one page has no readable text. Text changes could not be verified. Enable OCR and rerun.",
          );
        if (result.ocrUsed)
          notices.push(
            "OCR was used. Recognized text and its changes need manual verification.",
          );
        if (result.alignmentUncertain)
          notices.push(
            "Alignment is uncertain. Open the drawing, use Align and rerun before accepting visual findings.",
          );
        if (result.sizeMismatch)
          notices.push("Page sizes differ. Check scale and alignment.");
        if (result.truncatedVisual)
          notices.push(
            `${result.truncatedVisual} additional visual regions are not itemized. Inspect the complete page.`,
          );
        if (result.formatting)
          notices.push(
            `${result.formatting} formatting-only text differences were normalized.`,
          );
        if (notices.length)
          section.append(node("p", "review-notice", notices.join(" ")));
        section.append(
          previewImages(result.previewA, result.previewB, "page-previews"),
        );
        const pageTools = node("div", "review-tools");
        pageTools.append(
          reviewSelect(result.review, (v) => (result.review = v)),
        );
        const pageNote = node("textarea");
        pageNote.placeholder = "Page review note";
        pageNote.setAttribute("aria-label", "Page review note");
        pageNote.value = result.note || "";
        pageNote.addEventListener(
          "input",
          () => (result.note = pageNote.value),
        );
        pageTools.append(pageNote);
        const open = btn("Open drawing / align", () =>
          openInViewer(pair, result),
        );
        open.disabled = !result.a || !result.b || state.busy;
        pageTools.append(open);
        section.append(pageTools);
        const findings = result.findings || [];
        for (const finding of findings) {
          if (filter.value === "uncertain" && finding.score > 55) continue;
          if (filter.value === "unreviewed" && finding.review !== "unreviewed")
            continue;
          if (
            ["dimension", "visual"].includes(filter.value) &&
            finding.type !== filter.value
          )
            continue;
          const card = node("article", "finding-card " + finding.type);
          card.dataset.finding = finding.id;
          card.append(
            node(
              "h4",
              "",
              finding.type === "dimension"
                ? "Dimension / numeric change"
                : finding.type === "visual"
                  ? "Visual change"
                  : finding.type[0].toUpperCase() + finding.type.slice(1),
            ),
            node(
              "span",
              "match-score",
              `${finding.type === "visual" ? "Detection" : "Match"} score ${finding.score}/100 · heuristic, not accuracy`,
            ),
          );
          const values = node("div", "finding-values");
          values.append(
            node("del", "", finding.from || "—"),
            node("span", "", " → "),
            node("ins", "", finding.to || "—"),
          );
          card.append(values, previewImages(finding.before, finding.after));
          const controls = node("div", "review-tools");
          controls.append(
            reviewSelect(finding.review, (v) => (finding.review = v)),
          );
          const note = node("textarea");
          note.placeholder = "Comment for the review meeting";
          note.setAttribute("aria-label", "Finding note");
          note.value = finding.note || "";
          note.addEventListener("input", () => (finding.note = note.value));
          controls.append(note);
          const locate = btn("Locate on drawing", () =>
            openInViewer(pair, result, finding),
          );
          locate.disabled = state.busy || !result.a || !result.b;
          controls.append(locate);
          card.append(controls);
          section.append(card);
        }
        if (!findings.length && !result.error)
          section.append(
            node(
              "p",
              "muted",
              result.status === "no-difference"
                ? "No differences detected with the current settings. This is not a guarantee that the drawings are identical."
                : "No individual findings; check the page status above.",
            ),
          );
        body.append(section);
      }
    }
    filter.addEventListener("change", paint);
    paint();
    d.showModal();
  }
  async function openInViewer(pair, result, finding) {
    requireIdle();
    const token = ++reviewToken;
    let a, b;
    try {
      a = await openDocument(source("A", pair.a));
      b = await openDocument(source("B", pair.b));
      if (token !== reviewToken) {
        await a.destroy();
        await b.destroy();
        return;
      }
      if (pdfA?.destroy) await pdfA.destroy();
      if (pdfB?.destroy) await pdfB.destroy();
      const adapter = (doc, side) => ({
        numPages: pair.mappings.length,
        fingerprints: [
          (doc.fingerprints?.[0] || "") + JSON.stringify(pair.mappings),
        ],
        getPage: (n) => doc.getPage(pair.mappings[n - 1][side]),
        hasPage: (n) => !!pair.mappings[n - 1]?.[side],
        destroy: () => doc.destroy(),
      });
      pdfA = adapter(a, "a");
      pdfB = adapter(b, "b");
      a = b = null;
      state.viewer = { pairId: pair.id };
      pgOff = {};
      gOff = { x: 0, y: 0, r: 0 };
      draws = [];
      stopBlink();
      stopDraw();
      if (alignOn) exitAl();
      pair.mappings.forEach((m, i) => {
        const r = pair.results[`${m.a || 0}:${m.b || 0}`];
        if (r?.transform) pgOff[i + 1] = { ...r.transform };
      });
      $("fnA").textContent = source("A", pair.a).name;
      $("fnB").textContent = source("B", pair.b).name;
      await init();
      cur =
        pair.mappings.findIndex((m) => m.a === result.a && m.b === result.b) +
        1;
      await changePg();
      pane.hidden = true;
      if (activeReview?.open) activeReview.close();
      $("howto")?.classList.add("hide");
      await runTextDiff();
      if (finding) {
        zoomToText({
          ...finding.box,
          y: finding.box.y + (finding.box.baseline ? 0 : finding.box.h),
        });
        const marker = node("div", "tmk active");
        marker.style.cssText = `left:${finding.box.x}px;top:${finding.box.y - (finding.box.baseline ? finding.box.h : 0)}px;width:${finding.box.w}px;height:${finding.box.h}px;border-color:#7c3aed`;
        W.append(marker);
      }
      updateViewerContext();
    } catch (error) {
      if (a) await a.destroy();
      if (b) await b.destroy();
      throw error;
    }
  }
  function viewerPair() {
    return (
      state.viewer && state.pairs.find((p) => p.id === state.viewer.pairId)
    );
  }
  function viewerResult() {
    const pair = viewerPair(),
      mapping = pair?.mappings?.[cur - 1];
    return mapping ? pair.results[`${mapping.a || 0}:${mapping.b || 0}`] : null;
  }
  const contextLabel = node("span", "batch-viewer-context");
  document.querySelector(".sb").append(contextLabel);
  function updateViewerContext() {
    const p = viewerPair(),
      m = p?.mappings?.[cur - 1];
    contextLabel.textContent = m
      ? `Package · A ${m.a || "—"} / B ${m.b || "—"}`
      : "";
  }
  function context() {
    const pair = viewerPair(),
      mapping = pair?.mappings?.[cur - 1];
    return JSON.stringify([
      pair?.id || null,
      mapping || cur,
      pdfA?.fingerprints?.[0],
      pdfB?.fingerprints?.[0],
      off(cur),
      settingKey(),
      pair?.regions || [],
    ]);
  }
  function onAligned() {
    const pair = viewerPair(),
      mapping = pair?.mappings?.[cur - 1];
    if (!mapping) return;
    pair.alignments ||= {};
    const key = `${mapping.a || 0}:${mapping.b || 0}`;
    pair.alignments[key] = { ...off(cur) };
    rememberReviews(pair);
    delete pair.results[key];
    render();
  }
  function onAlignmentAll(transform) {
    const pair = viewerPair();
    if (!pair) return;
    rememberReviews(pair);
    pair.results = {};
    pair.alignments = {};
    if (transform)
      for (const m of pair.mappings)
        pair.alignments[`${m.a || 0}:${m.b || 0}`] = { ...transform };
    render();
  }
  function portableProject() {
    return {
      format: "pdfdiff-project",
      version: 1,
      createdAt: new Date().toISOString(),
      files: {
        A: state.files.A.map(({ file, ...meta }) => meta),
        B: state.files.B.map(({ file, ...meta }) => meta),
      },
      pairs: state.pairs,
      regions: state.regions,
      sensitivity: state.sensitivity,
      ocr: state.ocr,
      ocrLanguage: state.ocrLanguage,
    };
  }
  function saveProject() {
    download(
      new Blob([JSON.stringify(portableProject())], {
        type: "application/json",
      }),
      "pdfdiff-project.json",
    );
    message(
      "Project saved with results, pairing, exclusions and notes. Original PDFs and API keys are not included.",
    );
  }
  function validRegions(regions) {
    return (
      Array.isArray(regions) &&
      regions.length <= 64 &&
      regions.every(
        (r) =>
          r &&
          ["x", "y", "w", "h"].every(
            (k) => Number.isFinite(r[k]) && r[k] >= 0 && r[k] <= 1,
          ) &&
          r.w > 0 &&
          r.h > 0 &&
          r.x + r.w <= 1.001 &&
          r.y + r.h <= 1.001,
      )
    );
  }
  function validateProject(p) {
    if (
      !p ||
      p.format !== "pdfdiff-project" ||
      p.version !== 1 ||
      !p.files ||
      !Array.isArray(p.pairs) ||
      p.pairs.length > 1000 ||
      !validRegions(p.regions) ||
      ![20, 35, 55].includes(p.sensitivity) ||
      !["eng", "eng+hun"].includes(p.ocrLanguage)
    )
      throw new Error("Unsupported or invalid pdfdiff project.");
    const ids = {};
    for (const side of ["A", "B"]) {
      const files = p.files[side];
      if (!Array.isArray(files) || files.length > 1000)
        throw new Error("Invalid source list.");
      ids[side] = new Set();
      for (const f of files) {
        if (
          !f ||
          typeof f.id !== "string" ||
          f.id.length > 5000 ||
          ids[side].has(f.id) ||
          typeof f.name !== "string" ||
          typeof f.path !== "string" ||
          typeof f.hash !== "string" ||
          !/^[a-f0-9]{64}$/.test(f.hash) ||
          !Number.isFinite(f.size)
        )
          throw new Error("Invalid source identity.");
        ids[side].add(f.id);
        delete f.file;
      }
    }
    const usedA = new Set(),
      usedB = new Set();
    for (const pair of p.pairs) {
      if (
        !pair ||
        !ids.A.has(pair.a) ||
        (pair.b && !ids.B.has(pair.b)) ||
        usedA.has(pair.a) ||
        (pair.b && usedB.has(pair.b)) ||
        !validRegions(pair.regions || [])
      )
        throw new Error("Invalid or duplicate file pairing.");
      usedA.add(pair.a);
      if (pair.b) usedB.add(pair.b);
      pair.id = pairKey(pair.a, pair.b);
      pair.regions ||= [];
      pair.results ||= {};
      if (pair.mappings !== null && pair.mappings !== undefined) {
        if (
          !Array.isArray(pair.pageCounts) ||
          pair.pageCounts.length !== 2 ||
          pair.pageCounts.some(
            (n) => !Number.isInteger(n) || n < 1 || n > 10000,
          )
        )
          throw new Error("Invalid page counts.");
        if (!Array.isArray(pair.mappings) || pair.mappings.length > 20000)
          throw new Error("Invalid page mappings.");
        const aa = new Set(),
          bb = new Set();
        for (const m of pair.mappings) {
          if (
            !m ||
            (!m.a && !m.b) ||
            [m.a, m.b].some(
              (n) => n !== null && (!Number.isInteger(n) || n < 1 || n > 10000),
            ) ||
            (m.a && aa.has(m.a)) ||
            (m.b && bb.has(m.b))
          )
            throw new Error("Invalid page mapping.");
          if (m.a) aa.add(m.a);
          if (m.b) bb.add(m.b);
        }
      }
      if (typeof pair.results !== "object" || Array.isArray(pair.results))
        throw new Error("Invalid results.");
      for (const [key, r] of Object.entries(pair.results)) {
        if (
          !r ||
          key !== `${r.a || 0}:${r.b || 0}` ||
          !pair.mappings?.some((m) => m.a === r.a && m.b === r.b)
        )
          throw new Error("Result does not match its saved page pairing.");
        if (
          !/^\d+:\d+$/.test(key) ||
          !r ||
          !statusNames[r.status] ||
          !Array.isArray(r.findings) ||
          r.findings.length > 20000
        )
          throw new Error("Invalid page result.");
        for (const f of r.findings) {
          if (
            !["changed", "dimension", "added", "removed", "visual"].includes(
              f.type,
            ) ||
            !Number.isFinite(f.score) ||
            !f.box ||
            !["x", "y", "w", "h"].every((k) => Number.isFinite(f.box[k]))
          )
            throw new Error("Invalid finding.");
          f.review = reviewNames[f.review] ? f.review : "unreviewed";
          f.note = String(f.note || "").slice(0, 20000);
          f.from = String(f.from || "");
          f.to = String(f.to || "");
          for (const field of ["before", "after"])
            if (
              f[field] &&
              !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f[field])
            )
              throw new Error("Invalid preview image.");
        }
        for (const field of ["previewA", "previewB"])
          if (
            r[field] &&
            !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(r[field])
          )
            throw new Error("Invalid preview image.");
      }
    }
    return p;
  }
  async function loadProject(file) {
    requireIdle();
    if (file.size > 100 * 1024 * 1024)
      throw new Error("Project file exceeds 100 MB.");
    const p = validateProject(JSON.parse(await file.text()));
    if (
      (state.files.A.length || state.files.B.length) &&
      !confirm(
        "Open this project and replace the current workspace? Save your current project first if needed.",
      )
    )
      return;
    state.files = p.files;
    state.pairs = p.pairs;
    state.regions = p.regions;
    state.sensitivity = p.sensitivity;
    state.ocr = !!p.ocr;
    state.ocrLanguage = p.ocrLanguage;
    state.viewer = null;
    clearViewerAnalysis();
    syncSettings();
    pane.hidden = false;
    render();
    message(
      "Project restored. Results and notes are available. Reattach the original PDFs to reopen drawings or rerun.",
    );
  }
  function exportRows(onlyPair) {
    const rows = [];
    const pairs = onlyPair ? [onlyPair] : state.pairs;
    for (const pair of pairs) {
      const old = fileLabel(source("A", pair.a)),
        fresh = fileLabel(source("B", pair.b));
      if (
        !pair.b ||
        pair.error ||
        pair.mappingReview ||
        !Object.keys(pair.results).length
      ) {
        rows.push([
          old,
          fresh,
          "",
          "",
          pair.error
            ? "Processing error"
            : pair.mappingReview
              ? "Review page pairing"
              : pair.b
                ? "Pending"
                : "Unpaired old file",
          "",
          "",
          "",
          "",
          "",
          "",
          pair.error || "",
        ]);
      }
      for (const r of Object.values(pair.results)) {
        const base = [
          old,
          fresh,
          r.a || "",
          r.b || "",
          statusNames[r.status] || r.status,
        ];
        rows.push([
          ...base,
          "PAGE",
          "",
          "",
          "",
          reviewNames[r.review] || "Not reviewed",
          r.note || "",
          r.error || "",
        ]);
        for (const f of r.findings)
          rows.push([
            ...base,
            f.type,
            f.from,
            f.to,
            f.score,
            reviewNames[f.review] || "Not reviewed",
            f.note || "",
            "",
          ]);
      }
      for (const m of pair.mappings || [])
        if (!pair.results[`${m.a || 0}:${m.b || 0}`])
          rows.push([
            old,
            fresh,
            m.a || "",
            m.b || "",
            "Pending",
            "",
            "",
            "",
            "",
            "Not reviewed",
            "",
            "",
          ]);
    }
    if (!onlyPair) {
      const used = new Set(state.pairs.map((p) => p.b));
      for (const f of state.files.B)
        if (!used.has(f.id))
          rows.push([
            "",
            fileLabel(f),
            "",
            "",
            "Unpaired new file",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
          ]);
    }
    return rows;
  }
  function exportCSV() {
    const rows = [
      [
        "Old file",
        "New file",
        "Old page",
        "New page",
        "Page status",
        "Type",
        "Old value",
        "New value",
        "Match score /100",
        "Review status",
        "Note",
        "Error",
      ],
      ...exportRows(),
    ];
    download(
      new Blob(
        [
          "\ufeff" +
            rows.map((row) => row.map(C.csvCell).join(",")).join("\r\n"),
        ],
        { type: "text/csv;charset=utf-8" },
      ),
      "pdfdiff-package.csv",
    );
  }
  let fontData = null;
  async function configureFont(doc) {
    if (!fontData) {
      const response = await fetch("assets/NotoSans-Regular.ttf");
      if (!response.ok)
        throw new Error("Report font could not load. Please retry.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      fontData = btoa(binary);
    }
    doc.addFileToVFS("NotoSans.ttf", fontData);
    doc.addFont("NotoSans.ttf", "NotoSans", "normal");
    doc.addFont("NotoSans.ttf", "NotoSans", "bold");
    doc.setFont("NotoSans");
  }
  async function exportReport(onlyPair) {
    const report = structuredClone({
      ...portableProject(),
      pairs: onlyPair ? [onlyPair] : state.pairs,
    });
    const reportSource = (side, id) =>
      report.files[side].find((f) => f.id === id);
    if (!window.jspdf) throw new Error("PDF report library did not load.");
    const doc = new jspdf.jsPDF({ unit: "mm", format: "a4" });
    await configureFont(doc);
    let y = 18;
    const line = (text, size = 10, color = [27, 34, 48]) => {
      doc.setFont("NotoSans");
      doc.setFontSize(size);
      doc.setTextColor(...color);
      for (const part of doc.splitTextToSize(String(text), 180)) {
        if (y > 277) {
          doc.addPage();
          y = 18;
        }
        doc.text(part, 15, y);
        y += size * 0.45 + 1;
      }
    };
    line("Drawing package revision review", 18);
    line(new Date().toLocaleString(), 9);
    line(
      "Scores are heuristics, not measured accuracy. Pending, unreadable and failed pages require review.",
      9,
      [90, 100, 120],
    );
    line(
      `Settings: visual sensitivity ${report.sensitivity}; OCR ${report.ocr ? "enabled (" + report.ocrLanguage + ")" : "off"}; ${report.regions.length} package exclusion areas.`,
      9,
    );
    const pairs = report.pairs;
    for (const pair of pairs) {
      if (y > 220) {
        doc.addPage();
        y = 18;
      }
      y += 6;
      line("OLD: " + fileLabel(reportSource("A", pair.a)), 12);
      line("NEW: " + fileLabel(reportSource("B", pair.b)), 12);
      line(pairStatus(pair), 10);
      if (pair.error) line(pair.error, 9, [190, 40, 40]);
      for (const result of Object.values(pair.results)) {
        if (y > 220) {
          doc.addPage();
          y = 18;
        }
        y += 5;
        line(
          `Page A ${result.a || "—"} / B ${result.b || "—"} — ${statusNames[result.status] || result.status}`,
          12,
        );
        line(
          `Review: ${reviewNames[result.review] || "Not reviewed"}${result.note ? " · " + result.note : ""}`,
          9,
        );
        if (result.error) line(result.error, 9, [190, 40, 40]);
        if (result.noText)
          line(
            "Text could not be verified: at least one page has no readable text layer.",
            9,
          );
        if (result.alignmentUncertain) line("Alignment needs verification.", 9);
        if (result.truncatedVisual)
          line(
            `${result.truncatedVisual} additional visual regions are not itemized.`,
            9,
          );
        if (result.ocrUsed)
          line("OCR-derived text: verify recognition against the drawing.", 9);
        if (result.formatting)
          line(
            `${result.formatting} formatting-only differences normalized.`,
            9,
          );
        if (result.ai?.text) {
          line("AI interpretation — " + result.ai.model, 10);
          line(result.ai.text, 9);
        }
        for (const finding of result.findings) {
          if (y > 220) {
            doc.addPage();
            y = 18;
          }
          y += 3;
          line(
            `${finding.type.toUpperCase()} · score ${finding.score}/100 · ${reviewNames[finding.review] || "Not reviewed"}`,
            10,
          );
          line(`${finding.from || "—"} → ${finding.to || "—"}`, 10);
          if (finding.note) line(finding.note, 9);
          if (finding.before || finding.after) {
            if (y > 237) {
              doc.addPage();
              y = 18;
            }
            line(
              "OLD                                                        NEW",
              8,
              [90, 100, 120],
            );
            for (const [x, img] of [
              [15, finding.before],
              [108, finding.after],
            ])
              if (img) {
                const props = doc.getImageProperties(img),
                  w = Math.min(82, (32 * props.width) / props.height),
                  h = (w * props.height) / props.width;
                doc.addImage(img, "JPEG", x, y, w, h);
              }
            y += 35;
          }
        }
        if (!result.findings.length)
          line(
            result.status === "no-difference"
              ? "No differences detected at the selected sensitivity."
              : "See page status; absence of findings does not mean the page is unchanged.",
            9,
          );
      }
      for (const mapping of pair.mappings || [])
        if (!pair.results[`${mapping.a || 0}:${mapping.b || 0}`])
          line(
            `Page A ${mapping.a || "—"} / B ${mapping.b || "—"}: not processed`,
            9,
            [190, 80, 20],
          );
    }
    if (!onlyPair) {
      const used = new Set(report.pairs.map((p) => p.b));
      for (const file of report.files.B)
        if (!used.has(file.id))
          line("Unpaired new file: " + fileLabel(file), 10);
    }
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setTextColor(110, 120, 135);
      doc.text(`pdfdiff · ${p} / ${pages}`, 15, 291);
    }
    doc.save("pdfdiff-package-report.pdf");
  }
  window.PdfDiffWorkspace = {
    context,
    configureFont,
    onAligned,
    onAlignmentAll,
    updateViewerContext,
    regions: () => (viewerPair() ? allRegions(viewerPair()) : []),
    onAI: (ai) => {
      const r = viewerResult();
      if (r) r.ai = { text: ai.text, model: ai.model, visual: ai.visual };
    },
    onSourceChange: () => {
      state.viewer = null;
      updateViewerContext();
    },
    exportCurrent: () => {
      const pair = viewerPair();
      return pair ? exportReport(pair) : null;
    },
  };
  render();
})();
