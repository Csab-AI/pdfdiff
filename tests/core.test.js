const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../core.js");
const label = (str, x = 10, y = 20) => ({ str, x, y, w: 20, h: 10 });
test("revision and date pairing preserves drawing numbers, ambiguous duplicates remain unresolved", () => {
  const a = [
    { id: "a", name: "A-101_alaprajz_rev02.pdf" },
    { id: "b", name: "gepeszet_2025-01-10.pdf" },
  ];
  const b = [
    { id: "c", name: "A_101 alaprajz rev03.pdf" },
    { id: "d", name: "gepeszet_2025-02-15.pdf" },
  ];
  assert.deepEqual(
    C.pairFiles(a, b).pairs.map((p) => p.b),
    ["c", "d"],
  );
  assert.notEqual(C.normalizeName("A-101.pdf"), C.normalizeName("A-102.pdf"));
  assert.equal(
    C.pairFiles(a, [...b, { id: "e", name: "A-101_alaprajz_rev04.pdf" }])
      .pairs[0].pairing,
    "ambiguous",
  );
});
test("PDF fragments and numeric spacing normalize without hiding a changed dimension", () => {
  const grouped = C.groupText([
    label("Width", 10),
    { ...label("3 000 mm", 35), w: 50 },
  ]);
  assert.equal(grouped.length, 1);
  const normalized = C.compareText([label("3000 mm")], [label("3 000 mm")]);
  assert.equal(normalized.changed.length, 0);
  assert.equal(normalized.formatting.length, 1);
  const changed = C.compareText([label("Width 3000")], [label("Width 3200")]);
  assert.equal(changed.changed.length, 1);
  assert.equal(changed.changed[0].dimension, true);
});
test("translation alignment and exclusion regions apply to both documents", () => {
  const a = Array.from({ length: 4 }, (_, i) =>
    label("Anchor " + i, 10 + i * 30, 20 + i * 30),
  );
  const b = a.map((t) => ({ ...t, x: t.x + 15, y: t.y - 10 }));
  assert.deepEqual(C.alignment(a, b), {
    x: -15,
    y: 10,
    r: 0,
    anchors: 4,
    reliable: true,
  });
  assert.equal(C.compareText(a, b).unchanged.length, 4);
  assert.equal(
    C.compareText([label("old", 80, 85)], [label("new", 80, 85)], {
      width: 100,
      height: 100,
      regions: [{ x: 0.7, y: 0.7, w: 0.3, h: 0.3 }],
    }).changed.length,
    0,
  );
});
test("page insertion is paired by content, not shifted page numbers", () => {
  const pg = (str) => ({ text: [label(str)] });
  const map = C.pairPages(
    [pg("floor one"), pg("floor two")],
    [pg("cover"), pg("floor one"), pg("floor two")],
  );
  assert.deepEqual(
    map.map((p) => [p.a, p.b]),
    [
      [1, 2],
      [2, 3],
      [null, 1],
    ],
  );
});
test("visual detector distinguishes identical pages from a moved wall", () => {
  const w = 80,
    h = 80,
    a = new Uint8ClampedArray(w * h * 4).fill(255),
    b = a.slice();
  for (let y = 10; y < 60; y++)
    for (let x = 20; x < 23; x++) {
      let i = (y * w + x) * 4;
      a[i] = a[i + 1] = a[i + 2] = 0;
    }
  assert.equal(C.visualDiff(a, a, w, h).regions.length, 0);
  for (let y = 10; y < 60; y++)
    for (let x = 35; x < 38; x++) {
      let i = (y * w + x) * 4;
      b[i] = b[i + 1] = b[i + 2] = 0;
    }
  assert.ok(C.visualDiff(a, b, w, h).regions.length >= 1);
});
test("errors and missing text never become clean results; CSV formula cells are inert", () => {
  assert.equal(
    C.pageStatus({ a: 1, b: 1, noText: true, findings: [] }),
    "no-text",
  );
  assert.equal(C.pageStatus({ a: 1, b: 1, error: "bad PDF" }), "error");
  assert.equal(C.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});

test("partial page matches preserve old-page ordering", () => {
  const pg = (str) => ({ text: [label(str)] });
  assert.deepEqual(
    C.pairPages(
      [pg("changed old"), pg("same page")],
      [pg("changed new"), pg("same page")],
    ).map((p) => [p.a, p.b]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  assert.notEqual(
    C.normalizeName("R-101-roof.pdf"),
    C.normalizeName("R-102-roof.pdf"),
  );
});

test("local label movement does not turn unchanged labels into false additions/removals", () => {
  const a = [
    ...Array.from({ length: 5 }, (_, i) =>
      label("Anchor left " + i, 10, i * 30),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      label("Anchor right " + i, 500, i * 30),
    ),
    label("Width 3000", 510, 70),
  ];
  const b = a.map((t) => ({
    ...t,
    x: t.x + (t.x > 400 ? 60 : 0),
    str: t.str === "Width 3000" ? "Width 3200" : t.str,
  }));
  const result = C.compareText(a, b);
  assert.equal(result.changed.length, 1);
  assert.equal(result.unchanged.length, 10);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.notEqual(
    C.normalizeName("X202501103.pdf"),
    C.normalizeName("X202502153.pdf"),
  );
});
