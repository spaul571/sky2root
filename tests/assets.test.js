// Run: node --test "tests/*.test.js"
// A missing picture or an uncredited photo should fail here, not in front of a farmer or a judge.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../app/js/engine.js");
const { CROPS } = globalThis.S2R.engine;
const ROOT = path.join(__dirname, "..", "app");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("every crop has a small picture and a credit under a licence that allows this use", () => {
  const credits = JSON.parse(read("data/crop-photos.json"));
  for (const id of Object.keys(CROPS)) {
    const size = fs.statSync(path.join(ROOT, "img/crops", `${id}.webp`)).size;
    assert.ok(size > 2000 && size < 80000, `${id}: ${size} bytes`);
    const c = credits[id];
    assert.ok(c && c.author && c.page.startsWith("https://commons.wikimedia.org/wiki/File:"), id);
    assert.match(c.licence, /^(Public domain|CC0|CC BY \d)/, id); // no share-alike: a cropped copy would have to carry that licence
  }
  assert.equal(Object.keys(credits).length, Object.keys(CROPS).length);
});

test("the offline list includes every picture and new data file", () => {
  const sw = read("sw.js");
  for (const id of Object.keys(CROPS)) assert.ok(sw.includes(`"${id}"`), id);
  for (const file of ["data/enso.json", "data/crop-photos.json", "data/country-crops.json"]) assert.ok(sw.includes(file), file);
});

test("the app can be installed on a phone: linked manifest, start page and both icon sizes", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.ok(m.name && m.start_url && ["standalone", "fullscreen", "minimal-ui"].includes(m.display));
  for (const size of ["192x192", "512x512"]) {
    const icon = m.icons.find((i) => i.sizes === size);
    assert.ok(icon && fs.existsSync(path.join(ROOT, icon.src)), size);
  }
  assert.match(read("index.html"), /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.ok(read("sw.js").includes("manifest.webmanifest"));
});

test("yields and prices cover every crop FAOSTAT reports, with a world figure to fall back on", () => {
  const data = JSON.parse(read("data/country-crops.json"));
  const crops = new Set(Object.keys(CROPS).filter((id) => !CROPS[id].cover).map((id) => (id === "winterWheat" ? "wheat" : id)));
  for (const id of crops) {
    assert.ok(data._world.yield[id][1] > 0, id);
    assert.ok(data._world.price[id] > 0, id);
  }
  for (const [key, c] of Object.entries(data)) if (key !== "_world") assert.ok(c.name && c.shares && c.yield && c.price && c.priceEst, key);
  assert.ok(data.BD.price.rice > 100 && data.BD.yield.rice[0] > 2, "Bangladesh rice");
  assert.ok(data.IN.priceEst.potato > 50 && !data.IN.price.potato, "India has estimates, not recent reports");
});

test("the bundled El Nino index has one value a month from 1950, recent enough to use", () => {
  const e = JSON.parse(read("data/enso.json"));
  assert.equal(e.first, 1950);
  assert.ok(e.oni.every((v) => typeof v === "number" && Math.abs(v) < 4));
  assert.ok(e.oni.length >= (2026 - 1950) * 12 + 9, `only ${e.oni.length} months`);
});
