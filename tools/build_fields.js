// Downloads NASA data for the demo fields into app/fields/, so the app can open them offline.
// Raw responses stay in data/http_cache/ (not in git). The same code runs live in the browser.
//
//   node tools/build_fields.js            all fields
//   node tools/build_fields.js sorriso    one field
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "..");
require(path.join(ROOT, "app/js/engine.js"));
require(path.join(ROOT, "app/js/nasa.js"));
const N = globalThis.S2R.nasa;

const CACHE = path.join(ROOT, "data/http_cache");
fs.mkdirSync(CACHE, { recursive: true });
const cachePath = (url) => path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex"));
N.cfg.cache = {
  get: async (url) => { try { return new Uint8Array(fs.readFileSync(cachePath(url))); } catch { return null; } },
  put: async (url, bytes) => fs.writeFileSync(cachePath(url), bytes),
};
N.cfg.readAsset = async (p) => new Uint8Array(fs.readFileSync(path.join(ROOT, "app", p)));

const FIRST_YEAR = 1984, LAST_YEAR = 2025;
const FIELDS = require(path.join(ROOT, "tools/fields.json"));

const round = (a, d) => a.map((x) => +x.toFixed(d));

async function build(f) {
  const t0 = Date.now();
  const log = (msg) => console.log(`  ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${msg}`);
  const status = {};
  const step = async (name, fn) => {
    try { const v = await fn(); status[name] = "ok"; log(`${name}: ok`); return v; }
    catch (error) { status[name] = String(error.message); log(`${name}: FAILED ${error.message}`); return null; }
  };
  console.log(`${f.name} (${f.lat}, ${f.lon})`);
  const weather = await step("weather", () => N.fetchWeather(f.lat, f.lon, FIRST_YEAR, LAST_YEAR));
  if (!weather) throw new Error("no weather: cannot build this field");
  // The soil service is slow and has a limit of 5 calls a minute: fall back on the grid the app carries.
  let soil = await step("soil", () => N.fetchSoil(f.lat, f.lon));
  if (!soil) soil = await step("soilGrid", () => N.soilFromGrid(f.lat, f.lon));
  const slope = await step("slope", () => N.fetchSlope(f.lat, f.lon));
  const landCover = await step("landCover", () => N.fetchLandCover(f.lat, f.lon));
  const country = f.country || (await step("country", () => N.fetchCountry(f.lat, f.lon)));
  const ndvi = await step("ndvi", () => N.fetchNdvi(f.lat, f.lon, 2001, LAST_YEAR));
  const smap = await step("smap", () => N.fetchSmap(f.lat, f.lon, `${LAST_YEAR}-12-31`, 16));
  const grace = await step("grace", () => N.fetchGrace(f.lat, f.lon));
  // HLS reads use short-lived tokens, so the finished series is cached rather than the raw responses.
  const burned = await step("burned", () => N.fetchBurned(f.lat, f.lon, 2001, LAST_YEAR));
  const water = await step("water", () => N.fetchSurfaceWater(f.lat, f.lon));
  const hls = await step("hls", async () => {
    const key = `hls:${f.lat},${f.lon},${LAST_YEAR}`;
    const hit = await N.cfg.cache.get(key);
    if (hit) return JSON.parse(Buffer.from(hit).toString());
    const series = await N.fetchHls(f.lat, f.lon, `${LAST_YEAR - 4}-01-01`, `${LAST_YEAR}-12-31`);
    await N.cfg.cache.put(key, Buffer.from(JSON.stringify(series)));
    return series;
  });
  const pack = {
    id: f.id, name: f.name, place: f.place, lat: f.lat, lon: f.lon, current: f.current, irrigation: f.irrigation, floods: !!f.floods, note: f.note,
    elev: weather.elev, country, soil, slope, landCover, ndvi, smap, grace, hls, burned, water, status, built: new Date().toISOString().slice(0, 10),
    weather: {
      start: weather.start, tmax: round(weather.tmax, 1), tmin: round(weather.tmin, 1), tdew: round(weather.tdew, 1), wind10: round(weather.wind10, 1),
      rs: round(weather.rs, 1), rain: round(weather.rain, 1), rainMerra: round(weather.rainMerra, 1), rainInfo: weather.rainInfo, gwetroot: round(weather.gwetroot, 2),
    },
  };
  const out = path.join(ROOT, "app/fields", `${f.id}.json`);
  fs.writeFileSync(out, JSON.stringify(pack));
  log(`wrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB); NDVI ${ndvi ? ndvi.length : 0}, SMAP ${smap ? smap.length : 0}, GRACE ${grace ? grace.length : 0}, HLS ${hls ? hls.length : 0}, soil ${soil ? `${soil.sand.toFixed(0)}/${soil.clay.toFixed(0)}/${soil.soc.toFixed(2)}` : "none"}, slope ${slope ? slope.slope : "?"}%, land ${landCover ? landCover.name : "?"}`);
}

(async () => {
  const only = process.argv[2];
  for (const f of FIELDS) {
    if (only && !f.id.startsWith(only)) continue;
    try { await build(f); } catch (error) { console.log(`  FAILED: ${error.message}`); }
  }
  // The app lists the demo fields from this index.
  const index = FIELDS.filter((f) => fs.existsSync(path.join(ROOT, "app/fields", `${f.id}.json`))).map(({ id, name, place, lat, lon, note }) => ({ id, name, place, lat, lon, note }));
  fs.writeFileSync(path.join(ROOT, "app/fields/index.json"), JSON.stringify(index, null, 1));
})();
