"file:" === location.protocol
  ? ((pdfjsLib.GlobalWorkerOptions.workerSrc = ""),
    console.log("PDF.js: main thread mode (file://)."))
  : ((pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"),
    console.log("PDF.js: Web Worker mode"));
const $ = (e) => document.getElementById(e),
  vpEl = $("vp"),
  W = $("W");
let pdfA = null,
  pdfB = null,
  pgA = null,
  pgB = null,
  cur = 1,
  total = 1,
  mode = "overlay",
  vp = { x: 0, y: 0, z: 1 };
const ZMIN = 0.05,
  ZMAX = 30;
let cA = null,
  cB = null,
  renderScale = 1,
  renderTimer = null,
  baseW = 0,
  baseH = 0,
  alignOn = !1,
  pgOff = {},
  gOff = { x: 0, y: 0, r: 0 },
  alDr = { on: !1, sx: 0, sy: 0, ox: 0, oy: 0 },
  pan = { on: !1, sx: 0, sy: 0, vx: 0, vy: 0 },
  spHeld = !1,
  blinkOn = !1,
  blinkT = null,
  swX = 0.5,
  swDr = !1,
  dMode = "",
  dCol = "#ff4466",
  dAct = !1,
  dS = { x: 0, y: 0 },
  dC = { x: 0, y: 0 },
  draws = [];
function off(e) {
  const t = pgOff[e] ? { ...pgOff[e] } : { ...gOff };
  return (void 0 === t.r && (t.r = 0), t);
}
function setOff(e, t, n, o) {
  invalidateAnalysis();
  const a = off(e);
  ((pgOff[e] = { x: t, y: n, r: void 0 !== o ? o : a.r }),
    ($("oTag").textContent =
      `ΔX:${Math.round(t)} ΔY:${Math.round(n)}${pgOff[e].r ? ` ∠${pgOff[e].r.toFixed(1)}°` : ""}`),
    updAlBtn());
  window.PdfDiffWorkspace?.onAligned();
}
function setRot(e, t) {
  invalidateAnalysis();
  const n = off(e);
  ((t = ((t % 360) + 360) % 360) > 180 && (t -= 360),
    (pgOff[e] = { x: n.x, y: n.y, r: t }),
    ($("oTag").textContent =
      `ΔX:${Math.round(n.x)} ΔY:${Math.round(n.y)}${t ? ` ∠${t.toFixed(1)}°` : ""}`),
    updAlBtn());
  const o = $("alBL");
  o && (o.style.transform = `rotate(${t}deg)`);
  window.PdfDiffWorkspace?.onAligned();
}
function hasOff() {
  if (gOff.x || gOff.y || gOff.r) return !0;
  for (const e in pgOff) if (pgOff[e].x || pgOff[e].y || pgOff[e].r) return !0;
  return !1;
}
function updAlBtn() {
  const e = $("alB");
  hasOff()
    ? (e.classList.add("grn"), (e.textContent = "⊞ Aligned"))
    : (e.classList.remove("grn"), (e.textContent = "⊞ Align"));
}
function applyVP() {
  ((W.style.transform = `translate(${vp.x}px,${vp.y}px) scale(${vp.z})`),
    ($("zI").textContent = Math.round(100 * vp.z) + "%"),
    ($("sZ").textContent = "Z:" + Math.round(100 * vp.z) + "%"),
    scheduleRender());
}
function fitW(e, t) {
  const n = vpEl.clientWidth,
    o = vpEl.clientHeight;
  ((vp.z = Math.min((n - 20) / e, (o - 20) / t, 2)),
    (vp.x = (n - e * vp.z) / 2),
    (vp.y = (o - t * vp.z) / 2),
    applyVP());
}
function scheduleRender() {
  clearTimeout(renderTimer);
  const e = Math.max(1, 1.2 * vp.z);
  (e > 1.4 * renderScale || e < 0.3 * renderScale) &&
    ($("rBadge").classList.add("show"),
    (renderTimer = setTimeout(() => doRender(e), 250)));
}
async function doRender(e) {
  if (!pdfA && !pdfB) return void $("rBadge").classList.remove("show");
  const t = Math.min(e, 10);
  renderScale = t;
  try {
    const [e, n] = await Promise.all([
      renderPg(pdfA, cur, t),
      renderPg(pdfB, cur, t),
    ]);
    ((cA = e),
      (cB = n),
      e ? ((baseW = e.w), (baseH = e.h)) : n && ((baseW = n.w), (baseH = n.h)));
  } catch (e) {
    console.error("Render error:", e);
  }
  ($("rBadge").classList.remove("show"), buildScene());
}
async function renderPg(e, t, n) {
  if (!e || t > e.numPages || (e.hasPage && !e.hasPage(t))) return null;
  try {
    const o = await e.getPage(t),
      a = o.getViewport({ scale: n }),
      i = document.createElement("canvas");
    ((i.width = Math.floor(a.width)),
      (i.height = Math.floor(a.height)),
      await o.render({ canvasContext: i.getContext("2d"), viewport: a })
        .promise);
    const s = o.getViewport({ scale: 1 });
    return { canvas: i, scale: n, w: s.width, h: s.height };
  } catch (e) {
    return (console.error("Page render error:", e), null);
  }
}
const sourceVersions = { A: 0, B: 0 };
async function loadF(file, side) {
  if (!file) return;
  const version = ++sourceVersions[side];
  invalidateAnalysis();
  window.PdfDiffWorkspace?.onSourceChange();
  try {
    const document = await pdfjsLib.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
    if (version !== sourceVersions[side]) {
      await document.destroy();
      return;
    }
    const old = side === "A" ? pdfA : pdfB;
    if (side === "A") pdfA = document;
    else pdfB = document;
    if (old?.destroy) await old.destroy();
    pgOff = {};
    gOff = { x: 0, y: 0, r: 0 };
    draws = [];
    stopBlink();
    stopDraw();
    if (alignOn) exitAl();
    $("dz" + side).classList.add("ok");
    $("dl" + side).textContent = "✓ " + document.numPages + " pages";
    $("dl" + side).style.color = "";
    $("fn" + side).textContent = file.name;
    if (pdfA && pdfB) await init();
  } catch (error) {
    if (version !== sourceVersions[side]) return;
    $("dl" + side).textContent = "Processing error: " + error.message;
    $("dl" + side).style.color = "var(--red)";
  }
}
async function init() {
  ((total = Math.max(pdfA.numPages, pdfB.numPages)),
    (cur = 1),
    ($("dzs").style.display = "none"),
    (renderScale = 1),
    await doRender(1),
    fitW(baseW * ("side" === mode ? 2.1 : 1), baseH));
}
function buildScene() {
  ((W.innerHTML = ""),
    (cA || cB) &&
      (vpEl
        .querySelectorAll(".dl,.sw-line,.sw-handle")
        .forEach((e) => e.remove()),
      updPgUI(),
      alignOn
        ? buildAlign()
        : ("overlay" === mode
            ? buildOvl()
            : "side" === mode
              ? buildSide()
              : "swipe" === mode && buildSwipe(),
          buildDraw())));
}
function mkC(e) {
  const t = document.createElement("canvas");
  return (
    (t.width = e.canvas.width),
    (t.height = e.canvas.height),
    (t.style.width = e.w + "px"),
    (t.style.height = e.h + "px"),
    t.getContext("2d").drawImage(e.canvas, 0, 0),
    t
  );
}
function mkD(e) {
  const t = document.createElement("div");
  return ((t.className = e), t);
}
function addLbl(e, t, n) {
  const o = document.createElement("div");
  ((o.style.cssText = `position:absolute;top:3px;left:3px;font-family:JetBrains Mono,monospace;font-size:7px;padding:1px 4px;border-radius:2px;z-index:5;color:${n ? "#fff" : "#111"};background:${n ? "var(--ac)" : "var(--ora)"};`),
    (o.textContent = t),
    e.appendChild(o));
}
function buildOvl() {
  const e = off(cur),
    t = Math.max(baseW, (cB ? cB.w : 0) + Math.abs(e.x)),
    n = Math.max(baseH, (cB ? cB.h : 0) + Math.abs(e.y));
  if (((W.style.width = t + "px"), (W.style.height = n + "px"), cA)) {
    const t = mkD("la");
    ((t.style.left = Math.max(0, -e.x) + "px"),
      (t.style.top = Math.max(0, -e.y) + "px"),
      t.appendChild(mkC(cA)),
      addLbl(t, "A", !0),
      W.appendChild(t));
  }
  if (cB) {
    const t = mkD("lb");
    ((t.id = "lB"),
      (t.style.left = Math.max(0, e.x) + "px"),
      (t.style.top = Math.max(0, e.y) + "px"),
      (t.style.opacity = $("opS").value / 100),
      e.r && (t.style.transform = `rotate(${e.r}deg)`),
      t.appendChild(mkC(cB)),
      addLbl(t, "B", !1),
      W.appendChild(t));
  }
}
function buildSide() {
  const e = (cA ? cA.w : 0) + (cB ? cB.w : 0) + 16,
    t = Math.max(cA ? cA.h : 0, cB ? cB.h : 0);
  if (((W.style.width = e + "px"), (W.style.height = t + "px"), cA)) {
    const e = mkD("la");
    (e.appendChild(mkC(cA)), addLbl(e, "A", !0), W.appendChild(e));
  }
  if (cB) {
    const e = mkD("lb");
    ((e.style.left = (cA ? cA.w : 0) + 16 + "px"),
      e.appendChild(mkC(cB)),
      addLbl(e, "B", !1),
      W.appendChild(e));
  }
}
function buildSwipe() {
  if (!cA || !cB) return;
  const e = off(cur),
    t = Math.max(cA.w, cB.w),
    n = Math.max(cA.h, cB.h);
  ((W.style.width = t + "px"), (W.style.height = n + "px"));
  const o = mkD("la");
  ((o.id = "swA"), o.appendChild(mkC(cA)), addLbl(o, "A", !0));
  const a = mkD("lb");
  ((a.id = "swB"),
    (a.style.left = e.x + "px"),
    (a.style.top = e.y + "px"),
    e.r && (a.style.transform = `rotate(${e.r}deg)`),
    a.appendChild(mkC(cB)),
    addLbl(a, "B", !1));
  const i = swX * t;
  ((o.style.clipPath = `inset(0 ${t - i}px 0 0)`),
    (a.style.clipPath = `inset(0 0 0 ${i - e.x}px)`),
    W.appendChild(o),
    W.appendChild(a));
  const s = document.createElement("div");
  ((s.className = "sw-line"),
    (s.style.left = i + "px"),
    (s.style.height = n + "px"),
    (s.style.position = "absolute"),
    (s.style.top = "0"));
  const r = document.createElement("div");
  ((r.className = "sw-handle"),
    (r.style.left = i + "px"),
    (r.style.top = n / 2 + "px"),
    (r.style.position = "absolute"),
    (r.textContent = "⇔"),
    W.appendChild(s),
    W.appendChild(r),
    (W._sw = { dA: o, dB: a, ln: s, hd: r, w: t, ox: e.x }));
}
function buildAlign() {
  if (((W.innerHTML = ""), !cA && !cB)) return;
  const e = Math.max(cA ? cA.w : 0, cB ? cB.w : 0) + 80,
    t = Math.max(cA ? cA.h : 0, cB ? cB.h : 0) + 80;
  if (((W.style.width = e + "px"), (W.style.height = t + "px"), cA)) {
    const e = mkD("la");
    ((e.id = "alAL"),
      e.appendChild(mkC(cA)),
      addLbl(e, "A", !0),
      W.appendChild(e));
  }
  if (cB) {
    const e = off(cur),
      t = mkD("lb alvis");
    ((t.id = "alBL"),
      (t.style.left = e.x + "px"),
      (t.style.top = e.y + "px"),
      e.r && (t.style.transform = `rotate(${e.r}deg)`),
      t.appendChild(mkC(cB)),
      addLbl(t, "B", !1),
      W.appendChild(t),
      ($("oTag").textContent =
        `ΔX:${Math.round(e.x)} ΔY:${Math.round(e.y)}${e.r ? ` ∠${e.r.toFixed(1)}°` : ""}`));
  }
}
function buildDraw() {
  const e = parseInt(W.style.width) || baseW,
    t = parseInt(W.style.height) || baseH,
    n = mkD("drl");
  n.id = "drL";
  const o = document.createElement("canvas");
  ((o.width = Math.round(2 * e)),
    (o.height = Math.round(2 * t)),
    (o.style.width = e + "px"),
    (o.style.height = t + "px"),
    (o.id = "drC"),
    n.appendChild(o),
    W.appendChild(n),
    redrawD(o));
}
function redrawD(e) {
  if ((e || (e = $("drC")), !e)) return;
  const t = e.getContext("2d");
  (t.clearRect(0, 0, e.width, e.height),
    (t.lineWidth = 4),
    (t.lineCap = "round"));
  for (const e of draws)
    if (((t.strokeStyle = e.color), (t.fillStyle = e.color), "line" === e.type))
      (t.beginPath(),
        t.moveTo(2 * e.pts[0], 2 * e.pts[1]),
        t.lineTo(2 * e.pts[2], 2 * e.pts[3]),
        t.stroke());
    else if ("rect" === e.type)
      t.strokeRect(2 * e.pts[0], 2 * e.pts[1], 2 * e.pts[2], 2 * e.pts[3]);
    else if ("circle" === e.type)
      (t.beginPath(),
        t.arc(2 * e.pts[0], 2 * e.pts[1], 2 * e.pts[2], 0, 2 * Math.PI),
        t.stroke());
    else if ("arrow" === e.type) {
      const [n, o, a, i] = e.pts;
      (t.beginPath(),
        t.moveTo(2 * n, 2 * o),
        t.lineTo(2 * a, 2 * i),
        t.stroke());
      const s = Math.atan2(i - o, a - n),
        r = 12;
      (t.beginPath(),
        t.moveTo(2 * a, 2 * i),
        t.lineTo(
          2 * (a - r * Math.cos(s - 0.5)),
          2 * (i - r * Math.sin(s - 0.5)),
        ),
        t.moveTo(2 * a, 2 * i),
        t.lineTo(
          2 * (a - r * Math.cos(s + 0.5)),
          2 * (i - r * Math.sin(s + 0.5)),
        ),
        t.stroke());
    } else if ("text" === e.type)
      ((t.font = "28px 'DM Sans',sans-serif"),
        t.fillText(e.text, 2 * e.pts[0], 2 * e.pts[1]));
    else if ("meas" === e.type) {
      const [n, o, a, i] = e.pts;
      ((t.strokeStyle = "#0891b2"),
        (t.fillStyle = "#0891b2"),
        (t.lineWidth = 3.2),
        t.beginPath(),
        t.moveTo(2 * n, 2 * o),
        t.lineTo(2 * a, 2 * i),
        t.stroke());
      const s = Math.atan2(i - o, a - n),
        r = 12;
      for (const [e, l] of [
        [n, o],
        [a, i],
      ])
        (t.beginPath(),
          t.moveTo(2 * e - r * Math.sin(s), 2 * l + r * Math.cos(s)),
          t.lineTo(2 * e + r * Math.sin(s), 2 * l - r * Math.cos(s)),
          t.stroke());
      const l = ((n + a) / 2) * 2,
        c = ((o + i) / 2) * 2,
        d = e.m >= 1 ? e.m.toFixed(2) + " m" : (100 * e.m).toFixed(1) + " cm";
      t.font = "bold 24px 'JetBrains Mono',monospace";
      const p = t.measureText(d).width;
      ((t.fillStyle = "rgba(255,255,255,.92)"),
        t.fillRect(l - p / 2 - 8, c - 30, p + 16, 36),
        (t.fillStyle = "#0891b2"),
        t.fillText(d, l - p / 2, c - 4),
        (t.lineWidth = 4));
    }
}
function updPgUI() {
  (($("pgI").textContent = `${cur}/${total}`),
    ($("ppB").disabled = cur <= 1),
    ($("npB").disabled = cur >= total),
    ($("sP").textContent = `P:${cur}/${total}`));
}
(["A", "B"].forEach((e) => {
  const t = $("f" + e),
    n = $("dz" + e);
  (t.addEventListener("change", (t) => loadF(t.target.files[0], e)),
    n.addEventListener("dragover", (e) => {
      (e.preventDefault(), n.classList.add("ov"));
    }),
    n.addEventListener("dragleave", () => n.classList.remove("ov")),
    n.addEventListener("drop", (t) => {
      (t.preventDefault(), n.classList.remove("ov"));
      const o = t.dataTransfer.files[0];
      o && "application/pdf" === o.type && loadF(o, e);
    }));
}),
  vpEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const t = vpEl.getBoundingClientRect(),
        n = e.clientX - t.left,
        o = e.clientY - t.top,
        a = (n - vp.x) / vp.z,
        i = (o - vp.y) / vp.z,
        s = e.deltaY > 0 ? 0.88 : 1 / 0.88;
      ((vp.z = Math.min(30, Math.max(0.05, vp.z * s))),
        (vp.x = n - a * vp.z),
        (vp.y = o - i * vp.z),
        applyVP());
    },
    { passive: !1 },
  ),
  vpEl.addEventListener("mousedown", (e) => {
    if (alignOn && ptPhase && !spHeld && 0 === e.button) ptClick(e);
    else {
      if (!mOn || spHeld || alignOn || dMode || 0 !== e.button)
        return "swipe" !== mode || spHeld || alignOn || dMode || 0 !== e.button
          ? alignOn && !spHeld && 0 === e.button
            ? ((alDr = {
                on: !0,
                sx: e.clientX,
                sy: e.clientY,
                ox: off(cur).x,
                oy: off(cur).y,
              }),
              void vpEl.classList.add("alm"))
            : void (!dMode || spHeld || 0 !== e.button
                ? (0 !== e.button && 1 !== e.button) ||
                  (e.preventDefault(),
                  (pan = {
                    on: !0,
                    sx: e.clientX,
                    sy: e.clientY,
                    vx: vp.x,
                    vy: vp.y,
                  }),
                  vpEl.classList.add("pan"))
                : startDr(e))
          : ((swDr = !0), void doSw(e));
      measClick(e);
    }
  }),
  window.addEventListener("mousemove", (e) => {
    if (pan.on)
      return (
        (vp.x = pan.vx + (e.clientX - pan.sx)),
        (vp.y = pan.vy + (e.clientY - pan.sy)),
        void applyVP()
      );
    if (alDr.on) {
      const t = (e.clientX - alDr.sx) / vp.z,
        n = (e.clientY - alDr.sy) / vp.z;
      setOff(cur, alDr.ox + t, alDr.oy + n);
      const o = $("alBL");
      return void (
        o &&
        ((o.style.left = alDr.ox + t + "px"),
        (o.style.top = alDr.oy + n + "px"))
      );
    }
    if (dAct) return void moveDr(e);
    if (swDr) return void doSw(e);
    const t = vpEl.getBoundingClientRect();
    $("sC").textContent =
      `${Math.round((e.clientX - t.left - vp.x) / vp.z)},${Math.round((e.clientY - t.top - vp.y) / vp.z)}`;
  }),
  window.addEventListener("mouseup", () => {
    (pan.on && ((pan.on = !1), vpEl.classList.remove("pan")),
      alDr.on && ((alDr.on = !1), vpEl.classList.remove("alm")),
      dAct && endDr(),
      (swDr = !1));
  }),
  vpEl.addEventListener("contextmenu", (e) => e.preventDefault()));
