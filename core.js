/* Pure comparison logic shared by the browser and node:test. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PdfDiffCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function normalizeName(name) {
    return name
      .split(/[\\/]/)
      .pop()
      .replace(/\.pdf$/i, "")
      .normalize("NFKC")
      .replace(
        /(?:^|[\s_.-])(?:rev(?:ision)?|ver(?:sion)?)[\s_.-]*[a-z]?\d+[a-z]?(?=$|[\s_.-])/gi,
        " ",
      )
      .replace(/(?:^|[\s_.-])rev(?:ision)?[\s_.-]*[a-z](?=$|[\s_.-])/gi, " ")
      .replace(
        /(?:^|[\s_.-])(?:19|20)\d{2}[_.-]?(?:0[1-9]|1[0-2])[_.-]?(?:0[1-9]|[12]\d|3[01])(?=$|[\s_.-])/g,
        " ",
      )
      .toLowerCase()
      .replace(/[\s_.-]+/g, "")
      .trim();
  }
  function pairFiles(oldFiles, newFiles) {
    const used = new Set();
    const oldGroups = new Map(),
      newGroups = new Map();
    for (const [files, groups] of [
      [oldFiles, oldGroups],
      [newFiles, newGroups],
    ]) {
      for (const file of files) {
        const key = normalizeName(file.name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(file);
      }
    }
    const pairs = oldFiles.map((a) => {
      const key = normalizeName(a.name),
        matches = newGroups.get(key) || [];
      const unique =
        key && oldGroups.get(key).length === 1 && matches.length === 1;
      const b = unique ? matches[0] : null;
      if (b) used.add(b.id);
      return {
        a: a.id,
        b: b?.id || null,
        pairing: b ? "filename" : matches.length ? "ambiguous" : "unpaired",
      };
    });
    return { pairs, unpairedNew: newFiles.filter((b) => !used.has(b.id)) };
  }
  function normalizeText(text) {
    return String(text)
      .normalize("NFKC")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/[−–]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(\d)[ ](?=\d{3}(?:\D|$))/g, "$1")
      .replace(/(\d)\s+(mm|cm|km|m|kg|kN|MPa|m²|m³)\b/gi, "$1$2");
  }
  function groupText(items) {
    const result = [];
    for (const item of [...items]
      .filter((t) => t.str?.trim())
      .sort((a, b) => a.y - b.y || a.x - b.x)) {
      const h = item.h || 10;
      const previous = result.findLast(
        (t) =>
          Math.abs(t.y - item.y) <= Math.min(t.h, h) * 0.25 &&
          item.x >= t.x &&
          item.x - (t.x + t.w) >= -1 &&
          item.x - (t.x + t.w) <= Math.max(4, h * 0.65),
      );
      if (previous) {
        const gap = item.x - (previous.x + previous.w);
        previous.str +=
          (gap > h * 0.12 && !/\s$/.test(previous.str) ? " " : "") + item.str;
        previous.w = Math.max(previous.w, item.x + item.w - previous.x);
        previous.h = Math.max(previous.h, h);
      } else result.push({ ...item, h });
    }
    return result.map((t) => ({
      ...t,
      str: t.str.trim(),
      normalized: normalizeText(t.str),
    }));
  }
  function similarity(a, b) {
    a = normalizeText(a);
    b = normalizeText(b);
    if (a === b) return 1;
    if (!a.length || !b.length) return 0;
    // Bound pathological document labels; rolling rows avoid quadratic memory.
    a = a.slice(0, 500);
    b = b.slice(0, 500);
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(
          next[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      previous = next;
    }
    return 1 - previous[b.length] / Math.max(a.length, b.length);
  }
  const median = (values) => {
    const a = [...values].sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : 0;
  };
  function alignment(a, b) {
    const aa = new Map(),
      bb = new Map();
    for (const [items, map] of [
      [a, aa],
      [b, bb],
    ])
      for (const item of items) {
        const key = normalizeText(item.str);
        if (key.length >= 4) map.set(key, map.has(key) ? null : item);
      }
    const anchors = [];
    for (const [key, item] of aa)
      if (item && bb.get(key))
        anchors.push({
          ax: item.x,
          ay: item.y,
          dx: bb.get(key).x - item.x,
          dy: bb.get(key).y - item.y,
        });
    const dx = median(anchors.map((a) => a.dx)),
      dy = median(anchors.map((a) => a.dy));
    const inliers = anchors.filter((a) => Math.hypot(a.dx - dx, a.dy - dy) < 8);
    return {
      x: -median(inliers.map((a) => a.dx)),
      y: -median(inliers.map((a) => a.dy)),
      r: 0,
      anchors: inliers.length,
      reliable: inliers.length >= 3,
    };
  }
  function inRegions(item, regions, width, height) {
    const x = item.x / width,
      y = (item.y - (item.h || 0)) / height,
      w = (item.w || 0) / width,
      h = (item.h || 0) / height;
    return regions.some(
      (r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y,
    );
  }
  function compareText(a, b, options = {}) {
    const transform =
        options.transform ||
        alignment(
          a.filter(
            (t) =>
              !inRegions(
                t,
                options.regions || [],
                options.width || 1,
                options.height || 1,
              ),
          ),
          b.filter(
            (t) =>
              !inRegions(
                t,
                options.regions || [],
                options.width || 1,
                options.height || 1,
              ),
          ),
        ),
      tol = options.tolerance || 25;
    const angle = ((transform.r || 0) * Math.PI) / 180,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    const cx = (options.widthB || options.width || 0) / 2,
      cy = (options.heightB || options.height || 0) / 2;
    const mapped = b.map((t) => ({
      ...t,
      x: cx + (t.x - cx) * cos - (t.y - cy) * sin + (transform.x || 0),
      y: cy + (t.x - cx) * sin + (t.y - cy) * cos + (transform.y || 0),
    }));
    const regions = options.regions || [],
      w = options.width || 1,
      h = options.height || 1;
    a = a.filter((t) => !inRegions(t, regions, w, h));
    b = mapped.filter((t) => !inRegions(t, regions, w, h));
    const anchor = alignment(a, b),
      usedA = new Set(),
      usedB = new Set(),
      changed = [],
      unchanged = [],
      formatting = [];
    const uniqueA = new Map(),
      uniqueB = new Map(),
      localAnchors = [];
    for (const [items, map] of [
      [a, uniqueA],
      [b, uniqueB],
    ])
      items.forEach((item, i) => {
        const key = normalizeText(item.str);
        if (key.length >= 4) map.set(key, map.has(key) ? -1 : i);
      });
    for (const [key, i] of uniqueA) {
      const j = uniqueB.get(key);
      if (i < 0 || j === undefined || j < 0) continue;
      usedA.add(i);
      usedB.add(j);
      unchanged.push({ a: a[i], b: b[j] });
      if (a[i].str !== b[j].str)
        formatting.push({
          from: a[i].str,
          to: b[j].str,
          a: a[i],
          b: b[j],
          conf: 100,
        });
      localAnchors.push({
        x: a[i].x,
        y: a[i].y,
        dx: b[j].x - a[i].x,
        dy: b[j].y - a[i].y,
      });
    }
    function targetPosition(item) {
      const nearest = [];
      for (const anchor of localAnchors) {
        const d = Math.hypot(anchor.x - item.x, anchor.y - item.y);
        if (nearest.length < 6 || d < nearest[nearest.length - 1].d) {
          nearest.push({ ...anchor, d });
          nearest.sort((a, b) => a.d - b.d);
          if (nearest.length > 6) nearest.pop();
        }
      }
      let weight = 0,
        dx = 0,
        dy = 0;
      for (const a of nearest) {
        const w = 1 / (a.d + 1);
        weight += w;
        dx += a.dx * w;
        dy += a.dy * w;
      }
      return {
        x: item.x + (weight ? dx / weight : 0),
        y: item.y + (weight ? dy / weight : 0),
      };
    }
    const targets = a.map((item, i) =>
      usedA.has(i) ? item : targetPosition(item),
    );
    const positions = new Map();
    for (let j = 0; j < b.length; j++) {
      const key = `${Math.floor(b[j].x / tol)},${Math.floor(b[j].y / tol)}`;
      if (!positions.has(key)) positions.set(key, []);
      positions.get(key).push(j);
    }
    function nearbyIndices(item) {
      const x = Math.floor(item.x / tol),
        y = Math.floor(item.y / tol),
        indices = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          indices.push(...(positions.get(`${x + dx},${y + dy}`) || []));
      return indices;
    }
    for (const exact of [true, false]) {
      const candidates = [];
      for (let i = 0; i < a.length; i++) {
        if (usedA.has(i)) continue;
        for (const j of nearbyIndices(targets[i])) {
          if (usedB.has(j)) continue;
          const distance = Math.hypot(
            targets[i].x - b[j].x,
            targets[i].y - b[j].y,
          );
          if (distance > tol) continue;
          const normA = normalizeText(a[i].str),
            normB = normalizeText(b[j].str);
          if (exact && normA !== normB) continue;
          const sim = exact ? 1 : similarity(normA, normB),
            score = 0.6 * sim + 0.4 * (1 - distance / tol);
          if (!exact && score < 0.45) continue;
          candidates.push({ i, j, score, distance, sim });
        }
      }
      candidates.sort((x, y) => y.score - x.score);
      for (const c of candidates) {
        if (usedA.has(c.i) || usedB.has(c.j)) continue;
        usedA.add(c.i);
        usedB.add(c.j);
        const old = a[c.i],
          fresh = b[c.j];
        if (exact) {
          unchanged.push({ a: old, b: fresh });
          if (old.str !== fresh.str)
            formatting.push({
              from: old.str,
              to: fresh.str,
              a: old,
              b: fresh,
              conf: 100,
            });
        } else
          changed.push({
            from: old.str,
            to: fresh.str,
            a: old,
            b: fresh,
            conf: Math.round(
              100 *
                (0.55 * c.sim +
                  0.3 * (1 - c.distance / tol) +
                  0.15 * (anchor.anchors >= 3 ? 1 : 0.3)),
            ),
            dimension: /\d/.test(old.str + fresh.str),
          });
      }
    }
    const confidence = anchor.anchors >= 3 ? 90 : 40;
    return {
      changed,
      formatting,
      unchanged,
      removed: a
        .filter((_, i) => !usedA.has(i))
        .map((t) => ({ ...t, conf: confidence })),
      added: b
        .filter((_, i) => !usedB.has(i))
        .map((t) => ({ ...t, conf: confidence })),
      anchorCount: anchor.anchors,
      allB: b,
      transform,
    };
  }
  function pageSignature(page) {
    return page.text
      .map((t) => normalizeText(t.str))
      .filter(Boolean)
      .sort()
      .join("\n");
  }
  function pairPages(a, b) {
    const used = new Set(),
      map = new Map();
    const sigA = a.map(pageSignature),
      sigB = b.map(pageSignature);
    // Distinct complete text signatures safely detect inserted/reordered pages.
    for (let i = 0; i < a.length; i++)
      if (sigA[i] && sigA.filter((s) => s === sigA[i]).length === 1) {
        const hits = sigB
          .map((s, j) => (s === sigA[i] ? j : -1))
          .filter((j) => j >= 0);
        if (hits.length === 1 && !used.has(hits[0])) {
          map.set(i, { a: i + 1, b: hits[0] + 1, method: "text" });
          used.add(hits[0]);
        }
      }
    for (let i = 0; i < a.length; i++) {
      if (map.has(i)) continue;
      const label = a[i].label;
      const hits = b
        .map((p, j) =>
          !used.has(j) && label && !/^\d+$/.test(label) && p.label === label
            ? j
            : -1,
        )
        .filter((j) => j >= 0);
      if (
        hits.length === 1 &&
        a.filter((p) => p.label === label).length === 1
      ) {
        map.set(i, { a: i + 1, b: hits[0] + 1, method: "label" });
        used.add(hits[0]);
      }
    }
    // Same-size documents may use ordered pages; always expose this choice in UI.
    for (let i = 0; i < a.length; i++)
      if (!map.has(i)) {
        if (a.length === b.length && !used.has(i)) {
          map.set(i, { a: i + 1, b: i + 1, method: "order" });
          used.add(i);
        } else map.set(i, { a: i + 1, b: null, method: "review" });
      }
    const rows = [...map.values()].sort((a, b) => a.a - b.a);
    for (let j = 0; j < b.length; j++)
      if (!used.has(j)) rows.push({ a: null, b: j + 1, method: "review" });
    return rows;
  }
  function visualDiff(a, b, width, height, options = {}) {
    const threshold = options.threshold ?? 35,
      cell = 8,
      gw = Math.ceil(width / cell),
      gh = Math.ceil(height / cell),
      grid = new Uint32Array(gw * gh);
    const radius = options.radius ?? 1;
    const luminance = (data, x, y) => {
      const i = (y * width + x) * 4;
      return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    };
    let pixels = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const va = luminance(a, x, y),
          vb = luminance(b, x, y);
        if (Math.abs(va - vb) < threshold) continue;
        const other = va < vb ? b : a,
          target = Math.min(va, vb);
        let matched = false;
        for (let dy = -radius; dy <= radius && !matched; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (
              xx >= 0 &&
              yy >= 0 &&
              xx < width &&
              yy < height &&
              Math.abs(target - luminance(other, xx, yy)) < threshold
            ) {
              matched = true;
              break;
            }
          }
        if (!matched) {
          grid[Math.floor(y / cell) * gw + Math.floor(x / cell)]++;
          pixels++;
        }
      }
    const seen = new Uint8Array(grid.length),
      regions = [];
    for (let start = 0; start < grid.length; start++)
      if (grid[start] && !seen[start]) {
        const queue = [start];
        seen[start] = 1;
        let count = 0,
          minX = gw,
          maxX = 0,
          minY = gh,
          maxY = 0;
        for (let k = 0; k < queue.length; k++) {
          const idx = queue[k],
            x = idx % gw,
            y = Math.floor(idx / gw);
          count += grid[idx];
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx,
                yy = y + dy,
                ni = yy * gw + xx;
              if (
                xx >= 0 &&
                yy >= 0 &&
                xx < gw &&
                yy < gh &&
                grid[ni] &&
                !seen[ni]
              ) {
                seen[ni] = 1;
                queue.push(ni);
              }
            }
        }
        if (count >= (options.minPixels ?? 8))
          regions.push({
            x: minX * cell,
            y: minY * cell,
            w: Math.min(width, (maxX + 1) * cell) - minX * cell,
            h: Math.min(height, (maxY + 1) * cell) - minY * cell,
            pixels: count,
          });
      }
    return {
      regions: regions.sort((a, b) => b.pixels - a.pixels),
      pixels,
      ratio: pixels / (width * height),
    };
  }
  function pageStatus(result) {
    if (result.error) return "error";
    if (!result.a) return "added-page";
    if (!result.b) return "removed-page";
    if (result.noText) return "no-text";
    if (
      result.findings?.some((f) => f.score <= 55) ||
      result.alignmentUncertain
    )
      return "uncertain";
    return result.findings?.length ? "changed" : "no-difference";
  }
  function csvCell(value) {
    let text = String(value ?? "");
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return {
    normalizeName,
    pairFiles,
    normalizeText,
    groupText,
    similarity,
    alignment,
    inRegions,
    compareText,
    pairPages,
    visualDiff,
    pageStatus,
    csvCell,
    clamp,
  };
});
