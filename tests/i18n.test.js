// Run: node --test "tests/*.test.js"
// A wrong or missing key would show raw text like "tile.food" to a farmer, so check them all.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../app/js/i18n.js");
const { STR, LANGS, t, setLang } = globalThis.S2R.i18n;
const ROOT = path.join(__dirname, "..", "app");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const slots = (s) => (s.match(/\{\w+\}/g) || []).sort().join(" ");

test("every language in the menu has strings", () => {
  for (const { id } of LANGS) assert.ok(STR[id], id);
});

test("translations use only keys that exist in English, with the same {values}", () => {
  for (const [lang, dict] of Object.entries(STR)) {
    for (const [key, text] of Object.entries(dict)) {
      assert.ok(key in STR.en, `${lang}: unknown key "${key}"`);
      assert.equal(slots(text), slots(STR.en[key]), `${lang}: "${key}"`);
    }
  }
});

test("each translation covers everything a farmer needs to reach and read the answer", () => {
  const prefixes = ["nav.", "step.", "s1.", "s2.", "s3.", "search.", "pattern.", "water.", "prio.", "level.", "prog.", "err.", "period.", "plan.", "hero.", "badge.", "tile.", "cal.", "cta.", "acc.", "opt.", "status.", "why.", "stage.", "crop.", "texture.", "x.", "limit.", "fact.", "enso.", "hint.water."];
  for (const [lang, dict] of Object.entries(STR)) {
    const missing = Object.keys(STR.en).filter((k) => prefixes.some((p) => k.startsWith(p)) && !(k in dict));
    assert.deepEqual(missing, [], lang);
  }
});

test("every key written in the code exists in English", () => {
  const code = ["js/app.js", "js/explain.js", "js/season-view.js"].map(read).join("\n");
  const used = new Set([...code.matchAll(/\b[tT]\("([\w. -]+)"/g)].map((m) => m[1]));
  const html = read("index.html");
  for (const m of html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size > 150, `only found ${used.size} keys: the scan is broken`);
  const missing = [...used].filter((k) => !k.endsWith(".") && !(k in STR.en)); // "status." + x is built at run time: next test
  assert.deepEqual(missing, []);
});

test("the keys built at run time from engine values exist", () => {
  const engine = read("js/engine.js");
  const reasons = new Set([...engine.matchAll(/why = "([^"]+)"/g)].map((m) => m[1]));
  for (const m of engine.matchAll(/\? "([^"]+)" : (?=wf\.|"[a-z ]+"\s*[:;)])/g)) if (/drought|short|no planting|previous|hot|cold/.test(m[1])) reasons.add(m[1]);
  for (const m of engine.matchAll(/"((?:drought|short of|no planting|previous crop|too (?:hot|cold))[^"]*)"/g)) reasons.add(m[1]);
  assert.ok(reasons.size >= 11, [...reasons].join("|"));
  for (const r of reasons) assert.ok(`why.${r}` in STR.en, r);
  for (const c of engine.matchAll(/\bc\(\{ id: "(\w+)"/g)) assert.ok(`crop.${c[1]}` in STR.en, c[1]);
  for (const m of engine.matchAll(/return [^;]*?"([A-Z][a-z]+(?: [a-z]+)*)"/g)) if (/clay|loam|sand|silt/i.test(m[1])) assert.ok(`texture.${m[1]}` in STR.en, m[1]);
  for (const m of engine.matchAll(/mk\("([^"]+)"/g)) { assert.ok(`trend.${m[1]}` in STR.en, m[1]); assert.ok(`trend.what.${m[1]}` in STR.en, m[1]); }
});

test("the El Nino keys chosen at run time exist", () => {
  for (const k of ["nino", "ninoStrong", "nina", "ninaStrong", "neutral", "history"]) assert.ok(`enso.title.${k}` in STR.en, k);
  for (const k of ["nino", "nina", "neutral"]) assert.ok(`enso.${k}` in STR.en, k);
  for (const k of ["nino", "nina"]) assert.ok(`x.risk.enso.${k}` in STR.en, k);
});

test("t() fills in values and falls back to English for a missing key", () => {
  setLang("bn");
  assert.equal(t("unit.days", { n: 5 }), "5 দিন");
  assert.equal(t("data.how"), STR.en["data.how"]);
  setLang("en");
  assert.equal(t("no.such.key"), "no.such.key");
});
