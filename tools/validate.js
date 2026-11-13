// Checks the simulator against data it never saw: SMAP soil moisture, MODIS greenness and evapotranspiration,
// FAOSTAT national yields, known drought years and known El Nino patterns. Writes the numbers behind docs/VALIDATION.md.
//
//   node tools/validate.js
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const crypto = require("node:crypto");
require(path.join(ROOT, "app/js/engine.js"));
require(path.join(ROOT, "app/js/nasa.js"));
const E = globalThis.S2R.engine, N = globalThis.S2R.nasa;
const CACHE = path.join(ROOT, "data/http_cache"); // shared with tools/build_fields.js
fs.mkdirSync(CACHE, { recursive: true });
const cachePath = (url) => path.join(CACHE, crypto.createHash("sha1").update(url).digest("hex"));
N.cfg.cache = {
  get: async (url) => { try { return new Uint8Array(fs.readFileSync(cachePath(url))); } catch { return null; } },
  put: async (url, bytes) => fs.writeFileSync(cachePath(url), bytes),
};
const ensoRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "app/data/enso.json")));
const enso = { first: ensoRaw.first, oni: ensoRaw.oni, phase: E.ensoPhases(ensoRaw.oni) };

const faostat = JSON.parse(fs.readFileSync(path.join(ROOT, "data/faostat/yields.json")));
const COUNTRY = { "sorriso-brazil": "Brazil", "bogura-bangladesh": "Bangladesh", "machakos-kenya": "Kenya", "ames-iowa-usa": "United States of America", "maradi-niger": "Niger", "ludhiana-india": "India", "lilongwe-malawi": "Malawi" };
// Well-documented bad crop years, by harvest year, for the crop named. Sources are listed in docs/VALIDATION.md.
const KNOWN = {
  "ames-iowa-usa": { maize: [1988, 2012], soybean: [1988, 2012] },
  "lilongwe-malawi": { maize: [1992, 2005, 2016] },
  "sorriso-brazil": { soybean: [2016, 2024] },
  "machakos-kenya": { maize: [2000, 2009, 2011, 2017] },
  "maradi-niger": { millet: [1987, 2004, 2009, 2011] },
};

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
function detrendLinear(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const b = den ? num / den : 0;
  return ys.map((y, i) => y - (my + b * (xs[i] - mx)));
}
// Rank (Spearman) correlation: yield anomalies are skewed, and a drought year should not need the right size to count.
function spearman(a, b) {
  const rank = (v) => { const o = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]), r = new Array(v.length); o.forEach((p, i) => { r[p[1]] = i; }); return r; };
  return E.pearson(rank(a), rank(b));
}

// The year the crop was or would have been harvested, which is the year FAOSTAT reports it under.
function harvestYear(s, run, wx) {
  // Southern crops sown after mid-year are reported under the next year, even if harvested on 30 December.
  if (wx.lat < 0 && wx.month[s.sowIdx] >= 6) return wx.year[s.sowIdx] + 1;
  if (s.harvestIdx != null) return wx.year[s.harvestIdx];
  return wx.year[Math.min(wx.n - 1, s.sowIdx + run.rot.slots[s.slot].typicalDays)];
}

function checkSmap(f, wx, daily) {
  if (!f.smap || f.smap.length < 30) return null;
  const startMs = Date.parse(wx.start + "T00:00:00Z");
  const sim = [], obs = [], doy = [];
  for (const p of f.smap) {
    const i = Math.round((Date.parse(p.date + "T00:00:00Z") - startMs) / 864e5);
    if (i < 0 || i >= wx.n) continue;
    sim.push(daily[i]); obs.push(p.v); doy.push(wx.doy[i]);
  }
  // Anomalies against the mean for that time of year show whether the wet and dry years agree, not just the seasons.
  const anomalies = (v) => {
    const sum = new Float64Array(12), n = new Float64Array(12);
    doy.forEach((d, i) => { const k = Math.min(11, Math.floor(d / 30.5)); sum[k] += v[i]; n[k]++; });
    return v.map((x, i) => { const k = Math.min(11, Math.floor(doy[i] / 30.5)); return x - sum[k] / n[k]; });
  };
  return { n: sim.length, r: E.pearson(sim, obs), rAnomaly: E.pearson(anomalies(sim), anomalies(obs)) };
}

