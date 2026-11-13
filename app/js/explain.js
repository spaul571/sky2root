/* Sky2Root: plain-language reasons. Pure functions, written so that each statement rests on a
 * number the simulation produced, and each claim about agronomy says "may" and points to local review.
 * The sentences themselves live in i18n.js, one set per language.
 */
(function (global) {
  "use strict";
  const S2R = global.S2R || (global.S2R = {});
  const T = (key, vars) => S2R.i18n.t(key, vars);
  const list = (a) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + T("x.and") + a[a.length - 1]);

  // item, current: { rot, m } from the ranking. ctx: { soil, clim, grace, scenario, years, checks, water, burned, enso }
  function explain(item, current, ctx) {
    const E = S2R.engine, CROPS = E.CROPS;
    const m = item.m, c = current ? current.m : null, rot = item.rot;
    const isCurrent = current && item.rot.id === current.rot.id;
    const crops = rot.crops.map((id) => CROPS[id]);
    const cropName = (x) => S2R.i18n.crop(x.id);
    const names = crops.map((x) => cropName(x).toLowerCase());
    const cover = rot.slots.find((s) => s.isCover);
    const why = [], evidence = [], benefits = [], gaps = [], risks = [];
    const pct = (a, b) => Math.round((100 * a) / (b || 1));

    // Why suggested: the differences that matter, against what the farmer does now.
    if (isCurrent) {
      why.push(T("x.why.current"));
    } else if (c) {
      const rate = (x) => x.failed / (x.seasons || 1);
      const counts = { a: m.failed, b: m.seasons, c: c.failed, d: c.seasons };
      if (rate(m) < rate(c)) why.push(T("x.why.fewer", counts));
      else if (rate(m) > rate(c)) why.push(T("x.why.more", counts));
      if (m.harvest > c.harvest * 1.05) why.push(T("x.why.moreFood", { n: pct(m.harvest - c.harvest, c.harvest) }));
      else if (m.harvest < c.harvest * 0.95) why.push(T("x.why.lessFood", { n: pct(c.harvest - m.harvest, c.harvest) }));
      if (m.et < c.et - 20) why.push(T("x.why.lessWater", { n: Math.round(c.et - m.et) }));
      if (m.irrigation < c.irrigation - 20) why.push(T("x.why.lessIrrigation", { n: Math.round(c.irrigation - m.irrigation) }));
      if (m.rootDays > c.rootDays + 15) why.push(T("x.why.roots", { n: Math.round(m.rootDays - c.rootDays) }));
      if (m.soilLoss < c.soilLoss * 0.85) why.push(T("x.why.soilLoss", { n: pct(c.soilLoss - m.soilLoss, c.soilLoss) }));
    }

    // Evidence: what produced the numbers.
    evidence.push(T("x.ev.seasons", { n: m.seasons, a: ctx.years[0], b: ctx.years[1] }));
    if (m.range) evidence.push(T("x.ev.models", { n: m.range.models, a: m.range.failed[0], b: m.range.failed[1] }));
    if (ctx.checks && ctx.checks.smapR != null) evidence.push(T("x.ev.smap", { r: ctx.checks.smapR.toFixed(2) }));
    evidence.push(T("x.ev.soil", { texture: S2R.i18n.t("texture." + E.textureClass(ctx.soil.sand, ctx.soil.clay)).toLowerCase(), source: ctx.soil.source || T("soil.yours"), n: Math.round(ctx.soil.taw1m) }));
    if (ctx.market) {
      const share = (x) => ctx.market.shares[x.id === "winterWheat" ? "wheat" : x.id] || 0;
      const fmt = (v) => (v >= 0.1 ? `${Math.round(v * 100)}%` : `${(v * 100).toFixed(1)}%`);
      evidence.push(T("x.ev.market", { country: ctx.market.name, list: crops.map((x) => `${cropName(x).toLowerCase()} ${fmt(share(x))}`).join(", ") }));
    }
    const reasons = Object.entries(m.failReasons).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (reasons.length) evidence.push(T("x.ev.causes", { list: reasons.map(([r, n]) => `${T("why." + r)} (${n})`).join(", ") }));

    // Benefits: what these plants do for soil and farm, in general terms.
    const of = (arr) => list(arr.map((x) => cropName(x)));
    const legumes = crops.filter((x) => x.nfix);
    if (legumes.length) benefits.push(T("x.ben.nitrogen", { names: of(legumes) }));
    if (new Set(crops.map((x) => x.family)).size > 1) benefits.push(T("x.ben.family"));
    const deep = crops.filter((x) => x.zr >= 1.25);
    if (deep.length) benefits.push(T("x.ben.deep", { names: of(deep) }));
    const hardy = crops.filter((x) => x.ky <= 0.9);
    if (hardy.length) benefits.push(T("x.ben.hardy", { names: of(hardy) }));
    const fodder = crops.filter((x) => x.forage >= 0.6);
    if (fodder.length) benefits.push(T("x.ben.fodder", { names: of(fodder) }));
    if (cover) benefits.push(T("x.ben.cover"));

    // Information gaps.
    gaps.push(T("x.gap.notSimulated"));
    gaps.push(T("x.gap.grid") + " " + T(ctx.soil.floods ? "x.gap.floodRule" : "x.gap.noFlood"));
    const seen = ctx.water ? ctx.water.occurrence : null;
    if (ctx.soil.floods && seen === 0) gaps.push(T("x.gap.floodNotSeen"));
    else if (!ctx.soil.floods && seen >= 5) gaps.push(T("x.gap.floodSeen", { n: seen }));
    else if (!ctx.soil.floods && seen == null && ctx.soil.slope < 1 && ctx.clim.annualRain > 1000) gaps.push(T("x.gap.flatRainy"));
    if (ctx.soil.source && /coarse/.test(ctx.soil.source)) gaps.push(T("x.gap.coarse"));
    const estimated = crops.filter((x) => x.est);
    if (estimated.length) gaps.push(T("x.gap.estimated", { names: list(estimated.map((x) => cropName(x).toLowerCase())) }));
    if (ctx.scenario && ctx.scenario !== "past") gaps.push(T("x.gap.scenario"));

    // Risks that need local review.
    if (ctx.enso) {
      const s = ctx.enso.split, k = ctx.enso.kind, others = k === "nino" ? [s.nina, s.neutral] : [s.nino, s.neutral];
      risks.push(T("x.risk.enso." + k, { a: s[k].failed, b: s[k].n, c: others[0].failed + others[1].failed, d: others[0].n + others[1].n }));
    }
    if (ctx.soil.ph != null) {
      // Well past EcoCrop's optimum only: wheat thrives on Punjab's pH 7.9, a point above that optimum, and the map is coarse.
      const low = crops.filter((x) => ctx.soil.ph < x.ph[0] - 0.5), high = crops.filter((x) => ctx.soil.ph > x.ph[1] + 1);
      if (low.length) risks.push(T("x.risk.ph.low", { ph: ctx.soil.ph.toFixed(1), names: list(low.map((x) => cropName(x).toLowerCase())) }));
      if (high.length) risks.push(T("x.risk.ph.high", { ph: ctx.soil.ph.toFixed(1), names: list(high.map((x) => cropName(x).toLowerCase())) }));
    }
    if (ctx.burned && ctx.burned.years / ctx.burned.span >= 0.2) risks.push(T("x.risk.fire", { a: ctx.burned.years, b: ctx.burned.span }));
    risks.push(T("x.risk.varieties", { names: list(names) }));
    if (legumes.length) risks.push(T("x.risk.inoculant"));
    if (ctx.grace && ctx.grace.trend != null && ctx.grace.trend < -0.5 && m.irrigation > 0) risks.push(T("x.risk.grace", { n: Math.abs(ctx.grace.trend).toFixed(1) }));
    if (cover) risks.push(T("x.risk.cover"));
    if (!cover && m.bareDays > 150) risks.push(T("x.risk.bare", { n: Math.round(m.bareDays) }));
    risks.push(T("x.risk.talk"));
    return { why, evidence, benefits, gaps, risks };
  }

  // Keys into i18n.js: gl.<key>.t is the word, gl.<key>.d its meaning.
  const GLOSSARY = ["plan", "et", "balance", "anomaly", "ndvi", "frost", "failed", "roots", "thermal"];
  const LIMITS = ["pests", "fertility", "floods", "markets", "field", "future"];

  const SOURCES = [
    ["NASA POWER (MERRA-2, CERES)", "Daily temperature, humidity, wind, sunshine, from 1984", "https://power.larc.nasa.gov/"],
    ["GPM IMERG V07, through POWER", "Daily rain from 1998", "https://gpm.nasa.gov/data/imerg"],
    ["SMAP L4 root-zone soil moisture, through NASA GIBS", "Checks the simulation, 2015 onward", "https://nsidc.org/data/spl4smgp"],
    ["MODIS MOD13Q1 NDVI, MCD12Q1 land cover and MCD64A1 burned area, through ORNL DAAC", "Greenness, bare soil and fire from 2001", "https://modis.ornl.gov/"],
    ["HLS v2.0, Landsat and Sentinel-2, through Microsoft Planetary Computer and NASA GIBS", "Greenness and pictures of the field itself at 30 m", "https://www.earthdata.nasa.gov/data/projects/hls"],
    ["JRC Global Surface Water, from Landsat, through Microsoft Planetary Computer", "How often water was seen on this spot, 1984-2020", "https://global-surface-water.appspot.com/"],
    ["NEX-GDDP-CMIP6", "2041-2060 change from 5 climate models and 2 scenarios", "https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6"],
    ["GRACE and GRACE-FO mascons (JPL), through NASA GIBS", "Long-term water storage", "https://grace.jpl.nasa.gov/"],
    ["SRTM, through Terrain Tiles on AWS", "Slope, for erosion", "https://registry.opendata.aws/terrain-tiles/"],
    ["ISRIC SoilGrids 2.0 (CC BY 4.0)", "Sand, clay, organic carbon, pH", "https://www.isric.org/explore/soilgrids"],
    ["NASA GIBS", "Map imagery", "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api"],
    ["FAO-56, FAO-33, AquaCrop, EcoCrop", "Crop water use, yield response, temperature and soil pH limits", "https://www.fao.org/4/x0490e/x0490e00.htm"],
    ["FAOSTAT crops and producer prices, through OpenStreetMap Nominatim for the country", "What is grown in your country, national yields and farm prices", "https://www.fao.org/faostat/en/#data/PP"],
    ["NOAA Oceanic Nino Index", "El Nino and La Nina, from 1950", "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php"],
    ["OpenStreetMap Nominatim", "Finding a place by name", "https://nominatim.openstreetmap.org/"],
  ];

  S2R.explain = { explain, GLOSSARY, LIMITS, SOURCES };
})(typeof window !== "undefined" ? window : globalThis);