let tc = { p: !1, pi: !1, ld: 0, sx: 0, sy: 0, vx: 0, vy: 0 };
function doSw(e) {
  if ("swipe" !== mode) return;
  const t = vpEl.getBoundingClientRect(),
    n = (e.clientX - t.left - vp.x) / vp.z,
    o = W._sw;
  if (!o) return;
  const a = Math.max(0, Math.min(n, o.w));
  ((swX = a / o.w),
    (o.dA.style.clipPath = `inset(0 ${o.w - a}px 0 0)`),
    (o.dB.style.clipPath = `inset(0 0 0 ${a - o.ox}px)`),
    (o.ln.style.left = a + "px"),
    (o.hd.style.left = a + "px"));
}
function startDr(e) {
  dAct = !0;
  const t = vpEl.getBoundingClientRect();
  if (
    ((dS.x = (e.clientX - t.left - vp.x) / vp.z),
    (dS.y = (e.clientY - t.top - vp.y) / vp.z),
    (dC = { ...dS }),
    "text" === dMode)
  ) {
    const e = prompt("Text:");
    return (
      e &&
        (draws.push({ type: "text", pts: [dS.x, dS.y], color: dCol, text: e }),
        redrawD()),
      void (dAct = !1)
    );
  }
}
function moveDr(e) {
  const t = vpEl.getBoundingClientRect();
  ((dC.x = (e.clientX - t.left - vp.x) / vp.z),
    (dC.y = (e.clientY - t.top - vp.y) / vp.z));
  const n = $("drC");
  if (!n) return;
  const o = n.getContext("2d");
  if (
    (o.clearRect(0, 0, n.width, n.height),
    redrawD(n),
    (o.strokeStyle = dCol),
    (o.lineWidth = 4),
    o.setLineDash([8, 8]),
    "line" === dMode)
  )
    (o.beginPath(),
      o.moveTo(2 * dS.x, 2 * dS.y),
      o.lineTo(2 * dC.x, 2 * dC.y),
      o.stroke());
  else if ("rect" === dMode)
    o.strokeRect(
      2 * Math.min(dS.x, dC.x),
      2 * Math.min(dS.y, dC.y),
      2 * Math.abs(dC.x - dS.x),
      2 * Math.abs(dC.y - dS.y),
    );
  else if ("circle" === dMode) {
    const e = Math.hypot(dC.x - dS.x, dC.y - dS.y);
    (o.beginPath(),
      o.arc(2 * dS.x, 2 * dS.y, 2 * e, 0, 2 * Math.PI),
      o.stroke());
  } else
    "arrow" === dMode &&
      (o.beginPath(),
      o.moveTo(2 * dS.x, 2 * dS.y),
      o.lineTo(2 * dC.x, 2 * dC.y),
      o.stroke());
  o.setLineDash([]);
}
function endDr() {
  dAct &&
    ((dAct = !1),
    "line" === dMode
      ? draws.push({ type: "line", pts: [dS.x, dS.y, dC.x, dC.y], color: dCol })
      : "rect" === dMode
        ? draws.push({
            type: "rect",
            pts: [
              Math.min(dS.x, dC.x),
              Math.min(dS.y, dC.y),
              Math.abs(dC.x - dS.x),
              Math.abs(dC.y - dS.y),
            ],
            color: dCol,
          })
        : "circle" === dMode
          ? draws.push({
              type: "circle",
              pts: [dS.x, dS.y, Math.hypot(dC.x - dS.x, dC.y - dS.y)],
              color: dCol,
            })
          : "arrow" === dMode &&
            draws.push({
              type: "arrow",
              pts: [dS.x, dS.y, dC.x, dC.y],
              color: dCol,
            }),
    redrawD());
}
function stopBlink() {
  if (blinkOn) {
    ((blinkOn = !1), $("blkB").classList.remove("on"), clearTimeout(blinkT));
    const e = W.querySelector(".lb");
    e && (e.style.opacity = $("opS").value / 100);
  }
}
function stopDraw() {
  dMode &&
    ((dMode = ""),
    document
      .querySelectorAll("#dGrp .b")
      .forEach((e) => e.classList.remove("on")),
    vpEl.classList.remove("draw"),
    $("drL")?.classList.remove("act"));
}
function doBl() {
  if (!blinkOn) return;
  const e = W.querySelector(".lb");
  (e && (e.style.opacity = "0" === e.style.opacity ? "1" : "0"),
    (blinkT = setTimeout(doBl, 400)));
}
async function changePg() {
  const show = $("txtPanel").classList.contains("on");
  invalidateAnalysis();
  stopBlink();
  if (mOn) {
    mP1 = null;
    mCalP1 = null;
    W.querySelectorAll(".ptmk").forEach((e) => e.remove());
  }
  renderScale = 1;
  await doRender(vp.z);
  if (alignOn) buildAlign();
  if (mOn) measStatus();
  window.PdfDiffWorkspace?.updateViewerContext();
  if (show) await runTextDiff();
}
(vpEl.addEventListener(
  "touchstart",
  (e) => {
    if (2 === e.touches.length)
      (e.preventDefault(),
        (tc.pi = !0),
        (tc.ld = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        )));
    else if (1 === e.touches.length) {
      if (alignOn)
        return void (alDr = {
          on: !0,
          sx: e.touches[0].clientX,
          sy: e.touches[0].clientY,
          ox: off(cur).x,
          oy: off(cur).y,
        });
      ((tc.p = !0),
        (tc.sx = e.touches[0].clientX),
        (tc.sy = e.touches[0].clientY),
        (tc.vx = vp.x),
        (tc.vy = vp.y));
    }
  },
  { passive: !1 },
),
  vpEl.addEventListener(
    "touchmove",
    (e) => {
      if (tc.pi && 2 === e.touches.length) {
        e.preventDefault();
        const t = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY,
          ),
          n = t / tc.ld,
          o = vpEl.getBoundingClientRect(),
          a = (e.touches[0].clientX + e.touches[1].clientX) / 2 - o.left,
          i = (e.touches[0].clientY + e.touches[1].clientY) / 2 - o.top,
          s = (a - vp.x) / vp.z,
          r = (i - vp.y) / vp.z;
        ((vp.z = Math.min(30, Math.max(0.05, vp.z * n))),
          (vp.x = a - s * vp.z),
          (vp.y = i - r * vp.z),
          (tc.ld = t),
          applyVP());
      } else if (tc.p && 1 === e.touches.length) {
        if (alDr.on) {
          const t = (e.touches[0].clientX - alDr.sx) / vp.z,
            n = (e.touches[0].clientY - alDr.sy) / vp.z;
          setOff(cur, alDr.ox + t, alDr.oy + n);
          const o = $("alBL");
          return void (
            o &&
            ((o.style.left = alDr.ox + t + "px"),
            (o.style.top = alDr.oy + n + "px"))
          );
        }
        ((vp.x = tc.vx + (e.touches[0].clientX - tc.sx)),
          (vp.y = tc.vy + (e.touches[0].clientY - tc.sy)),
          applyVP());
      }
    },
    { passive: !1 },
  ),
  vpEl.addEventListener("touchend", (e) => {
    (e.touches.length < 2 && (tc.pi = !1),
      e.touches.length || ((tc.p = !1), (alDr.on = !1)));
  }),
  window.addEventListener("keydown", (e) => {
    if (
      e.target.closest("input,textarea,select") ||
      document.querySelector("dialog[open]") ||
      document.getElementById("batchPane")?.hidden === false
    )
      return;
    if (
      ("Space" !== e.code || e.repeat || ((spHeld = !0), e.preventDefault()),
      alignOn &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
    ) {
      e.preventDefault();
      const t = e.shiftKey ? 10 : 1,
        n = off(cur);
      let o = n.x,
        a = n.y;
      ("ArrowLeft" === e.key && (o -= t),
        "ArrowRight" === e.key && (o += t),
        "ArrowUp" === e.key && (a -= t),
        "ArrowDown" === e.key && (a += t),
        setOff(cur, o, a));
      const i = $("alBL");
      return void (i && ((i.style.left = o + "px"), (i.style.top = a + "px")));
    }
    return !alignOn || ("Enter" !== e.key && "Escape" !== e.key)
      ? "Escape" === e.key && mOn
        ? (stopMeas(),
          void ($("sH").textContent =
            "Scroll: zoom · Drag: pan · Arrows: pages"))
        : void (
            alignOn ||
            dMode ||
            ("ArrowLeft" === e.key && cur > 1 && (cur--, changePg()),
            "ArrowRight" === e.key && cur < total && (cur++, changePg()))
          )
      : ptPhase && "Escape" === e.key
        ? void ptCancel()
        : void $("adB").click();
  }),
  window.addEventListener("keyup", (e) => {
    "Space" === e.code && (spHeld = !1);
  }),
  document.querySelectorAll("#mGrp .b").forEach((e) =>
    e.addEventListener("click", () => {
      alignOn ||
        (stopBlink(),
        stopDraw(),
        stopMeas(),
        document
          .querySelectorAll("#mGrp .b")
          .forEach((e) => e.classList.remove("on")),
        e.classList.add("on"),
        (mode = e.dataset.m),
        ($("opC").style.display = "overlay" === mode ? "" : "none"),
        ($("blkB").style.display = "overlay" === mode ? "" : "none"),
        vpEl.querySelectorAll(".dl").forEach((e) => e.remove()),
        buildScene());
    }),
  ),
  $("opS").addEventListener("input", (e) => {
    $("opV").textContent = e.target.value + "%";
    const t = W.querySelector(".lb");
    t && (t.style.opacity = e.target.value / 100);
  }),
  $("blkB").addEventListener("click", () => {
    if (!alignOn)
      if (
        ((blinkOn = !blinkOn),
        $("blkB").classList.toggle("on", blinkOn),
        blinkOn)
      )
        doBl();
      else {
        clearTimeout(blinkT);
        const e = W.querySelector(".lb");
        e && (e.style.opacity = $("opS").value / 100);
      }
  }),
  $("ppB").addEventListener("click", () => {
    cur > 1 && (cur--, changePg());
  }),
  $("npB").addEventListener("click", () => {
    cur < total && (cur++, changePg());
  }),
  $("alB").addEventListener("click", () => {
    pdfA && pdfB && (alignOn ? exitAl() : enterAl());
  }),
  $("adB").addEventListener("click", () => {
    (exitAl(), buildScene());
  }),
  $("arB").addEventListener("click", () => {
    invalidateAnalysis();
    window.PdfDiffWorkspace?.onAlignmentAll(null);
    ((pgOff = {}),
      (gOff = { x: 0, y: 0, r: 0 }),
      ($("oTag").textContent = "ΔX:0 ΔY:0"),
      updAlBtn(),
      buildScene());
  }),
  $("aaB").addEventListener("click", () => {
    invalidateAnalysis();
    window.PdfDiffWorkspace?.onAlignmentAll(off(cur));
    const e = off(cur);
    ((gOff = { x: e.x, y: e.y, r: e.r || 0 }),
      (pgOff = {}),
      (pgOff[cur] = { x: e.x, y: e.y, r: e.r || 0 }));
  }),
  $("rL90").addEventListener("click", () => {
    (setRot(cur, off(cur).r - 90), alignOn ? buildAlign() : buildScene());
  }),
  $("rR90").addEventListener("click", () => {
    (setRot(cur, off(cur).r + 90), alignOn ? buildAlign() : buildScene());
  }),
  $("rL1").addEventListener("click", (e) => {
    (setRot(cur, off(cur).r - (e.shiftKey ? 0.1 : 1)),
      alignOn ? buildAlign() : buildScene());
  }),
  $("rR1").addEventListener("click", (e) => {
    (setRot(cur, off(cur).r + (e.shiftKey ? 0.1 : 1)),
      alignOn ? buildAlign() : buildScene());
  }));