function checkNdvi(f, wx, run) {
  if (!f.ndvi || f.ndvi.length < 100) return null;
  const startMs = Date.parse(wx.start + "T00:00:00Z");
  const ts = f.ndvi.map((p) => ({ i: Math.round((Date.parse(p.date + "T00:00:00Z") - startMs) / 864e5), v: p.ndvi }));
  const results = {};
  for (const s of run.seasons) {
    if (!s.sown || s.harvestIdx == null || wx.year[s.sowIdx] < 2001) continue;
    const inSeason = ts.filter((p) => p.i >= s.sowIdx && p.i <= s.harvestIdx);
    if (inSeason.length < 3) continue;
    const r = results[s.crop] || (results[s.crop] = { peak: [], wf: [] });
    r.peak.push(Math.max(...inSeason.map((p) => p.v)));
    r.wf.push(s.ry);
  }
  const out = {};
  for (const [crop, r] of Object.entries(results)) if (r.peak.length >= 10) out[crop] = { n: r.peak.length, r: spearman(r.wf, r.peak) };
  return out;
}

function checkYield(id, wx, run) {
  const stats = faostat[COUNTRY[id]];
  const out = {};
  if (!stats) return out;
  const byCrop = {};
  for (const s of run.seasons) {
    if (s.harvestIdx == null && !s.sowIdx) continue;
    const year = harvestYear(s, run, wx);
    (byCrop[s.crop] = byCrop[s.crop] || {})[year] = s;
  }
  for (const [crop, seasons] of Object.entries(byCrop)) {
    const table = stats[crop];
    if (!table) continue;
    const years = Object.keys(seasons).map(Number).filter((y) => table[y] != null && y >= 1985);
    if (years.length < 15) continue;
    const obs = detrendLinear(years, years.map((y) => table[y]));
    const sim = detrendLinear(years, years.map((y) => seasons[y].yield));
    // Of the country's worst fifth of years, how many did this one field call stressed or failed?
    const worst = years.map((y, i) => [obs[i], y]).sort((a, b) => a[0] - b[0]).slice(0, Math.ceil(years.length / 5)).map((p) => p[1]);
    const flagged = worst.filter((y) => seasons[y].status !== "good").length;
    const allBad = years.filter((y) => seasons[y].status !== "good").length;
    const recent = years.filter((y) => y >= years[years.length - 1] - 9);
    out[crop] = {
      n: years.length, r: E.pearson(obs, sim), rho: spearman(obs, sim),
      worstYears: worst.sort(), flagged, baseRate: allBad / years.length,
      simMean: mean(years.map((y) => seasons[y].yield)), nationalRecent: mean(recent.map((y) => table[y])), nationalBest: Math.max(...years.map((y) => table[y])),
    };
  }
  return out;
}

// That year's national yield against the 1985-on linear trend, in percent: the evidence that it was a bad year.
function nationalAnomaly(id, crop, year) {
  const table = (faostat[COUNTRY[id]] || {})[crop];
  if (!table || table[year] == null) return null;
  const years = Object.keys(table).map(Number).filter((y) => y >= 1985);
  const values = years.map((y) => table[y]);
  const res = detrendLinear(years, values);
  const trendValue = table[year] - res[years.indexOf(year)];
  return Math.round((100 * res[years.indexOf(year)]) / trendValue);
}

