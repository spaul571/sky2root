/* Sky2Root science core: pure functions, no DOM, runs in the browser and in Node.
 *
 *   wx    = engine.prepareWeather(rawWeather, lat, elev)   daily series with FAO-56 reference ET
 *   soil  = engine.soilFrom({ sand, clay, soc, slope })    hydraulic properties and erosion factors
 *   clim  = engine.analyseClimate(wx, soil, irrigation)    calendar: when each crop fits this place
 *   rot   = engine.makeRotation(clim, { crops, pattern })  crops with sowing windows
 *   run   = engine.simulate(wx, soil, rot, options)        every season, day by day
 *
 * Methods and sources for every number are in docs/METHODS.md.
 */
(function (global) {
  "use strict";
  const S2R = global.S2R || (global.S2R = {});

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const satVP = (T) => 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
  const DAYS_PER_YEAR = 365.25;

  // ------------------------------------------------------------- reference ET
  // FAO-56 Penman-Monteith, daily (Allen et al. 1998, Eq. 6 and Chapter 3).
  function et0FAO(tmax, tmin, ea, u2, rs, z, latRad, doy) {
    const T = (tmax + tmin) / 2;
    const gamma = 0.000665 * 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26);
    const delta = (4098 * satVP(T)) / ((T + 237.3) * (T + 237.3));
    const es = (satVP(tmax) + satVP(tmin)) / 2;
    const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365);
    const dec = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39);
    const ws = Math.acos(clamp(-Math.tan(latRad) * Math.tan(dec), -1, 1));
    const ra = 37.586 * dr * (ws * Math.sin(latRad) * Math.sin(dec) + Math.cos(latRad) * Math.cos(dec) * Math.sin(ws));
    const rso = (0.75 + 2e-5 * z) * ra;
    const cloudiness = rso > 0.5 ? clamp(rs / rso, 0.3, 1) : 0.6; // polar night: FAO-56 falls back on a typical ratio
    const tk4 = (Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2;
    const rnl = 4.903e-9 * tk4 * (0.34 - 0.14 * Math.sqrt(Math.max(ea, 0))) * (1.35 * cloudiness - 0.35);
    const rn = 0.77 * rs - rnl;
    const et = (0.408 * delta * rn + (gamma * 900 * u2 * Math.max(es - ea, 0)) / (T + 273)) / (delta + gamma * (1 + 0.34 * u2));
    return Math.max(0, et);
  }
  // FAO-56 Eq. 47: wind at 10 m to the 2 m grass-reference height. Below 0.5 m/s the
  // equation no longer holds, so FAO-56 limits it there.
  const windTo2m = (u10) => Math.max(0.5, u10 * 0.748);

  // raw: { start: "1984-01-01", tmax, tmin, tdew, wind10, rs, rain } as equal-length arrays.
  // change (optional): { dTmax[12], dTmin[12], rainRatio[12] } for the delta-change climate test.
  function prepareWeather(raw, lat, elev, change) {
    const n = raw.tmax.length;
    const wx = {
      n, start: raw.start, lat, elev, change: change || null,
      tmax: new Float32Array(n), tmin: new Float32Array(n), rain: new Float32Array(n), et0: new Float32Array(n), rs: new Float32Array(n),
      year: raw.year || new Int16Array(n), month: raw.month || new Uint8Array(n), doy: raw.doy || new Int16Array(n),
    };
    const latRad = (lat * Math.PI) / 180;
    if (!raw.year) {
      let t = Date.parse(raw.start + "T00:00:00Z");
      for (let i = 0; i < n; i++, t += 864e5) {
        const d = new Date(t), y = d.getUTCFullYear();
        wx.year[i] = y; wx.month[i] = d.getUTCMonth();
        wx.doy[i] = Math.floor((t - Date.UTC(y, 0, 1)) / 864e5) + 1;
      }
      raw.year = wx.year; raw.month = wx.month; raw.doy = wx.doy; // the same calendar for every climate test
    }
    for (let i = 0; i < n; i++) {
      const m = wx.month[i];
      const dx = change ? change.dTmax[m] : 0, dn = change ? change.dTmin[m] : 0;
      let tx = raw.tmax[i] + dx, tn = raw.tmin[i] + dn;
      if (tn > tx) { const s = tx; tx = tn; tn = s; }
      // Relative humidity is held constant under warming, so vapour pressure rises with saturation.
      const ea = satVP(raw.tdew[i]) * (change ? satVP(tn) / satVP(raw.tmin[i]) : 1);
      wx.tmax[i] = tx; wx.tmin[i] = tn; wx.rs[i] = raw.rs[i];
      wx.rain[i] = raw.rain[i] * (change ? change.rainRatio[m] : 1);
      wx.et0[i] = et0FAO(tx, tn, ea, windTo2m(raw.wind10[i]), raw.rs[i], elev, latRad, wx.doy[i]);
    }
    return wx;
  }

  // --------------------------------------------------------------------- soil
  // Saxton & Rawls (2006) pedotransfer functions; S, C as fractions, OM in percent.
  function saxtonRawls(sandPct, clayPct, omPct) {
    const S = clamp(sandPct, 1, 95) / 100, C = clamp(clayPct, 1, 60) / 100, OM = clamp(omPct, 0, 8);
    const t15 = -0.024 * S + 0.487 * C + 0.006 * OM + 0.005 * S * OM - 0.013 * C * OM + 0.068 * S * C + 0.031;
    const wp = t15 + (0.14 * t15 - 0.02);
    const t33 = -0.251 * S + 0.195 * C + 0.011 * OM + 0.006 * S * OM - 0.027 * C * OM + 0.452 * S * C + 0.299;
    const fc = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
    const ts = 0.278 * S + 0.034 * C + 0.022 * OM - 0.018 * S * OM - 0.027 * C * OM - 0.584 * S * C + 0.078;
    const s33 = ts + (0.636 * ts - 0.107);
    const sat = fc + s33 - 0.097 * S + 0.043;
    const B = (Math.log(1500) - Math.log(33)) / (Math.log(fc) - Math.log(wp));
    const ksat = 1930 * Math.pow(Math.max(sat - fc, 0.001), 3 - 1 / B); // mm/h
    return { wp, fc, sat, ksat };
  }
  // USLE soil erodibility, Williams (1995) EPIC, in t ha h / (ha MJ mm).
  function erodibilityK(sand, silt, clay, orgC) {
    const fsand = 0.2 + 0.3 * Math.exp(-0.256 * sand * (1 - silt / 100));
    const fclsi = Math.pow(silt / (clay + silt + 1e-6), 0.3);
    const forg = 1 - (0.25 * orgC) / (orgC + Math.exp(3.72 - 2.95 * orgC));
    const sn = 1 - sand / 100;
    const fhi = 1 - (0.7 * sn) / (sn + Math.exp(-5.51 + 22.9 * sn));
    return 0.1317 * fsand * fclsi * forg * fhi;
  }
  // RUSLE LS (McCool et al. 1987, 1989); shortcut: slope length is assumed (default 75 m), a farmer's real value would be better.
  function slopeLS(slopePct, lengthM) {
    const th = Math.atan(slopePct / 100), sn = Math.sin(th);
    const S = slopePct < 9 ? 10.8 * sn + 0.03 : 16.8 * sn - 0.5;
    const beta = sn / 0.0896 / (3 * Math.pow(sn, 0.8) + 0.56);
    return Math.pow((lengthM || 75) / 22.13, beta / (1 + beta)) * S;
  }
  // USDA NEH-630 Chapter 9 Table 9-1, hydrologic groups A-D (good condition).
  const CN_TABLE = { bare: [77, 86, 91, 94], residue: [74, 83, 88, 90], row: [67, 78, 85, 89], close: [58, 72, 81, 85] };
  const LAYERS = [0.15, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25]; // metres, 1.9 m in all

  // s: sand and clay in percent, soc in percent. Topsoil values (sandTop, clayTop, socTop) are optional.
  function soilFrom(s) {
    const sand = s.sand, clay = s.clay, silt = Math.max(0, 100 - sand - clay), soc = s.soc;
    const h = saxtonRawls(sand, clay, 1.72 * soc);
    const top = saxtonRawls(s.sandTop != null ? s.sandTop : sand, s.clayTop != null ? s.clayTop : clay, 1.72 * (s.socTop != null ? s.socTop : soc));
    const awc = Math.max(0.03, h.fc - h.wp);
    const cap = LAYERS.map((dz, i) => 1000 * dz * (i === 0 ? Math.max(0.03, top.fc - top.wp) : awc));
    let hsg = h.ksat > 144 ? 0 : h.ksat > 36 ? 1 : h.ksat > 3.6 ? 2 : 3; // NEH-630 Chapter 7 limits, converted to mm/h
    // Texture misjudges two common clays. Low-activity clays (deep tropical red soils, CEC under 24 cmol per kg of clay,
    // the WRB limit) drain far better than their texture says; high-activity shrink-swell clays drain worse.
    const cecClay = s.cec != null && clay > 0 ? (s.cec * 100) / clay : null;
    if (cecClay != null && clay >= 30 && cecClay < 24) hsg = Math.min(hsg, 1);
    if (cecClay != null && clay >= 40 && cecClay > 50) hsg = 3;
    const sandT = s.sandTop != null ? s.sandTop : sand, clayT = s.clayTop != null ? s.clayTop : clay;
    return {
      sand, clay, silt, soc, slope: s.slope != null ? s.slope : 1, source: s.source || "", cec: s.cec != null ? s.cec : null, awc, wp: h.wp, fc: h.fc, ksat: h.ksat, hsg, cap,
      floods: !!s.floods, ph: s.ph != null ? s.ph : null,
      taw1m: awc * 1000,
      tew: Math.max(6, 1000 * (top.fc - 0.5 * top.wp) * 0.1),
      rew: clamp(4 + 0.1 * Math.max(0, 100 - sandT), 3, 11),
      K: erodibilityK(sandT, Math.max(0, 100 - sandT - clayT), clayT, s.socTop != null ? s.socTop : soc),
      LS: slopeLS(s.slope != null ? s.slope : 1, s.slopeLength),
    };
  }
  function textureClass(sand, clay) {
    const silt = 100 - sand - clay;
    if (clay >= 40) return silt >= 40 ? "Silty clay" : sand >= 45 ? "Sandy clay" : "Clay";
    if (clay >= 27) return sand <= 20 ? "Silty clay loam" : sand >= 45 ? "Sandy clay loam" : "Clay loam";
    if (clay >= 20 && sand >= 45) return "Sandy clay loam";
    if (silt >= 80) return "Silt";
    if (silt >= 50) return "Silt loam";
    if (sand >= 85) return "Sand";
    if (sand >= 70) return clay < 15 && sand - clay >= 70 ? "Loamy sand" : "Sandy loam";
    if (sand >= 52) return "Sandy loam";
    return "Loam";
  }

  // -------------------------------------------------------------------- crops
  // Each row: FAO-56 Tables 11 (stages), 17 (Kcb), 22 (root depth); FAO-33 (Ky); AquaCrop v7.3 Annex I
  // (tb, tu, wp, hi, and p and shape for stomatal stress); FAO EcoCrop (topt, tlim: mean temperature ranges); heat limits from Luo (2011) and AquaCrop.
  // gdd is the range of thermal time from short to long varieties, worked out from FAO-56 durations at each
  // region's growing temperature. `est` lists values set by analogy because the sources do not cover them.
  // See docs/METHODS.md.
  const c = (o) => Object.assign({ c4: false, nfix: false, paddy: false, cover: false, close: false, tall: false, sowRain: 20, sowDays: 3, chill: 0, dry: 1, est: "" }, o);
  const CROPS = {
    maize: c({ id: "maize", name: "Maize", family: "Grass", c4: true, tall: true, gdd: [1300, 2300], maxDays: 200, stages: [20, 35, 40, 30], kcb: [0.15, 1.15, 0.5], h: 2, zr: 1.7, p: 0.69, shape: 6, ky: 1.25, kyS: [0.4, 1.5, 0.5, 0.2], tb: 8, tu: 30, wp: 33.7, hi: 0.5, topt: [18, 33], tlim: [10, 47], heat: [35, 45], cold: 10, kill: [-2, 0], tsow: 12, kcal: 365, protein: 9.4, forage: 0.6 }),
    sorghum: c({ id: "sorghum", name: "Sorghum", family: "Grass", c4: true, tall: true, gdd: [1500, 2400], maxDays: 180, stages: [20, 35, 40, 30], kcb: [0.15, 1.0, 0.35], h: 1.5, zr: 2.0, p: 0.75, shape: 3, ky: 0.9, kyS: [0.2, 0.55, 0.45, 0.2], tb: 8, tu: 30, wp: 33.7, hi: 0.45, topt: [22, 35], tlim: [8, 40], heat: [36, 45], cold: 10, kill: [-2, 0], tsow: 15, kcal: 329, protein: 10.6, forage: 0.8 }),
    millet: c({ id: "millet", name: "Pearl millet", family: "Grass", c4: true, tall: true, gdd: [1300, 2200], maxDays: 140, stages: [15, 25, 40, 25], kcb: [0.15, 0.95, 0.2], h: 1.5, zr: 2.0, p: 0.75, shape: 3, ky: 0.9, kyS: [0.2, 0.55, 0.45, 0.2], tb: 10, tu: 30, wp: 33.7, hi: 0.3, topt: [25, 35], tlim: [12, 40], heat: [38, 46], cold: 10, kill: [-2, 0], tsow: 18, kcal: 378, protein: 11, forage: 0.8, est: "Ky, wp, heat" }),
    rice: c({ id: "rice", name: "Rice (paddy)", family: "Grass", paddy: true, close: true, sowRain: 80, sowDays: 7, gdd: [1800, 3200], maxDays: 200, stages: [30, 30, 60, 30], kcb: [1.0, 1.15, 0.6], kcbBio: [0.15, 1.1, 0.5], h: 1, zr: 0.6, p: 0.5, shape: 3, ky: 1.2, kyS: [0.4, 1.4, 0.6, 0.2], tb: 8, tu: 30, wp: 19, hi: 0.43, topt: [20, 35], tlim: [10, 38], heat: [35, 40], cold: 8, kill: [-0.5, 0], tsow: 15, kcal: 245, protein: 4.8, forage: 0.3, est: "Ky" }),
    wheat: c({ id: "wheat", name: "Spring wheat", family: "Grass", close: true, gdd: [1500, 2300], maxDays: 200, stages: [15, 25, 50, 30], kcb: [0.15, 1.1, 0.2], h: 1, zr: 1.5, p: 0.65, shape: 2.5, ky: 1.15, kyS: [0.2, 0.6, 0.5, 0], tb: 0, tu: 26, wp: 15, hi: 0.48, topt: [15, 23], tlim: [5, 27], heat: [31, 40], cold: 5, kill: [-10, -1], tsow: 3, kcal: 340, protein: 11, forage: 0.4 }),
    winterWheat: c({ id: "winterWheat", name: "Winter wheat", family: "Grass", close: true, chill: 30, gdd: [1800, 2600], maxDays: 330, stages: [30, 140, 40, 30], kcb: [0.15, 1.1, 0.2], h: 1, zr: 1.8, p: 0.65, shape: 2.5, ky: 1.05, kyS: [0.2, 0.6, 0.5, 0], tb: 0, tu: 26, wp: 15, hi: 0.48, topt: [15, 23], tlim: [-10, 27], heat: [31, 40], cold: 5, kill: [-18, -1], tsow: 2, kcal: 340, protein: 11, forage: 0.4 }),
    barley: c({ id: "barley", name: "Barley", family: "Grass", close: true, gdd: [1300, 2000], maxDays: 200, stages: [15, 25, 50, 30], kcb: [0.15, 1.1, 0.15], h: 1, zr: 1.5, p: 0.6, shape: 3, ky: 1.15, kyS: [0.2, 0.6, 0.5, 0], tb: 0, tu: 26, wp: 15, hi: 0.45, topt: [15, 20], tlim: [2, 40], heat: [31, 40], cold: 5, kill: [-10, -1], tsow: 3, kcal: 354, protein: 12, forage: 0.6, est: "Ky, tu" }),
    soybean: c({ id: "soybean", name: "Soybean", family: "Legume", nfix: true, gdd: [1700, 2600], maxDays: 180, stages: [20, 30, 60, 25], kcb: [0.15, 1.1, 0.3], h: 0.75, zr: 1.3, p: 0.6, shape: 3, ky: 0.85, kyS: [0.2, 0.8, 1.0, 0], tb: 5, tu: 30, wp: 15, hi: 0.4, topt: [20, 33], tlim: [10, 38], heat: [35, 45], cold: 8, kill: [-1, 0], tsow: 13, kcal: 446, protein: 36, forage: 0.4 }),
    cowpea: c({ id: "cowpea", name: "Cowpea", family: "Legume", nfix: true, gdd: [1000, 1700], maxDays: 130, stages: [20, 30, 30, 20], kcb: [0.15, 1.0, 0.35], h: 0.4, zr: 1.0, p: 0.6, shape: 3, ky: 1.0, kyS: [0.2, 1.0, 0.75, 0.2], tb: 10, tu: 35, wp: 15, hi: 0.35, topt: [20, 35], tlim: [10, 40], heat: [35, 45], cold: 10, kill: [-0.5, 0], tsow: 15, kcal: 336, protein: 23, forage: 0.8, est: "Ky, tb, tu, wp, hi, heat" }),
    bean: c({ id: "bean", name: "Common bean", family: "Legume", nfix: true, gdd: [1100, 1500], maxDays: 140, stages: [20, 30, 40, 20], kcb: [0.15, 1.1, 0.25], h: 0.4, zr: 0.9, p: 0.6, shape: 3, ky: 1.15, kyS: [0.2, 1.1, 0.75, 0.2], tb: 9, tu: 30, wp: 15, hi: 0.4, topt: [16, 25], tlim: [7, 32], heat: [30, 37], cold: 10, kill: [-0.5, 0], tsow: 12, kcal: 333, protein: 24, forage: 0.3 }),
    groundnut: c({ id: "groundnut", name: "Groundnut", family: "Legume", nfix: true, gdd: [1500, 2200], maxDays: 160, stages: [25, 35, 45, 25], kcb: [0.15, 1.1, 0.5], h: 0.4, zr: 1.0, p: 0.6, shape: 3, ky: 0.7, kyS: [0.2, 0.8, 0.6, 0.2], tb: 10, tu: 30, wp: 15, hi: 0.4, topt: [22, 32], tlim: [10, 45], heat: [33, 43], cold: 10, kill: [-0.5, 0], tsow: 16, kcal: 397, protein: 18, forage: 0.7, est: "tb, tu, wp, hi" }),
    chickpea: c({ id: "chickpea", name: "Chickpea", family: "Legume", nfix: true, gdd: [1200, 2000], maxDays: 180, stages: [20, 30, 50, 25], kcb: [0.15, 0.95, 0.25], h: 0.4, zr: 1.0, p: 0.6, shape: 3, ky: 1.0, kyS: [0.2, 1.0, 0.75, 0.2], tb: 4, tu: 30, wp: 15, hi: 0.4, topt: [15, 29], tlim: [7, 35], heat: [30, 37], cold: 5, kill: [-6, -0.5], tsow: 5, kcal: 378, protein: 20, forage: 0.3, est: "Ky, tb, tu, wp, hi, heat, stages" }),
    lentil: c({ id: "lentil", name: "Lentil", family: "Legume", nfix: true, gdd: [1300, 2200], maxDays: 200, stages: [20, 30, 60, 40], kcb: [0.15, 1.05, 0.2], h: 0.5, zr: 0.8, p: 0.6, shape: 3, ky: 1.0, kyS: [0.2, 1.0, 0.75, 0.2], tb: 2, tu: 28, wp: 15, hi: 0.35, topt: [15, 29], tlim: [5, 32], heat: [30, 37], cold: 5, kill: [-6, -0.5], tsow: 5, kcal: 352, protein: 25, forage: 0.3, est: "Ky, tb, tu, wp, hi, heat" }),
    sunflower: c({ id: "sunflower", name: "Sunflower", family: "Daisy", tall: true, gdd: [1700, 2500], maxDays: 170, stages: [25, 35, 45, 25], kcb: [0.15, 1.02, 0.25], h: 2, zr: 1.5, p: 0.6, shape: 2.5, ky: 0.95, kyS: [0.4, 1.0, 0.8, 0], tb: 4, tu: 30, wp: 18, hi: 0.35, topt: [17, 34], tlim: [5, 45], heat: [38, 45], cold: 10, kill: [-2, -0.5], tsow: 8, kcal: 438, protein: 15, forage: 0.2 }),
    sesame: c({ id: "sesame", name: "Sesame", family: "Sesame", gdd: [900, 1400], maxDays: 130, stages: [20, 30, 40, 20], kcb: [0.15, 1.05, 0.2], h: 1, zr: 1.5, p: 0.6, shape: 3, ky: 0.9, tb: 15, tu: 35, wp: 15, hi: 0.25, topt: [20, 30], tlim: [10, 40], heat: [38, 45], cold: 15, kill: [-0.5, 0], tsow: 18, kcal: 573, protein: 18, forage: 0.1, est: "Ky, tb, tu, wp, hi, heat" }),
    mustard: c({ id: "mustard", name: "Mustard / rapeseed", family: "Mustard", close: true, gdd: [1200, 1900], maxDays: 200, stages: [25, 35, 45, 25], kcb: [0.15, 1.02, 0.25], h: 0.8, zr: 1.5, p: 0.6, shape: 3, ky: 0.95, kyS: [0.4, 1.0, 0.8, 0], tb: 2, tu: 28, wp: 18, hi: 0.3, topt: [15, 28], tlim: [7, 40], heat: [30, 37], cold: 5, kill: [-8, -2], tsow: 4, kcal: 508, protein: 20, forage: 0.2, est: "Ky, tb, tu, wp, hi, heat, stages" }),
    potato: c({ id: "potato", name: "Potato", family: "Nightshade", gdd: [1400, 2200], maxDays: 180, stages: [25, 30, 45, 30], kcb: [0.15, 1.1, 0.65], h: 0.6, zr: 0.6, p: 0.6, shape: 3, ky: 1.1, kyS: [0.6, 0, 0.7, 0.2], tb: 2, tu: 26, wp: 19, hi: 0.8, topt: [15, 25], tlim: [7, 30], heat: [27, 34], cold: 5, kill: [-1, -1], tsow: 7, dry: 0.2, kcal: 367, protein: 9, forage: 0.1, est: "heat" }), // dry: AquaCrop's biomass rule gives dry matter and fresh tubers are about 80% water (FAO-33), so farmers' tonnes are five times as many
    coverWarm: c({ id: "coverWarm", name: "Warm-season cover (sunn hemp type)", family: "Legume", nfix: true, cover: true, close: true, days: [45, 120], maxDays: 200, stages: [10, 20, 40, 10], kcb: [0.15, 1.0, 0.5], h: 0.8, zr: 0.9, p: 0.6, shape: 3, ky: 0.9, tb: 10, tu: 35, wp: 15, hi: 0, topt: [20, 30], tlim: [4, 40], heat: [40, 48], cold: 8, kill: [-0.5, 0], tsow: 15, kcal: 0, protein: 0, forage: 0.7, est: "all: generic cover crop" }),
    coverCool: c({ id: "coverCool", name: "Cool-season cover (oat or rye)", family: "Grass", cover: true, close: true, days: [45, 200], maxDays: 330, stages: [15, 30, 40, 10], kcb: [0.15, 1.0, 0.5], h: 0.8, zr: 1.0, p: 0.6, shape: 3, ky: 0.9, tb: 0, tu: 26, wp: 15, hi: 0, topt: [15, 20], tlim: [3, 31], heat: [36, 45], cold: 0, kill: [-18, -5], tsow: 2, kcal: 0, protein: 0, forage: 0.7, est: "all: generic cover crop" }),
  };
  // Soil pH that suits each crop, from FAO EcoCrop: best from, best to, limit low, limit high. Sunn hemp and oat stand for the covers.
  const PH = {
    maize: [5, 7, 4.5, 8.5], sorghum: [5.5, 7.5, 5, 8], millet: [5, 6.5, 4.5, 8.3], rice: [5.5, 7, 4.5, 9], wheat: [6, 7, 5.5, 8.5], winterWheat: [6, 7, 5.5, 8.5], barley: [6.5, 7.5, 6, 8],
    soybean: [5.5, 6.5, 4.5, 8.4], cowpea: [5.5, 7.5, 4, 8.8], bean: [5.5, 7.5, 4, 9], groundnut: [5.5, 6.5, 4.5, 8.5], chickpea: [6, 8.5, 4.7, 9.5], lentil: [5.5, 7.5, 4.5, 8.2],
    sunflower: [6, 7.5, 5.5, 8], sesame: [5.5, 7.5, 4.5, 8], mustard: [5.5, 6.5, 5, 8], potato: [5, 6.2, 4.2, 8.5], coverWarm: [6, 7, 5, 8.4], coverCool: [5, 6, 4.5, 7.5],
  };
  Object.values(CROPS).forEach((cr) => {
    cr.ph = PH[cr.id];
    const total = cr.stages[0] + cr.stages[1] + cr.stages[2] + cr.stages[3];
    cr.g1 = cr.stages[0] / total;
    cr.g2 = cr.g1 + cr.stages[1] / total;
    cr.g3 = cr.g2 + cr.stages[2] / total;
    cr.gFlowerEnd = cr.g2 + (cr.g3 - cr.g2) / 3; // flowering is taken as the first third of mid-season
  });

  // AquaCrop's stomatal stress curve: no stress until depletion reaches p, then a convex fall to zero at wilting point.
  const stressCurve = (rel, p, shape) => {
    const d = (1 - rel - p) / (1 - p);
    if (d <= 0) return 1;
    if (d >= 1) return 0;
    return 1 - (Math.exp(d * shape) - 1) / (Math.exp(shape) - 1);
  };
  const kcbAt = (k, cr, g) => (g < cr.g1 ? k[0] : g < cr.g2 ? k[0] + ((k[1] - k[0]) * (g - cr.g1)) / (cr.g2 - cr.g1) : g < cr.g3 ? k[1] : k[1] + ((k[2] - k[1]) * (g - cr.g3)) / (1 - cr.g3));
  const stageOf = (cr, g) => (g < cr.g2 ? 0 : g < cr.gFlowerEnd ? 1 : g < cr.g3 ? 2 : 3);
  const gdd = (tx, tn, tb, tu) => (clamp(tx, tb, tu) + clamp(tn, tb, tu)) / 2 - tb;
  const KC_MIN = 0.15, KC_MAX = 1.2;
  // Biomass follows the water the canopy transpires. Kcb's floor of 0.15 is moisture lost from the soil beneath, not
  // transpiration; 1.05 is AquaCrop's transpiration coefficient at full cover. Result: T/ET0 as WP* expects it.
  const transpiring = (kcb) => 1.05 * Math.max(0, kcb - KC_MIN);
  const canopy = (kcb, h) => clamp(Math.pow(clamp((kcb - KC_MIN) / (KC_MAX - KC_MIN), 0, 1), 1 + 0.5 * h), 0, 1); // FAO-56 Eq. 76

  // Yield limit from water (FAO-33): the whole-season deficit or the sensitive-stage deficit, whichever is worse.
  function waterFactor(cr, eta, etm, etaS, etmS) {
    let f = etm > 0 ? 1 - cr.ky * (1 - eta / etm) : 1, stage = -1;
    if (cr.kyS) {
      for (let s = 0; s < 4; s++) {
        if (etmS[s] > 0 && cr.kyS[s] > 0) {
          const v = 1 - cr.kyS[s] * (1 - etaS[s] / etmS[s]);
          if (v < f) { f = v; stage = s; }
        }
      }
    }
    return { f: Math.max(0, f), stage };
  }
  // AquaCrop convention: pollination failure rises linearly between two temperatures.
  const heatLoss = (cr, tx) => clamp((tx - cr.heat[0]) / (cr.heat[1] - cr.heat[0]), 0, 1);
  // A well-watered canopy runs cooler than the air by transpiring, a thirsty one does not. 3 C is our working figure;
  // it also offsets part of reanalysis's warm bias over irrigated land.
  const canopyTmax = (tx, ks) => tx - 3 * ks;
  const coldLoss = (cr, tn) => clamp((cr.cold - tn) / 5, 0, 1);

  // FAO EcoCrop's trapezoid: how well a day's mean temperature suits the crop.
  const thermalFit = (cr, tm) => (tm <= cr.tlim[0] || tm >= cr.tlim[1] ? 0 : tm < cr.topt[0] ? (tm - cr.tlim[0]) / (cr.topt[0] - cr.tlim[0]) : tm > cr.topt[1] ? (cr.tlim[1] - tm) / (cr.tlim[1] - cr.topt[1]) : 1);

  // On land that floods, upland crops suffer through weeks of heavy rain; bunded paddy does not. 15 days at 8 mm a day is
  // our working limit, as neither floods nor river levels are simulated. A crop standing in such weather for a third of
  // its season loses half its yield.
  const WET_SPELL_MM = 120;
  const waterlogFactor = (share) => clamp(1 - 1.5 * share, 0, 1);

  const GOOD_AT = 0.8, FAILED_BELOW = 0.5; // FEWS NET / FAO WRSI classes
  const statusOf = (ry) => (ry < FAILED_BELOW ? "fail" : ry < GOOD_AT ? "warn" : "good");

  // ------------------------------------------------------- climate and calendar
  // Mean year for the World Meteorological Organization normal period (or what is available).
  function analyseClimate(wx, soil, irrigation) {
    const N = 365, sum = (k) => new Float64Array(k);
    const rain = sum(N), et0 = sum(N), tx = sum(N), tn = sum(N), count = sum(N), frost = sum(N), frost2 = sum(N);
    let y0 = 1991, y1 = 2020;
    if (wx.year[wx.n - 1] < y1) { y1 = wx.year[wx.n - 1]; y0 = Math.max(wx.year[0], y1 - 29); }
    const nYears = y1 - y0 + 1;
    for (let i = 0; i < wx.n; i++) {
      if (wx.year[i] < y0 || wx.year[i] > y1) continue;
      const d = Math.min(wx.doy[i], 365) - 1;
      rain[d] += wx.rain[i]; et0[d] += wx.et0[i]; tx[d] += wx.tmax[i]; tn[d] += wx.tmin[i]; count[d]++;
      if (wx.tmin[i] <= 0) frost[d]++;
      if (wx.tmin[i] <= -2) frost2[d]++;
    }
    const smooth = (a, w) => {
      const out = new Float64Array(N);
      for (let d = 0; d < N; d++) { let s = 0; for (let k = -w; k <= w; k++) s += a[(d + k + N) % N]; out[d] = s / (2 * w + 1); }
      return out;
    };
    for (let d = 0; d < N; d++) { const k = Math.max(1, count[d]); rain[d] /= k; et0[d] /= k; tx[d] /= k; tn[d] /= k; frost[d] /= k; }
    const clim = { y0, y1, nYears, soil, irrigation: irrigation || "none", rain: smooth(rain, 15), et0: smooth(et0, 15), tmax: smooth(tx, 15), tmin: smooth(tn, 15), frost: smooth(frost, 5), rainRaw: rain, annualRain: rain.reduce((a, b) => a + b, 0), annualEt0: et0.reduce((a, b) => a + b, 0) };
    // FAO agro-ecological growing period: rain at least half of reference ET and warmer than 5 C.
    const wet = new Uint8Array(N);
    for (let d = 0; d < N; d++) wet[d] = clim.rain[d] >= 0.5 * clim.et0[d] && (clim.tmax[d] + clim.tmin[d]) / 2 >= 5 ? 1 : 0;
    clim.growing = periods(wet);
    clim.frostFree = periods(Uint8Array.from(clim.frost, (f) => (f < 0.05 ? 1 : 0)));
    clim.soilWater = climateSoilWater(clim);
    clim.fits = {};
    return clim;
  }
  function periods(flags) {
    const N = flags.length, out = [];
    const total = flags.reduce((a, b) => a + b, 0);
    if (total === N) return [{ start: 0, end: N - 1, days: N }];
    if (total === 0) return [];
    let start = 0;
    while (flags[start] === 1 || flags[(start + N - 1) % N] === 0) start = (start + 1) % N;
    let cur = null;
    for (let k = 0; k < N; k++) {
      const d = (start + k) % N;
      if (flags[d]) { if (!cur) cur = { start: d, end: d, days: 1 }; else { cur.end = d; cur.days = cur.days + 1; } }
      else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    // Join spells split by less than 15 dry days.
    for (let i = out.length - 1; i > 0; i--) {
      const gap = (out[i].start - out[i - 1].end + N) % N;
      if (gap < 15) { out[i - 1].end = out[i].end; out[i - 1].days += out[i].days + gap - 1; out.splice(i, 1); }
    }
    return out.filter((p) => p.days >= 20).sort((a, b) => b.days - a.days);
  }
  // Soil water through the mean year for an empty field, used to judge sowing on stored water.
  function climateSoilWater(clim) {
    const cap = clim.soil.taw1m;
    let s = cap / 2;
    const out = new Float64Array(365);
    for (let lap = 0; lap < 3; lap++) {
      for (let d = 0; d < 365; d++) {
        s = clamp(s + clim.rain[d] * 0.85 - 0.5 * clim.et0[d] * (s / cap), 0, cap);
        out[d] = s;
      }
    }
    return out;
  }

  // How well one variety (thermal time gddReq) fits when sown on a given day of the mean year.
  // Returns relative yield, length in days and potential yield in t/ha, for sowing every 5 days.
  const STEP = 5, SLOTS = 73;
  function fitTable(clim, cr, gddReq, irrigated) {
    const ry = new Float32Array(SLOTS), dur = new Int16Array(SLOTS), pot = new Float32Array(SLOTS);
    for (let k = 0; k < SLOTS; k++) {
      const sow = k * STEP;
      let g = 0, t = 0, s = clim.soilWater[sow] * (cr.zr < 1 ? cr.zr : 1), eta = 0, etm = 0, biom = 0, fit = 0, fitDays = 0, chill = 0;
      const etaS = [0, 0, 0, 0], etmS = [0, 0, 0, 0];
      let heat = 0, cold = 0, flowerDays = 0, killed = false, soaked = 0;
      const taw = clim.soil.taw1m * cr.zr;
      const canSoak = clim.soil.floods && !cr.paddy;
      while (g < 1 && t < cr.maxDays) {
        const d = (sow + t) % 365;
        const et0 = clim.et0[d], tx = clim.tmax[d], tn = clim.tmin[d], tm = (tx + tn) / 2;
        g += gdd(tx, tn, cr.tb, cr.tu) / gddReq;
        const kcb = kcbAt(cr.kcb, cr, g);
        const zrNow = 0.3 + (cr.zr - 0.3) * Math.min(1, g / cr.g2);
        const avail = (s / taw) * (zrNow / cr.zr);
        const ks = cr.paddy ? (clim.rain[d] > 0.9 * et0 + 2 || irrigated ? 1 : 0.5) : stressCurve(Math.min(1, avail), cr.p, cr.shape);
        const pot1 = kcb * et0, tr = (irrigated ? 1 : ks) * pot1;
        const stage = stageOf(cr, g);
        eta += tr; etm += pot1; etaS[stage] += tr; etmS[stage] += pot1;
        biom += transpiring(kcbAt(cr.kcbBio || cr.kcb, cr, g));
        if (stage === 1 || stage === 2) { fit += thermalFit(cr, tm); fitDays++; }
        if (tm < 10) chill++;
        if (canSoak && clim.rain[d] * 15 >= WET_SPELL_MM) soaked++;
        s = clamp(s + clim.rain[d] * 0.85 - tr, 0, taw);
        if (stage === 1) { flowerDays++; heat += heatLoss(cr, canopyTmax(tx + 2, irrigated ? 1 : ks)); cold += coldLoss(cr, tn); } // a mean year hides the hot days, so 2 C is added
        // Mean Tmin hides cold nights: a mean 4 C above the killing point still freezes in some years. Tender crops must
        // avoid any time of year with frost in more than 1 year in 10, from sowing on.
        if (tn - 4 <= (stage === 1 ? cr.kill[1] : cr.kill[0]) || (cr.kill[0] > -4 && clim.frost[d] > 0.1)) killed = true;
        t++;
      }
      const reached = g >= 1 && chill >= cr.chill;
      const wf = waterFactor(cr, eta, etm, etaS, etmS).f;
      const hf = flowerDays ? 1 - heat / flowerDays : 1, cf = flowerDays ? 1 - cold / flowerDays : 1;
      ry[k] = !reached || killed ? 0 : wf * hf * cf * (fitDays ? fit / fitDays : 1) * waterlogFactor(soaked / t);
      dur[k] = t;
      pot[k] = (cr.hi * cr.wp * biom * ry[k]) / 100;
    }
    return { ry, dur, pot, gddReq, crop: cr };
  }
  function varietyAt(clim, cr, gddReq) {
    const key = cr.id + ":" + gddReq;
    return clim.fits[key] || (clim.fits[key] = fitTable(clim, cr, gddReq, clim.irrigation !== "none"));
  }
  // Short and medium varieties. The longest yield more on paper, but in a mean year that hides the dry ones.
  const varieties = (cr) => [cr.gdd[0], Math.round((cr.gdd[0] + cr.gdd[1]) / 2)];
  const energyPerTon = (cr) => cr.kcal * 10; // Mcal per tonne

  // Farmers choose for a dependable yield, not the most that a perfect year could give. The mean year hides dry and hot
  // years, so a variety that only just fits it is marked down heavily.
  const safeScore = (v, k) => v.pot[k] * v.ry[k] * v.ry[k];

  // The medium variety on its best sowing date, unless a shorter or longer one clearly fits better.
  function bestSingle(clim, cr) {
    const [short, mid] = varieties(cr);
    const top = (req) => {
      const v = varietyAt(clim, cr, req);
      let k = 0;
      for (let i = 1; i < SLOTS; i++) if (safeScore(v, i) > safeScore(v, k)) k = i;
      return { v, k, pot: safeScore(v, k) };
    };
    const best = top(mid), other = top(short);
    return other.pot > best.pot * 1.15 ? other : best;
  }
  // Which crops can finish and yield here at all.
  function suitableCrops(clim, allowed) {
    const out = [];
    for (const cr of Object.values(CROPS)) {
      if (cr.cover || (allowed && !allowed.includes(cr.id))) continue;
      const top = bestSingle(clim, cr);
      if (top && top.v.ry[top.k] >= 0.6) out.push({ crop: cr, ry: top.v.ry[top.k], pot: top.v.pot[top.k], sow: top.k * STEP, days: top.v.dur[top.k] });
    }
    return out.sort((a, b) => b.pot * energyPerTon(b.crop) - a.pot * energyPerTon(a.crop));
  }
  // The sowing window around the best day: every neighbouring day that still gives 75% of the best.
  function windowAround(v, k) {
    const top = safeScore(v, k);
    let a = k, b = k, span = 0;
    while (span < 12 && safeScore(v, (a - 1 + SLOTS) % SLOTS) >= 0.75 * top) { a = (a - 1 + SLOTS) % SLOTS; span++; }
    span = 0;
    while (span < 12 && safeScore(v, (b + 1) % SLOTS) >= 0.75 * top) { b = (b + 1) % SLOTS; span++; }
    return { open: a * STEP, close: b * STEP + STEP - 1 };
  }

  // spec: { crops: [a, b?], pattern: "single" | "double" | "alternate", cover: bool }
  // Returns null when the crops cannot fit in this climate.
  function makeRotation(clim, spec) {
    const crops = spec.crops.map((id) => CROPS[id]);
    let slots = null;
    if (spec.pattern === "single" || crops.length === 1) {
      const t = bestSingle(clim, crops[0]);
      if (!t || t.v.ry[t.k] < 0.2) return null;
      slots = [slotFrom(t.v, t.k)];
    } else if (spec.pattern === "alternate") {
      const a = bestSingle(clim, crops[0]), b = bestSingle(clim, crops[1]);
      if (!a || !b || a.v.ry[a.k] < 0.2 || b.v.ry[b.k] < 0.2) return null;
      slots = [slotFrom(a.v, a.k), slotFrom(b.v, b.k)];
    } else {
      slots = bestPair(clim, crops[0], crops[1]);
      if (!slots) return null;
    }
    const rot = {
      id: spec.crops.join(spec.pattern === "alternate" ? "/" : "+") + (spec.cover ? "+cover" : ""),
      crops: spec.crops, pattern: spec.pattern === "single" || crops.length === 1 ? "single" : spec.pattern, cover: !!spec.cover, slots,
    };
    if (spec.cover) addCover(clim, rot);
    rot.name = rotationName(rot);
    return rot;
  }
  function slotFrom(v, k) {
    const w = windowAround(v, k);
    return { crop: v.crop.id, gddReq: v.gddReq, open: w.open, close: w.close, sow: k * STEP, typicalDays: v.dur[k] };
  }
  // Best two crops in one year: they must not overlap, with time to spare, in either order around the year.
  function bestPair(clim, A, B) {
    let top = null;
    const TURNAROUND = 5, SPARE = 15;
    for (const qa of varieties(A)) {
      const va = varietyAt(clim, A, qa);
      for (const qb of varieties(B)) {
        const vb = varietyAt(clim, B, qb);
        for (let i = 0; i < SLOTS; i++) {
          if (va.ry[i] < 0.4) continue;
          const score0 = safeScore(va, i) * energyPerTon(A);
          for (let off = 1; off < SLOTS; off++) {
            const j = (i + off) % SLOTS;
            const gap = off * STEP;
            if (gap < va.dur[i] + TURNAROUND) continue;
            if (365 - gap < vb.dur[j] + TURNAROUND + SPARE) continue;
            if (vb.ry[j] < 0.4) continue;
            const score = score0 + safeScore(vb, j) * energyPerTon(B);
            if (!top || score > top.score) top = { score, va, vb, i, j };
          }
        }
      }
    }
    if (!top) return null;
    const a = slotFrom(top.va, top.i), b = slotFrom(top.vb, top.j);
    // The first crop's window must close in time. The second keeps its own window, so wheat does not go into hot October
    // soil just because the rice is off, but it cannot open before the first crop could be ready.
    a.close = Math.min(a.close, a.sow + 30) % 365;
    const soonest = Math.round(a.typicalDays * 0.75) + 1;
    if ((b.open - a.open + 365) % 365 < soonest) b.open = (a.open + soonest) % 365;
    b.sow = top.j * STEP;
    return [a, b];
  }
  // A cover crop grows from each harvest until shortly before the next sowing, when there is room.
  function addCover(clim, rot) {
    const main = rot.slots;
    const out = [];
    let added = false;
    main.forEach((slot, i) => {
      out.push(slot);
      const next = main[(i + 1) % main.length];
      // Days from this sowing to the next crop's window. In a two-crops-a-year pattern the next crop follows straight on;
      // otherwise a window that seems to open before this crop is off belongs to next year.
      let toNext = (next.open - slot.sow + 365) % 365;
      if (rot.pattern !== "double" && toNext < slot.typicalDays) toNext += 365;
      const gap = toNext - slot.typicalDays - 5 - 7;
      if (gap < 35) return;
      const from = (slot.sow + slot.typicalDays + 5) % 365;
      const mean = (clim.tmax[from] + clim.tmin[from]) / 2;
      const kind = mean < 15 || clim.frost[from] > 0.02 ? CROPS.coverCool : CROPS.coverWarm;
      const days = clamp(gap, kind.days[0], kind.days[1]);
      let req = 0;
      for (let t = 0; t < days; t++) { const d = (from + t) % 365; req += gdd(clim.tmax[d], clim.tmin[d], kind.tb, kind.tu); }
      out.push({ crop: kind.id, gddReq: Math.max(req, 1), days, open: from, close: (from + 25) % 365, sow: from, typicalDays: days, isCover: true });
      added = true;
    });
    rot.slots = out;
    rot.cover = added;
  }
  function rotationName(rot) {
    const names = rot.crops.map((id) => CROPS[id].name);
    const low = names[1] ? names[1].toLowerCase() : "";
    let s = rot.pattern === "single" ? `${names[0]} every year` : rot.pattern === "alternate" ? `${names[0]} one year, ${low} the next` : `${names[0]}, then ${low}`;
    if (rot.slots.some((x) => x.isCover)) s += ", plus a cover crop";
    return s;
  }

  // --------------------------------------------------------------- simulation
  // Annual rain erosivity from Renard & Freimund (1994), shared out over the days in proportion to P^1.81 (Richardson et al. 1983).
  function erosivityOf(wx) {
    const years = (wx.n / DAYS_PER_YEAR);
    let total = 0, weight = 0;
    const w = new Float32Array(wx.n);
    for (let i = 0; i < wx.n; i++) {
      total += wx.rain[i];
      if (wx.rain[i] >= 12.7) { w[i] = Math.pow(wx.rain[i], 1.81); weight += w[i]; } // RUSLE's erosive rain limit
    }
    const P = total / years;
    const R = P < 850 ? 0.0483 * Math.pow(P, 1.61) : 587.8 - 1.219 * P + 0.004105 * P * P;
    const scale = weight > 0 ? (R * years) / weight : 0;
    for (let i = 0; i < wx.n; i++) w[i] *= scale;
    return { daily: w, R };
  }

  function occurrences(wx, rot) {
    const out = [];
    const first = wx.year[0];
    const dayIndex = (y, doy0) => Math.round((Date.UTC(y, 0, 1) + doy0 * 864e5 - Date.parse(wx.start + "T00:00:00Z")) / 864e5);
    let cursor = -1, guard = 0, earliest = -1;
    while (guard++ < 400) {
      for (const slot of rot.slots) {
        let y = cursor < 0 ? first : wx.year[Math.min(cursor, wx.n - 1)];
        let idx = dayIndex(y, slot.open);
        // Wait until the crop before has had most of its usual time: in a two-year rotation that means next year.
        while (idx <= earliest) idx = dayIndex(++y, slot.open);
        if (idx >= wx.n) return out;
        const len = (slot.close - slot.open + 365) % 365;
        out.push({ slot, open: idx, close: idx + len, year: y });
        cursor = idx;
        earliest = idx + Math.round(slot.typicalDays * 0.7);
      }
    }
    return out;
  }

  // options: { irrigation: "none" | "limited" | "full", irrigationCap: mm a year, trace: seasonIndex, residueKept: 0-1, firstYear }
  function simulate(wx, soil, rot, options) {
    const opt = options || {};
    const irrigation = opt.irrigation || "none";
    const irrigationCap = opt.irrigationCap != null ? opt.irrigationCap : 150;
    const residueKept = opt.residueKept != null ? opt.residueKept : 0.5;
    const firstYear = opt.firstYear != null ? opt.firstYear : wx.year[0] + 1;
    const cap = soil.cap, nL = cap.length;
    const w = cap.map((x) => x * 0.5);
    const erosivity = opt.erosivity || erosivityOf(wx);
    const seasons = [];
    const yearly = {};
    const yr = (y) => yearly[y] || (yearly[y] = { et: 0, irrigation: 0, runoff: 0, drain: 0, rain: 0, rootDays: 0, soilLoss: 0, erosive: 0, erosiveBare: 0, energy: 0, residue: 0, forage: 0, n: 0 });
    let De = soil.tew / 2, snow = 0, pond = 0, residue = 0;
    let cur = null, o = 0, earliest = 0, traceDays = null;
    const occ = occurrences(wx, rot);

    function addWater(x) {
      for (let i = 0; i < nL && x > 0; i++) { const f = Math.min(cap[i] - w[i], x); w[i] += f; x -= f; }
      return x;
    }
    function record(season) {
      seasons.push(season);
    }
    function missed(oc, why) {
      if (oc.slot.isCover || wx.year[oc.open] < firstYear) return;
      const cr = CROPS[oc.slot.crop];
      record({ crop: cr.id, year: wx.year[oc.open], slot: rot.slots.indexOf(oc.slot), status: "fail", why, ry: 0, yield: 0, sown: false, sowIdx: oc.open, days: 0, rain: 0, et: 0, hot: 0, stressDays: 0, drySpell: 0, potential: 0 });
    }

    for (let t = 0; t < wx.n; t++) {
      const year = wx.year[t], et0 = wx.et0[t], tx = wx.tmax[t], tn = wx.tmin[t], tm = (tx + tn) / 2;
      let P = wx.rain[t];
      const Y = yr(year);
      Y.rain += P;
      // Snow: stored below freezing, melts at a standard degree-day rate.
      if (tm < 0) { snow += P; P = 0; }
      else if (snow > 0) { const melt = Math.min(snow, 3 * tm); snow -= melt; P += melt; }

      // Sow when the window is open, the soil is warm and there has been a good rain or there is water stored.
      if (!cur) {
        while (o < occ.length && t > occ[o].close) { missed(occ[o], t > earliest + 1 ? "no planting rain" : "previous crop came off too late"); o++; }
        if (o < occ.length && t >= occ[o].open && t >= earliest) {
          const oc = occ[o], cr = CROPS[oc.slot.crop];
          let warm = 0, rainSum = 0;
          for (let k = Math.max(0, t - 4); k <= t; k++) warm += (wx.tmax[k] + wx.tmin[k]) / 2;
          warm /= Math.min(5, t + 1);
          for (let k = Math.max(0, t - cr.sowDays + 1); k <= t; k++) rainSum += wx.rain[k];
          let rain10 = 0;
          for (let k = Math.max(0, t - 9); k <= t; k++) rain10 += wx.rain[k];
          const topWet = (w[0] + w[1]) / (cap[0] + cap[1]);
          const irrigated = irrigation !== "none";
          const wetEnough = irrigated || rainSum >= cr.sowRain || (!cr.paddy && (topWet >= 0.6 || rain10 >= 35));
          const lastCall = t >= oc.close - 1 && !cr.paddy && (topWet >= 0.3 || rain10 >= 10); // a farmer plants at the last chance on any moisture
          const dormantOK = cr.id === "winterWheat" || cr.id === "coverCool"; // these are sown into cooling autumn soil
          if ((warm >= cr.tsow || dormantOK) && (wetEnough || lastCall)) {
            cur = {
              oc, cr, slot: oc.slot, sowIdx: t, g: 0, day: 0, eta: 0, etm: 0, etaS: [0, 0, 0, 0], etmS: [0, 0, 0, 0], biomPot: 0, biomAct: 0,
              heat: 0, cold: 0, flowerDays: 0, hot: 0, stress: 0, rain: 0, et: 0, dry: 0, maxDry: 0, thermal: 0, tmSum: 0, fitDays: 0, soaked: 0, terminateAt: oc.slot.isCover ? t + oc.slot.days : Infinity,
              maxDays: Math.min(cr.maxDays * 1.2, oc.slot.typicalDays * 1.8), irrigationUsed: 0,
            };
            if (opt.trace === seasons.length && !cr.cover) traceDays = [];
            o++;
          }
        }
      }

      // Runoff, by the curve number for what covers the ground today (wetter soil sheds more).
      const crop = cur ? cur.cr : null;
      const g0 = cur ? cur.g : 0;
      const kcb = crop ? kcbAt(crop.kcb, crop, g0) : 0;
      const fc = crop ? canopy(crop.paddy ? kcbAt(crop.kcbBio, crop, g0) : kcb, crop.h) : 0;
      let runoff = 0, drain = 0;
      if (crop && crop.paddy) {
        pond += P;
        if (pond > 150) { runoff = pond - 150; pond = 150; }
      } else {
        const hsg = soil.hsg;
        const ground = CN_TABLE.bare[hsg] + (CN_TABLE.residue[hsg] - CN_TABLE.bare[hsg]) * residue;
        const CN2 = ground + ((crop && crop.close ? CN_TABLE.close[hsg] : CN_TABLE.row[hsg]) - ground) * fc;
        const CN1 = CN2 / (2.281 - 0.01281 * CN2), CN3 = CN2 / (0.427 + 0.00573 * CN2);
        const wet = w[0] / cap[0];
        const S = 25400 / (CN1 + (CN3 - CN1) * wet) - 254;
        if (P > 0.2 * S) runoff = ((P - 0.2 * S) * (P - 0.2 * S)) / (P + 0.8 * S);
        drain += addWater(P - runoff);
        De = Math.max(0, De - (P - runoff));
      }

      // Crop water use.
      let tr = 0, evap = 0, ks = 1, swFrac = 0, tpot = 0, irrigToday = 0;
      if (crop) {
        const zr = 0.3 + (crop.zr - 0.3) * Math.min(1, g0 / crop.g2);
        let aw = 0, taw = 0, z = 0;
        const frac = [];
        for (let i = 0; i < nL; i++) {
          const dz = LAYERS[i], fr = clamp((zr - z) / dz, 0, 1);
          frac.push(fr);
          aw += w[i] * fr; taw += cap[i] * fr; z += dz;
        }
        const p = clamp(crop.p + 0.04 * (5 - et0), 0.1, 0.9); // the threshold moves with the day's demand, as in FAO-56 and AquaCrop
        const dep = taw - aw;
        // Irrigation refills when the crop would start to stress (full), or until the year's allowance runs out (limited).
        if (irrigation !== "none" && !crop.cover) {
          const allowance = irrigation === "full" ? Infinity : irrigationCap - Y.irrigation;
          if (crop.paddy) {
            if (pond < 10 && allowance > 0) { irrigToday = Math.min(50, allowance); pond += irrigToday; }
          } else if (dep > p * taw && allowance > 0) {
            irrigToday = Math.min(dep, allowance);
            aw += irrigToday;
            // Fill from the top, within the root zone.
            let x = irrigToday;
            for (let i = 0; i < nL && x > 0; i++) { if (frac[i] > 0) { const f = Math.min(cap[i] - w[i], x); w[i] += f; x -= f; } }
            drain += addWater(x);
            De = Math.max(0, De - irrigToday);
          }
          Y.irrigation += irrigToday;
        }
        // As in AquaCrop, the wetter of the whole root zone and the topsoil sets the stress: after rain, a crop draws
        // freely from wet topsoil even though the subsoil its roots have reached is still dry.
        const rel = Math.max(taw > 0 ? aw / taw : 0, Math.min(1, (w[0] + w[1]) / (cap[0] + cap[1])));
        ks = crop.paddy && pond > 0 ? 1 : stressCurve(rel, p, crop.shape);
        tpot = kcb * et0;
        tr = Math.min(ks * tpot, crop.paddy ? ks * tpot : aw);
        swFrac = taw > 0 ? clamp(aw / taw, 0, 1) : 0;
        if (crop.paddy) {
          const fromPond = Math.min(pond, tr);
          pond -= fromPond;
          const rest = tr - fromPond;
          if (rest > 0 && aw > 0) { for (let i = 0; i < nL; i++) if (frac[i] > 0) w[i] = Math.max(0, w[i] - (rest * w[i] * frac[i]) / aw); }
          // Puddled soil still leaks a few mm a day, faster on lighter soil.
          const perc = Math.min(pond, clamp(soil.ksat * 0.3, 2, 8));
          pond -= perc;
          drain += addWater(perc);
          swFrac = pond > 0 ? 1 : swFrac;
        } else if (aw > 0) {
          for (let i = 0; i < nL; i++) if (frac[i] > 0) w[i] = Math.max(0, w[i] - (tr * w[i] * frac[i]) / aw);
        }
      } else if (pond > 0) {
        drain += addWater(pond); pond = 0;
      }
      // Soil evaporation (FAO-56 dual coefficient): falls as the topsoil dries, under canopy and under residue.
      if (!(crop && crop.paddy)) {
        const Kr = De <= soil.rew ? 1 : clamp((soil.tew - De) / (soil.tew - soil.rew), 0, 1);
        const Ke = Math.min(Kr * Math.max(KC_MAX - kcb, 0), (1 - fc) * KC_MAX);
        evap = snow > 0 || tm < 0 ? 0 : Math.min(Ke * et0 * (1 - 0.5 * residue), w[0]);
        w[0] -= evap;
        De = Math.min(soil.tew, De + evap);
      }

      // Soil loss: erosive rain by what is covering the soil today (RUSLE canopy and residue subfactors).
      const EI = erosivity.daily[t];
      if (EI > 0) {
        const heightFt = crop ? 3.28 * crop.h * Math.min(1, g0 / crop.g2) * 0.5 : 0;
        const C = (1 - fc * Math.exp(-0.1 * heightFt)) * Math.exp(-0.035 * 100 * residue);
        Y.soilLoss += EI * soil.K * soil.LS * C;
        Y.erosive += EI;
        if (fc < 0.3 && residue < 0.3) Y.erosiveBare += EI;
      }
      residue *= Math.exp(-0.015); // residue breaks down, half gone in about 46 days

      if (opt.soilDaily) opt.soilDaily[t] = (w[0] + w[1] + w[2] + w[3]) / (cap[0] + cap[1] + cap[2] + cap[3]); // top 0.9 m, the depth SMAP L4 calls root zone
      if (opt.etDaily) opt.etDaily[t] = tr + evap;
      Y.et += tr + evap;
      Y.runoff += runoff;
      Y.drain += drain;

      // Crop development.
      if (cur) {
        const g = g0;
        const stage = stageOf(crop, g);
        const eta = tr + evap, etm = tpot + evap;
        cur.eta += eta; cur.etm += etm; cur.etaS[stage] += eta; cur.etmS[stage] += etm;
        cur.biomPot += transpiring(kcbAt(crop.kcbBio || crop.kcb, crop, g));
        cur.biomAct += transpiring(kcbAt(crop.kcbBio || crop.kcb, crop, g)) * ks;
        cur.rain += wx.rain[t]; cur.et += eta; cur.irrigationUsed += irrigToday;
        if (stage === 1 || stage === 2) { cur.thermal += thermalFit(crop, tm); cur.tmSum += tm; cur.fitDays++; }
        if (soil.floods && !crop.paddy) {
          let r15 = 0;
          for (let k = Math.max(0, t - 14); k <= t; k++) r15 += wx.rain[k];
          if (r15 >= WET_SPELL_MM) cur.soaked++;
        }
        if (wx.rain[t] < 1) { cur.dry++; if (cur.dry > cur.maxDry) cur.maxDry = cur.dry; } else cur.dry = 0;
        if (ks < 0.7) cur.stress++;
        if (cur.day > 3) Y.rootDays++;
        if (stage === 1) {
          cur.flowerDays++;
          cur.heat += heatLoss(crop, canopyTmax(tx, ks));
          cur.cold += coldLoss(crop, tn);
          if (canopyTmax(tx, ks) > crop.heat[0]) cur.hot++;
        }
        const killAt = stage === 1 ? crop.kill[1] : crop.kill[0];
        const killed = g > 0.03 && tn <= killAt;
        if (traceDays) traceDays.push({ day: cur.day, rain: wx.rain[t], tmax: tx, tmin: tn, et0, kc: kcb, etc: tr + evap, swFrac, ks, g: g, stage: stage, hot: stage === 1 && canopyTmax(tx, ks) > crop.heat[0], hotSoFar: cur.hot, cloud: clamp(1 - wx.rs[t] / 25, 0, 1) });
        cur.g += gdd(tx, tn, crop.tb, crop.tu) / cur.slot.gddReq;
        cur.day++;
        if (cur.g >= 1 || killed || cur.day >= cur.maxDays || t >= cur.terminateAt) {
          const wf = waterFactor(crop, cur.eta, cur.etm, cur.etaS, cur.etmS);
          const hf = cur.flowerDays ? 1 - cur.heat / cur.flowerDays : 1, cf = cur.flowerDays ? 1 - cur.cold / cur.flowerDays : 1;
          // A killing frost ends the season: grain made so far counts only after flowering.
          const kf = killed ? clamp((cur.g - crop.gFlowerEnd) / (1 - crop.gFlowerEnd), 0, 1) : cur.g >= 1 || crop.cover ? 1 : 0;
          const tf = cur.fitDays ? cur.thermal / cur.fitDays : 1;
          const lf = waterlogFactor(cur.soaked / cur.day);
          const ry = wf.f * hf * cf * kf * tf * lf;
          const potential = (crop.hi * crop.wp * cur.biomPot) / 100;
          const yieldT = potential * ry;
          const biomassT = (crop.wp * cur.biomAct) / 100;
          residue = Math.min(1, residue + (1 - Math.exp(-0.0004 * residueKept * 1000 * Math.max(0, biomassT - yieldT))));
          const harvestYear = wx.year[cur.sowIdx];
          const Yh = yr(harvestYear);
          Yh.residue += Math.max(0, biomassT - yieldT) * residueKept;
          Yh.forage += crop.forage * Math.max(0, biomassT - yieldT);
          if (!crop.cover) {
            let why = "grew well";
            const worst = Math.min(wf.f, hf, cf, kf, tf, lf);
            const status = statusOf(ry);
            if (status !== "good") {
              if (worst === kf) why = "frost";
              else if (worst === lf) why = "waterlogged";
              else if (worst === tf) why = cur.tmSum / (cur.fitDays || 1) > crop.topt[1] ? "too hot for this crop" : "too cold for this crop";
              else if (worst === hf) why = "heat at flowering";
              else if (worst === cf) why = "cold at flowering";
              else why = wf.stage === 1 ? "drought at flowering" : wf.stage === 2 ? "drought during grain filling" : wf.stage === 0 ? "drought early in the season" : "short of water";
            }
            Yh.energy += yieldT * energyPerTon(crop);
            Yh.n++;
            if (harvestYear >= firstYear || wx.year[t] >= firstYear) {
              const s = { crop: crop.id, year: harvestYear, slot: rot.slots.indexOf(cur.slot), status, why, ry, yield: yieldT / crop.dry, potential, sown: true, sowIdx: cur.sowIdx, harvestIdx: t, days: cur.day, rain: Math.round(cur.rain), et: Math.round(cur.et), irrigation: Math.round(cur.irrigationUsed), hot: cur.hot, stressDays: cur.stress, drySpell: cur.maxDry, wf: wf.f, hf, cf, kf, tf, lf };
              if (traceDays) { s.trace = traceDays; traceDays = null; }
              record(s);
            }
          }
          earliest = t + 5;
          cur = null;
        }
      }
    }
    return { rot, seasons, yearly, firstYear };
  }

  // ------------------------------------------------------------------ results
  function summarize(run, soil) {
    const rot = run.rot;
    const seasons = run.seasons.filter((s) => s.year >= run.firstYear);
    const years = Object.keys(run.yearly).map(Number).filter((y) => y >= run.firstYear);
    const ny = years.length || 1;
    const sumY = (k) => years.reduce((a, y) => a + run.yearly[y][k], 0);
    const failed = seasons.filter((s) => s.status === "fail").length;
    const stressed = seasons.filter((s) => s.status === "warn").length;
    const mid = run.firstYear + Math.floor(ny / 2);
    const early = seasons.filter((s) => s.year < mid), recent = seasons.filter((s) => s.year >= mid);
    const rate = (list) => (list.length ? list.filter((s) => s.status === "fail").length / list.length : 0);
    const byCrop = {};
    for (const s of seasons) {
      const b = byCrop[s.crop] || (byCrop[s.crop] = { n: 0, failed: 0, stressed: 0, yield: 0, ry: 0, why: {} });
      b.n++; b.yield += s.yield; b.ry += s.ry;
      if (s.status === "fail") b.failed++;
      if (s.status === "warn") b.stressed++;
      if (s.status !== "good") b.why[s.why] = (b.why[s.why] || 0) + 1;
    }
    for (const b of Object.values(byCrop)) { b.yield /= b.n; b.ry /= b.n; }
    const rootDays = sumY("rootDays") / ny;
    const soilLoss = sumY("soilLoss") / ny;
    const erosive = sumY("erosive") || 1;
    const families = new Set(rot.slots.map((s) => CROPS[s.crop].family)).size;
    const allSlots = rot.slots.length;
    const legumeShare = rot.slots.filter((s) => CROPS[s.crop].nfix).length / allSlots;
    const parts = {
      cover: Math.min(1, rootDays / 365),
      legume: legumeShare,
      variety: Math.min(1, (families - 1) / 2),
      erosion: clamp(1 - Math.log10(1 + soilLoss) / Math.log10(1 + 50), 0, 1), // 0 at 50 t/ha/yr, a heavy loss
    };
    const soilScore = Math.round(100 * (0.3 * parts.cover + 0.25 * parts.legume + 0.2 * parts.variety + 0.25 * parts.erosion));
    const whyAll = {};
    for (const s of seasons) if (s.status === "fail") whyAll[s.why] = (whyAll[s.why] || 0) + 1;
    return {
      years: ny, seasons: seasons.length, failed, stressed, good: seasons.length - failed - stressed,
      reliability: seasons.length ? 100 * (1 - failed / seasons.length) : 0,
      failRateEarly: rate(early), failRateRecent: rate(recent), midYear: mid,
      harvest: sumY("energy") / ny, // Mcal per hectare per year
      et: sumY("et") / ny, irrigation: sumY("irrigation") / ny, water: sumY("irrigation") > 0 ? (sumY("irrigation") + 0.2 * sumY("et")) / ny : sumY("et") / ny, runoff: sumY("runoff") / ny, drain: sumY("drain") / ny, rain: sumY("rain") / ny,
      rootDays, bareDays: 365 - rootDays, soilLoss, erosiveBareShare: sumY("erosiveBare") / erosive,
      legumeShare, families, soilParts: parts, soil: soilScore, residue: sumY("residue") / ny,
      forage: sumY("forage") / ny, byCrop, failReasons: whyAll,
    };
  }

  // What the harvest might sell for in a year, per hectare, before costs. The simulation's yields assume good management, which
  // most farms cannot afford, so each season earns its relative yield x the best national yield of recent years x the farm-gate price.
  const marketCrop = (id) => (id === "winterWheat" ? "wheat" : id); // FAOSTAT does not separate them
  const farmYield = (id, market) => market.yield[marketCrop(id)] || market.world.yield[marketCrop(id)];
  const farmPrice = (id, market) => market.price[marketCrop(id)] || market.priceEst[marketCrop(id)] || market.world.price[marketCrop(id)];
  function harvestValue(m, market) {
    if (!market) return null;
    let value = 0;
    for (const [id, b] of Object.entries(m.byCrop)) value += (b.n / m.years) * b.ry * farmYield(id, market)[1] * farmPrice(id, market);
    return value;
  }

  // Sets the priorities of the farmer against every option, each measure scaled across the options.
  function rank(items, w) {
    const spec = { rel: ["reliability", 1], harv: ["harvest", 1], money: ["income", 1], water: ["water", 0], soil: ["soil", 1], forage: ["forage", 1] };
    const norm = {};
    for (const [k, [f, hi]] of Object.entries(spec)) {
      const v = items.map((x) => x.m[f] || 0), lo = Math.min(...v), up = Math.max(...v);
      norm[k] = (x) => (up === lo ? 1 : hi ? ((x.m[f] || 0) - lo) / (up - lo) : (up - (x.m[f] || 0)) / (up - lo));
    }
    const tot = Object.keys(spec).reduce((a, k) => a + (w[k] || 0), 0);
    const scored = items.map((x) => {
      const parts = {};
      let s = 0;
      for (const k of Object.keys(spec)) { parts[k] = norm[k](x); s += (w[k] || 0) * parts[k]; }
      return Object.assign({}, x, { score: tot ? (100 * s) / tot : 0, parts });
    });
    return scored.sort((p, q) => q.score - p.score);
  }

  // All the rotations worth comparing here: single crops, two-year alternations, two crops in a year,
  // each with and without a cover crop, in different plant families so that pest cycles are broken.
  function candidates(clim, allowed, current) {
    const fit = suitableCrops(clim, allowed);
    const main = fit.slice(0, 12);
    const specs = [];
    for (const a of main) specs.push({ crops: [a.crop.id], pattern: "single" });
    for (let i = 0; i < main.length; i++) {
      for (let j = 0; j < main.length; j++) {
        if (i === j || main[i].crop.family === main[j].crop.family) continue;
        if (i < j) specs.push({ crops: [main[i].crop.id, main[j].crop.id], pattern: "alternate" });
        specs.push({ crops: [main[i].crop.id, main[j].crop.id], pattern: "double" });
      }
    }
    const out = [], seen = new Set();
    const push = (spec, isCurrent) => {
      const rot = makeRotation(clim, spec);
      if (!rot || seen.has(rot.id)) return;
      seen.add(rot.id);
      rot.isCurrent = !!isCurrent;
      out.push(rot);
    };
    if (current) push(current, true);
    for (const spec of specs) {
      push(spec);
      push(Object.assign({}, spec, { cover: true }));
    }
    return { rotations: out, suitable: fit };
  }

  // ------------------------------------------------------------------- trends
  // Theil-Sen slope and Mann-Kendall significance (normal approximation), robust for short noisy series.
  function trend(ys, xs) {
    const n = ys.length;
    const X = xs || ys.map((_, i) => i);
    const slopes = [];
    let S = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dy = ys[j] - ys[i];
        S += Math.sign(dy);
        if (X[j] !== X[i]) slopes.push(dy / (X[j] - X[i]));
      }
    }
    slopes.sort((a, b) => a - b);
    const slope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
    const v = (n * (n - 1) * (2 * n + 5)) / 18;
    const z = S === 0 ? 0 : (S - Math.sign(S)) / Math.sqrt(v);
    return { slope, z, p: 2 * (1 - normalCdf(Math.abs(z))) };
  }
  function normalCdf(z) {
    // Abramowitz & Stegun 26.2.17
    const t = 1 / (1 + 0.2316419 * z);
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    return 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  }
  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // Season climate per year, for the longest growing period: rain onset, dry spells, hot days and season rain.
  // MERRA-2's land drifts with its own rain (docs/VALIDATION.md, check 9): at Bogura the mean daily high falls 2.9 C between
  // 1985-94 and 2015-25 as its rain doubles, and at Sorriso it rises 2.3 C as its rain falls. Real change is far smaller, so a
  // shift past this limit says the record cannot show a temperature trend here. Season results move little, as check 9 shows.
  const DRIFT_LIMIT = 1.5;
  function temperatureDrift(wx) {
    const mean = (y0, y1) => { let s = 0, n = 0; for (let i = 0; i < wx.n; i++) if (wx.year[i] >= y0 && wx.year[i] <= y1) { s += wx.tmax[i]; n++; } return n ? s / n : null; };
    const y1 = wx.year[wx.n - 1], first = mean(wx.year[0] + 1, wx.year[0] + 10), last = mean(y1 - 10, y1);
    if (first == null || last == null || y1 - wx.year[0] < 25) return { change: 0, drifts: false };
    return { change: last - first, drifts: Math.abs(last - first) > DRIFT_LIMIT };
  }
  function climateTrends(wx, clim) {
    const period = clim.growing[0];
    const year0 = wx.year[0] + 1, year1 = wx.year[wx.n - 1];
    const years = [], onset = [], rainTotal = [], drySpell = [], hot = [], frosts = [], heavy = [];
    if (!period) return null;
    for (let y = year0; y <= year1; y++) {
      const t0 = Math.round((Date.UTC(y, 0, 1) - Date.parse(wx.start + "T00:00:00Z")) / 864e5) + period.start;
      const len = Math.max(30, period.days);
      if (t0 + len >= wx.n) break;
      let on = -1, total = 0, spell = 0, maxSpell = 0, hotDays = 0;
      for (let t = Math.max(3, t0 - 45); t < t0 + Math.min(len, 90); t++) {
        if (on < 0 && wx.rain[t] + wx.rain[t - 1] + wx.rain[t - 2] >= 20) on = t - t0;
      }
      for (let t = t0; t < t0 + len; t++) {
        total += wx.rain[t];
        if (wx.rain[t] < 1) { spell++; maxSpell = Math.max(maxSpell, spell); } else spell = 0;
        if (wx.tmax[t] >= 35) hotDays++;
      }
      let frost = 0, downpour = 0;
      for (let t = t0; t < t0 + 365 && t < wx.n; t++) { if (wx.tmin[t] <= 0) frost++; if (wx.rain[t] >= 50) downpour++; }
      years.push(y); onset.push(on < 0 ? Math.min(len, 90) : on); rainTotal.push(total); drySpell.push(maxSpell); hot.push(hotDays); frosts.push(frost); heavy.push(downpour);
    }
    // Rain-based trends use the satellite years only: a trend across the change of rain source would mean nothing.
    const mk = (name, unit, ys, what, rainBased) => {
      const from = rainBased ? years.findIndex((y) => y >= 1998) : 0;
      const yy = ys.slice(from), xx = years.slice(from);
      const tr = trend(yy, xx);
      return { name, unit, what, series: ys, from: xx[0], perDecade: tr.slope * 10, p: tr.p, significant: tr.p < 0.05, mean: yy.reduce((a, b) => a + b, 0) / (yy.length || 1) };
    };
    const drift = temperatureDrift(wx);
    return {
      years, periodStart: period.start, periodDays: period.days, drift,
      items: [
        mk("Start of the rains", "days", onset, "Days after the usual start of the growing period when 20 mm first falls in 3 days. Later means a later start.", true),
        mk("Rain in the growing period", "mm", rainTotal, "Total rain in the usual growing period.", true),
        mk("Longest dry spell", "days", drySpell, "Longest run of days with under 1 mm of rain in the growing period.", true),
        Object.assign(mk("Hot days", "days", hot, "Days of 35 C or more in the growing period."), { drifts: drift.drifts }),
        Object.assign(mk("Frost days", "days", frosts, "Days at 0 C or below in the year."), { drifts: drift.drifts }),
        mk("Downpours", "days", heavy, "Days with 50 mm of rain or more in the year.", true),
      ],
    };
  }

  // ------------------------------------------------------------- El Nino, La Nina
  // NOAA's rule: the index, rounded to 0.1, at +0.5 or -0.5 or beyond for at least five overlapping seasons running.
  const ENSO_LIMIT = 0.45; // what rounds to 0.5
  function ensoPhases(v) {
    const phase = new Int8Array(v.length);
    for (const sign of [1, -1]) {
      for (let i = 0; i < v.length; i++) {
        if (sign * v[i] < ENSO_LIMIT) continue;
        let end = i;
        while (end < v.length && sign * v[end] >= ENSO_LIMIT) end++;
        if (end - i >= 5) phase.fill(sign, i, end);
        i = end;
      }
    }
    return phase;
  }
  // Each season, by what the Pacific was doing at its middle. enso: { first, phase }, one value per month from January of first.
  function ensoSplit(run, wx, enso) {
    const t0 = Date.parse(wx.start + "T00:00:00Z");
    const out = { nino: { n: 0, failed: 0, rain: 0, sown: 0 }, nina: { n: 0, failed: 0, rain: 0, sown: 0 }, neutral: { n: 0, failed: 0, rain: 0, sown: 0 } };
    for (const s of run.seasons) {
      if (s.year < run.firstYear) continue;
      const mid = new Date(t0 + (s.sowIdx + s.days / 2) * 864e5);
      const ph = enso.phase[(mid.getUTCFullYear() - enso.first) * 12 + mid.getUTCMonth()] || 0;
      const box = out[ph > 0 ? "nino" : ph < 0 ? "nina" : "neutral"];
      box.n++;
      if (s.status === "fail") box.failed++;
      if (s.sown) { box.sown++; box.rain += s.rain; }
    }
    for (const b of Object.values(out)) b.rain = b.sown ? b.rain / b.sown : null;
    return out;
  }

  // Years with enough clear greenness to count: most of the 16-day steps, from early in the year to late.
  function fullYears(series) {
    const by = {};
    for (const p of series) (by[p.date.slice(0, 4)] = by[p.date.slice(0, 4)] || []).push(p.date);
    return Object.keys(by).filter((y) => by[y].length >= 14 && by[y][0].slice(5, 7) <= "02" && by[y][by[y].length - 1].slice(5, 7) >= "11");
  }

  // Satellite greenness: how long the field lies bare, and how many crops it carries a year.
  function analyseNdvi(series) {
    // series: [{ date, ndvi }] at 16-day steps. Median of three removes single cloudy composites.
    const v = series.map((p, i) => {
      const a = series[Math.max(0, i - 1)].ndvi, b = p.ndvi, c2 = series[Math.min(series.length - 1, i + 1)].ndvi;
      return a + b + c2 - Math.min(a, b, c2) - Math.max(a, b, c2);
    });
    const sorted = v.slice().sort((a, b) => a - b);
    const q = (f) => sorted[Math.floor(f * (sorted.length - 1))];
    const lo = q(0.05), hi = q(0.95);
    // Bare soil looks different from place to place, so the limit sits between this field's own low and high.
    const threshold = clamp(lo + 0.35 * (hi - lo), 0.2, 0.45);
    const perYear = {}, peaks = {};
    series.forEach((p, i) => {
      const y = p.date.slice(0, 4);
      if (!perYear[y]) { perYear[y] = 0; peaks[y] = 0; }
      if (v[i] < threshold) perYear[y] += 16;
      const before = v[i - 1], after = v[i + 1];
      if (before != null && after != null && v[i] >= before && v[i] > after && v[i] > threshold + 0.1) peaks[y]++;
    });
    const years = Object.keys(perYear).filter((y) => perYear[y] != null);
    // What the farm does now, not 20 years ago: the last 5 complete years.
    const full = fullYears(series).filter((y) => years.includes(y)).slice(-5);
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    return {
      threshold, smooth: v, low: lo, high: hi, perYear, peaks,
      bareDays: avg(full.map((y) => perYear[y])),
      cropsPerYear: avg(full.map((y) => peaks[y])),
    };
  }

  // A second opinion on each season, from data alone: how its peak greenness compares with other seasons of that crop.
  // Comparing it with the simulation shows where the two methods agree, and where local knowledge has to decide.
  function greennessCheck(wx, run, ndvi) {
    const startMs = Date.parse(wx.start + "T00:00:00Z");
    const pts = ndvi.map((p) => ({ i: Math.round((Date.parse(p.date + "T00:00:00Z") - startMs) / 864e5), v: p.ndvi }));
    const byCrop = {};
    for (const s of run.seasons) {
      if (!s.sown || s.harvestIdx == null) continue;
      const inside = pts.filter((p) => p.i >= s.sowIdx && p.i <= s.harvestIdx);
      if (inside.length < 3) continue;
      (byCrop[s.crop] = byCrop[s.crop] || []).push({ s, peak: Math.max(...inside.map((p) => p.v)) });
    }
    const rows = [];
    for (const [crop, list] of Object.entries(byCrop)) {
      if (list.length < 8) continue;
      const m = list.reduce((a, x) => a + x.peak, 0) / list.length;
      const sd = Math.sqrt(list.reduce((a, x) => a + (x.peak - m) ** 2, 0) / list.length) || 1;
      list.forEach((x) => rows.push({ crop, year: x.s.year, status: x.s.status, ry: x.s.ry, why: x.s.why, peak: x.peak, z: (x.peak - m) / sd }));
    }
    if (rows.length < 8) return null;
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y.z, 0) / a.length : null);
    const good = rows.filter((r) => r.status === "good"), bad = rows.filter((r) => r.status !== "good");
    // Pale in a season the simulation called good, or green in one it called failed.
    const disagree = rows.filter((r) => (r.status === "good" && r.z < -1.2) || (r.status === "fail" && r.z > 0.5)).sort((a, b) => b.year - a.year);
    return { n: rows.length, r: pearson(rows.map((x) => x.ry), rows.map((x) => x.z)), zGood: mean(good), zBad: mean(bad), nBad: bad.length, disagree };
  }

  // HLS dates are irregular: keep the greenest clear reading in each 16-day step (as MODIS composites do) and fill short gaps.
  function compositeNdvi(points) {
    if (!points.length) return [];
    const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date);
    const step = 16 * 864e5, n = Math.floor((t1 - t0) / step) + 1;
    const v = new Array(n).fill(null);
    for (const p of points) { const k = Math.floor((Date.parse(p.date) - t0) / step); if (v[k] == null || p.ndvi > v[k]) v[k] = p.ndvi; }
    const out = [];
    let last = -1;
    for (let k = 0; k < n; k++) {
      let value = v[k];
      if (value == null) { // a linear fill across at most about three months of cloud
        let next = k + 1;
        while (next < n && v[next] == null) next++;
        if (last >= 0 && next < n && next - last <= 6) value = v[last] + ((v[next] - v[last]) * (k - last)) / (next - last);
      } else last = k;
      if (value != null) out.push({ date: new Date(t0 + k * step).toISOString().slice(0, 10), ndvi: value });
    }
    return out;
  }

  S2R.engine = {
    CROPS, LAYERS, CN_TABLE, GOOD_AT, FAILED_BELOW,
    et0FAO, windTo2m, satVP, prepareWeather, saxtonRawls, erodibilityK, slopeLS, soilFrom, textureClass,
    analyseClimate, suitableCrops, makeRotation, candidates, simulate, summarize, rank, erosivityOf,
    trend, pearson, climateTrends, analyseNdvi, compositeNdvi, greennessCheck, bestSingle, varietyAt, periods, thermalFit, varieties,
    temperatureDrift, harvestValue, farmYield, farmPrice, marketCrop, ENSO_LIMIT, ensoPhases, ensoSplit, fullYears,
  };
})(typeof window !== "undefined" ? window : globalThis);
