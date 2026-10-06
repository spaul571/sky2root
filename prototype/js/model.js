/* Sky2Root concept prototype: shared data model.
 *
 * Used by every screen of the prototype app (index.html).
 *
 * Everything here is ILLUSTRATIVE: a fixed, seeded example farm with two rainy
 * seasons a year, 1985-2024. The real tool would drive the same steps with
 * NASA POWER, GPM IMERG, SMAP and NEX-GDDP-CMIP6 data for the farmer's field.
 */
(function (global) {
  "use strict";
  const S2R = global.S2R || (global.S2R = {});

  // ---------------------------------------------------------------- helpers
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(...parts) {
    let h = 2166136261;
    for (const p of parts) { h ^= p | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
    return h >>> 0;
  }

  // ------------------------------------------------- season climate (1985-2024)
  // One rain index and one heat index per season, from a fixed seed.
  const FIRST_YEAR = 1985, LAST_YEAR = 2024;
  const CLIMATE = (function () {
    const r = mulberry32(19);
    const g = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const out = [];
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
      for (let k = 0; k < 2; k++) {
        const rain = g() * 0.9 - Math.max(0, y - 1995) * 0.016 - (k ? 0.25 : 0);
        const heat = g() * 0.7 + (y - 1985) * 0.028 + (k ? 0.15 : 0);
        out.push({ y, k, rain, heat });
      }
    }
    return out;
  })();
  // The 2050 what-if: the same seasons, warmer and drier (a delta-method stand-in
  // for NEX-GDDP-CMIP6 projections).
  const FUTURE = { rain: -0.35, heat: 0.9 };
  const SEASONS = ["Main season", "Second season"];
  const SOW = [{ month: 2, day: 15 }, { month: 9, day: 10 }]; // 15 Mar and 10 Oct

  // ------------------------------------------------------------------- crops
  // rf/rs: rain index below which the crop fails / is stressed; hf/hs: heat index
  // above which it fails / is stressed. kc: crop coefficient at start, peak, end.
  const CROPS = {
    maize:   { id: "maize", name: "Maize", rf: -1.15, rs: -0.5, hf: 1.95, hs: 1.25, pot: 1.0, days: 120, kc: [0.3, 1.2, 0.6], taw: 140, heatT: 35, tall: true, legume: false, family: "Grass" },
    sorghum: { id: "sorghum", name: "Sorghum", rf: -1.75, rs: -1.0, hf: 2.7, hs: 1.9, pot: 0.68, days: 115, kc: [0.3, 1.05, 0.55], taw: 190, heatT: 38, tall: true, legume: false, family: "Grass" },
    cowpea:  { id: "cowpea", name: "Cowpea", rf: -1.5, rs: -0.8, hf: 2.4, hs: 1.65, pot: 0.62, days: 85, kc: [0.4, 1.05, 0.6], taw: 110, heatT: 36, tall: false, legume: true, family: "Legume" },
    bean:    { id: "bean", name: "Common bean", rf: -1.25, rs: -0.6, hf: 1.75, hs: 1.05, pot: 0.66, days: 90, kc: [0.4, 1.15, 0.35], taw: 85, heatT: 32, tall: false, legume: true, family: "Legume" },
  };

  // --------------------------------------------------------------- rotations
  const ROTS = {
    a: { id: "a", letter: "A", name: "Maize, then maize", short: "Maize, then maize", current: true, seq: ["maize", "maize"], color: "#8a8f88",
         soil: { cover: 190, legumes: 0, families: 1, erosion: 0.25, erosionLabel: "High" }, water: 830 },
    b: { id: "b", letter: "B", name: "Maize, then cowpea", short: "Maize, then cowpea", seq: ["maize", "cowpea"], color: "#2a78d6",
         soil: { cover: 212, legumes: 1, families: 2, erosion: 0.45, erosionLabel: "Medium" }, water: 700 },
    c: { id: "c", letter: "C", name: "Sorghum, then cowpea", short: "Sorghum, then cowpea", seq: ["sorghum", "cowpea"], color: "#eb6834",
         soil: { cover: 205, legumes: 1, families: 2, erosion: 0.45, erosionLabel: "Medium" }, water: 620 },
    d: { id: "d", letter: "D", name: "Maize, then bean, plus a dry-season cover crop", short: "Maize, bean + cover crop", seq: ["maize", "bean"], color: "#1baf7a",
         soil: { cover: 314, legumes: 1, families: 3, erosion: 0.75, erosionLabel: "Low" }, water: 770 },
  };

  const climateFor = (c, period) => (period === "future" ? { rain: c.rain + FUTURE.rain, heat: c.heat + FUTURE.heat } : { rain: c.rain, heat: c.heat });
  const climateAt = (year, k) => CLIMATE[(year - FIRST_YEAR) * 2 + k];

  function outcome(crop, c, period) {
    const k = climateFor(c, period);
    if (k.rain < crop.rf) return { st: "fail", why: "too dry" };
    if (k.heat > crop.hf) return { st: "fail", why: "too hot at flowering" };
    if (k.rain < crop.rs) return { st: "warn", why: "short of water" };
    if (k.heat > crop.hs) return { st: "warn", why: "heat at flowering" };
    return { st: "good", why: "grew well" };
  }

  function soilParts(rot) {
    const s = rot.soil;
    return { cover: s.cover / 365, legume: s.legumes / 2, variety: Math.min(1, (s.families - 1) / 2), erosion: s.erosion };
  }
  function soilScore(rot) {
    const p = soilParts(rot);
    return Math.round(100 * (0.3 * p.cover + 0.25 * p.legume + 0.2 * p.variety + 0.25 * p.erosion));
  }

  const FACTOR = { good: 1, warn: 0.6, fail: 0 };
  const metricsCache = {};
  function metrics(id, period) {
    const key = id + ":" + period;
    if (metricsCache[key]) return metricsCache[key];
    const rot = ROTS[id];
    let failed = 0, stressed = 0, recentFailed = 0, harv = 0;
    const cells = CLIMATE.map((c) => {
      const crop = CROPS[rot.seq[c.k]];
      const o = outcome(crop, c, period);
      if (o.st === "fail") { failed++; if (c.y >= 2005) recentFailed++; }
      if (o.st === "warn") stressed++;
      harv += crop.pot * FACTOR[o.st];
      return { year: c.y, k: c.k, crop: crop.id, st: o.st, why: o.why };
    });
    return (metricsCache[key] = {
      cells, failed, stressed, recentFailed,
      reliability: 100 * (1 - failed / cells.length),
      harvest: 100 * harv / cells.length,
      water: rot.water, soil: soilScore(rot),
    });
  }

  function ranking(w, period) {
    const ms = Object.keys(ROTS).map((id) => ({ id, rot: ROTS[id], m: metrics(id, period) }));
    const spec = { rel: ["reliability", 1], harv: ["harvest", 1], water: ["water", 0], soil: ["soil", 1] };
    const norm = {};
    for (const [k, [f, hi]] of Object.entries(spec)) {
      const v = ms.map((x) => x.m[f]), lo = Math.min(...v), up = Math.max(...v);
      norm[k] = (x) => (up === lo ? 1 : hi ? (x.m[f] - lo) / (up - lo) : (up - x.m[f]) / (up - lo));
    }
    const tot = (w.rel || 0) + (w.harv || 0) + (w.water || 0) + (w.soil || 0);
    ms.forEach((x) => { x.score = tot === 0 ? 0 : 100 * ((w.rel || 0) * norm.rel(x) + (w.harv || 0) * norm.harv(x) + (w.water || 0) * norm.water(x) + (w.soil || 0) * norm.soil(x)) / tot; });
    return ms.sort((p, q) => q.score - p.score);
  }

  // ------------------------------------------------ one season, day by day
  // Daily weather depends only on the season (and the 2050 switch), so every crop
  // planted that season sees the same rain and heat. The crop then runs a simple
  // FAO-56-style soil water bucket. The final label comes from outcome(), the
  // same rule the 40-year report card uses.
  const WEATHER_DAYS = 125;
  function weather(year, k, period) {
    const c = climateAt(year, k), kf = climateFor(c, period);
    const r = mulberry32(hash(year, k, period === "future" ? 2050 : 1));
    const R = kf.rain, H = kf.heat;
    const pRain = clamp(0.33 + 0.07 * R - (k ? 0.03 : 0), 0.12, 0.55);
    const mean = clamp(11 + 2.4 * R, 5, 18);
    const drySpell = Math.round(clamp(5 - 9 * R, 0, 34));
    const dryStart = 34 + Math.floor(r() * 8);
    const hotDays = Math.round(clamp((H - 0.45) * 3.2, 0, 10));
    const hotStart = 44 + Math.floor(r() * 6);
    const days = [];
    for (let d = 0; d < WEATHER_DAYS; d++) {
      let rain = 0;
      if (d === 0) rain = 22 + r() * 10; // the first good rain that triggers sowing
      else if (d >= dryStart && d < dryStart + drySpell) rain = 0;
      else if (r() < pRain) rain = -Math.log(1 - r()) * mean;
      let tmax = 29 + 1.6 * H + 2 * Math.sin((d / WEATHER_DAYS) * Math.PI) + (r() - 0.5) * 3;
      if (d >= hotStart && d < hotStart + hotDays * 2 && (d - hotStart) % 2 === 0) tmax = Math.max(tmax, 35.6 + r() * 3.2);
      const cloud = rain > 0 ? clamp(0.55 + rain / 40, 0, 1) : r() * 0.35;
      days.push({ rain: Math.round(rain * 10) / 10, tmax: Math.round(tmax * 10) / 10, cloud });
    }
    return { days, drySpell, hotDays, R, H };
  }

  function sowDate(year, k) {
    const s = SOW[k];
    return new Date(Date.UTC(year, s.month, s.day));
  }

  const STAGES = [
    { id: "sow", name: "Sowing", from: 0 },
    { id: "veg", name: "Growing", from: 0.08 },
    { id: "flower", name: "Flowering", from: 0.42 },
    { id: "grain", name: "Filling grain", from: 0.58 },
    { id: "harvest", name: "Harvest", from: 0.92 },
  ];
  const stageAt = (g) => STAGES.reduce((cur, s) => (g >= s.from ? s : cur), STAGES[0]);

  const seasonCache = {};
  function season(year, k, rotId, period) {
    const key = [year, k, rotId, period].join(":");
    if (seasonCache[key]) return seasonCache[key];
    const rot = ROTS[rotId], crop = CROPS[rot.seq[k]];
    const wx = weather(year, k, period);
    const N = crop.days, taw = crop.taw;
    const flowerStart = Math.round(N * 0.42), flowerEnd = Math.round(N * 0.58);
    let sw = 0.55 * taw;
    let stressDays = 0, hot = 0, rainTotal = 0;
    const daily = [];
    for (let d = 0; d <= N; d++) {
      const w = wx.days[Math.min(d, wx.days.length - 1)];
      const g = d / N;
      const kc = g < 0.15 ? crop.kc[0] : g < 0.45 ? crop.kc[0] + (crop.kc[1] - crop.kc[0]) * (g - 0.15) / 0.3 : g < 0.75 ? crop.kc[1] : crop.kc[1] + (crop.kc[2] - crop.kc[1]) * (g - 0.75) / 0.25;
      const et0 = clamp(3.4 + 0.16 * (w.tmax - 29) - 1.2 * w.cloud, 1.5, 7);
      const ks = sw > 0.5 * taw ? 1 : sw / (0.5 * taw);
      const etc = kc * et0 * ks;
      const rainIn = w.rain > 35 ? w.rain * 0.8 : w.rain;
      sw = clamp(sw + rainIn - etc, 0, taw);
      const isHot = d >= flowerStart && d <= flowerEnd && w.tmax > crop.heatT;
      if (isHot) hot++;
      if (ks < 0.7) stressDays++;
      rainTotal += w.rain;
      daily.push({ day: d, rain: w.rain, tmax: w.tmax, cloud: w.cloud, et0, kc, etc, sw, swFrac: sw / taw, ks, g, stage: stageAt(g).id, hot: isHot, hotSoFar: hot });
    }
    const o = outcome(crop, climateAt(year, k), period);
    const stressFrac = stressDays / (N + 1);
    let yieldPct;
    if (o.st === "good") yieldPct = clamp(97 - 25 * stressFrac - 2 * hot, 85, 98);
    else if (o.st === "warn") yieldPct = clamp(80 - 40 * stressFrac - 3 * hot, 55, 80);
    else yieldPct = clamp(38 - 40 * stressFrac - 3 * hot, 8, 38);
    const start = sowDate(year, k);
    return (seasonCache[key] = {
      year, k, rotId, period, crop, rot, N, taw, daily, flowerStart, flowerEnd,
      hotDays: hot, stressDays, rainTotal: Math.round(rainTotal), drySpell: wx.drySpell,
      st: o.st, why: o.why, yieldPct: Math.round(yieldPct), start,
      dateOf: (d) => new Date(start.getTime() + d * 86400000),
    });
  }

  // Seasons worth showing first: a stressed one and a failed one for a rotation.
  function exampleSeasons(rotId, period) {
    const m = metrics(rotId, period);
    const pick = (st, test) => m.cells.find((c) => c.st === st && test(c.why)) || m.cells.find((c) => c.st === st) || m.cells[0];
    const warn = pick("warn", (w) => w.indexOf("heat") >= 0);
    const fail = pick("fail", (w) => w.indexOf("dry") >= 0);
    return { stressed: { year: warn.year, k: warn.k }, failed: { year: fail.year, k: fail.k } };
  }

  // ------------------------------------------------- district (extension agent)
  function districtFarms(n) {
    const r = mulberry32(2026);
    const farms = [];
    const names = ["b", "c", "d"];
    for (let i = 0; i < (n || 42); i++) {
      const wet = r(), sandy = r();
      const rot = wet < 0.35 ? "c" : sandy > 0.62 ? "d" : wet > 0.7 ? "b" : names[Math.floor(r() * 3)];
      const before = 9 + Math.round(r() * 9);
      const after = Math.max(2, Math.round(before * (0.32 + r() * 0.2)));
      farms.push({ id: i + 1, x: 0.06 + r() * 0.88, y: 0.08 + r() * 0.84, rot, status: r() < 0.78 ? "ready" : "visit", failedNow: before, failedPlan: after, ha: Math.round((0.6 + r() * 4.4) * 10) / 10 });
    }
    return farms;
  }

  // --------------------------------------------------------------- languages
  const LANGS = [
    { id: "en", name: "English" }, { id: "es", name: "Español" }, { id: "fr", name: "Français" },
    { id: "sw", name: "Kiswahili" }, { id: "hi", name: "हिन्दी" }, { id: "bn", name: "বাংলা" }, { id: "pt", name: "Português" },
  ];
  const I18N = {
    en: { bigger: "Bigger harvest", field: "Field", data: "NASA data", simulate: "Simulate", replay: "Replay", rank: "Rank", monitor: "Monitor", district: "District", offline: "Works offline", yourField: "Your field", matters: "What matters", reliable: "Reliable harvest", water: "Saving water", soil: "Soil health", best: "Best match", tag: "Concept prototype · illustrative data" },
    es: { bigger: "Cosecha mayor", field: "Campo", data: "Datos de la NASA", simulate: "Simular", replay: "Repetir", rank: "Clasificar", monitor: "Seguimiento", district: "Distrito", offline: "Funciona sin conexión", yourField: "Tu campo", matters: "Lo que importa", reliable: "Cosecha fiable", water: "Ahorrar agua", soil: "Salud del suelo", best: "Mejor opción", tag: "Prototipo conceptual · datos ilustrativos" },
    fr: { bigger: "Plus de récolte", field: "Champ", data: "Données NASA", simulate: "Simuler", replay: "Rejouer", rank: "Classer", monitor: "Suivi", district: "District", offline: "Fonctionne hors ligne", yourField: "Votre champ", matters: "Ce qui compte", reliable: "Récolte fiable", water: "Économiser l'eau", soil: "Santé du sol", best: "Meilleur choix", tag: "Prototype conceptuel · données illustratives" },
    sw: { bigger: "Mavuno mengi", field: "Shamba", data: "Data za NASA", simulate: "Jaribu msimu", replay: "Rudia", rank: "Panga", monitor: "Fuatilia", district: "Wilaya", offline: "Inafanya kazi bila mtandao", yourField: "Shamba lako", matters: "Kinachokujali", reliable: "Mavuno ya uhakika", water: "Kuokoa maji", soil: "Afya ya udongo", best: "Chaguo bora", tag: "Mfano wa dhana · data za mfano" },
    hi: { bigger: "ज़्यादा उपज", field: "खेत", data: "नासा डेटा", simulate: "सिमुलेशन", replay: "दोहराएँ", rank: "रैंकिंग", monitor: "निगरानी", district: "ज़िला", offline: "ऑफ़लाइन काम करता है", yourField: "आपका खेत", matters: "क्या ज़रूरी है", reliable: "भरोसेमंद फ़सल", water: "पानी की बचत", soil: "मिट्टी की सेहत", best: "सबसे अच्छा विकल्प", tag: "अवधारणा प्रोटोटाइप · उदाहरण डेटा" },
    bn: { bigger: "বেশি ফলন", field: "জমি", data: "নাসা ডেটা", simulate: "সিমুলেশন", replay: "পুনরাবৃত্তি", rank: "র‍্যাঙ্কিং", monitor: "পর্যবেক্ষণ", district: "জেলা", offline: "অফলাইনে কাজ করে", yourField: "আপনার জমি", matters: "যা গুরুত্বপূর্ণ", reliable: "নির্ভরযোগ্য ফসল", water: "পানি সাশ্রয়", soil: "মাটির স্বাস্থ্য", best: "সেরা বিকল্প", tag: "ধারণাগত প্রোটোটাইপ · উদাহরণ ডেটা" },
    pt: { bigger: "Colheita maior", field: "Campo", data: "Dados da NASA", simulate: "Simular", replay: "Repetir", rank: "Classificar", monitor: "Monitorar", district: "Distrito", offline: "Funciona offline", yourField: "Seu campo", matters: "O que importa", reliable: "Colheita confiável", water: "Economizar água", soil: "Saúde do solo", best: "Melhor opção", tag: "Protótipo conceitual · dados ilustrativos" },
  };

  S2R.model = {
    FIRST_YEAR, LAST_YEAR, CLIMATE, FUTURE, SEASONS, CROPS, ROTS, STAGES, LANGS, I18N,
    climateFor, climateAt, outcome, soilParts, soilScore, metrics, ranking,
    weather, season, stageAt, exampleSeasons, districtFarms, mulberry32,
  };
})(window);