// Whether results jump where the rain source changes (1998): failure rate and annual rain each side of it.
function rainJoin(wx, run) {
  const seasons = run.seasons.filter((x) => x.year >= run.firstYear);
  const side = (f) => { const l = seasons.filter(f); return l.length ? l.filter((x) => x.status === "fail").length / l.length : 0; };
  const rain = { a: 0, b: 0, na: 0, nb: 0 };
  for (let i = 0; i < wx.n; i++) {
    if (wx.year[i] >= run.firstYear && wx.year[i] < 1998) { rain.a += wx.rain[i]; rain.na++; }
    else if (wx.year[i] >= 1998 && wx.year[i] < 2011) { rain.b += wx.rain[i]; rain.nb++; }
  }
  return { before: side((x) => x.year < 1998), after: side((x) => x.year >= 1998), rainBefore: (rain.a / rain.na) * 365.25, rainAfter: (rain.b / rain.nb) * 365.25 };
}

// How well reanalysis rain follows satellite rain from year to year, in growing-period totals, trends removed.
function merraSkill(f, wx, clim) {
  const period = clim.growing[0];
  if (!period) return null;
  const startMs = Date.parse(wx.start + "T00:00:00Z");
  const years = [], a = [], b = [];
  for (let y = 1998; y <= 2013; y++) {
    const t0 = Math.round((Date.UTC(y, 0, 1) - startMs) / 864e5) + period.start;
    let m = 0, r = 0;
    for (let t = t0; t < t0 + period.days && t < wx.n; t++) { m += f.weather.rainMerra[t]; r += f.weather.rain[t]; }
    years.push(y); a.push(m); b.push(r);
  }
  return E.pearson(detrendLinear(years, a), detrendLinear(years, b));
}

function checkKnown(id, wx, run) {
  const list = KNOWN[id];
  if (!list) return null;
  const out = [];
  for (const [crop, years] of Object.entries(list)) {
    for (const year of years) {
      const s = run.seasons.find((x) => x.crop === crop && harvestYear(x, run, wx) === year);
      const anomaly = nationalAnomaly(id, crop, year);
      if (s) out.push({ crop, year, status: s.status, why: s.why, ry: +s.ry.toFixed(2), anomaly });
    }
  }
  return out;
}

// Crop water use against MODIS MOD16A2GF, whose gap-filled 8-day evapotranspiration comes from satellite greenness and weather,
// not from this water balance. ORNL DAAC, 500 m.
async function checkEt(f, wx, daily) {
  const base = "https://modis.ornl.gov/rst/api/v1/MOD16A2GF";
  const dates = (await N.getJson(`${base}/dates?latitude=${f.lat}&longitude=${f.lon}`)).dates.filter((d) => d.calendar_date >= "2015-01-01" && d.calendar_date <= "2024-12-31");
  const chunks = [];
  for (let i = 0; i < dates.length; i += 10) chunks.push(dates.slice(i, i + 10));
  const parts = await N.pool(chunks, 6, async (ch) => (await N.getJson(`${base}/subset?latitude=${f.lat}&longitude=${f.lon}&band=ET_500m&startDate=${ch[0].modis_date}&endDate=${ch[ch.length - 1].modis_date}&kmAboveBelow=0&kmLeftRight=0`)).subset);
  const startMs = Date.parse(wx.start + "T00:00:00Z");
  const sim = [], obs = [], slot = [], years = new Set();
  let wanted = 0;
  for (const part of parts) {
    if (!part) continue;
    for (const row of part) {
      wanted++;
      const v = row.data[0];
      if (!(v >= 0 && v < 3000)) continue; // land-cover fill values sit above 32000
      const i = Math.round((Date.parse(row.calendar_date + "T00:00:00Z") - startMs) / 864e5);
      if (i < 0 || i + 8 > wx.n) continue;
      let total = 0;
      for (let t = i; t < i + 8; t++) total += daily[t];
      sim.push(total); obs.push(v * 0.1); slot.push(row.calendar_date.slice(5)); years.add(row.calendar_date.slice(0, 4));
    }
  }
  if (sim.length < 100) return { valid: sim.length, wanted };
  const anomalies = (a) => { const sum = {}, n = {}; a.forEach((x, i) => { sum[slot[i]] = (sum[slot[i]] || 0) + x; n[slot[i]] = (n[slot[i]] || 0) + 1; }); return a.map((x, i) => x - sum[slot[i]] / n[slot[i]]); };
  const perYear = (a) => a.reduce((x, y) => x + y, 0) / years.size;
  return { valid: sim.length, wanted, sim: perYear(sim), modis: perYear(obs), r: E.pearson(sim, obs), rAnomaly: E.pearson(anomalies(sim), anomalies(obs)) };
}

