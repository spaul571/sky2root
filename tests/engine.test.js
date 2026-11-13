// Run: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
require("../app/js/engine.js");
require("../app/js/nasa.js");
const E = globalThis.S2R.engine, N = globalThis.S2R.nasa;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} is not within ${tol} of ${b}`);

test("reference ET matches FAO-56 Example 18 (Brussels, 6 July: 3.88 mm/day)", () => {
  // The paper's own inputs: Tmax 21.5, Tmin 12.3, ea 1.409 kPa, u2 2.078 m/s, Rs 22.07 MJ, z 100 m, 50.8 N, day 187.
  near(E.et0FAO(21.5, 12.3, 1.409, 2.078, 22.07, 100, (50.8 * Math.PI) / 180, 187), 3.88, 0.05, "ET0");
});

test("wind conversion follows FAO-56 Eq. 47 and its 0.5 m/s limit", () => {
  near(E.windTo2m(3.2), 2.4, 0.01); // the paper's Example 14: 3.2 m/s at 10 m is 2.4 m/s at 2 m
  assert.equal(E.windTo2m(0.1), 0.5);
});

test("soil water limits match Saxton & Rawls for a loam (sand 40, clay 20, OM 2.5)", () => {
  const h = E.saxtonRawls(40, 20, 2.5);
  near(h.wp, 0.137, 0.005, "wilting point");
  near(h.fc, 0.28, 0.005, "field capacity");
});

test("USLE slope factor is about 1 on the standard plot (9%, 22.13 m)", () => {
  near(E.slopeLS(9, 22.13), 1, 0.05);
});

test("erodibility: silty soil erodes more readily than sand or clay", () => {
  const silt = E.erodibilityK(10, 75, 15, 1), sand = E.erodibilityK(85, 10, 5, 1), clay = E.erodibilityK(20, 25, 55, 1);
  assert.ok(silt > sand && silt > clay, `${silt} ${sand} ${clay}`);
  assert.ok(silt > 0.03 && silt < 0.08, `K in SI units ${silt}`);
});

// A synthetic weather record with a dry and a wet season, for checks that need no download.
function syntheticWeather(years, dailyWetRain) {
  const raw = { start: "1984-01-01", tmax: [], tmin: [], tdew: [], wind10: [], rs: [], rain: [] };
  for (let t = Date.UTC(1984, 0, 1), end = Date.UTC(1984 + years, 0, 1); t < end; t += 864e5) {
    const doy = Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 864e5);
    const wet = doy > 120 && doy < 300;
    raw.tmax.push(31); raw.tmin.push(20); raw.tdew.push(wet ? 18 : 10); raw.wind10.push(2.5); raw.rs.push(20);
    raw.rain.push(wet && doy % 3 === 0 ? dailyWetRain : 0);
  }
  return raw;
}
const loam = { sand: 40, clay: 25, soc: 1.2, slope: 3 };

test("water balance closes: rain = ET + runoff + drainage + change in storage", () => {
  const raw = syntheticWeather(12, 18);
  const wx = E.prepareWeather(raw, 10, 300);
  const soil = E.soilFrom(loam);
  const clim = E.analyseClimate(wx, soil);
  const rot = E.makeRotation(clim, { crops: ["maize"], pattern: "single" });
  assert.ok(rot);
  const run = E.simulate(wx, soil, rot, {});
  let rain = 0, out = 0;
  for (const y of Object.values(run.yearly)) { rain += y.rain; out += y.et + y.runoff + y.drain; }
  // Storage can change by at most the size of the whole soil column.
  const column = soil.cap.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(rain - out) <= column, `rain ${rain} against outflows ${out}, column ${column}`);
});

test("more rain means fewer failed maize seasons", () => {
  const soil = E.soilFrom(loam);
  const failed = (mm) => {
    const wx = E.prepareWeather(syntheticWeather(12, mm), 10, 300);
    const clim = E.analyseClimate(wx, soil);
    const rot = E.makeRotation(clim, { crops: ["maize"], pattern: "single" });
    return E.summarize(E.simulate(wx, soil, rot, {}), soil).reliability;
  };
  assert.ok(failed(21) > failed(9), "a wetter climate should be more reliable");
});

test("irrigation removes drought failure and is counted", () => {
  const soil = E.soilFrom(loam);
  const raw = syntheticWeather(12, 3);
  const wx = E.prepareWeather(raw, 10, 300);
  const clim = E.analyseClimate(wx, soil, "full");
  const rot = E.makeRotation(clim, { crops: ["maize"], pattern: "single" });
  const m = E.summarize(E.simulate(wx, soil, rot, { irrigation: "full" }), soil);
  assert.ok(m.reliability >= 90, `reliability ${m.reliability}`);
  assert.ok(m.irrigation > 100, `irrigation ${m.irrigation}`);
});

test("land that floods favours paddy over upland crops", () => {
  const raw = syntheticWeather(10, 40);
  const wx = E.prepareWeather(raw, 20, 20);
  const dry = E.soilFrom(loam);
  const wet = E.soilFrom(Object.assign({}, loam, { floods: true }));
  const yieldOf = (soil, id) => {
    const clim = E.analyseClimate(wx, soil, "none");
    const rot = E.makeRotation(clim, { crops: [id], pattern: "single" });
    return rot ? E.summarize(E.simulate(wx, soil, rot, {}), soil).byCrop[id].ry : 0;
  };
  assert.ok(yieldOf(wet, "soybean") <= yieldOf(dry, "soybean"), "soybean suffers or moves on land that floods");
  assert.ok(yieldOf(wet, "rice") > 0.5, "paddy still grows");
});

test("a hard frost kills a tender crop", () => {
  const raw = syntheticWeather(10, 21);
  const wx = E.prepareWeather(raw, 10, 300);
  const soil = E.soilFrom(loam);
  const clim = E.analyseClimate(wx, soil);
  const rot = E.makeRotation(clim, { crops: ["maize"], pattern: "single" });
  const clean = E.summarize(E.simulate(wx, soil, rot, {}), soil);
  const cold = Object.assign({}, raw, { tmin: raw.tmin.slice() });
  for (let i = 0; i < cold.tmin.length; i++) if (wx.doy[i] === 200) cold.tmin[i] = -5;
  const wx2 = E.prepareWeather(cold, 10, 300);
  const frosted = E.summarize(E.simulate(wx2, soil, rot, {}), soil);
  assert.ok(frosted.failed > clean.failed, `${frosted.failed} against ${clean.failed}`);
  assert.ok(frosted.failReasons.frost > 0);
});

test("a 2050 change raises reference ET and scales rain", () => {
  const raw = syntheticWeather(4, 15);
  const base = E.prepareWeather(raw, 10, 300);
  const warm = E.prepareWeather(raw, 10, 300, { dTmax: Array(12).fill(2), dTmin: Array(12).fill(2), rainRatio: Array(12).fill(0.9) });
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  assert.ok(sum(warm.et0) > sum(base.et0));
  near(sum(warm.rain), sum(base.rain) * 0.9, 1);
  near(warm.tmax[0], base.tmax[0] + 2, 0.01);
});

test("ranking follows the farmer's priorities", () => {
  const items = [
    { id: "a", m: { reliability: 90, harvest: 10, water: 800, soil: 20 } },
    { id: "b", m: { reliability: 60, harvest: 30, water: 500, soil: 80 } },
  ];
  assert.equal(E.rank(items, { rel: 5 })[0].id, "a");
  assert.equal(E.rank(items, { soil: 5, water: 3 })[0].id, "b");
});

test("trend: Theil-Sen slope and Mann-Kendall find a real rise and ignore noise", () => {
  const up = Array.from({ length: 40 }, (_, i) => i * 0.5 + (i % 3));
  const tr = E.trend(up);
  near(tr.slope, 0.5, 0.1);
  assert.ok(tr.p < 0.01);
  const flat = Array.from({ length: 40 }, (_, i) => (i * 7919) % 13);
  assert.ok(E.trend(flat).p > 0.05);
});

test("rain harmonizing keeps IMERG and maps MERRA-2 onto its distribution before it", () => {
  const keys = [], merra = [], imerg = {};
  for (let y = 1996; y <= 2013; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 28; d++) {
        const k = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
        keys.push(k);
        merra.push(d % 2 ? 2 : 1); // drizzle every day
        if (y >= 1998) imerg[k] = d % 3 === 0 ? 6 : 0; // fewer, heavier falls
      }
    }
  }
  const r = N.harmonizeRain(keys, merra, imerg);
  const mapped = r.rain.slice(0, 28);
  assert.ok(mapped.includes(0), "dry days appear");
  assert.ok(mapped.includes(6), "heavier falls appear");
  assert.equal(r.rain[keys.indexOf("20130328")], imerg["20130328"]);
});

test("the PNG reader decodes filtered RGB scanlines", async () => {
  // 2x2 RGB, row 0 unfiltered, row 1 with the Sub filter. Written with Node's zlib.
  const zlib = require("node:zlib");
  const raw = Buffer.from([0, 10, 20, 30, 40, 50, 60, 1, 1, 2, 3, 4, 5, 6]);
  const idat = zlib.deflateSync(raw);
  const chunk = (name, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(name), data, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
  const img = await N.decodePng(new Uint8Array(png));
  assert.deepEqual(img.pixel(1, 0), [40, 50, 60, 255]);
  assert.deepEqual(img.pixel(1, 1), [5, 7, 9, 255]);
});

test("NDVI analysis counts bare days and crops per year", () => {
  const series = [];
  for (let y = 2010; y < 2013; y++) {
    for (let i = 0; i < 23; i++) {
      const d = new Date(Date.UTC(y, 0, 1 + i * 16)).toISOString().slice(0, 10);
      const twoCrops = 0.2 + 0.6 * Math.max(0, Math.sin((i / 23) * 2 * Math.PI * 2 - 1));
      series.push({ date: d, ndvi: twoCrops });
    }
  }
  const a = E.analyseNdvi(series);
  near(a.cropsPerYear, 2, 0.7);
  assert.ok(a.bareDays > 80 && a.bareDays < 320, `bare days ${a.bareDays}`);
});

test("UTM projection matches a known point", () => {
  // Snyder's USGS worked example gives easting 627,106 and northing 4,173,... here checked to within a kilometre by zone geometry.
  const central = N.toUtm(0, -57, 21);
  near(central.x, 500000, 0.5, "on the central meridian the easting is exactly 500 km");
  near(central.y, 0, 0.5, "the equator has northing 0 in the northern hemisphere formula");
  const degree = N.toUtm(0, -56, 21);
  near(degree.x - 500000, 111320 * 0.9996, 60, "one degree of longitude at the equator");
  assert.ok(N.toUtm(-12.62, -55.86, 21).y < 0, "north-grid northing is negative south of the equator");
  assert.ok(N.toUtm(-12.62, -55.86, 21, true).y > 8e6, "south grid adds the false northing");
});

test("16-day composite keeps the greenest reading and bridges short gaps only", () => {
  const pts = [{ date: "2020-01-01", ndvi: 0.2 }, { date: "2020-01-05", ndvi: 0.4 }, { date: "2020-03-05", ndvi: 0.8 }];
  const c = E.compositeNdvi(pts);
  assert.equal(c[0].ndvi, 0.4);
  assert.ok(c.length >= 4 && c[1].ndvi > 0.4 && c[1].ndvi < 0.8);
});

test("greenness check marks seasons where simulation and satellite disagree", () => {
  const raw = syntheticWeather(14, 21);
  const wx = E.prepareWeather(raw, 10, 300);
  const soil = E.soilFrom(loam);
  const clim = E.analyseClimate(wx, soil);
  const run = E.simulate(wx, soil, E.makeRotation(clim, { crops: ["maize"], pattern: "single" }), {});
  const sown = run.seasons.filter((x) => x.sown && x.harvestIdx != null);
  const start = Date.parse(wx.start + "T00:00:00Z");
  const ndvi = [];
  sown.forEach((x, n) => {
    for (let k = 1; k <= 4; k++) {
      const date = new Date(start + (x.sowIdx + (k * (x.harvestIdx - x.sowIdx)) / 5) * 864e5).toISOString().slice(0, 10);
      ndvi.push({ date, ndvi: n === 3 ? 0.2 : 0.8 }); // one season far paler than the rest
    }
  });
  const g = E.greennessCheck(wx, run, ndvi);
  assert.ok(g && g.n >= 8);
  if (sown[3].status === "good") assert.ok(g.disagree.some((d) => d.year === sown[3].year), "the pale season is listed");
});

test("El Nino and La Nina follow NOAA's rule and its known events", () => {
  // Five overlapping seasons at the limit make an event, four do not; the index counts after rounding to 0.1.
  assert.deepEqual([...E.ensoPhases([0, 0.6, 0.6, 0.6, 0.6, 0.6, 0])], [0, 1, 1, 1, 1, 1, 0]);
  assert.deepEqual([...E.ensoPhases([0, 0.6, 0.6, 0.6, 0.6, 0, 0])], [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...E.ensoPhases([-0.45, -0.5, -0.6, -0.7, -0.5])], [-1, -1, -1, -1, -1]);
  const j = require("../app/data/enso.json"), phase = E.ensoPhases(j.oni);
  const at = (y, m) => phase[(y - j.first) * 12 + m];
  for (const y of [1982, 1997, 2009, 2015, 2023]) assert.equal(at(y, 11), 1, `El Nino in late ${y}`);
  for (const y of [1988, 1998, 2010, 2020]) assert.equal(at(y, 11), -1, `La Nina in late ${y}`);
  assert.equal(at(2013, 5), 0, "neutral in mid 2013");
});

test("seasons are counted under what the Pacific was doing at their middle", () => {
  const wx = { start: "2000-01-01" };
  const enso = { first: 2000, phase: new Int8Array(24) };
  enso.phase[6] = 1; // July 2000: El Nino
  enso.phase[18] = -1; // July 2001: La Nina
  const day = (y, m, d) => Math.round((Date.UTC(y, m, d) - Date.UTC(2000, 0, 1)) / 864e5);
  const run = {
    firstYear: 2000,
    seasons: [
      { year: 2000, sowIdx: day(2000, 5, 1), days: 60, status: "fail", sown: true, rain: 100 }, // middle 31 June: July
      { year: 2001, sowIdx: day(2001, 5, 1), days: 60, status: "good", sown: true, rain: 300 },
      { year: 2000, sowIdx: day(2000, 1, 1), days: 0, status: "fail", sown: false, rain: 0 }, // not planted: counts as failed, adds no rain
    ],
  };
  const s = E.ensoSplit(run, wx, enso);
  assert.deepEqual(s.nino, { n: 1, failed: 1, rain: 100, sown: 1 });
  assert.deepEqual(s.nina, { n: 1, failed: 0, rain: 300, sown: 1 });
  assert.deepEqual(s.neutral, { n: 1, failed: 1, rain: null, sown: 0 });
});

test("harvest value uses this country's figures first and says nothing without a market", () => {
  const world = { yield: { maize: [3, 4], wheat: [2, 3] }, price: { maize: 300, wheat: 300 } };
  const market = { yield: { maize: [1, 2] }, price: { maize: 100 }, priceEst: { wheat: 200 }, world };
  const m = { years: 10, byCrop: { maize: { n: 10, ry: 0.5 }, winterWheat: { n: 5, ry: 1 } } };
  // maize: 1 season a year x 0.5 x best national 2 t x $100 = $100. Winter wheat counts as wheat, has no national yield,
  // so the world's best-recent 3 t, and an estimated price of $200: 0.5 seasons a year x 1 x 3 x 200 = $300.
  assert.equal(E.harvestValue(m, market), 400);
  assert.equal(E.harvestValue(m, null), null);
  assert.equal(E.farmPrice("wheat", { price: {}, priceEst: {}, world }), 300);
});

test("potato is reported in the fresh tonnes farmers weigh, not dry matter", () => {
  const raw = syntheticWeather(6, 12);
  for (let i = 0; i < raw.tmax.length; i++) { raw.tmax[i] = 24; raw.tmin[i] = 12; }
  const wx = E.prepareWeather(raw, 10, 300);
  const soil = E.soilFrom(loam);
  const clim = E.analyseClimate(wx, soil, "full");
  const rot = E.makeRotation(clim, { crops: ["potato"], pattern: "single" });
  assert.ok(rot);
  const s = E.simulate(wx, soil, rot, { irrigation: "full" }).seasons.find((x) => x.sown && x.ry > 0);
  near(s.yield, (s.potential * s.ry) / 0.2, 0.01);
  assert.ok(s.yield > 15, `fresh yield ${s.yield}`);
});

test("only years with clear views from early to late count as full", () => {
  const year = (y, months) => months.map((m) => ({ date: `${y}-${String(m).padStart(2, "0")}-10`, ndvi: 0.5 }));
  const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const twice = (a) => a.flatMap((m) => [m, m]);
  const series = [...year(2021, twice(all)), ...year(2022, twice(all.slice(0, 10))), ...year(2023, all)];
  assert.deepEqual(E.fullYears(series), ["2021"]); // 2022 stops in October, 2023 has too few readings
});

test("a temperature record that shifts more than real change is flagged", () => {
  const raw = (shift) => {
    const r = syntheticWeather(36, 12);
    r.tmax = r.tmax.map((v, i) => v + (shift * i) / r.tmax.length);
    return E.prepareWeather(r, 10, 300);
  };
  assert.equal(E.temperatureDrift(raw(1)).drifts, false);
  const cooling = E.temperatureDrift(raw(-4));
  assert.equal(cooling.drifts, true);
  assert.ok(cooling.change < -1.5 && cooling.change > -4, `${cooling.change}`);
});

test("every crop has a soil pH range from low to high", () => {
  for (const c of Object.values(E.CROPS)) assert.ok(c.ph && c.ph[2] <= c.ph[0] && c.ph[0] < c.ph[1] && c.ph[1] <= c.ph[3], c.id);
});

test("the TIFF reader reaches tile tables that lie past its first read", async () => {
  const zlib = require("node:zlib");
  const tile = zlib.deflateSync(Buffer.from([...Array(16).keys()].map((x) => x + 10)));
  const file = Buffer.alloc(30000);
  file.write("II", 0, "latin1"); file.writeUInt16LE(42, 2); file.writeUInt32LE(8, 4);
  const tags = [[256, 3, 1, 8], [257, 3, 1, 4], [258, 3, 1, 8], [317, 3, 1, 1], [322, 3, 1, 4], [323, 3, 1, 4], [324, 4, 2, 20000], [325, 4, 2, 20008], [339, 3, 1, 1]];
  file.writeUInt16LE(tags.length, 8);
  tags.forEach(([id, type, n, value], i) => { const at = 10 + i * 12; file.writeUInt16LE(id, at); file.writeUInt16LE(type, at + 2); file.writeUInt32LE(n, at + 4); if (type === 3) file.writeUInt16LE(value, at + 8); else file.writeUInt32LE(value, at + 8); });
  // Two tiles side by side; the table says the second holds the data.
  file.writeUInt32LE(0, 20000); file.writeUInt32LE(25000, 20004);
  file.writeUInt32LE(0, 20008); file.writeUInt32LE(tile.length, 20012);
  tile.copy(file, 25000);
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, opts) => {
    const [from, to] = opts.headers.Range.match(/\d+/g).map(Number);
    asked.push(from);
    return new Response(file.subarray(from, to + 1), { status: 206 });
  };
  try {
    assert.deepEqual(await N.cogPixels("https://example.test/a.tif", "t", 5, 2, 0), [10 + 9]); // column 5 is column 1 of tile 2, row 2
    assert.ok(asked.includes(20004) && asked.includes(20012), `read the tables by range: ${asked}`);
  } finally { globalThis.fetch = realFetch; }
});

test("a cover crop never pushes the second crop of a double crop into the next year", () => {
  const raw = syntheticWeather(12, 30);
  const wx = E.prepareWeather(raw, 10, 300);
  const soil = E.soilFrom(loam);
  const clim = E.analyseClimate(wx, soil);
  const plain = E.makeRotation(clim, { crops: ["cowpea", "sorghum"], pattern: "double" });
  const covered = E.makeRotation(clim, { crops: ["cowpea", "sorghum"], pattern: "double", cover: true });
  assert.ok(plain && covered);
  const count = (rot) => E.simulate(wx, soil, rot, {}).seasons.filter((x) => x.year >= 1986 && x.year <= 1994).length;
  assert.equal(count(covered), count(plain), "same number of crop seasons with and without the cover crop");
  assert.equal(count(plain), 18, "two crop seasons a year");
});