let ptPhase = 0,
  ptA = null;
function snapToCorner(e, t, n) {
  const o = "A" === e ? cA : cB;
  if (!o) return { x: t, y: n };
  const a = off(cur);
  let i = t,
    s = n;
  if ("B" === e) {
    let e = t - a.x,
      r = n - a.y;
    if (a.r) {
      const t = (-a.r * Math.PI) / 180,
        n = Math.cos(t),
        i = Math.sin(t),
        s = o.w / 2,
        l = o.h / 2,
        c = e - s,
        d = r - l;
      ((e = s + c * n - d * i), (r = l + c * i + d * n));
    }
    ((i = e), (s = r));
  }
  const r = renderScale,
    l = Math.max(10, Math.min(120, Math.round((20 / vp.z) * r))),
    c = Math.round(i * r),
    d = Math.round(s * r),
    p = Math.max(0, c - l),
    u = Math.max(0, d - l),
    h = Math.min(o.canvas.width, c + l) - p,
    f = Math.min(o.canvas.height, d + l) - u;
  if (h < 12 || f < 12) return { x: t, y: n };
  let m;
  try {
    m = o.canvas.getContext("2d").getImageData(p, u, h, f).data;
  } catch (e) {
    return { x: t, y: n };
  }
  const y = new Float32Array(h * f);
  for (let e = 0; e < h * f; e++)
    y[e] =
      (255 - (0.299 * m[4 * e] + 0.587 * m[4 * e + 1] + 0.114 * m[4 * e + 2])) /
      255;
  const v = new Float32Array(h * f),
    x = new Float32Array(h * f);
  for (let e = 1; e < f - 1; e++)
    for (let t = 1; t < h - 1; t++) {
      const n = e * h + t;
      ((v[n] =
        y[n - h + 1] +
        2 * y[n + 1] +
        y[n + h + 1] -
        y[n - h - 1] -
        2 * y[n - 1] -
        y[n + h - 1]),
        (x[n] =
          y[n + h - 1] +
          2 * y[n + h] +
          y[n + h + 1] -
          y[n - h - 1] -
          2 * y[n - h] -
          y[n - h + 1]));
    }
  const g = 2 * Math.pow(0.5 * l, 2),
    w = Math.pow(0.6 * l, 2);
  let b = 0,
    $ = -1,
    C = -1;
  for (let e = 3; e < f - 2 - 1; e++)
    for (let t = 3; t < h - 2 - 1; t++) {
      const n = Math.pow(t - (c - p), 2) + Math.pow(e - (d - u), 2);
      if (n > w) continue;
      let o = 0,
        a = 0,
        i = 0;
      for (let n = -2; n <= 2; n++) {
        const s = (e + n) * h + t;
        for (let e = -2; e <= 2; e++) {
          const t = s + e;
          ((o += v[t] * v[t]), (a += x[t] * x[t]), (i += v[t] * x[t]));
        }
      }
      const s = o + a;
      let r = o * a - i * i - 0.04 * s * s;
      r <= 0 || ((r *= Math.exp(-n / g)), r > b && ((b = r), ($ = t), (C = e)));
    }
  if (b < 5 || $ < 0) return { x: t, y: n };
  let M = (p + $) / r,
    A = (u + C) / r;
  if ("B" === e) {
    if (a.r) {
      const e = (a.r * Math.PI) / 180,
        t = Math.cos(e),
        n = Math.sin(e),
        i = o.w / 2,
        s = o.h / 2,
        r = M - i,
        l = A - s;
      ((M = i + r * t - l * n), (A = s + r * n + l * t));
    }
    ((M += a.x), (A += a.y));
  }
  return { x: M, y: A, snapped: !0 };
}
function ptMarker(e, t, n) {
  const o = document.createElement("div");
  o.className = "ptmk";
  const a = n ? "#15a34a" : "#dc2626";
  o.style.cssText = `position:absolute;left:${e}px;top:${t}px;width:0;height:0;pointer-events:none;z-index:60;`;
  const i = 1 / vp.z;
  ((o.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" style="position:absolute;left:-7px;top:-7px;transform:scale(${i});transform-origin:7px 7px;overflow:visible;"><line x1="7" y1="0" x2="7" y2="14" stroke="${a}" stroke-width="1"/><line x1="0" y1="7" x2="14" y2="7" stroke="${a}" stroke-width="1"/><circle cx="7" cy="7" r="3.5" fill="none" stroke="${a}" stroke-width="0.9"/></svg>`),
    W.appendChild(o));
}
let ptMode = 1,
  ptPicks = {};
function showOnlyA() {
  const e = $("alAL");
  e && (e.style.display = "");
  const t = $("alBL");
  t && (t.style.display = "none");
}
function showOnlyB() {
  const e = $("alAL");
  e && (e.style.display = "none");
  const t = $("alBL");
  t && ((t.style.display = ""), (t.style.opacity = "1"));
}
function worldToBPage(e, t) {
  const n = off(cur);
  let o = e - n.x,
    a = t - n.y;
  if (n.r) {
    const e = (-n.r * Math.PI) / 180,
      t = Math.cos(e),
      i = Math.sin(e),
      s = cB.w / 2,
      r = cB.h / 2,
      l = o - s,
      c = a - r;
    ((o = s + l * t - c * i), (a = r + l * i + c * t));
  }
  return { x: o, y: a };
}
function ptStart(e) {
  alignOn &&
    ((ptMode = e ? 2 : 1),
    (ptPhase = 1),
    (ptA = null),
    (ptPicks = {}),
    $(e ? "ap2B" : "apB").classList.add("on"),
    showOnlyA(),
    ($("sH").textContent =
      (2 === ptMode ? "2-POINT 1/4" : "POINT ALIGN 1/2") +
      ": click a distinctive point on drawing A (corner, intersection). Tip: zoom in close!"),
    (vpEl.style.cursor = "crosshair"));
}
function ptCancel() {
  ((ptPhase = 0),
    (ptA = null),
    (ptPicks = {}),
    $("apB").classList.remove("on"),
    $("ap2B").classList.remove("on"),
    (vpEl.style.cursor = ""),
    ($("sH").textContent = "Drag B · Arrows: 1px · Shift+arrow: 10px"),
    buildAlign());
}
function ptClick(e) {
  const t = vpEl.getBoundingClientRect(),
    n = (e.clientX - t.left - vp.x) / vp.z,
    o = (e.clientY - t.top - vp.y) / vp.z,
    a = (e) => (e.snapped ? "✓ Snapped to corner. " : "");
  if (1 !== ptMode) {
    if (1 === ptPhase) {
      const e = snapToCorner("A", n, o);
      ((ptPicks.A1 = { x: e.x, y: e.y }),
        ptMarker(e.x, e.y, e.snapped),
        showOnlyB(),
        (ptPhase = 2),
        ($("sH").textContent =
          a(e) + "2-POINT 2/4: click the SAME point on drawing B."));
    } else if (2 === ptPhase) {
      const e = snapToCorner("B", n, o);
      ((ptPicks.B1 = worldToBPage(e.x, e.y)),
        ptMarker(e.x, e.y, e.snapped),
        showOnlyA(),
        (ptPhase = 3),
        ($("sH").textContent =
          a(e) + "2-POINT 3/4: click ANOTHER, far-away point on drawing A."));
    } else if (3 === ptPhase) {
      const e = snapToCorner("A", n, o);
      ((ptPicks.A2 = { x: e.x, y: e.y }),
        ptMarker(e.x, e.y, e.snapped),
        showOnlyB(),
        (ptPhase = 4),
        ($("sH").textContent =
          a(e) + "2-POINT 4/4: click the SAME (second) point on drawing B."));
    } else if (4 === ptPhase) {
      const e = snapToCorner("B", n, o);
      ptPicks.B2 = worldToBPage(e.x, e.y);
      const { A1: t, A2: a, B1: i, B2: s } = ptPicks,
        r = { x: a.x - t.x, y: a.y - t.y },
        l = { x: s.x - i.x, y: s.y - i.y },
        c = Math.hypot(r.x, r.y),
        d = Math.hypot(l.x, l.y);
      if (c < 5 || d < 5)
        return void ptCancelFinish(
          "The two points are too close together — pick points further apart.",
        );
      let p = (180 * (Math.atan2(r.y, r.x) - Math.atan2(l.y, l.x))) / Math.PI;
      ((p = ((p % 360) + 360) % 360), p > 180 && (p -= 360));
      const u = (p * Math.PI) / 180,
        h = Math.cos(u),
        f = Math.sin(u),
        m = cB.w / 2,
        y = cB.h / 2,
        v = i.x - m,
        x = i.y - y,
        g = { x: m + v * h - x * f, y: y + v * f + x * h };
      setOff(cur, t.x - g.x, t.y - g.y, p);
      const w = 100 * Math.abs(c / d - 1);
      ptCancelFinish(
        `2-point alignment done: ∠${p.toFixed(2)}°.` +
          (w > 1
            ? ` ⚠ Scale mismatch ~${w.toFixed(1)}% — the two drawings are not at the same scale!`
            : ""),
      );
    }
  } else if (1 === ptPhase) {
    const e = snapToCorner("A", n, o);
    ((ptA = { x: e.x, y: e.y }),
      ptMarker(e.x, e.y, e.snapped),
      showOnlyB(),
      (ptPhase = 2),
      ($("sH").textContent =
        a(e) + "POINT ALIGN 2/2: now click the SAME point on drawing B."));
  } else if (2 === ptPhase) {
    const e = snapToCorner("B", n, o),
      t = off(cur);
    (setOff(cur, t.x + (ptA.x - e.x), t.y + (ptA.y - e.y)),
      ptCancelFinish(
        "Point alignment done" +
          (e.snapped ? " (snapped to corner)" : "") +
          ". Verify, and fine-tune with arrows if needed.",
      ));
  }
}
function ptCancelFinish(e) {
  ((ptPhase = 0),
    (ptA = null),
    (ptPicks = {}),
    $("apB").classList.remove("on"),
    $("ap2B").classList.remove("on"),
    (vpEl.style.cursor = ""),
    ($("sH").textContent = e),
    buildAlign());
}
($("apB").addEventListener("click", () => {
  ptPhase ? ptCancel() : ptStart(!1);
}),
  $("ap2B").addEventListener("click", () => {
    ptPhase ? ptCancel() : ptStart(!0);
  }));
let mOn = !1,
  mCal = {},
  mP1 = null,
  mCalP1 = null;
function stopMeas() {
  ((mOn = !1),
    (mP1 = null),
    (mCalP1 = null),
    $("measB").classList.remove("on"),
    dMode || ptPhase || (vpEl.style.cursor = ""),
    W.querySelectorAll(".ptmk").forEach((e) => e.remove()));
}
function measStatus() {
  mCal[cur]
    ? ($("sH").textContent =
        "MEASURE: click the " +
        (mP1 ? "other" : "first") +
        " endpoint of the segment to measure. (Esc: exit, Shift+Measure button: recalibrate)")
    : ($("sH").textContent =
        "MEASURE — calibration " +
        (mCalP1
          ? "2/2: click the OTHER end of the reference segment"
          : "1/2: click one end of a segment with a known length (e.g. a dimension line)"));
}
function measClick(e) {
  const t = vpEl.getBoundingClientRect(),
    n = (e.clientX - t.left - vp.x) / vp.z,
    o = (e.clientY - t.top - vp.y) / vp.z,
    a = cA ? snapToCorner("A", n, o) : { x: n, y: o };
  if (!mCal[cur]) {
    if (!mCalP1)
      return (
        (mCalP1 = { x: a.x, y: a.y }),
        ptMarker(a.x, a.y, a.snapped),
        void measStatus()
      );
    const e = Math.hypot(a.x - mCalP1.x, a.y - mCalP1.y);
    if (e < 3)
      return (
        ($("sH").textContent =
          "The two calibration points are too close — start over."),
        (mCalP1 = null),
        void W.querySelectorAll(".ptmk").forEach((e) => e.remove())
      );
    const t = prompt("Real length of the marked segment in meters (e.g. 5.0):");
    W.querySelectorAll(".ptmk").forEach((e) => e.remove());
    const n = parseFloat((t || "").replace(",", "."));
    return !n || n <= 0
      ? ((mCalP1 = null),
        ($("sH").textContent = "Calibration cancelled."),
        void measStatus())
      : ((mCal[cur] = n / e),
        (mCalP1 = null),
        ($("sH").textContent =
          `Calibrated: 1 drawing unit = ${(1e3 * mCal[cur]).toFixed(2)} mm. You can measure now!`),
        void setTimeout(measStatus, 2200));
  }
  if (!mP1)
    return (
      (mP1 = { x: a.x, y: a.y }),
      ptMarker(a.x, a.y, a.snapped),
      void measStatus()
    );
  const i = Math.hypot(a.x - mP1.x, a.y - mP1.y) * mCal[cur];
  (draws.push({
    type: "meas",
    pts: [mP1.x, mP1.y, a.x, a.y],
    m: i,
    color: "#0891b2",
  }),
    (mP1 = null),
    W.querySelectorAll(".ptmk").forEach((e) => e.remove()),
    redrawD(),
    measStatus());
}
function enterAl() {
  (stopBlink(),
    stopDraw(),
    stopMeas(),
    (alignOn = !0),
    $("aBar").classList.add("on"),
    document.querySelectorAll("#mGrp .b").forEach((e) => (e.disabled = !0)),
    ($("sH").textContent = "Drag B · Arrows: 1px · Shift+arrow: 10px"),
    buildScene());
}
function exitAl() {
  ((alignOn = !1),
    (ptPhase = 0),
    (ptA = null),
    $("apB").classList.remove("on"),
    (vpEl.style.cursor = ""),
    $("aBar").classList.remove("on"),
    document.querySelectorAll("#mGrp .b").forEach((e) => (e.disabled = !1)),
    ($("sH").textContent = "Scroll: zoom · Drag: pan · Arrows: pages"),
    updAlBtn(),
    txtResult && $("txtPanel").classList.contains("on") && runTextDiff());
}
($("measB").addEventListener("click", (e) =>
  e.shiftKey
    ? (delete mCal[cur],
      ($("sH").textContent = "Calibration cleared on this page."),
      void (mOn && measStatus()))
    : mOn
      ? (stopMeas(),
        void ($("sH").textContent = "Scroll: zoom · Drag: pan · Arrows: pages"))
      : void (
          alignOn ||
          (stopDraw(),
          stopBlink(),
          (mOn = !0),
          $("measB").classList.add("on"),
          (vpEl.style.cursor = "crosshair"),
          measStatus())
        ),
),
  document.querySelectorAll("#dGrp .b").forEach((e) =>
    e.addEventListener("click", () => {
      if (alignOn) return;
      const t = e.dataset.d;
      if (dMode === t) return void stopDraw();
      (stopBlink(),
        stopMeas(),
        document
          .querySelectorAll("#dGrp .b")
          .forEach((e) => e.classList.remove("on")),
        e.classList.add("on"),
        (dMode = t),
        vpEl.classList.add("draw"));
      const n = $("drL");
      n && n.classList.add("act");
    }),
  ),
  $("dCol").addEventListener("input", (e) => {
    dCol = e.target.value;
  }),
  $("undoB").addEventListener("click", () => {
    (draws.pop(), redrawD());
  }),
  $("clrB").addEventListener("click", () => {
    ((draws = []), redrawD());
  }),
  $("expB").addEventListener("click", async () => {
    if (!cA && !cB) return;
    const e = baseW,
      t = baseH,
      n = Math.max(renderScale, 2),
      [o, a] = await Promise.all([
        renderPg(pdfA, cur, n),
        renderPg(pdfB, cur, n),
      ]),
      i = document.createElement("canvas");
    ((i.width = Math.round(e * n)), (i.height = Math.round(t * n)));
    const s = i.getContext("2d");
    if ((o && s.drawImage(o.canvas, 0, 0), a)) {
      s.globalAlpha = parseFloat($("opS").value) / 100;
      const e = off(cur);
      if (e.r) {
        const t = a.canvas.width,
          o = a.canvas.height;
        (s.save(),
          s.translate(Math.round(e.x * n) + t / 2, Math.round(e.y * n) + o / 2),
          s.rotate((e.r * Math.PI) / 180),
          s.drawImage(a.canvas, -t / 2, -o / 2),
          s.restore());
      } else s.drawImage(a.canvas, Math.round(e.x * n), Math.round(e.y * n));
      s.globalAlpha = 1;
    }
    const r = $("drC");
    r && s.drawImage(r, 0, 0, r.width, r.height, 0, 0, i.width, i.height);
    const l = await new Promise((e) => i.toBlob(e, "image/png")),
      c = URL.createObjectURL(l),
      d = document.createElement("a");
    ((d.href = c),
      (d.download = `compare_p${cur}.png`),
      d.click(),
      URL.revokeObjectURL(c));
  }));
const htModal = $("howto");
($("htX").addEventListener("click", () => htModal.classList.add("hide")),
  $("htGo").addEventListener("click", () => htModal.classList.add("hide")),
  htModal.addEventListener("click", (e) => {
    e.target === htModal && htModal.classList.add("hide");
  }),
  $("helpB").addEventListener("click", () => htModal.classList.remove("hide")));
let txtResult = null,
  txtActiveIdx = -1,
  lastAI = null;
let analysisEpoch = 0;
function invalidateAnalysis() {
  analysisEpoch++;
  txtResult = null;
  lastAI = null;
  navItems = [];
  navIdx = -1;
  updNavI();
  $("txtSum").replaceChildren();
  $("txtBody").textContent = "Run comparison for the current files and page.";
  W.querySelectorAll(".tmk").forEach((e) => e.remove());
}
function currentAnalysisContext() {
  return JSON.stringify([
    analysisEpoch,
    window.PdfDiffWorkspace?.context() || [
      pdfA?.fingerprints,
      pdfB?.fingerprints,
      cur,
      off(cur),
    ],
    $("hideLowConf").checked,
    $("tolS").value,
  ]);
}
async function extractText(document, pageNumber) {
  if (
    !document ||
    pageNumber > document.numPages ||
    (document.hasPage && !document.hasPage(pageNumber))
  )
    return [];
  const page = await document.getPage(pageNumber),
    view = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return PdfDiffCore.groupText(
    content.items
      .filter((t) => t.str?.trim())
      .map((t) => {
        const matrix = pdfjsLib.Util.transform(view.transform, t.transform);
        return {
          str: t.str,
          x: matrix[4],
          y: matrix[5],
          w: t.width,
          h: Math.max(1, Math.hypot(matrix[2], matrix[3])),
        };
      }),
  );
}
function matchTexts(a, b, transform, tolerance) {
  const manual =
    Object.prototype.hasOwnProperty.call(pgOff, cur) ||
    transform.x ||
    transform.y ||
    transform.r;
  return PdfDiffCore.compareText(a, b, {
    transform: manual ? transform : undefined,
    tolerance,
    width: baseW,
    height: baseH,
    widthB: cB?.w || baseW,
    heightB: cB?.h || baseH,
    regions: window.PdfDiffWorkspace?.regions() || [],
  });
}
function nearbyContext(e, t, n = 120, o = 2) {
  if (!e || !t) return [];
  const a = t
      .filter(
        (t) =>
          t.str.length > 5 &&
          (t.str.match(/[a-zA-Z\u00C0-\u017F]/g) || []).length >= 4 &&
          Math.hypot(t.x - e.x, t.y - e.y) > 1,
      )
      .map((t) => ({ str: t.str, d: Math.hypot(t.x - e.x, t.y - e.y) }))
      .filter((e) => e.d < n)
      .sort((e, t) => e.d - t.d),
    i = new Set(),
    s = [];
  for (const e of a)
    if (!i.has(e.str) && (i.add(e.str), s.push(e.str), s.length >= o)) break;
  return s;
}
async function runTextDiff() {
  if (!pdfA || !pdfB) return;
  invalidateAnalysis();
  const epoch = analysisEpoch,
    docA = pdfA,
    docB = pdfB,
    page = cur;
  $("txtPanel").classList.add("on");
  $("txtBody").textContent = "Extracting and matching text…";
  try {
    const [a, b] = await Promise.all([
      extractText(docA, page),
      extractText(docB, page),
    ]);
    if (
      epoch !== analysisEpoch ||
      docA !== pdfA ||
      docB !== pdfB ||
      page !== cur
    )
      return;
    if (!a.length || !b.length) {
      $("txtBody").textContent =
        "At least one page has no readable text layer, or has no counterpart. Text comparison is incomplete. Use the batch workspace for page pairing, visual comparison and optional OCR.";
      return;
    }
    txtResult = matchTexts(a, b, off(cur), parseInt($("tolS").value));
    renderTextDiff();
    drawTextMarkers();
  } catch (error) {
    if (epoch !== analysisEpoch) return;
    txtResult = null;
    lastAI = null;
    $("txtBody").textContent = "Processing error: " + error.message;
  }
}
function renderTextDiff() {
  if (!txtResult) return;
  const {
      changed: e,
      added: t,
      removed: n,
      unchanged: o,
      anchorCount: a,
    } = txtResult,
    i = $("hideLowConf") && $("hideLowConf").checked ? 55 : -1,
    s = e.filter((e) => e.conf > i).sort((e, t) => t.conf - e.conf),
    r = t.filter((e) => e.conf > i),
    l = n.filter((e) => e.conf > i),
    c = e.length - s.length + (t.length - r.length) + (n.length - l.length);
  $("txtSum").innerHTML =
    `<div class="tp-stat chg"><span class="n">${s.length}</span><span class="l">Changed</span></div><div class="tp-stat add"><span class="n">${r.length}</span><span class="l">Added</span></div><div class="tp-stat rem"><span class="n">${l.length}</span><span class="l">Removed</span></div>`;
  const d = $("txtBody");
  if (((d.innerHTML = ""), a < 3)) {
    const e = document.createElement("div");
    ((e.style.cssText =
      "margin:4px;padding:8px 10px;background:rgba(255,159,67,.12);border:1px solid var(--ora);border-radius:6px;font-size:10px;color:var(--ora);line-height:1.4;"),
      (e.innerHTML = `⚠ Only ${a} common anchors — too few for reliable matching. Results may be uncertain. Try ⊞ Align to roughly position the two drawings first.`),
      d.appendChild(e));
  }
  if (!s.length && !r.length && !l.length) {
    const e = document.createElement("div");
    return (
      (e.className = "tp-empty"),
      (e.innerHTML = `No text differences detected at the selected settings.<br><br>${o.length} labels match.${c ? "<br>" + c + " uncertain matches hidden." : ""}`),
      void d.appendChild(e)
    );
  }
  const p = (e) =>
    `<span style="float:right;font-size:8px;font-family:'JetBrains Mono',monospace;padding:1px 5px;border-radius:3px;background:${e > 75 ? "rgba(61,220,132,.15);color:var(--grn)" : e > 55 ? "rgba(255,217,61,.12);color:var(--yel)" : "rgba(255,68,102,.12);color:var(--red)"};">${e}/100</span>`;
  ((navItems = []), (navIdx = -1), updNavI());
  const u = (e, t) => {
    const n = document.createElement("div");
    n.className = "ti " + t;
    let o = "";
    ((o =
      "chg" === t
        ? `<div class="ti-type">Changed${p(e.conf)}</div><div class="ti-txt"><span class="ti-old">${esc(e.from)}</span><span class="ti-arrow">→</span><span class="ti-new">${esc(e.to)}</span></div>`
        : "add" === t
          ? `<div class="ti-type">Added${p(e.conf)}</div><div class="ti-txt">${esc(e.str)}</div>`
          : `<div class="ti-type">Removed${p(e.conf)}</div><div class="ti-txt">${esc(e.str)}</div>`),
      (n.innerHTML = o));
    const a = "rem" === t || "add" === t ? e : e.b,
      i = navItems.length;
    (navItems.push({ pos: a, div: n }),
      n.addEventListener("click", () => {
        ((navIdx = i), updNavI(), zoomToText(a), highlightTextItem(n));
      }),
      d.appendChild(n));
  };
  if (
    (s.forEach((e) => u(e, "chg")),
    r.forEach((e) => u(e, "add")),
    l.forEach((e) => u(e, "rem")),
    c)
  ) {
    const e = document.createElement("div");
    ((e.style.cssText =
      "padding:8px 10px;font-size:9px;color:var(--tx3);text-align:center;"),
      (e.textContent = `${c} uncertain matches hidden`),
      d.appendChild(e));
  }
}
function esc(e) {
  return e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function highlightTextItem(e) {
  (document.querySelectorAll(".ti").forEach((e) => (e.style.background = "")),
    (e.style.background = "var(--s3)"));
}
function zoomToText(e) {
  const t = vpEl.getBoundingClientRect(),
    n = off(cur),
    o = Math.max(0, -n.x),
    a = Math.max(0, -n.y),
    i = Math.max(vp.z, 3);
  ((vp.z = Math.min(i, 8)),
    (vp.x = t.width / 2 - (e.x + o) * vp.z),
    (vp.y = t.height / 2 - (e.y + a) * vp.z),
    applyVP(),
    drawTextMarkers(e));
}
function drawTextMarkers(e) {
  if ((W.querySelectorAll(".tmk").forEach((e) => e.remove()), !txtResult))
    return;
  const t = off(cur),
    n = Math.max(0, -t.x),
    o = Math.max(0, -t.y),
    a = (e, t, a) => {
      const i = document.createElement("div");
      i.className = "tmk " + t + (a ? " active" : "");
      ((i.style.left = e.x + n - 4 + "px"),
        (i.style.top = e.y + o - e.h - 4 + "px"),
        (i.style.width = e.w + 8 + "px"),
        (i.style.height = e.h + 8 + "px"),
        W.appendChild(i));
    },
    i = $("hideLowConf") && $("hideLowConf").checked ? 55 : -1;
  (txtResult.changed
    .filter((e) => e.conf > i)
    .forEach((t) => a(t.b, "chg", e && t.b.x === e.x && t.b.y === e.y)),
    txtResult.added
      .filter((e) => e.conf > i)
      .forEach((t) => a(t, "add", e && t.x === e.x && t.y === e.y)),
    txtResult.removed
      .filter((e) => e.conf > i)
      .forEach((t) => a(t, "rem", e && t.x === e.x && t.y === e.y)));
}
let navItems = [],
  navIdx = -1;
function updNavI() {
  $("navI").textContent = navItems.length
    ? `${navIdx + 1 < 1 ? "–" : navIdx + 1}/${navItems.length}`
    : "–";
}
function navGo(e) {
  if (!navItems.length) return;
  navIdx =
    (((navIdx + e) % navItems.length) + navItems.length) % navItems.length;
  const t = navItems[navIdx];
  (updNavI(),
    zoomToText(t.pos),
    highlightTextItem(t.div),
    t.div.scrollIntoView({ block: "nearest", behavior: "smooth" }));
}
($("navP").addEventListener("click", () => navGo(-1)),
  $("navN").addEventListener("click", () => navGo(1)),
  $("txtB").addEventListener("click", () => {
    alignOn ||
      ($("txtPanel").classList.contains("on") && txtResult
        ? ($("txtPanel").classList.remove("on"),
          W.querySelectorAll(".tmk").forEach((e) => e.remove()))
        : runTextDiff());
  }),
  $("txtX").addEventListener("click", () => {
    ($("txtPanel").classList.remove("on"),
      W.querySelectorAll(".tmk").forEach((e) => e.remove()));
  }),
  $("txtRerun").addEventListener("click", () => runTextDiff()),
  $("tolS").addEventListener(
    "input",
    (e) => ($("tolV").textContent = e.target.value + "px"),
  ),
  $("hideLowConf").addEventListener("change", () => {
    lastAI = null;
    txtResult && (renderTextDiff(), drawTextMarkers());
  }));
const _origBuild = buildScene;
buildScene = function () {
  (_origBuild(),
    txtResult && $("txtPanel").classList.contains("on") && drawTextMarkers());
};
const AI_MODELS = {
    anthropic: [
      ["claude-opus-4-8", "Claude Opus 4.8 — best quality"],
      ["claude-opus-4-6", "Claude Opus 4.6"],
      ["claude-sonnet-4-6", "Claude Sonnet 4.6 — balanced"],
      ["claude-haiku-4-5-20251001", "Claude Haiku 4.5 — fast, cheap"],
    ],
    openai: [
      ["gpt-5", "GPT-5 — newest, strongest"],
      ["gpt-5-mini", "GPT-5 mini — fast, cheaper"],
      ["gpt-4.1", "GPT-4.1"],
      ["o3", "o3 — reasoning (thorough, slower)"],
      ["gpt-4o", "GPT-4o"],
    ],
  },
  AI_DEFAULTS = { anthropic: "claude-sonnet-4-6", openai: "gpt-5" },
  AI_KEYLINKS = {
    anthropic:
      'Key: <a href="https://console.anthropic.com/settings/keys" target="_blank">console.anthropic.com</a>',
    openai:
      'Key: <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com</a>',
  };
let aiProvider = "anthropic";
function lsGet(e, t) {
  try {
    return localStorage.getItem(e) ?? t;
  } catch (e) {
    return t;
  }
}
function lsSet(e, t) {
  try {
    localStorage.setItem(e, t);
  } catch (e) {}
}
function fillModelDropdown(e) {
  const t = $("aiModelSel");
  ((t.innerHTML = ""),
    AI_MODELS[aiProvider].forEach(([e, n]) => {
      const o = document.createElement("option");
      ((o.value = e), (o.textContent = n), t.appendChild(o));
    }));
  const n = document.createElement("option");
  ((n.value = "__custom__"),
    (n.textContent = "Custom (your own model name)…"),
    t.appendChild(n));
  const o = AI_MODELS[aiProvider].some((t) => t[0] === e);
  t.value = o ? e : "__custom__";
}
function aiLoadSettings() {
  ((aiProvider = lsGet("pcp_provider", "anthropic")),
    document
      .querySelectorAll("#aiProv button")
      .forEach((e) => e.classList.toggle("on", e.dataset.p === aiProvider)),
    ($("aiKey").value = lsGet("pcp_key_" + aiProvider, "")));
  const e = lsGet("pcp_model_" + aiProvider, "") || AI_DEFAULTS[aiProvider];
  (($("aiModel").value = e),
    fillModelDropdown(e),
    ($("aiKeyLink").innerHTML = AI_KEYLINKS[aiProvider]));
}
function buildPayload() {
  if (!txtResult) return { text: "", count: 0 };
  const threshold = $("hideLowConf").checked ? 55 : -1;
  const nearby = (item) => {
    const labels = nearbyContext(item, txtResult.allB || []);
    return labels.length
      ? " [nearby element: " +
          labels.map((s) => JSON.stringify(s)).join(", ") +
          "]"
      : "";
  };
  const lines = [
    ...txtResult.changed
      .filter((t) => t.conf > threshold)
      .map(
        (t) =>
          `CHANGED: "${t.from}" → "${t.to}" (match score ${t.conf}/100)${nearby(t.b || t)}`,
      ),
    ...txtResult.added
      .filter((t) => t.conf > threshold)
      .map(
        (t) =>
          `ADDED: "${t.str}" (match score ${t.conf}/100)${nearby(t.b || t)}`,
      ),
    ...txtResult.removed
      .filter((t) => t.conf > threshold)
      .map(
        (t) =>
          `REMOVED: "${t.str}" (match score ${t.conf}/100)${nearby(t.b || t)}`,
      ),
  ];
  return { text: lines.join("\n"), count: lines.length };
}
function aiRefreshPayload() {
  const e = buildPayload(),
    t = $("aiVisual").checked;
  (($("aiPayload").textContent =
    (e.count ? e.text : "(no differences to send with the current filters)") +
    (t
      ? "\n\n+ 2 drawing images (A and B, current page) for visual inspection"
      : "")),
    ($("aiSend").disabled = !e.count));
}
async function renderPageImage(pdfDocument, maxSize) {
  if (
    !pdfDocument ||
    cur > pdfDocument.numPages ||
    (pdfDocument.hasPage && !pdfDocument.hasPage(cur))
  )
    return null;
  const page = await pdfDocument.getPage(cur),
    original = page.getViewport({ scale: 1 }),
    scale = Math.min(maxSize / original.width, maxSize / original.height, 3),
    view = page.getViewport({ scale }),
    image = document.createElement("canvas");
  image.width = Math.ceil(view.width);
  image.height = Math.ceil(view.height);
  const ctx = image.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, image.width, image.height);
  await page.render({
    canvasContext: ctx,
    viewport: view,
    background: "rgb(255,255,255)",
  }).promise;
  ctx.fillStyle = "#fff";
  const alignment = off(cur),
    isB = pdfDocument === pdfB;
  for (const r of window.PdfDiffWorkspace?.regions() || []) {
    ctx.save();
    if (isB) {
      ctx.translate(
        (original.width * scale) / 2,
        (original.height * scale) / 2,
      );
      ctx.rotate((-(alignment.r || 0) * Math.PI) / 180);
      ctx.translate(
        -(original.width / 2 + alignment.x) * scale,
        -(original.height / 2 + alignment.y) * scale,
      );
    }
    ctx.fillRect(
      r.x * baseW * scale,
      r.y * baseH * scale,
      r.w * baseW * scale,
      r.h * baseH * scale,
    );
    ctx.restore();
  }
  return image.toDataURL("image/jpeg", 0.85).split(",")[1];
}
const AI_SYSTEM =
  "You are an experienced construction/engineering plan reviewer comparing drawing revisions during detailed design. You are precise, factual, and use professional AEC terminology.";
function aiUserPrompt(e, t) {
  return `You have received AUTOMATICALLY and deterministically detected text differences between two versions (OLD → NEW) of a technical drawing. Detection was done by position-based text matching in software — YOU did not detect the text.${t ? " You have also been given images of the drawings for visual inspection (see below)." : " You do NOT see the drawing, only the finished difference list."}\n\nYour task is to INTERPRET the given differences. Strict rules:\n\n1. NEVER invent a change that is not in the list below. Work only from the given lines.\n2. Automatic detection can contain FALSE POSITIVES (a label that merely moved, or a mismatched pairing). The score is a heuristic matching score, not measured accuracy or probability. If a difference looks like a false positive, FLAG it — do not force an interpretation.\n3. If the professional meaning of a difference is uncertain from the data, say so openly.\n4. Respond in English, using professional construction terminology.\n\nThe task, in exactly this structure:\n\n## Summary\nA 2–3 sentence executive summary: what this revision is about, what to focus on in the design review meeting.\n\n## Substantive changes\nGroup RELATED differences into ONE finding (e.g. many uniformly shifted elevation points → "Elevations shifted uniformly by ~X m (N points)"). Next to each difference I have included the spatially nearest descriptive label ("[nearby element: ...]") — USE IT to NAME the building element the change belongs to. E.g. if "25.0 x 5.0 m → 25.0 x 6.0 m" comes with "[nearby element: reinforced concrete stormwater reservoir]", the finding is: "The stormwater reservoir grew from 25.0×5.0 m to 25.0×6.0 m". For each group give:\n- **[Category]** — one of: Dimension/geometry, Equipment/structure, Quantity, Elevation data, Routing/utilities, Plot data, or Other\n- a concise description of the change, **naming the specific element** (from the nearby label)\n- **Significance:** Design-critical / Moderate / Administrative\n- **Verify:** 1–2 sentences on consequences (structural, other disciplines, permits, quantities) — only if substantive\n${t ? '\n\nIMPORTANT — VISUAL INSPECTION: I have also attached images of the current page of both drawings (image 1 = OLD/A version, image 2 = NEW/B version). The text diff is the authoritative source for LABELS and DIMENSIONS. Your additional task on the images: look for GEOMETRIC / VISUAL differences the text diff cannot see — e.g. moved or resized lines, walls, structure outlines; added or removed symbols, hatching, routing; layout changes. Put your visual observations in a SEPARATE section ("## Visual observations"), and mark each as a visual finding (non-deterministic, to be verified). If image resolution is insufficient for a detail, say so. Do not repeat changes already listed in the text diff — only what is additionally visible.' : ""}\n\n## Possible false positives\nList differences that are probably not real design changes (matching errors, mere movement). If none: "No clear false positives identified."\n\n## Note\nOne sentence reminding that this is an AI interpretation of automatic detection, the final call belongs to the designer, and visual inspection of the drawing is not replaceable.\n\nThe list of differences:\n${e}`;
}
async function callAnthropic(e, t, n, o) {
  const a = [];
  (o &&
    (a.push({ type: "text", text: "Image 1 — OLD (A) version:" }),
    a.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: o.a },
    }),
    a.push({ type: "text", text: "Image 2 — NEW (B) version:" }),
    a.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: o.b },
    })),
    a.push({ type: "text", text: aiUserPrompt(n, !!o) }));
  const i = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": e,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: t,
      max_tokens: 2e3,
      system: AI_SYSTEM,
      messages: [{ role: "user", content: a }],
    }),
  });
  if (!i.ok) {
    const e = await i.text();
    throw new Error(
      "Anthropic API error (" + i.status + "): " + e.slice(0, 200),
    );
  }
  return (await i.json()).content
    .filter((e) => "text" === e.type)
    .map((e) => e.text)
    .join("\n");
}
async function callOpenAI(e, t, n, o) {
  const a = [{ type: "text", text: aiUserPrompt(n, !!o) }];
  o &&
    (a.push({ type: "text", text: "Image 1 — OLD (A) version:" }),
    a.push({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64," + o.a },
    }),
    a.push({ type: "text", text: "Image 2 — NEW (B) version:" }),
    a.push({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64," + o.b },
    }));
  const i = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + e,
    },
    body: JSON.stringify({
      model: t,
      max_completion_tokens: 2e3,
      messages: [
        { role: "system", content: AI_SYSTEM },
        { role: "user", content: a },
      ],
    }),
  });
  if (!i.ok) {
    const e = await i.text();
    throw new Error("OpenAI API error (" + i.status + "): " + e.slice(0, 200));
  }
  return (await i.json()).choices[0].message.content;
}
function mdToHtml(e) {
  return e
    .split("\n")
    .map((e) => {
      if (/^## /.test(e)) return "<h4>" + esc(e.slice(3)) + "</h4>";
      let t = esc(e).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return /^[-•] /.test(e)
        ? '<div style="margin-left:10px;">• ' +
            t.replace(/^[-•] /, "") +
            "</div>"
        : t
          ? "<div>" + t + "</div>"
          : '<div style="height:6px;"></div>';
    })
    .join("");
}
async function aiSend() {
  const context = currentAnalysisContext(),
    provider = aiProvider;
  lastAI = null;
  const e = $("aiKey").value.trim(),
    t = $("aiModel").value.trim() || AI_DEFAULTS[aiProvider];
  if (!e) return void $("aiKey").focus();
  (lsSet("pcp_key_" + aiProvider, e),
    lsSet("pcp_model_" + aiProvider, t),
    lsSet("pcp_provider", aiProvider));
  const n = buildPayload();
  if (!n.count) return;
  $("aiSettings").style.display = "none";
  const o = $("aiOut");
  o.style.display = "block";
  const a = $("aiVisual").checked;
  o.innerHTML =
    '<div class="ai-spin"><div class="s"></div><div>' +
    (a ? "Rendering drawings and interpreting…" : "Interpreting…") +
    "</div></div>";
  try {
    let i = null;
    if (a) {
      const [e, t] = await Promise.all([
        renderPageImage(pdfA, 1500),
        renderPageImage(pdfB, 1500),
      ]);
      e && t && (i = { a: e, b: t });
    }
    if (context !== currentAnalysisContext())
      throw new Error(
        "The comparison changed before sending. No AI request was made.",
      );
    const s =
      provider === "anthropic"
        ? await callAnthropic(e, t, n.text, i)
        : await callOpenAI(e, t, n.text, i);
    if (context !== currentAnalysisContext())
      throw new Error(
        "The document, page or comparison settings changed. This response was discarded; rerun AI on the current comparison.",
      );
    ((lastAI = { text: s, model: t, visual: a, context }),
      (o.innerHTML = `<div class="ai-result">${mdToHtml(s)}<div class="ai-warn">⚠ This is an AI interpretation of automatic detection${a ? " (with visual inspection)" : ""} — informational only; it does not replace the designer's judgement or visual review of the drawing. Model: ${esc(t)}.</div></div><div style="text-align:center;padding:0 0 16px;"><button class="b" id="aiBack">← Back to settings</button></div>`),
      window.PdfDiffWorkspace?.onAI(lastAI),
      $("aiBack").addEventListener("click", () => {
        ((o.style.display = "none"),
          (o.innerHTML = ""),
          ($("aiSettings").style.display = "block"));
      }));
  } catch (e) {
    ((o.innerHTML = `<div class="ai-result"><div class="ai-warn" style="color:var(--red);border-color:rgba(255,68,102,.3);background:rgba(255,68,102,.08);">Error: ${esc(e.message)}<br><br>Check: is the API key correct, the model name valid, and do you have credit/quota?</div></div><div style="text-align:center;padding:0 0 16px;"><button class="b" id="aiBack">← Back</button></div>`),
      $("aiBack").addEventListener("click", () => {
        ((o.style.display = "none"),
          (o.innerHTML = ""),
          ($("aiSettings").style.display = "block"));
      }));
  }
}
function reportRows() {
  if (!txtResult) return { rows: [], counts: [0, 0, 0] };
  const e = $("hideLowConf").checked ? 55 : -1,
    t = txtResult.allB || [],
    n = (e) => nearbyContext(e, t).join(", "),
    o = [];
  let a = 0,
    i = 0,
    s = 0;
  return (
    txtResult.changed
      .filter((t) => t.conf > e)
      .sort((e, t) => t.conf - e.conf)
      .forEach((e) => {
        (o.push(["Changed", e.from, e.to, n(e.b), e.conf + "/100"]), a++);
      }),
    txtResult.added
      .filter((t) => t.conf > e)
      .forEach((e) => {
        (o.push(["Added", "—", e.str, n(e), e.conf + "/100"]), i++);
      }),
    txtResult.removed
      .filter((t) => t.conf > e)
      .forEach((e) => {
        (o.push(["Removed", e.str, "—", n(e), e.conf + "/100"]), s++);
      }),
    { rows: o, counts: [a, i, s] }
  );
}
async function generateReport() {
  const reportContext = currentAnalysisContext();
  const batchReport = window.PdfDiffWorkspace?.exportCurrent();
  if (batchReport) return batchReport;
  if (lastAI?.context !== currentAnalysisContext()) lastAI = null;
  if (!txtResult || !window.jspdf) return;
  const { jsPDF: e } = window.jspdf,
    t = new e({ unit: "mm", format: "a4" }),
    n = 15;
  await window.PdfDiffWorkspace?.configureFont(t);
  if (reportContext !== currentAnalysisContext())
    throw new Error(
      "The comparison changed while the report was being prepared. Generate the report again.",
    );
  let o = 18;
  const a = $("fnA").textContent || "Version A (old)",
    i = $("fnB").textContent || "Version B (new)",
    s = new Date().toLocaleString("en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    { rows: r, counts: l } = reportRows();
  (t.setFont("NotoSans", "normal"),
    t.setFontSize(18),
    t.setTextColor(27, 34, 48),
    t.text("Drawing Revision Comparison", n, o),
    (o += 7),
    t.setDrawColor(210, 217, 230),
    t.setLineWidth(0.4),
    t.line(n, o, 195, o),
    (o += 7),
    t.setFont("NotoSans", "normal"),
    t.setFontSize(10),
    t.setTextColor(90, 100, 120),
    t.text("Old (A):", n, o),
    t.setTextColor(27, 34, 48),
    t.text(a, 37, o),
    (o += 5.5),
    t.setTextColor(90, 100, 120),
    t.text("New (B):", n, o),
    t.setTextColor(27, 34, 48),
    t.text(i, 37, o),
    (o += 5.5),
    t.setTextColor(90, 100, 120),
    t.text("Page:", n, o),
    t.setTextColor(27, 34, 48),
    t.text(String(cur) + " / " + total, 37, o),
    (o += 5.5),
    t.setTextColor(90, 100, 120),
    t.text("Generated:", n, o),
    t.setTextColor(27, 34, 48),
    t.text(s, 37, o),
    (o += 9));
  const c = [
      ["CHANGED", l[0], [234, 88, 12]],
      ["ADDED", l[1], [21, 163, 74]],
      ["REMOVED", l[2], [220, 38, 38]],
    ],
    d = 172 / 3;
  if (
    (c.forEach((e, a) => {
      const i = n + a * (d + 4);
      (t.setFillColor(e[2][0], e[2][1], e[2][2]),
        t.setDrawColor(e[2][0], e[2][1], e[2][2]),
        t.roundedRect(i, o, d, 16, 2, 2, "S"),
        t.setTextColor(e[2][0], e[2][1], e[2][2]),
        t.setFont("NotoSans", "normal"),
        t.setFontSize(20),
        t.text(String(e[1]), i + d / 2, o + 8, { align: "center" }),
        t.setFont("NotoSans", "normal"),
        t.setFontSize(8),
        t.text(e[0], i + d / 2, o + 13, { align: "center" }));
    }),
    (o += 24),
    lastAI && lastAI.text)
  ) {
    (t.setFont("NotoSans", "normal"),
      t.setFontSize(12),
      t.setTextColor(124, 58, 237),
      t.text("AI Summary", n, o),
      (o += 6),
      t.setFont("NotoSans", "normal"),
      t.setFontSize(9),
      t.setTextColor(60, 68, 84));
    const e = lastAI.text
      .replace(/^#+\s*/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1");
    (t.splitTextToSize(e, 180).forEach((e) => {
      (o > 275 && (t.addPage(), (o = 18)), t.text(e, n, o), (o += 4.6));
    }),
      (o += 4),
      t.setFontSize(7.5),
      t.setTextColor(150, 152, 171),
      t.text(
        "Source: " +
          lastAI.model +
          (lastAI.visual ? " (with visual inspection)" : "") +
          " — informational AI interpretation.",
        n,
        o,
      ),
      (o += 8));
  }
  (o > 250 && (t.addPage(), (o = 18)),
    t.autoTable({
      startY: o,
      head: [
        ["Type", "Old value", "New value", "Nearby element", "Match score"],
      ],
      body: r,
      margin: { left: n, right: n },
      styles: {
        font: "NotoSans",
        fontSize: 8,
        cellPadding: 2,
        textColor: [27, 34, 48],
        lineColor: [225, 229, 238],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8.5,
      },
      alternateRowStyles: { fillColor: [244, 246, 250] },
      columnStyles: {
        0: { cellWidth: 20 },
        4: { cellWidth: 18, halign: "center" },
      },
      didParseCell: (e) => {
        if ("body" === e.section && 0 === e.column.index) {
          const t = e.cell.raw;
          ("Changed" === t
            ? (e.cell.styles.textColor = [234, 88, 12])
            : "Added" === t
              ? (e.cell.styles.textColor = [21, 163, 74])
              : "Removed" === t && (e.cell.styles.textColor = [220, 38, 38]),
            (e.cell.styles.fontStyle = "bold"));
        }
      },
    }));
  const p = t.internal.getNumberOfPages();
  for (let e = 1; e <= p; e++)
    (t.setPage(e),
      t.setFontSize(7.5),
      t.setTextColor(150, 152, 171),
      t.setDrawColor(225, 229, 238),
      t.setLineWidth(0.2),
      t.line(n, 287, 195, 287),
      t.text(
        "Generated with pdfdiff (csab-ai.github.io/pdfdiff) — Created by Csaba Darabos · Deterministic text analysis" +
          (lastAI ? " + AI interpretation" : ""),
        n,
        291,
      ),
      t.text(e + " / " + p, 195, 291, { align: "right" }));
  const u = (e) => e.replace(/[^\w.-]+/g, "_").slice(0, 40);
  t.save("revision_diff_" + u(a) + "_vs_" + u(i) + "_p" + cur + ".pdf");
}
($("aiSumB").addEventListener("click", () => {
  txtResult &&
    (aiLoadSettings(),
    ($("aiSettings").style.display = "block"),
    ($("aiOut").style.display = "none"),
    ($("aiOut").innerHTML = ""),
    aiRefreshPayload(),
    $("aiBg").classList.add("on"));
}),
  $("aiX").addEventListener("click", () => $("aiBg").classList.remove("on")),
  $("aiBg").addEventListener("click", (e) => {
    e.target === $("aiBg") && $("aiBg").classList.remove("on");
  }),
  document.querySelectorAll("#aiProv button").forEach((e) =>
    e.addEventListener("click", () => {
      ((aiProvider = e.dataset.p),
        document
          .querySelectorAll("#aiProv button")
          .forEach((t) => t.classList.toggle("on", t === e)),
        ($("aiKey").value = lsGet("pcp_key_" + aiProvider, "")));
      const t = lsGet("pcp_model_" + aiProvider, "") || AI_DEFAULTS[aiProvider];
      (($("aiModel").value = t),
        fillModelDropdown(t),
        ($("aiKeyLink").innerHTML = AI_KEYLINKS[aiProvider]));
    }),
  ),
  $("aiModelSel").addEventListener("change", (e) => {
    "__custom__" === e.target.value
      ? (($("aiModel").value = ""), $("aiModel").focus())
      : ($("aiModel").value = e.target.value);
  }),
  $("aiModel").addEventListener("input", () => {
    const e = AI_MODELS[aiProvider].some((e) => e[0] === $("aiModel").value);
    $("aiModelSel").value = e ? $("aiModel").value : "__custom__";
  }),
  $("aiVisual").addEventListener("change", (e) => {
    (($("aiVisualWarn").style.display = e.target.checked ? "block" : "none"),
      aiRefreshPayload());
  }),
  $("aiSend").addEventListener("click", aiSend),
  $("rptB").addEventListener("click", () =>
    generateReport().catch((error) => alert("Report error: " + error.message)),
  ),
  document.addEventListener("keydown", (e) => {
    // Browser shortcuts remain available.
  }));