// What El Nino is known to do to rain in each region (Ropelewski & Halpert 1987, 1989; NOAA CPC), against this rain record, 1985 onward.
// months: the season the pattern is known for. sign: -1 El Nino usually drier, +1 wetter, 0 no strong pattern known here.
const ENSO_EXPECTED = {
  "machakos-kenya": { months: [9, 10, 11], sign: 1, season: "October-December short rains" },
  "maradi-niger": { months: [6, 7, 8], sign: -1, season: "July-September rains" },
  "ludhiana-india": { months: [5, 6, 7, 8], sign: -1, season: "June-September monsoon" },
  "lilongwe-malawi": { months: [11, 0, 1, 2], sign: -1, season: "December-March rains" },
  "sorriso-brazil": { months: [11, 0, 1], sign: 0, season: "December-February rains" },
  "bogura-bangladesh": { months: [5, 6, 7, 8], sign: 0, season: "June-September monsoon" },
  "ames-iowa-usa": { months: [5, 6, 7], sign: 0, season: "June-August rains" },
};
function checkEnso(id, wx) {
  const want = ENSO_EXPECTED[id];
  if (!want) return null;
  const startMonth = want.months[0], total = {};
  for (let i = 0; i < wx.n; i++) {
    const at = want.months.indexOf(wx.month[i]);
    if (at < 0) continue;
    const y = wx.month[i] < startMonth ? wx.year[i] - 1 : wx.year[i]; // a season across New Year belongs to the year it starts in
    (total[y] = total[y] || { rain: 0, days: 0 }).rain += wx.rain[i];
    total[y].days++;
  }
  const middle = want.months[Math.floor(want.months.length / 2)];
  const groups = { nino: [], nina: [], other: [] };
  for (const [ys, v] of Object.entries(total)) {
    const y = +ys;
    if (y < 1985 || v.days < want.months.length * 28) continue;
    const ph = enso.phase[(y + (middle < startMonth ? 1 : 0) - enso.first) * 12 + middle] || 0;
    groups[ph > 0 ? "nino" : ph < 0 ? "nina" : "other"].push(v.rain);
  }
  const m = (a) => mean(a);
  return { season: want.season, sign: want.sign, nNino: groups.nino.length, nNina: groups.nina.length, nOther: groups.other.length, nino: m(groups.nino), nina: m(groups.nina), other: m(groups.other), ninoChange: (100 * (m(groups.nino) - m(groups.other))) / m(groups.other), ninaChange: (100 * (m(groups.nina) - m(groups.other))) / m(groups.other) };
}

// How much do season results rest on the drift in POWER's temperature? Run the same plan with each month's linear trend
// in daily highs and lows removed, and an assumed 0.2 C a decade of real warming put back.
function withoutDrift(raw) {
  const n = raw.tmax.length, t0 = Date.parse(raw.start + "T00:00:00Z");
  const year = new Int16Array(n), month = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const d = new Date(t0 + i * 864e5); year[i] = d.getUTCFullYear(); month[i] = d.getUTCMonth(); }
  const out = Object.assign({}, raw, { tmax: raw.tmax.slice(), tmin: raw.tmin.slice() });
  delete out.year; delete out.month; delete out.doy;
  for (const key of ["tmax", "tmin"]) {
    for (let m = 0; m < 12; m++) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
      for (let i = 0; i < n; i++) if (month[i] === m) { const x = year[i] - 2005; sx += x; sy += raw[key][i]; sxx += x * x; sxy += x * raw[key][i]; c++; }
      const slope = (c * sxy - sx * sy) / (c * sxx - sx * sx);
      for (let i = 0; i < n; i++) if (month[i] === m) out[key][i] = raw[key][i] - (slope - 0.02) * (year[i] - 2005);
    }
  }
  return out;
}
function checkDrift(f, wx, soil, m) {
  const drift = E.temperatureDrift(wx);
  const wx2 = E.prepareWeather(withoutDrift(f.weather), f.lat, f.elev);
  const clim2 = E.analyseClimate(wx2, soil, f.irrigation);
  const rot2 = E.makeRotation(clim2, f.current);
  const m2 = rot2 ? E.summarize(E.simulate(wx2, soil, rot2, { irrigation: f.irrigation }), soil) : null;
  return { change: drift.change, drifts: drift.drifts, failed: m.failed, stressed: m.stressed, failedEarly: m.failRateEarly, failedLate: m.failRateRecent, failed2: m2 && m2.failed, stressed2: m2 && m2.stressed, failedEarly2: m2 && m2.failRateEarly, failedLate2: m2 && m2.failRateRecent };
}

