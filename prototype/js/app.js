/* Sky2Root concept prototype: screens and interactions.
 * URL options for demos and screenshots: ?screen=simulate&lang=es&day=60
 */
(function () {
  "use strict";
  const M = S2R.model;
  const params = new URLSearchParams(location.search);
  const state = {
    screen: params.get("screen") || (location.hash ? location.hash.slice(1) : "field"),
    lang: params.get("lang") || "en",
    w: { rel: 4, harv: 3, water: 2, soil: 4 },
    water: "rainfed",
    current: "a",
    pin: { x: 520, y: 470 },
    simRot: "a", simPeriod: "past", sim: null, day: 0, playing: false, speed: 1,
    repRot: "a", repPeriod: "past",
    rankPeriod: "past",
    layers: { temperature: { on: false, op: 0.75 }, rain: { on: true, op: 0.85 }, soilmoisture: { on: false, op: 0.7 }, ndvi: { on: false, op: 0.75 } },
  };

  // ---------------------------------------------------------------- helpers
  const $ = (sel) => document.querySelector(sel);
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    kids.flat().forEach((c) => c != null && n.append(c));
    return n;
  }
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === "text") n.textContent = v; else n.setAttribute(k, v); }
    if (parent) parent.appendChild(n);
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const pct = (v) => Math.round(v) + "%";
  const t = (key) => (M.I18N[state.lang] && M.I18N[state.lang][key]) || M.I18N.en[key] || key;
  const STATUS_WORD = { good: "Good", warn: "Stressed", fail: "Failed" };
  const STATUS_COLOR = { good: "#0ca30c", warn: "#fab219", fail: "#d03b3b" };

  const tip = $("#tip");
  function showTip(title, lines, x, y) {
    clear(tip); tip.append(h("strong", { text: title }), ...lines.map((l) => h("div", { text: l })));
    tip.hidden = false;
    tip.style.left = Math.min(innerWidth - tip.offsetWidth - 8, x + 14) + "px";
    tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  function seg(container, items, current, onPick) {
    clear(container);
    items.forEach((it) => {
      const b = h("button", { type: "button", "aria-pressed": String(it.id === current), onclick: () => onPick(it.id) },
        it.color ? h("span", { class: "swatch", style: `background:${it.color}` }) : null, it.label);
      container.append(b);
    });
  }
  const rotItems = () => Object.values(M.ROTS).map((r) => ({ id: r.id, label: `${r.letter} · ${r.short}`, color: r.color }));
  const periodItems = [{ id: "past", label: "Past 40 years" }, { id: "future", label: "2050 what-if" }];

  // ----------------------------------------------------------- navigation
  function go(screen) {
    state.screen = screen;
    document.querySelectorAll(".screen").forEach((sc) => sc.classList.toggle("on", sc.id === "screen-" + screen));
    document.querySelectorAll(".side button").forEach((b) => b.setAttribute("aria-current", b.dataset.screen === screen ? "page" : "false"));
    if (screen !== "simulate") pause();
    const render = { field: renderField, data: renderData, simulate: renderSim, replay: renderReplay, rank: renderRank, monitor: renderMonitor, district: renderDistrict }[screen];
    if (render) render();
    history.replaceState(null, "", "#" + screen);
  }
  document.querySelectorAll(".side button").forEach((b) => b.addEventListener("click", () => go(b.dataset.screen)));

  // ------------------------------------------------------------- language
  function applyLang() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
    renderSliders();
  }
  const langSel = $("#lang");
  M.LANGS.forEach((l) => langSel.append(h("option", { value: l.id, text: l.name })));
  langSel.value = state.lang;
  langSel.addEventListener("change", () => { state.lang = langSel.value; applyLang(); go(state.screen); });

  // -------------------------------------------------------------- sliders
  const SLIDERS = [["rel", "reliable"], ["harv", "bigger"], ["water", "water"], ["soil", "soil"]];
  function renderSliders() {
    ["#sliders", "#rank-sliders"].forEach((sel) => {
      const box = $(sel); clear(box);
      SLIDERS.forEach(([key, label]) => {
        const out = h("output", { text: String(state.w[key]) });
        const input = h("input", { type: "range", min: "0", max: "5", step: "1", value: String(state.w[key]), "aria-label": t(label) });
        input.addEventListener("input", () => {
          state.w[key] = Number(input.value); out.textContent = input.value;
          if (state.screen === "rank") renderRanking();
        });
        box.append(h("div", { class: "slider" }, h("span", { text: t(label) }), input, out));
      });
    });
  }

  // ------------------------------------------------------------------ field
  const BBOX = { north: -11.5, south: -13.5, west: -56.5, east: -54.5 };
  function pinToLatLon(p) {
    return { lat: BBOX.north - (p.y / 1000) * (BBOX.north - BBOX.south), lon: BBOX.west + (p.x / 1000) * (BBOX.east - BBOX.west) };
  }
  function drawPin(svg, p, withField) {
    clear(svg);
    if (withField) {
      const poly = [[p.x - 55, p.y - 30], [p.x + 50, p.y - 42], [p.x + 62, p.y + 36], [p.x - 46, p.y + 46]].map((q) => q.join(",")).join(" ");
      s("polygon", { points: poly, fill: "rgba(108,199,151,0.32)", stroke: "#ffffff", "stroke-width": 4, "vector-effect": "non-scaling-stroke" }, svg);
    }
    const g = s("g", { transform: `translate(${p.x},${p.y})` }, svg);
    s("path", { d: "M0 0 C -14 -20 -16 -30 -16 -36 A 16 16 0 1 1 16 -36 C 16 -30 14 -20 0 0 Z", fill: "#e0533f", stroke: "#fff", "stroke-width": 3 }, g);
    s("circle", { cx: 0, cy: -36, r: 6, fill: "#fff" }, g);
  }
  $("#field-map").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    state.pin = { x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * 1000 };
    renderField();
  });
  function renderField() {
    drawPin($("#field-overlay"), state.pin, true);
    const ll = pinToLatLon(state.pin);
    const facts = $("#field-facts"); clear(facts);
    const row = (k, v, small) => { facts.append(h("dt", { text: k }), h("dd", {}, v, small ? h("small", { text: small }) : null)); };
    row("Location", `${Math.abs(ll.lat).toFixed(2)}° S, ${Math.abs(ll.lon).toFixed(2)}° W`);
    row("Area", "46 ha", "Measured from the outline you drew");
    row("Soil", "Sandy clay loam · pH 5.6", "From global soil maps (SoilGrids in the real tool); edit with your soil test");
    row("Organic carbon", "1.2%", "Low: rotations with legumes and cover crops help");
    row("Water held", "140 mm in the root zone", "Worked out from soil texture");
    const sel = $("#current-rot"); if (!sel.options.length) {
      Object.values(M.ROTS).forEach((r) => sel.append(h("option", { value: r.id, text: `${r.letter} · ${r.name}` })));
      sel.addEventListener("change", () => { state.current = sel.value; });
    }
    sel.value = state.current;
    document.querySelectorAll("#water-seg button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.water === state.water));
      b.onclick = () => { state.water = b.dataset.water; renderField(); };
    });
  }
  $("#go-replay").addEventListener("click", () => go("replay"));

  // ------------------------------------------------------------------- data
  const LAYERS = [
    { id: "temperature", img: "temperature.png", name: "Weather · NASA POWER", what: "Daily temperature, humidity, wind, sunshine and rain since 1984. Shown: MERRA-2 air temperature, the model behind POWER's weather.", spec: "½° × ⅝° · image: September 2023 monthly mean" },
    { id: "rain", img: "rain.png", name: "Rainfall · GPM IMERG", what: "Rain from a fleet of satellites. Shows when rains start and how long dry spells last.", spec: "0.1° · every 30 minutes since 1998 · image: 10 January 2024" },
    { id: "soilmoisture", img: "soilmoisture.png", name: "Soil moisture · SMAP", what: "How wet the root zone is. Sets the starting point for the next season.", spec: "9 km · 3-hourly since 2015 · image: 15 January 2024" },
    { id: "ndvi", img: "ndvi.png", name: "Greenness · MODIS NDVI", what: "How green each field is. Counts bare-soil days and checks cover crops.", spec: "250 m · 16-day since 2000 · image: July 2023" },
  ];
  function renderData() {
    const map = $("#data-map");
    LAYERS.forEach((L) => {
      let img = map.querySelector(`img[data-layer="${L.id}"]`);
      if (!img) { img = h("img", { class: "layer", "data-layer": L.id, src: "assets/img/" + L.img, alt: L.name }); map.append(img); }
      const st = state.layers[L.id];
      img.style.opacity = st.on ? st.op : 0;
    });
    const list = $("#layer-list"); clear(list);
    LAYERS.forEach((L) => {
      const st = state.layers[L.id];
      const cb = h("input", { type: "checkbox", "aria-label": L.name });
      cb.checked = st.on;
      cb.addEventListener("change", () => { st.on = cb.checked; renderData(); });
      const op = h("input", { type: "range", min: "0.2", max: "1", step: "0.05", value: String(st.op), "aria-label": L.name + " opacity" });
      op.addEventListener("input", () => { st.op = Number(op.value); const img = map.querySelector(`img[data-layer="${L.id}"]`); if (img && st.on) img.style.opacity = st.op; });
      list.append(h("div", { class: "layer-row" }, cb, h("div", {}, h("b", { text: L.name }), h("div", { class: "what", text: L.what }), h("div", { class: "spec", text: L.spec })), st.on ? op : null));
    });
    const on = LAYERS.filter((L) => state.layers[L.id].on).map((L) => L.name.split(" · ")[1]);
    $("#data-caption").textContent = `Base: MODIS true colour, 8 July 2023. Layers on: ${on.length ? on.join(", ") : "none"}. All via NASA GIBS.`;
  }

  // --------------------------------------------------------------- simulate
  let view = null, raf = 0, last = 0;
  function seasonOptions() {
    const sel = $("#sim-season"); clear(sel);
    const m = M.metrics(state.simRot, state.simPeriod);
    m.cells.forEach((c) => {
      const label = `${c.year} · ${M.SEASONS[c.k]} · ${M.CROPS[c.crop].name} · ${STATUS_WORD[c.st]}${c.st === "good" ? "" : " (" + c.why + ")"}`;
      sel.append(h("option", { value: `${c.year}-${c.k}`, text: label }));
    });
    sel.value = `${state.sim.year}-${state.sim.k}`;
  }
  function loadSeason() {
    const S = M.season(state.sim.year, state.sim.k, state.simRot, state.simPeriod);
    view.setSeason(S);
    const slider = $("#sim-day"); slider.max = String(S.N + 1.5);
    state.day = Math.min(state.day, S.N + 1.5);
    drawSim();
    const box = $("#sim-summary"); clear(box);
    const stat = (k, v, cls) => box.append(h("div", { class: "stat" }, h("div", { class: "k", text: k }), h("div", { class: "v " + (cls || ""), text: v })));
    stat("Crop", S.crop.name);
    stat("Rain this season", S.rainTotal + " mm");
    stat("Longest dry spell", S.drySpell + " days");
    stat("Hot days at flowering", String(S.hotDays));
    stat("Result", `${STATUS_WORD[S.st]} · ${S.yieldPct}%`, S.st);
  }
  function drawSim() { view.render(state.day); $("#sim-day").value = String(state.day); }
  function frame(now) {
    if (!state.playing) return;
    const dt = (now - last) / 1000; last = now;
    const S = view.season;
    state.day = Math.min(S.N + 1.5, state.day + dt * 14 * state.speed);
    drawSim();
    if (state.day >= S.N + 1.5) { pause(); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() { if (!view) return; if (state.day >= view.season.N + 1.4) state.day = 0; state.playing = true; last = performance.now(); $("#sim-play").textContent = "Pause"; raf = requestAnimationFrame(frame); }
  function pause() { state.playing = false; cancelAnimationFrame(raf); const b = $("#sim-play"); if (b) b.textContent = "Play"; }
  function renderSim() {
    if (!view) {
      view = new S2R.SeasonView($("#sim-view"));
      $("#sim-play").addEventListener("click", () => (state.playing ? pause() : play()));
      $("#sim-day").addEventListener("input", (e) => { pause(); state.day = Number(e.target.value); drawSim(); });
      $("#sim-season").addEventListener("change", (e) => { const [y, k] = e.target.value.split("-").map(Number); state.sim = { year: y, k }; state.day = 0; loadSeason(); });
    }
    if (!state.sim) state.sim = M.exampleSeasons(state.simRot, state.simPeriod).stressed;
    seg($("#sim-rots"), rotItems(), state.simRot, (id) => { state.simRot = id; pause(); renderSim(); });
    seg($("#sim-period"), periodItems, state.simPeriod, (id) => { state.simPeriod = id; pause(); renderSim(); });
    seg($("#sim-speed"), [{ id: 1, label: "1×" }, { id: 2, label: "2×" }, { id: 4, label: "4×" }], state.speed, (id) => { state.speed = id; renderSim(); });
    seasonOptions();
    loadSeason();
  }

  // ----------------------------------------------------------------- replay
  function reportCard(svg, rotId, period, onCell) {
    clear(svg);
    const W = 1100, L = 150, colW = (W - L - 10) / 40, cw = colW - 3, ch = 36;
    const m = M.metrics(rotId, period), rot = M.ROTS[rotId];
    const lab = (txt, x, y, opts) => s("text", Object.assign({ x, y, "font-size": 14, fill: "#56625a", text: txt }, opts || {}), svg);
    lab("Rain vs normal", 0, 34); lab("Heat at flowering", 0, 90);
    s("line", { x1: L, x2: W - 10, y1: 30, y2: 30, stroke: "#d4dad3" }, svg);
    s("line", { x1: L, x2: W - 10, y1: 96, y2: 96, stroke: "#d4dad3" }, svg);
    [0, 1].forEach((k) => {
      lab(M.SEASONS[k], 0, 140 + k * 46, { fill: "#16201b", "font-weight": 600, "font-size": 15 });
      lab(M.CROPS[rot.seq[k]].name, 0, 157 + k * 46, { "font-size": 13 });
    });
    for (let i = 0; i < 40; i++) {
      const x = L + i * colW + 1.5;
      const a = M.climateFor(M.CLIMATE[i * 2], period), b = M.climateFor(M.CLIMATE[i * 2 + 1], period);
      const rain = Math.max(-2.4, Math.min(2.4, (a.rain + b.rain) / 2)) * 9, heat = Math.max(-1, Math.min(3.6, (a.heat + b.heat) / 2)) * 9;
      s("rect", { x, y: rain > 0 ? 30 - rain : 30, width: cw, height: Math.max(0.6, Math.abs(rain)), fill: "#a3ada5" }, svg);
      s("rect", { x, y: heat > 0 ? 96 - heat : 96, width: cw, height: Math.max(0.6, Math.abs(heat)), fill: "#a3ada5" }, svg);
      for (let k = 0; k < 2; k++) {
        const c = m.cells[i * 2 + k], y = 120 + k * 46;
        const r = s("rect", { x, y, width: cw, height: ch, rx: 4, fill: STATUS_COLOR[c.st], style: "cursor:pointer" }, svg);
        const cx = x + cw / 2, cy = y + ch / 2;
        if (c.st === "fail") s("path", { d: `M${cx - 4} ${cy - 4}l8 8M${cx + 4} ${cy - 4}l-8 8`, stroke: "#fff", "stroke-width": 2, "stroke-linecap": "round", "pointer-events": "none" }, svg);
        if (c.st === "warn") s("circle", { cx, cy, r: 2.6, fill: "#fff", "pointer-events": "none" }, svg);
        r.addEventListener("mousemove", (e) => showTip(`${STATUS_WORD[c.st]}${c.st === "good" ? "" : ": " + c.why}`, [`${M.CROPS[c.crop].name} · ${M.SEASONS[c.k]} ${c.year}`, "Click to watch this season"], e.clientX, e.clientY));
        r.addEventListener("mouseleave", hideTip);
        if (onCell) r.addEventListener("click", () => { hideTip(); onCell(c); });
      }
    }
    [1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020, 2024].forEach((y) => lab(String(y), L + (y - 1985) * colW + colW / 2, 236, { "text-anchor": "middle", "font-family": "IBM Plex Mono, monospace", "font-size": 13 }));
    return m;
  }
  function renderReplay() {
    seg($("#rep-rots"), rotItems(), state.repRot, (id) => { state.repRot = id; renderReplay(); });
    seg($("#rep-period"), periodItems, state.repPeriod, (id) => { state.repPeriod = id; renderReplay(); });
    const m = reportCard($("#rep-card"), state.repRot, state.repPeriod, (c) => {
      state.simRot = state.repRot; state.simPeriod = state.repPeriod; state.sim = { year: c.year, k: c.k }; state.day = 0; go("simulate"); play();
    });
    const box = $("#rep-stats"); clear(box);
    const stat = (k, v, cls) => box.append(h("div", { class: "stat" }, h("div", { class: "k", text: k }), h("div", { class: "v " + (cls || ""), text: v })));
    stat("Failed seasons", `${m.failed} of 80`, "fail");
    stat("Stressed", String(m.stressed), "warn");
    stat("Good", String(80 - m.failed - m.stressed), "good");
    stat("Not failed", pct(m.reliability));
    const tab = $("#rep-table"); clear(tab);
    tab.append(h("tr", {}, ...["Rotation", "Failed, past 40 years", "Failed, 2050 what-if", "Water need", "Soil score"].map((x) => h("th", { text: x }))));
    Object.values(M.ROTS).forEach((r) => {
      tab.append(h("tr", {}, h("td", {}, h("span", { class: "swatch", style: `background:${r.color};margin-right:8px` }), `${r.letter} · ${r.name}`),
        h("td", { class: "num", text: `${M.metrics(r.id, "past").failed} / 80` }), h("td", { class: "num", text: `${M.metrics(r.id, "future").failed} / 80` }),
        h("td", { class: "num", text: `${r.water} mm/yr` }), h("td", { class: "num", text: String(M.soilScore(r)) })));
    });
  }

  // ------------------------------------------------------------------- rank
  function renderRanking() {
    const ms = M.ranking(state.w, state.rankPeriod);
    const list = $("#ranking"); clear(list);
    ms.forEach((x, i) => {
      list.append(h("li", { class: i === 0 ? "first" : "" },
        h("span", { class: "pos", text: String(i + 1) }),
        h("span", { class: "nm" }, h("span", { class: "swatch", style: `background:${x.rot.color}` }), `${x.rot.letter} · ${x.rot.short}`, i === 0 ? h("span", { class: "best", text: t("best") }) : null),
        h("span", { class: "val", text: String(Math.round(x.score)) }),
        h("div", { class: "bar" }, h("i", { style: `width:${Math.max(1, x.score)}%;background:${x.rot.color}` })),
        h("span", { class: "facts2", text: `${pct(x.m.reliability)} not failed · harvest ${Math.round(x.m.harvest)} · ${x.m.water} mm · soil ${x.m.soil}` })));
    });
    // scatter
    const svg = $("#scatter"); clear(svg);
    const x0 = 46, x1 = 404, y0 = 34, y1 = 270, X = (v) => x0 + (v - 40) / 60 * (x1 - x0), Y = (v) => y1 - v / 100 * (y1 - y0);
    [0, 25, 50, 75, 100].forEach((v) => { s("line", { x1: x0, x2: x1, y1: Y(v), y2: Y(v), stroke: "#e6eae4" }, svg); s("text", { x: x0 - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 12, fill: "#7d887f", text: String(v) }, svg); });
    [40, 60, 80, 100].forEach((v) => { s("line", { x1: X(v), x2: X(v), y1: y0, y2: y1, stroke: "#e6eae4" }, svg); s("text", { x: X(v), y: y1 + 18, "text-anchor": "middle", "font-size": 12, fill: "#7d887f", text: v + "%" }, svg); });
    s("text", { x: (x0 + x1) / 2, y: 312, "text-anchor": "middle", "font-size": 13, fill: "#56625a", text: "Seasons not failed" }, svg);
    s("text", { x: 0, y: 12, "font-size": 13, fill: "#56625a", text: "Soil score" }, svg);
    ms.forEach((x, i) => {
      const cx = X(x.m.reliability), cy = Y(x.m.soil);
      if (i === 0) s("circle", { cx, cy, r: 13, fill: "none", stroke: "#16201b", "stroke-width": 1.5 }, svg);
      s("circle", { cx, cy, r: 8, fill: x.rot.color, stroke: "#fff", "stroke-width": 2 }, svg);
      s("text", { x: cx + (x.id === "b" ? -14 : 14), y: cy + 5, "text-anchor": x.id === "b" ? "end" : "start", "font-size": 15, "font-weight": 700, fill: "#16201b", text: x.rot.letter }, svg);
    });
    // why
    const top = ms[0], cur = ms.find((x) => x.id === state.current) || ms.find((x) => x.id === "a");
    const why = $("#why"); clear(why);
    why.append(h("b", { text: `Why ${top.rot.letter}: ` }),
      top.id === cur.id
        ? `your current rotation already scores best on these priorities. In this example it failed ${top.m.failed} of 80 seasons.`
        : `in this example, ${top.rot.short.toLowerCase()} failed ${top.m.failed} of 80 seasons in the replay; ${cur.rot.short.toLowerCase()} failed ${cur.m.failed}. Living roots stay in the ground ${top.rot.soil.cover} days a year instead of ${cur.rot.soil.cover}, and the crops need ${top.rot.water} mm of water a year instead of ${cur.rot.water}.`);
  }
  function renderRank() {
    seg($("#rank-period"), periodItems, state.rankPeriod, (id) => { state.rankPeriod = id; renderRank(); });
    renderRanking();
  }

  // ---------------------------------------------------------------- monitor
  function renderMonitor() {
    const data = window.S2R_NDVI;
    const svg = $("#ndvi"); clear(svg);
    if (!data) { s("text", { x: 20, y: 40, text: "NDVI data file missing: run tools/fetch_ndvi.py" }, svg); return; }
    const pts = data.series.map((p) => ({ t: Date.parse(p.date), v: p.ndvi, date: p.date }));
    const t0 = Date.parse("2019-01-01"), t1 = Date.parse("2025-01-01");
    const x0 = 50, x1 = 1086, y0 = 18, y1 = 300, X = (v) => x0 + (v - t0) / (t1 - t0) * (x1 - x0), Y = (v) => y1 - v * (y1 - y0);
    // bare spells (NDVI below 0.4)
    pts.forEach((p, i) => {
      if (p.v >= 0.4) return;
      const next = pts[i + 1] ? pts[i + 1].t : p.t + 16 * 864e5;
      s("rect", { x: X(p.t), y: y0, width: Math.max(2, X(next) - X(p.t)), height: y1 - y0, fill: "#a8794f", opacity: 0.16 }, svg);
    });
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((v) => { s("line", { x1: x0, x2: x1, y1: Y(v), y2: Y(v), stroke: v === 0.4 ? "#c9a36b" : "#e6eae4", "stroke-dasharray": v === 0.4 ? "5 4" : "" }, svg); s("text", { x: x0 - 8, y: Y(v) + 4, "text-anchor": "end", "font-size": 12, fill: "#7d887f", text: v.toFixed(1) }, svg); });
    for (let y = 2019; y <= 2024; y++) s("text", { x: X(Date.parse(`${y}-07-01`)), y: y1 + 22, "text-anchor": "middle", "font-size": 13, fill: "#56625a", text: String(y) }, svg);
    s("polyline", { points: pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" "), fill: "none", stroke: "#2f8f5b", "stroke-width": 3, "stroke-linejoin": "round" }, svg);
    pts.forEach((p) => {
      const c = s("circle", { cx: X(p.t), cy: Y(p.v), r: 4, fill: "#2f8f5b", stroke: "#fff", "stroke-width": 1.5 }, svg);
      c.addEventListener("mousemove", (e) => showTip(`NDVI ${p.v.toFixed(2)}`, [p.date, p.v < 0.4 ? "Little or no living cover" : "Crop growing"], e.clientX, e.clientY));
      c.addEventListener("mouseleave", hideTip);
    });
    s("text", { x: x0 + 6, y: Y(0.4) - 6, "font-size": 12, fill: "#9a7340", text: "Below 0.4: bare or nearly bare soil" }, svg);
    $("#ndvi-caption").textContent = `${data.source}. ${data.place}, ${Math.abs(data.lat)}° S, ${Math.abs(data.lon)}° W. Brown bands: bare or nearly bare soil.`;
    // bare days per year
    const bars = $("#bare-bars"); clear(bars);
    const perYear = {};
    pts.forEach((p) => { const y = p.date.slice(0, 4); perYear[y] = (perYear[y] || 0) + (p.v < 0.4 ? 16 : 0); });
    const maxDays = Math.max(...Object.values(perYear), 1);
    Object.entries(perYear).forEach(([y, d]) => bars.append(h("div", { class: "slider", style: "grid-template-columns:52px 1fr 84px" }, h("span", { text: y }),
      h("div", { class: "bar", style: "height:12px;background:#ece5da;border-radius:0 6px 6px 0;position:relative" }, h("i", { style: `position:absolute;inset:0 auto 0 0;width:${(d / maxDays) * 100}%;background:#a8794f;border-radius:0 6px 6px 0` })),
      h("output", { text: `${d} days` }))));
    const lastYear = perYear["2024"] || 0, avg = Math.round(Object.values(perYear).reduce((a, b) => a + b, 0) / Object.keys(perYear).length);
    const notes = $("#monitor-notes"); clear(notes);
    notes.append(
      h("p", {}, h("b", { text: `About ${avg} bare days a year, ` }), "mostly from July to October, between the maize harvest and the next soy crop."),
      h("p", { text: "That is when wind and the first heavy rains strip the most topsoil. A dry-season cover crop would keep living roots in the ground through this gap." }),
      h("p", { class: "muted", text: `2024: ${lastYear} bare days. In the real tool, the same count runs every season for the farmer's own field, from 30 m HLS imagery where clouds allow.` }));
  }

  // --------------------------------------------------------------- district
  const farms = M.districtFarms(42);
  function renderDistrict() {
    const svg = $("#district-overlay"); clear(svg);
    farms.forEach((f) => {
      const rot = M.ROTS[f.rot];
      const g = s("g", { transform: `translate(${f.x * 1000},${f.y * 1000})`, style: "cursor:pointer" }, svg);
      if (f.status === "visit") s("circle", { r: 22, fill: "none", stroke: "#fab219", "stroke-width": 4, "stroke-dasharray": "6 5" }, g);
      s("circle", { r: 13, fill: rot.color, stroke: "#fff", "stroke-width": 4 }, g);
      g.addEventListener("mousemove", (e) => showTip(`Farm ${f.id} · ${f.ha} ha`, [`Plan: ${rot.letter} · ${rot.short}`, `Failed seasons ${f.failedNow} → ${f.failedPlan} (example)`], e.clientX, e.clientY));
      g.addEventListener("mouseleave", hideTip);
      g.addEventListener("click", () => showFarm(f));
    });
    const ready = farms.filter((f) => f.status === "ready").length;
    const avgNow = farms.reduce((a, f) => a + f.failedNow, 0) / farms.length, avgPlan = farms.reduce((a, f) => a + f.failedPlan, 0) / farms.length;
    const box = $("#district-stats"); clear(box);
    const stat = (k, v, cls) => box.append(h("div", { class: "stat" }, h("div", { class: "k", text: k }), h("div", { class: "v " + (cls || ""), text: v })));
    stat("Farms", String(farms.length));
    stat("Plans ready", String(ready), "good");
    stat("Need a visit", String(farms.length - ready), "warn");
    stat("Failed seasons", `${avgNow.toFixed(0)} → ${avgPlan.toFixed(0)}`);
    const leg = $("#district-legend"); clear(leg);
    ["b", "c", "d"].forEach((id) => leg.append(h("span", {}, h("span", { class: "swatch", style: `background:${M.ROTS[id].color};margin-right:6px` }), `${M.ROTS[id].letter} · ${M.ROTS[id].short}`)));
    leg.append(h("span", { class: "muted", text: "Dashed ring: needs a visit. Numbers are illustrative." }));
    showFarm(farms.find((f) => f.status === "visit") || farms[0]);
  }
  function showFarm(f) {
    const rot = M.ROTS[f.rot], card = $("#farm-card"); clear(card);
    card.append(h("div", {}, h("b", { text: `Farm ${f.id}` }), ` · ${f.ha} ha · ${f.status === "ready" ? "plan ready" : "needs a visit"}`),
      h("div", {}, "Recommended: ", h("b", { text: `${rot.letter} · ${rot.name}` })),
      h("div", { text: `Failed seasons in the replay: ${f.failedNow} → ${f.failedPlan} of 80 (example)` }));
  }

  // ------------------------------------------------------------------ start
  applyLang();
  go(state.screen);
  if (params.has("day") && state.screen === "simulate") { state.day = Number(params.get("day")); drawSim(); }
  window.S2R_APP = { state, go, play, pause, setDay: (d) => { state.day = d; drawSim(); } };
})();