(async () => {
const results = {};
for (const file of fs.readdirSync(path.join(ROOT, "app/fields"))) {
  if (file === "index.json") continue;
  const id = file.replace(".json", "");
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, "app/fields", file)));
  const wx = E.prepareWeather(f.weather, f.lat, f.elev);
  const soil = E.soilFrom(Object.assign({}, f.soil || { sand: 40, clay: 25, soc: 1 }, { slope: f.slope ? f.slope.slope : 1, floods: f.floods }));
  const clim = E.analyseClimate(wx, soil, f.irrigation);
  const rot = E.makeRotation(clim, f.current);
  if (!rot) { console.log(id, "current rotation does not fit"); continue; }
  const daily = new Float32Array(wx.n), etDaily = new Float32Array(wx.n);
  const run = E.simulate(wx, soil, rot, { irrigation: f.irrigation, soilDaily: daily, etDaily });
  const m = E.summarize(run, soil);
  const res = {
    name: f.name, rotation: rot.name, slots: rot.slots.map((s) => `${s.crop} sow day ${s.sow} (window ${s.open}-${s.close}), about ${s.typicalDays} days`),
    rain: Math.round(m.rain), cropWater: Math.round(m.et), runoff: Math.round(m.runoff), drain: Math.round(m.drain), irrigation: Math.round(m.irrigation), hsg: "ABCD"[soil.hsg], awc: +soil.awc.toFixed(3),
    seasons: m.seasons, failed: m.failed, stressed: m.stressed, reasons: m.failReasons, soilLoss: +m.soilLoss.toFixed(1), rootDays: Math.round(m.rootDays),
    smap: checkSmap(f, wx, daily), ndvi: checkNdvi(f, wx, run), yield: checkYield(id, wx, run), known: checkKnown(id, wx, run),
    green: f.ndvi ? E.greennessCheck(wx, run, f.ndvi) : null,
    rainJoin: rainJoin(wx, run), merraSkill: merraSkill(f, wx, clim),
    et: await checkEt(f, wx, etDaily), enso: checkEnso(id, wx), drift: checkDrift(f, wx, soil, m),
  };
  results[id] = res;
  console.log(`\n=== ${res.name}: ${res.rotation}  [soil ${E.textureClass(soil.sand, soil.clay)} ${res.hsg} awc ${res.awc}]`);
  console.log(`  ${res.slots.join(" | ")}`);
  console.log(`  rain ${res.rain}, ET ${res.cropWater}, runoff ${res.runoff}, drain ${res.drain}, irrigation ${res.irrigation} mm/yr; ${res.failed} failed, ${res.stressed} stressed of ${res.seasons}; ${JSON.stringify(res.reasons)}`);
  if (res.smap) console.log(`  SMAP: r = ${res.smap.r.toFixed(2)}, anomalies r = ${res.smap.rAnomaly.toFixed(2)} (n ${res.smap.n})`);
  if (res.ndvi) console.log(`  NDVI peak vs simulated relative yield: ${Object.entries(res.ndvi).map(([c, v]) => `${c} rho ${v.r.toFixed(2)} (n ${v.n})`).join(", ")}`);
  for (const [crop, y] of Object.entries(res.yield)) console.log(`  FAOSTAT ${crop}: r ${y.r.toFixed(2)}, rho ${y.rho.toFixed(2)} (n ${y.n}); worst years ${y.worstYears.join(" ")}: ${y.flagged}/${y.worstYears.length} flagged (flags ${Math.round(y.baseRate * 100)}% of all years); yield simulated ${y.simMean.toFixed(1)} t/ha, national recent ${y.nationalRecent.toFixed(1)}, best ${y.nationalBest.toFixed(1)}`);
  if (res.known) console.log(`  Known bad years: ${res.known.map((k) => `${k.crop} ${k.year} (national ${k.anomaly}%): ${k.status} (${k.ry}, ${k.why})`).join("; ")}`);
  if (res.green) console.log(`  Greenness second opinion: r ${res.green.r.toFixed(2)} over ${res.green.n} seasons; poor seasons ${res.green.zBad != null ? res.green.zBad.toFixed(2) : "n/a"} vs good ${res.green.zGood != null ? res.green.zGood.toFixed(2) : "n/a"} sd; ${res.green.disagree.length} disagreements`);
  console.log(`  MODIS ET: ${JSON.stringify(res.et)}`);
  console.log(`  El Nino, ${JSON.stringify(res.enso)}`);
  console.log(`  Rain join: failure ${Math.round(res.rainJoin.before * 100)}% before 1998, ${Math.round(res.rainJoin.after * 100)}% after; annual rain ${Math.round(res.rainJoin.rainBefore)} mm (1985-97), ${Math.round(res.rainJoin.rainAfter)} mm (1998-2010); MERRA-2 follows IMERG year to year with r ${res.merraSkill == null ? "n/a" : res.merraSkill.toFixed(2)}`);
}
fs.writeFileSync(path.join(ROOT, "data/validation.json"), JSON.stringify(results, null, 1));
writeReport(results);
})();

function writeReport(R) {
  const rows = Object.values(R);
  const f2 = (v) => (v == null ? "n/a" : v.toFixed(2));
  const L = [];
  L.push("# Sky2Root: does the simulation hold up?", "");
  L.push("Written for judges, mentors and teammates. This file is generated by `node tools/validate.js`, so every number comes from the code and data in this repository.", "");
  L.push("Sky2Root is checked here against data it never used: SMAP soil moisture, MODIS greenness and evapotranspiration, FAOSTAT national yields, known bad crop years and known El Niño patterns. Each field runs the rotation commonly grown there. No parameter was fitted to any of these checks, though they did lead us to fix errors (see the end).", "");
  L.push("## The fields", "");
  L.push("| Field | Rotation | Rain (mm/yr) | Crop water use (mm/yr) | Irrigation (mm/yr) | Failed of seasons | Stressed |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) L.push(`| ${r.name} | ${r.rotation} | ${r.rain} | ${r.cropWater} | ${r.irrigation} | ${r.failed} of ${r.seasons} | ${r.stressed} |`);
  L.push("", "## Check 1: soil water against NASA SMAP", "");
  L.push("Simulated wetness of the top 0.9 m against SMAP L4 root-zone soil moisture, 2015-2025. Anomalies remove the normal seasons, so they ask the harder question: do wet and dry spells agree?", "");
  L.push("| Field | Correlation | Correlation of anomalies | Readings |", "| --- | --- | --- | --- |");
  for (const r of rows) if (r.smap) L.push(`| ${r.name} | ${f2(r.smap.r)} | ${f2(r.smap.rAnomaly)} | ${r.smap.n} |`);
  const smaps = rows.filter((r) => r.smap);
  if (smaps.length) L.push("", `Mean correlation ${f2(mean(smaps.map((r) => r.smap.r)))}, mean of anomalies ${f2(mean(smaps.map((r) => r.smap.rAnomaly)))}. SMAP L4 is itself a model that assimilates satellite data, so this shows agreement with NASA's best estimate rather than with a ground measurement.`);
  L.push("", "## Check 2: season results against MODIS greenness", "");
  L.push("For each season since 2001: simulated relative yield against that season's peak NDVI at the field, as a rank correlation by crop. Peak greenness saturates in good years and sees weeds and neighbouring fields, so this is a weak test, and a useful one mainly in dry climates.", "");
  L.push("| Field | Crop | Rank correlation | Seasons |", "| --- | --- | --- | --- |");
  for (const r of rows) for (const [c, v] of Object.entries(r.ndvi || {})) L.push(`| ${r.name} | ${c} | ${f2(v.r)} | ${v.n} |`);
  L.push("", "## Check 3: yield anomalies against FAOSTAT", "");
  L.push("Simulated yield at one field against national yield, both with the linear trend removed, 1985 onward. National yields mix many regions, management and policy, and technology raises them over time, so one field can only partly follow them. Small countries and those with one main growing region are the fairer test.", "");
  L.push("\"Worst years\" takes the country's worst fifth of years and asks how many this field called stressed or failed, next to how often it says so in any year: a method that always says \"stressed\" would score high here too.", "");
  L.push("| Field | Crop | Correlation | Worst years flagged | Flagged in any year | Simulated yield (t/ha) | National recent (best) |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) for (const [c, y] of Object.entries(r.yield)) L.push(`| ${r.name} | ${c} | ${f2(y.r)} | ${y.flagged} of ${y.worstYears.length} | ${Math.round(y.baseRate * 100)}% | ${y.simMean.toFixed(1)} | ${y.nationalRecent.toFixed(1)} (${y.nationalBest.toFixed(1)}) |`);
  L.push("", "Simulated yields assume good management with adequate nutrients, so they should sit at or above national bests, not match national means.");
  L.push("", "## Check 4: known bad crop years", "");
  L.push("Years of well-known drought in these regions, by harvest year. The national yield column is FAOSTAT against its trend, the evidence that the year was bad.", "");
  L.push("| Field | Crop | Year | National yield vs trend | Simulation |", "| --- | --- | --- | --- | --- |");
  let hit = 0, total = 0;
  for (const r of rows) for (const k of r.known || []) { total++; if (k.status !== "good") hit++; L.push(`| ${r.name} | ${k.crop} | ${k.year} | ${k.anomaly == null ? "n/a" : `${k.anomaly > 0 ? "+" : ""}${k.anomaly}%`} | ${k.status === "fail" ? "Failed" : k.status === "warn" ? "Stressed" : "Good"} (${Math.round(k.ry * 100)}% of potential${k.status === "good" ? "" : `, ${k.why}`}) |`); }
  L.push("", `The simulation flagged ${hit} of ${total} as stressed or failed.`);
  L.push("", "## Check 5: two methods, one question", "");
  L.push("The challenge asks teams to compare approaches and to say where local expertise is needed. For each field, the process simulation is compared with a purely statistical view: how each season's peak greenness compares with that crop's other seasons (a z-score). The app lists the seasons where they disagree, for a farmer or adviser to settle.", "");
  L.push("| Field | Correlation | Greenness of poor seasons (sd) | Greenness of good seasons (sd) | Seasons compared | Disagreements |", "| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) if (r.green) L.push(`| ${r.name} | ${f2(r.green.r)} | ${f2(r.green.zBad)} | ${f2(r.green.zGood)} | ${r.green.n} | ${r.green.disagree.length} |`);
  L.push("", "## Check 6: the join in the rain record", "");
  L.push("Rain before 1998 is MERRA-2 quantile-mapped to IMERG, so results could jump where the source changes.", "");
  L.push("| Field | Failed before 1998 | Failed from 1998 | Rain 1985-1997 (mm/yr) | Rain 1998-2010 (mm/yr) | MERRA-2 against IMERG, year to year |", "| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) L.push(`| ${r.name} | ${Math.round(r.rainJoin.before * 100)}% | ${Math.round(r.rainJoin.after * 100)}% | ${Math.round(r.rainJoin.rainBefore)} | ${Math.round(r.rainJoin.rainAfter)} | ${f2(r.merraSkill)} |`);
  L.push("", "The last column is the correlation of growing-season rain, trends removed, 1998-2013: how far the pre-satellite year-to-year pattern can be trusted. Treat early seasons as less certain where it is low. Rain trends in the app use satellite years only.");
  L.push("", "## Check 7: crop water use against MODIS", "");
  L.push("Simulated evapotranspiration against MODIS MOD16A2GF, 8-day totals, 2015-2024. MODIS works it out from satellite greenness and weather rather than from a water balance, so it is a separate estimate of the same quantity, not a measurement. Anomalies remove the normal seasons, so they ask whether wet and dry years agree.", "");
  L.push("| Field | Simulated (mm/yr) | MODIS (mm/yr) | Correlation | Correlation of anomalies | Valid readings |", "| --- | --- | --- | --- | --- | --- |");
  for (const r of rows) if (r.et) L.push(`| ${r.name} | ${r.et.sim == null ? "n/a" : Math.round(r.et.sim)} | ${r.et.modis == null ? "n/a" : Math.round(r.et.modis)} | ${f2(r.et.r)} | ${f2(r.et.rAnomaly)} | ${r.et.valid} of ${r.et.wanted} |`);
  L.push("", "## Check 8: rain in El Niño and La Niña years", "");
  L.push("Rain at each field in the season where El Niño has a known effect (Ropelewski & Halpert 1987, 1989), by NOAA's Oceanic Niño Index, 1985 onward, against the other years. The app tells farmers how plans did in such years, so the rain record should show these patterns where they are known. Rain was not fitted to them.", "");
  L.push("| Field | Season | Known El Niño effect | El Niño years vs others | La Niña years vs others | Years (El Niño, La Niña, others) |", "| --- | --- | --- | --- | --- | --- |");
  const signed = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
  for (const r of rows) if (r.enso) L.push(`| ${r.name} | ${r.enso.season} | ${r.enso.sign > 0 ? "Wetter" : r.enso.sign < 0 ? "Drier" : "No strong pattern"} | ${signed(r.enso.ninoChange)} | ${signed(r.enso.ninaChange)} | ${r.enso.nNino}, ${r.enso.nNina}, ${r.enso.nOther} |`);
  const known = rows.filter((r) => r.enso && r.enso.sign !== 0);
  L.push("", `Where a pattern is known, the rain record agrees in ${known.filter((r) => Math.sign(r.enso.ninoChange) === r.enso.sign).length} of ${known.length} regions.`);
  L.push("", "## Check 9: drift in the temperature record", "");
  L.push("NASA POWER's temperature comes from MERRA-2, whose land model responds to its own rain, and that rain drifts (see check 6). So the record can show warming or cooling that did not happen. The second column compares the mean daily high of the first ten years with the last ten. The results columns run the same plan as it stands and with each month's trend removed and an assumed 0.2 °C a decade of real warming put back. They show seasons failed, then poor, and the share failed before and after the middle of the record.", "");
  L.push("| Field | Change in mean daily high (°C) | App flags it | As it stands | Drift removed |", "| --- | --- | --- | --- | --- |");
  const pct = (v) => `${Math.round(v * 100)}%`;
  for (const r of rows) if (r.drift) L.push(`| ${r.name} | ${r.drift.change > 0 ? "+" : ""}${r.drift.change.toFixed(1)} | ${r.drift.drifts ? "Yes" : "No"} | ${r.drift.failed} failed, ${r.drift.stressed} poor (${pct(r.drift.failedEarly)} then ${pct(r.drift.failedLate)}) | ${r.drift.failed2} failed, ${r.drift.stressed2} poor (${pct(r.drift.failedEarly2)} then ${pct(r.drift.failedLate2)}) |`);
  L.push("", fs.readFileSync(path.join(ROOT, "tools/validation_notes.md"), "utf8").trim(), "");
  fs.writeFileSync(path.join(ROOT, "docs/VALIDATION.md"), L.join("\n"));
  console.log("\nWrote docs/VALIDATION.md");
}
