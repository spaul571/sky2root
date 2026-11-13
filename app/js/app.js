/* Sky2Root: screens and interactions.
 * URL options for demos and screenshots: ?field=sorriso-brazil&screen=rank&period=ssp245&lang=es
 */
(function () {
  "use strict";
  const E = S2R.engine, N = S2R.nasa, X = S2R.explain, I = S2R.i18n, CROPS = E.CROPS;
  const t = I.t, cropName = I.crop;
  const params = new URLSearchParams(location.search);
  const LAST_YEAR = new Date().getUTCFullYear() - 1, FIRST_YEAR = 1984;
  const TILES = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

  // Your answers are kept on this device only, so that a reload or a lost connection does not lose them.
  const SAVE_KEY = "s2r-setup";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (error) { return {}; } })();
  const knownLang = (id) => (I.LANGS.some((l) => l.id === id) ? id : null);

  const state = {
    screen: "field", step: 1,
    lang: knownLang(params.get("lang")) || knownLang(saved.lang) || knownLang((navigator.language || "").slice(0, 2)) || "en",
    w: Object.assign({ rel: 4, harv: 3, money: 0, water: 2, soil: 4, forage: 0 }, saved.w),
    point: null, placeName: null, demoId: "", demos: [], irrigation: saved.irrigation || "none", cap: saved.cap || 150, floods: !!saved.floods, floodsByFarmer: false, water: null,
    pattern: saved.pattern || "single", crop1: CROPS[saved.crop1] ? saved.crop1 : "maize", crop2: CROPS[saved.crop2] ? saved.crop2 : "soybean",
    allowed: new Set(saved.allowed || Object.values(CROPS).filter((c) => !c.cover).map((c) => c.id)),
    allowedByFarmer: !!saved.allowed, // once the farmer has ticked or unticked a crop, their list stands
    market: null,
    allowCover: saved.allowCover !== false,
    soilInput: null,
    pack: null, wx: null, soil: null, clim: null, items: [], current: null,
    period: ["ssp245", "ssp585", "custom"].includes(params.get("period")) ? params.get("period") : "past", custom: { dT: 2, rain: -10 },
    scenarioCache: {}, wxCache: {}, runCache: {},
    selected: null, repRot: null, repPick: null, simRot: null, simSeason: null, day: 0, playing: false, speed: 1,
    layer: "soil", acc: new Set(["why"]), enso: null, ensoCache: {},
  };
  let firstScreen = params.get("screen"); // only the page's first answer follows the link's screen

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
  const SVG = "http://www.w3.org/2000/svg";
  function s(tag, attrs, parent) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === "text") n.textContent = v; else n.setAttribute(k, v); }
    if (parent) parent.appendChild(n);
    return n;
  }
  const icon = (id, cls) => { const n = s("svg", { class: "ic " + (cls || ""), "aria-hidden": "true" }); s("use", { href: "#i-" + id }, n); return n; };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  const num = (v, d) => (v == null || Number.isNaN(v) ? "n/a" : (+v).toFixed(d || 0));
  const statusWord = (st) => t("status." + st);
  const whyText = (why) => t("why." + why);
  const STATUS_MARK = { good: "", warn: "•", fail: "×" };
  const COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#8a56c8", "#c8a12a", "#d0457d", "#3aa8b8"];
  const CURRENT_COLOR = "#7d887f";
  const colorOf = (id, ids) => (state.current && id === state.current.id ? CURRENT_COLOR : COLORS[Math.max(0, ids.indexOf(id)) % COLORS.length]);
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));
  const glide = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  // Dates in the reader's language, with the digits the rest of the numbers use.
  const dateFmt = (opts) => new Intl.DateTimeFormat(`${state.lang}-u-nu-latn`, Object.assign({ timeZone: "UTC" }, opts));
  const dayName = (doy0) => dateFmt({ day: "numeric", month: "short" }).format(Date.UTC(2001, 0, 1 + doy0));
  const monthName = (m, style) => dateFmt({ month: style || "short" }).format(Date.UTC(2001, m, 15));
  const lower = (x) => x.toLocaleLowerCase(state.lang);
  function planName(rot) {
    const a = cropName(rot.crops[0]), b = rot.crops[1] ? lower(cropName(rot.crops[1])) : "";
    const base = rot.pattern === "single" ? t("plan.single", { a }) : rot.pattern === "alternate" ? t("plan.alternate", { a, b }) : t("plan.double", { a, b });
    return rot.slots.some((x) => x.isCover) ? base + t("plan.cover") : base;
  }
  // Charts are drawn at the true width of their box, so their text is real size on any screen.
  function fit(svg, ratio, minH, maxH) {
    const W = Math.max(260, Math.round(svg.parentNode.getBoundingClientRect().width) - (parseFloat(getComputedStyle(svg.parentNode).paddingLeft) || 0) * 2);
    const H = Math.round(Math.min(maxH, Math.max(minH, W * ratio)));
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    return { W, H };
  }

  const tip = $("#tip");
  function showTip(title, lines, x, y) {
    clear(tip); tip.append(h("strong", { text: title }), ...lines.map((l) => h("div", { text: l })));
    tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, x + 14)) + "px";
    tip.style.top = Math.max(8, y - tip.offsetHeight - 12) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  // Hover with a mouse, tap with a finger.
  function tipOn(node, title, lines) {
    node.addEventListener("mousemove", (e) => showTip(title, lines, e.clientX, e.clientY));
    node.addEventListener("mouseleave", hideTip);
    node.addEventListener("click", (e) => { e.stopPropagation(); showTip(title, lines, e.clientX, e.clientY); });
  }
  document.addEventListener("click", hideTip);
  addEventListener("scroll", hideTip, { passive: true });
  function seg(container, items, current, onPick) {
    clear(container);
    items.forEach((it) => container.append(h("button", { type: "button", "aria-pressed": String(it.id === current), onclick: () => onPick(it.id) }, it.label)));
  }
  // A crop's photo. The name always sits beside it, so a screen reader need not hear it twice.
  const photo = (id, cls) => h("img", { class: "crop-img " + (cls || ""), src: `img/crops/${id}.webp`, alt: "", width: "96", height: "96", loading: "lazy", decoding: "async" });
  // Rough figures, so rounded like rough figures: $80, $470, $2,600, $11,000.
  const usd = (v) => new Intl.NumberFormat(`${state.lang}-u-nu-latn`, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v.toPrecision(2)));
  const stat = (box, k, v, cls) => box.append(h("div", { class: "stat" }, h("div", { class: "k", text: k }), h("div", { class: "v " + (cls || ""), text: v })));
  const paintRange = (input) => input.style.setProperty("--fill", `${(100 * (input.value - input.min)) / ((input.max - input.min) || 1)}%`);
  document.addEventListener("input", (e) => { if (e.target.type === "range") paintRange(e.target); });
  const saveSetup = () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        lang: state.lang, point: state.point, placeName: state.placeName, irrigation: state.irrigation, cap: state.cap, floods: state.floods, pattern: state.pattern, crop1: state.crop1, crop2: state.crop2, w: state.w,
        allowCover: state.allowCover, allowed: state.allowedByFarmer ? [...state.allowed] : null,
        soil: { sand: $("#soil-sand").value, clay: $("#soil-clay").value, soc: $("#soil-soc").value, ph: $("#soil-ph").value },
      }));
    } catch (error) { /* private browsing: answers are simply not kept */ }
  };

  // ----------------------------------------------------------- browser cache
  // NASA's past data does not change, so a field opened once can open again offline and at once.
  if (window.caches && location.protocol.startsWith("http")) {
    N.cfg.cache = {
      get: async (url) => { const c = await caches.open("s2r-data"); const r = await c.match(url); return r ? new Uint8Array(await r.arrayBuffer()) : null; },
      put: async (url, bytes) => { const c = await caches.open("s2r-data"); await c.put(url, new Response(bytes)); },
    };
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  // HLS is read with short-lived tokens, so its raw responses cannot be cached: keep the finished series instead.
  async function hlsSeries(lat, lon, from, to, onEach) {
    const key = `https://sky2root.invalid/hls?lat=${lat}&lon=${lon}&from=${from}&to=${to}`;
    if (N.cfg.cache) {
      const hit = await N.cfg.cache.get(key);
      if (hit) return JSON.parse(new TextDecoder().decode(hit));
    }
    const series = await N.fetchHls(lat, lon, from, to, onEach);
    if (N.cfg.cache && series.length) await N.cfg.cache.put(key, new TextEncoder().encode(JSON.stringify(series)));
    return series;
  }

  // ----------------------------------------------------------- navigation
  const nav = $("#nav"), moreBtn = $("#more");
  const EXTRA_SCREENS = ["data", "monitor", "trust"];
  function setMore(open) { nav.classList.toggle("open", open); moreBtn.setAttribute("aria-expanded", String(open)); }
  moreBtn.addEventListener("click", (e) => { e.stopPropagation(); setMore(!nav.classList.contains("open")); });
  document.addEventListener("click", (e) => { if (nav.classList.contains("open") && !nav.contains(e.target)) setMore(false); });
  function pageUrl() {
    const q = new URLSearchParams();
    if (state.demoId) q.set("field", state.demoId);
    else if (state.point && state.wx) {
      // A link to a live field carries the answers it was worked out from, so an adviser can send it on.
      q.set("lat", state.point.lat); q.set("lon", state.point.lon);
      q.set("plant", state.pattern); q.set("crops", state.pattern === "single" ? state.crop1 : `${state.crop1},${state.crop2}`);
      q.set("water", state.irrigation);
      if (state.floods) q.set("floods", "1");
    }
    if (state.screen !== "field") q.set("screen", state.screen);
    if (state.period !== "past") q.set("period", state.period);
    if (state.lang !== "en") q.set("lang", state.lang);
    const text = q.toString();
    return text ? `?${text}` : location.pathname;
  }
  // Back on a phone should step back inside the app, not leave it.
  function remember() { history.pushState({ screen: state.screen, step: state.step }, "", pageUrl()); }
  addEventListener("popstate", (e) => {
    const was = e.state || { screen: "field", step: 1 };
    state.step = was.step || 1;
    go(was.screen, { silent: true });
  });
  function renderScreen() {
    const render = { field: renderField, data: renderData, simulate: renderSim, replay: renderReplay, rank: renderRank, monitor: renderMonitor, trust: renderTrust }[state.screen];
    if (render) render();
  }
  function go(screen, opts) {
    const o = opts || {};
    if (screen !== "field" && !state.wx) screen = "field";
    const moved = screen !== state.screen;
    state.screen = screen;
    setMore(false);
    hideTip();
    document.querySelectorAll(".screen").forEach((sc) => sc.classList.toggle("on", sc.id === "screen-" + screen));
    document.querySelectorAll("#nav button[data-screen]").forEach((b) => b.setAttribute("aria-current", b.dataset.screen === screen ? "page" : "false"));
    moreBtn.classList.toggle("on", EXTRA_SCREENS.includes(screen));
    if (screen !== "simulate") pause();
    if (screen === "field" || screen === "rank") renderSliders();
    renderScreen();
    if (!o.silent) remember();
    if (moved || !o.silent) {
      scrollTo(0, 0);
      if (!o.silent) focusTitle();
    }
  }
  function focusTitle() {
    const title = $(".screen.on .step.on h1, .screen.on > .screen-head h1");
    if (title) title.focus({ preventScroll: true });
  }
  document.querySelectorAll("#nav button[data-screen]").forEach((b) => b.addEventListener("click", () => go(b.dataset.screen)));
  $("#brand").addEventListener("click", () => go("field"));
  $("#field-chip").addEventListener("click", () => { state.step = 1; go("field"); });

  // Charts follow the page when a phone turns or a window resizes.
  let lastWidth = 0, resizeTimer = 0;
  new ResizeObserver(() => {
    const width = $("#main").clientWidth;
    if (Math.abs(width - lastWidth) < 24) return;
    lastWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.wx && ["data", "monitor", "trust", "rank"].includes(state.screen)) renderScreen(); }, 150);
  }).observe($("#main"));

  function applyLang() {
    I.setLang(state.lang);
    document.documentElement.lang = state.lang;
    document.title = t("meta.title");
    document.querySelectorAll("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
    document.querySelectorAll("[data-i18n-aria]").forEach((n) => { n.setAttribute("aria-label", t(n.dataset.i18nAria)); });
    renderSliders();
  }
  const langSel = $("#lang");
  I.LANGS.forEach((l) => langSel.append(h("option", { value: l.id, text: l.name })));
  langSel.value = state.lang;
  langSel.addEventListener("change", () => {
    state.lang = langSel.value;
    applyLang();
    saveSetup();
    history.replaceState(history.state, "", pageUrl());
    renderScreen();
  });

  const SLIDERS = [["rel", "prio.rel", "shield"], ["harv", "prio.harv", "wheat"], ["money", "prio.money", "coin"], ["water", "prio.water", "drop"], ["soil", "prio.soil", "sprout"], ["forage", "prio.forage", "feed"]];
  function renderSliders() {
    ["#sliders", "#rank-sliders"].forEach((sel) => {
      const box = $(sel); clear(box);
      SLIDERS.forEach(([key, label, ico]) => {
        const id = `${sel.slice(1)}-${key}`;
        const word = () => t("level." + state.w[key]);
        const out = h("output", { for: id, text: word() });
        const input = h("input", { type: "range", id, min: "0", max: "5", step: "1", value: String(state.w[key]), "aria-valuetext": word() });
        paintRange(input);
        input.addEventListener("input", () => {
          state.w[key] = Number(input.value); out.textContent = word(); input.setAttribute("aria-valuetext", word());
          if (state.screen === "rank") renderRanking();
        });
        box.append(h("div", { class: "prio" }, h("label", { for: id }, icon(ico), h("span", { text: t(label) })), out, input));
      });
    });
  }

  // ------------------------------------------------------------------ field
  let map = null, marker = null;
  function gibsLayer(layer, tms, ext, time, opts) {
    const path = time ? `${layer}/default/${time}` : `${layer}/default/default`;
    return L.tileLayer(`${TILES}/${path}/${tms}/{z}/{y}/{x}.${ext}`, Object.assign({ attribution: "NASA GIBS", tileSize: 256, noWrap: false, crossOrigin: true }, opts || {}));
  }
  function baseLayers(target) {
    gibsLayer("BlueMarble_NextGeneration", "GoogleMapsCompatible_Level8", "jpeg", null, { maxNativeZoom: 8, maxZoom: 8 }).addTo(target);
    gibsLayer("Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual", "GoogleMapsCompatible_Level12", "jpeg", "2000-12-01", { maxNativeZoom: 12, minZoom: 9, maxZoom: 14 }).addTo(target);
    const labels = gibsLayer("Reference_Labels_15m", "GoogleMapsCompatible_Level13", "png", null, { maxNativeZoom: 13, maxZoom: 14, opacity: 0.9 });
    labels.setZIndex(5);
    labels.addTo(target);
  }
  function initMap() {
    if (map || !window.L) return;
    map = L.map("world-map", { worldCopyJump: true, minZoom: 2, maxZoom: 14, zoomControl: true }).setView([15, 20], 2);
    baseLayers(map);
    map.on("click", (e) => {
      setPoint(e.latlng.lat, ((e.latlng.lng + 540) % 360) - 180, false);
      // A tap on a world map is far from exact: come closer, so the next tap can place the pin on the field itself.
      if (map.getZoom() < 9) map.setView(e.latlng, Math.min(11, map.getZoom() + 4));
    });
    if (state.point) { placeMarker(); map.setView([state.point.lat, state.point.lon], 8); }
  }
  function placeMarker() {
    if (!map || !state.point) return;
    if (!marker) marker = L.marker([state.point.lat, state.point.lon]).addTo(map);
    else marker.setLatLng([state.point.lat, state.point.lon]);
  }
  const coordName = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
  function renderPointNote() {
    const note = $("#point-note");
    note.classList.toggle("set", !!state.point);
    note.textContent = state.point ? t("point.set", { place: state.placeName || coordName(state.point.lat, state.point.lon) }) : t("point.none");
    $("#next1").disabled = !state.point;
    document.querySelectorAll("#steps button").forEach((b) => { if (+b.dataset.step > 1) b.disabled = !state.point; });
  }
  function setPoint(lat, lon, keepDemo, placeName) {
    state.point = { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
    state.placeName = placeName || null;
    state.floodsByFarmer = false;
    state.water = null;
    renderWaterHint();
    $("#lat").value = state.point.lat; $("#lon").value = state.point.lon;
    if (!keepDemo) state.demoId = "";
    placeMarker();
    renderPointNote();
  }
  ["#lat", "#lon"].forEach((sel) => $(sel).addEventListener("change", () => {
    const lat = parseFloat($("#lat").value), lon = parseFloat($("#lon").value);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 84 && Math.abs(lon) <= 180) {
      setPoint(lat, lon, false);
      if (map) map.setView([lat, lon], Math.max(map.getZoom(), 8));
    }
  }));
  $("#locate").addEventListener("click", () => {
    const note = $("#point-note");
    const failed = () => { note.classList.remove("set"); note.textContent = t("locate.fail"); };
    if (!navigator.geolocation) return failed();
    navigator.geolocation.getCurrentPosition((pos) => {
      setPoint(pos.coords.latitude, pos.coords.longitude, false);
      if (map) map.setView([state.point.lat, state.point.lon], 13);
    }, failed, { timeout: 15000 });
  });
  function choosePlace(r) {
    setPoint(parseFloat(r.lat), parseFloat(r.lon), false, r.display_name.split(",").slice(0, 2).join(",").trim());
    if (map) map.setView([state.point.lat, state.point.lon], 11);
    $("#search-results").hidden = true;
  }
  // Runs only when the person asks, one search at a time, as Nominatim's rules require (no search-as-you-type).
  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#search").value.trim();
    if (!q) return;
    const box = $("#search-results"); clear(box); box.hidden = false;
    box.append(h("p", { class: "muted", text: t("search.busy") }));
    try {
      const found = await N.getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=${state.lang}&q=${encodeURIComponent(q)}`, { timeout: 15000, retries: 1, noCache: true });
      clear(box);
      if (!found.length) box.append(h("p", { text: t("search.none") }));
      else if (found.length === 1) choosePlace(found[0]);
      else found.forEach((r) => box.append(h("button", { type: "button", class: "result", text: r.display_name, onclick: () => choosePlace(r) })));
    } catch (error) {
      clear(box);
      box.append(h("p", { text: t("search.fail") }));
    }
  });

  const CROP_LIST = Object.values(CROPS).filter((c) => !c.cover);
  // The crops most grown in this country come first, once we know the country.
  const cropOrder = () => {
    const share = (c) => (state.market ? state.market.shares[E.marketCrop(c.id)] || 0 : 0);
    return CROP_LIST.slice().sort((a, b) => share(b) - share(a));
  };
  // Chosen by picture as well as by name: not everyone knows a crop by its written name.
  function cropPicker(box, current, onPick) {
    const wasOpen = box.firstChild && box.firstChild.open;
    clear(box);
    const d = h("details", { class: "crop-pick" },
      h("summary", {}, photo(current, "md"), h("span", { class: "crop-pick-name" }, h("b", { text: cropName(current) }), h("small", { text: t("crop.change") })), icon("chev", "chev")),
      state.market ? h("p", { class: "hint", text: t("crop.near", { country: state.market.name }) }) : null,
      h("div", { class: "crop-grid" }, cropOrder().map((c) => h("button", { type: "button", "aria-pressed": String(c.id === current), onclick: () => { onPick(c.id); box.firstChild.open = false; fillRotationInputs(); box.querySelector("summary").focus(); } }, photo(c.id), h("span", { text: cropName(c.id) })))));
    d.open = !!wasOpen;
    box.append(d);
  }
  function fillRotationInputs() {
    cropPicker($("#crop1"), state.crop1, (id) => { state.crop1 = id; });
    cropPicker($("#crop2"), state.crop2, (id) => { state.crop2 = id; });
    seg($("#pattern-seg"), ["single", "double", "alternate"].map((id) => ({ id, label: h("b", { text: t("pattern." + id) }) })), state.pattern, (id) => { state.pattern = id; renderField(); });
    $("#crop2-wrap").hidden = state.pattern === "single";
    $("#crop1-label").textContent = t(state.pattern === "single" ? "crop.only" : state.pattern === "double" ? "crop.first" : "crop.yearOne");
    $("#crop2-label").textContent = t(state.pattern === "double" ? "crop.second" : "crop.yearTwo");
  }
  function renderAllowed() {
    const box = $("#allowed"); clear(box);
    cropOrder().forEach((c) => {
      const cb = h("input", { type: "checkbox" });
      cb.checked = state.allowed.has(c.id);
      cb.dataset.crop = c.id;
      cb.addEventListener("change", () => { state.allowedByFarmer = true; if (cb.checked) state.allowed.add(c.id); else state.allowed.delete(c.id); });
      box.append(h("label", {}, cb, photo(c.id, "xs"), h("span", { text: cropName(c.id) })));
    });
    const cover = h("input", { type: "checkbox" });
    cover.checked = state.allowCover;
    cover.addEventListener("change", () => { state.allowCover = cover.checked; });
    box.append(h("label", {}, cover, photo("coverCool", "xs"), h("span", { text: t("allowed.cover") })));
    const note = $("#market-note");
    note.textContent = state.market ? t("market.note", { pct: GROWN_HERE * 100, country: state.market.name }) : t("market.none");
  }
  function renderDemos() {
    const box = $("#demos"); clear(box);
    state.demos.forEach((f) => box.append(h("button", { type: "button", class: "ex", onclick: () => openDemo(f.id) }, h("b", { text: f.name }), h("small", { text: t("ex." + f.id) }))));
    $("#examples").hidden = !state.demos.length;
    $("#to-examples").hidden = !state.demos.length;
  }
  function setStep(n, silent) {
    state.step = n;
    document.querySelectorAll(".step").forEach((el) => el.classList.toggle("on", +el.dataset.step === n));
    document.querySelectorAll("#steps button").forEach((b) => {
      const k = +b.dataset.step;
      if (k === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      b.classList.toggle("done", k < n);
    });
    if (n === 1 && map) setTimeout(() => map.invalidateSize(), 0);
    if (!silent) { remember(); scrollTo(0, 0); focusTitle(); }
    if (n === 2 && !silent) lookAround();
  }
  document.querySelectorAll("#steps button").forEach((b) => b.addEventListener("click", () => setStep(+b.dataset.step)));
  document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => setStep(+b.dataset.goto)));
  $("#next1").addEventListener("click", () => setStep(2));
  // As soon as the farmer moves on from the map: what grows in this country, and has Landsat seen water on this spot?
  async function lookAround() {
    const point = state.point;
    if (!point || state.demoId || state.lookedAt === point) return;
    state.lookedAt = point;
    await applyMarket({ lat: point.lat, lon: point.lon });
    if (state.point !== point) return;
    if (!document.querySelector(".crop-pick[open]")) fillRotationInputs(); // never reorder the pictures under someone's finger
    renderAllowed();
    const water = await N.fetchSurfaceWater(point.lat, point.lon).catch(() => null);
    if (state.point !== point || !water) return;
    state.water = water;
    if (!state.floodsByFarmer && water.occurrence >= WATER_OFTEN) { state.floods = true; $("#floods").checked = true; }
    renderWaterHint();
  }
  const WATER_OFTEN = 10, WATER_ALWAYS = 75; // percent of clear Landsat views since 1984
  function renderWaterHint() {
    const note = $("#water-hint"), w = state.water;
    note.hidden = !w;
    if (!w) return;
    const n = w.occurrence;
    note.textContent = n >= WATER_ALWAYS ? t("hint.water.lake", { n }) : n >= WATER_OFTEN ? t(state.floods ? "hint.water.often" : "hint.water.oftenNo", { n }) : n > 0 ? t("hint.water.some", { n }) : t("hint.water.none");
  }
  $("#to-examples").addEventListener("click", () => $("#examples").scrollIntoView({ behavior: glide() }));
  function renderField() {
    initMap();
    fillRotationInputs();
    seg($("#water-seg"), ["none", "limited", "full"].map((id) => ({ id, label: [h("b", { text: t("water." + id) }), h("small", { text: t("water." + id + ".d") })] })), state.irrigation, (id) => { state.irrigation = id; renderField(); });
    $("#cap-row").hidden = state.irrigation !== "limited";
    $("#cap-out").textContent = t("unit.mm", { n: state.cap });
    $("#floods").checked = !!state.floods;
    renderAllowed();
    renderDemos();
    renderPointNote();
    setStep(state.step, true);
    if (map) setTimeout(() => map.invalidateSize(), 0);
  }
  $("#floods").addEventListener("change", (e) => { state.floods = e.target.checked; state.floodsByFarmer = true; renderWaterHint(); });
  $("#cap").addEventListener("input", (e) => { state.cap = +e.target.value; $("#cap-out").textContent = t("unit.mm", { n: state.cap }); });

  async function loadDemos() {
    try {
      state.demos = await (await fetch("fields/index.json")).json();
      renderDemos();
      const wanted = params.get("field");
      if (wanted && state.demos.some((f) => f.id === wanted)) { await openDemo(wanted); return true; }
    } catch (error) { /* no examples when opened without a web server: the live path still works */ }
    return false;
  }
  async function pickDemo(id) {
    const f = state.demos.find((x) => x.id === id);
    const pack = await (await fetch(`fields/${id}.json`)).json();
    state.demoId = id;
    setPoint(f.lat, f.lon, true, f.name);
    if (map) map.setView([f.lat, f.lon], 8);
    state.pack = pack;
    state.irrigation = pack.irrigation || "none";
    state.floods = !!pack.floods;
    state.floodsByFarmer = true;
    state.water = pack.water || null;
    renderWaterHint();
    state.pattern = pack.current.pattern;
    state.crop1 = pack.current.crops[0];
    state.crop2 = pack.current.crops[1] || state.crop2;
  }
  async function openDemo(id) {
    showBusy();
    try { await pickDemo(id); } catch (error) { showRunError(t("err.net"), error.message); return; }
    await run();
  }

  // --------------------------------------------------------------- progress
  const PROGRESS = ["weather", "soil", "slope", "landCover", "deltas", "simulate", "hls", "ndvi", "smap", "grace", "water", "fire"];
  // Rough share of the waiting time before the first answer: the 40-year weather download is the long part.
  const FIRST_ANSWER = { weather: 55, soil: 5, slope: 10, landCover: 10, simulate: 20 };
  function progress(id, text, cls) {
    const box = $("#progress");
    let row = box.querySelector(`[data-id="${id}"]`);
    if (!row) {
      row = h("li", { "data-id": id }, h("span", { text: t("prog." + (PROGRESS.includes(id) ? id : "simulate")) }), h("span", { class: "st" }));
      box.append(row);
    }
    const st = row.querySelector(".st");
    st.className = "st " + (cls || "");
    st.textContent = cls === "ok" ? "✓" : text;
    if (cls === "busy" && id in FIRST_ANSWER) $("#busy-now").textContent = row.firstChild.textContent;
    let done = 0;
    for (const [k, share] of Object.entries(FIRST_ANSWER)) {
      const s1 = box.querySelector(`[data-id="${k}"] .st`);
      if (s1) done += s1.classList.contains("busy") ? share * 0.2 : share;
    }
    $("#busy-bar").style.width = `${Math.max(4, done)}%`;
    $("#bg-status").hidden = !(document.body.classList.contains("has-results") && box.querySelector(".st.busy"));
  }
  function showBusy() {
    $("#wizard").classList.add("is-busy");
    $("#busy").hidden = false;
    $("#busy-main").hidden = false;
    $("#busy-error").hidden = true;
    clear($("#progress"));
    $("#busy-bar").style.width = "4%";
    $("#busy-now").textContent = "";
    scrollTo(0, 0);
  }
  function hideBusy() {
    $("#wizard").classList.remove("is-busy");
    $("#busy").hidden = true;
  }
  function showRunError(message, detail) {
    $("#busy-main").hidden = true;
    $("#busy-error").hidden = false;
    $("#busy-error-msg").textContent = message;
    $("#busy-error-detail").textContent = detail || "";
  }
  $("#retry").addEventListener("click", () => (state.demoId ? openDemo(state.demoId) : run()));
  $("#busy-back").addEventListener("click", () => { hideBusy(); go("field", { silent: true }); });

  // ---------------------------------------------------------------- analysis
  $("#run").addEventListener("click", () => { state.demoId && state.pack && state.pack.id !== state.demoId ? openDemo(state.demoId) : run(); });
  async function run() {
    if (!state.point) return;
    saveSetup();
    showBusy();
    resetResults();
    try {
      let pack = state.demoId && state.pack && state.pack.id === state.demoId ? state.pack : null;
      if (pack) await analyse(pack);
      else await liveField();
    } catch (error) {
      showRunError(t("err.net"), error.message);
    }
  }
  function resetResults() {
    Object.assign(state, { wx: null, soil: null, clim: null, items: [], current: null, scenarioCache: {}, wxCache: {}, runCache: {}, selected: null, repRot: null, repPick: null, simRot: null, simSeason: null, period: state.period });
    document.body.classList.remove("has-results");
    $("#field-chip").hidden = true;
    $("#bg-status").hidden = true;
  }
  async function liveField() {
    const { lat, lon } = state.point;
    const wait = t("prog.wait"), na = t("prog.na");
    progress("weather", wait, "busy");
    const weather = await N.fetchWeather(lat, lon, FIRST_YEAR, LAST_YEAR);
    progress("weather", "", "ok");
    progress("soil", wait, "busy");
    const soil = await N.soilFromGrid(lat, lon);
    progress("soil", na, soil ? "ok" : "bad");
    progress("slope", wait, "busy");
    const slope = await N.fetchSlope(lat, lon).catch(() => null);
    progress("slope", na, slope ? "ok" : "bad");
    progress("landCover", wait, "busy");
    const landCover = await N.fetchLandCover(lat, lon).catch(() => null);
    progress("landCover", na, landCover ? "ok" : "bad");
    const pack = { id: "", name: state.placeName || coordName(lat, lon), lat, lon, elev: weather.elev, soil, slope, landCover, weather, ndvi: null, smap: null, grace: null, water: state.water, burned: null, current: null, irrigation: state.irrigation };
    state.pack = pack;
    await analyse(pack);
    // These three take longer and are not needed for the first answer, so they fill in afterwards.
    if (state.wx) backgroundData(pack);
    N.fetchSoil(lat, lon).then((fine) => {
      if (state.pack === pack) { pack.soil = fine; progress("soil", "", "ok"); analyse(pack, true); }
    }).catch(() => {});
  }
  function backgroundData(pack) {
    const { lat, lon } = pack;
    const wait = t("prog.wait"), na = t("prog.na");
    const of = (a, b) => t("prog.of", { a, b });
    const refresh = () => { if (state.pack === pack && ["monitor", "trust", "data", "rank"].includes(state.screen)) renderScreen(); };
    progress("smap", wait, "busy");
    const end = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    N.fetchSmap(lat, lon, end, 16, (a, b) => progress("smap", of(a, b), "busy")).then((v) => { pack.smap = v; progress("smap", "", "ok"); refresh(); }).catch(() => progress("smap", na, "bad"));
    progress("grace", wait, "busy");
    N.fetchGrace(lat, lon).then((v) => { pack.grace = v; progress("grace", "", "ok"); refresh(); }).catch(() => progress("grace", na, "bad"));
    progress("hls", wait, "busy");
    hlsSeries(lat, lon, `${LAST_YEAR - 4}-01-01`, end, (a, b) => progress("hls", of(a, b), "busy")).then((v) => { pack.hls = v; progress("hls", "", "ok"); refresh(); }).catch(() => progress("hls", na, "bad"));
    progress("ndvi", wait, "busy");
    N.fetchNdvi(lat, lon, LAST_YEAR - 9, LAST_YEAR, (a, b) => progress("ndvi", of(a, b), "busy")).then((v) => { pack.ndvi = v; progress("ndvi", "", "ok"); refresh(); }).catch(() => progress("ndvi", na, "bad"));
    progress("fire", wait, "busy");
    N.fetchBurned(lat, lon, 2001, LAST_YEAR, (a, b) => progress("fire", of(a, b), "busy")).then((v) => { pack.burned = v; progress("fire", "", "ok"); refresh(); }).catch(() => progress("fire", na, "bad"));
    if (!pack.water) {
      progress("water", wait, "busy");
      N.fetchSurfaceWater(lat, lon).then((v) => { pack.water = v; progress("water", "", "ok"); refresh(); }).catch(() => progress("water", na, "bad"));
    }
  }
  function soilOf(pack) {
    const input = { sand: parseFloat($("#soil-sand").value), clay: parseFloat($("#soil-clay").value), soc: parseFloat($("#soil-soc").value), ph: parseFloat($("#soil-ph").value) };
    const mapped = pack.soil || { sand: 40, clay: 25, soc: 1, source: t("soil.assumed") };
    const ph = Number.isFinite(input.ph) ? { ph: input.ph, phTested: true } : {};
    if (Number.isFinite(input.sand) && Number.isFinite(input.clay)) {
      return Object.assign({ ph: mapped.ph }, ph, { sand: input.sand, clay: input.clay, soc: Number.isFinite(input.soc) ? input.soc : 1, source: t("soil.yours") });
    }
    return Object.assign({}, mapped, ph);
  }
  // Crops under this share of the country's crop area probably lack seed, know-how and buyers: not suggested unless ticked.
  const GROWN_HERE = 0.003;
  async function applyMarket(pack) {
    let code = pack.country;
    if (code === undefined) {
      code = await N.fetchCountry(pack.lat, pack.lon).catch(() => null);
      pack.country = code;
    }
    state.market = await N.cropsInCountry(code).catch(() => null);
    if (!state.market) return;
    if (!state.allowedByFarmer) {
      const shares = state.market.shares;
      state.allowed = new Set(CROP_LIST.filter((c) => (shares[c.id === "winterWheat" ? "wheat" : c.id] || 0) >= GROWN_HERE).map((c) => c.id));
      document.querySelectorAll("#allowed input[data-crop]").forEach((cb) => { cb.checked = state.allowed.has(cb.dataset.crop); });
    }
  }
  async function analyse(pack, stayPut) {
    progress("simulate", t("prog.wait"), "busy");
    await nextFrame();
    await applyMarket(pack);
    Object.assign(state, { scenarioCache: {}, runCache: {}, checks: null, checksFor: null, ensoCache: {} });
    if (!state.enso) {
      const raw = await N.loadEnso().catch(() => null);
      if (raw) state.enso = Object.assign(raw, { phase: E.ensoPhases(raw.oni) });
    }
    state.wx = E.prepareWeather(pack.weather, pack.lat, pack.elev);
    state.soil = E.soilFrom(Object.assign({}, soilOf(pack), { slope: pack.slope ? pack.slope.slope : 1, floods: state.floods }));
    state.clim = E.analyseClimate(state.wx, state.soil, state.irrigation);
    state.erosivity = E.erosivityOf(state.wx);
    const currentSpec = { crops: state.pattern === "single" ? [state.crop1] : [state.crop1, state.crop2], pattern: state.pattern };
    const allowed = [...state.allowed];
    const c = E.candidates(state.clim, allowed, currentSpec);
    const opts = simOptions();
    const items = [];
    const rotations = c.rotations.filter((r) => state.allowCover || r.isCurrent || !r.slots.some((x) => x.isCover));
    for (let i = 0; i < rotations.length; i++) {
      const rot = rotations[i];
      const m = E.summarize(E.simulate(state.wx, state.soil, rot, Object.assign({ erosivity: state.erosivity }, opts)), state.soil);
      m.income = E.harvestValue(m, state.market);
      items.push({ id: rot.id, rot, m });
      if (i % 25 === 0) { progress("simulate", t("prog.of", { a: i, b: rotations.length }), "busy"); await nextFrame(); }
    }
    if (!items.length) {
      state.wx = null;
      progress("simulate", t("prog.na"), "bad");
      showRunError(t(state.irrigation === "none" ? "err.noCropRain" : "err.noCrop"));
      return;
    }
    state.items = items;
    state.suitable = c.suitable;
    state.current = items.find((x) => x.rot.isCurrent) || null;
    // Finer soil data can arrive while someone is reading: keep what they were looking at.
    const keep = (id) => (stayPut && items.some((x) => x.id === id) ? id : (state.current || items[0]).id);
    if (!stayPut) state.selected = null;
    state.repRot = keep(state.repRot);
    state.simRot = keep(state.simRot);
    progress("simulate", "", "ok");
    $("#field-name").textContent = pack.name;
    $("#field-chip").hidden = false;
    document.body.classList.add("has-results");
    if (state.deltasFor !== pack) {
      state.deltasFor = pack;
      progress("deltas", t("prog.wait"), "busy");
      state.deltas = await N.loadDeltas(pack.lat, pack.lon).catch(() => null);
      progress("deltas", t("prog.na"), state.deltas ? "ok" : "bad");
      if (!state.deltas && state.period.startsWith("ssp")) state.period = "past";
    }
    hideBusy();
    if (state.screen === "field" && !stayPut) {
      const want = firstScreen;
      firstScreen = null;
      go(want && want !== "field" ? want : "rank");
    } else renderScreen();
  }
  const simOptions = () => ({ irrigation: state.irrigation, irrigationCap: state.cap });

  // ------------------------------------------------------- climate scenarios
  const PERIODS = () => {
    const out = [{ id: "past", label: t("period.past") }];
    if (state.deltas) out.push({ id: "ssp245", label: t("period.ssp245") }, { id: "ssp585", label: t("period.ssp585") });
    out.push({ id: "custom", label: t("period.custom") });
    return out;
  };
  function wxFor(key) {
    if (state.wxCache[key]) return state.wxCache[key];
    let change = null;
    if (key.startsWith("custom")) {
      const { dT, rain } = state.custom;
      change = { dTmax: Array(12).fill(dT), dTmin: Array(12).fill(dT), rainRatio: Array(12).fill(1 + rain / 100) };
    } else {
      const [model, ssp] = key.split("|");
      change = state.deltas[model][ssp];
    }
    return (state.wxCache[key] = E.prepareWeather(state.pack.weather, state.pack.lat, state.pack.elev, change));
  }
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  // The options worth carrying into a climate test: the best for each single priority and for the current mix.
  function shortlist() {
    const ids = new Set();
    if (state.current) ids.add(state.current.id);
    const mixes = [state.w, { rel: 1 }, { harv: 1 }, { money: 1 }, { water: 1 }, { soil: 1 }, { rel: 4, harv: 3, water: 2, soil: 4 }];
    for (const w of mixes) distinctTop(E.rank(state.items, w), 6).forEach((x) => ids.add(x.id));
    return state.items.filter((x) => ids.has(x.id));
  }
  function runScenario(item, key) {
    const m = E.summarize(E.simulate(wxFor(key), state.soil, item.rot, simOptions()), state.soil);
    m.income = E.harvestValue(m, state.market);
    return m;
  }
  // Metrics of one rotation under one period: the median across climate models, with their range.
  function metricsFor(item, period) {
    if (period === "past") return item.m;
    const cacheKey = `${period}|${period === "custom" ? state.custom.dT + "," + state.custom.rain : ""}|${item.id}`;
    if (state.scenarioCache[cacheKey]) return state.scenarioCache[cacheKey];
    let out;
    if (period === "custom") {
      delete state.wxCache.custom;
      out = runScenario(item, "custom");
    } else {
      const each = N.CMIP6.models.map((model) => ({ model, m: runScenario(item, `${model}|${period}`) }));
      const mid = each.slice().sort((a, b) => a.m.failed - b.m.failed)[Math.floor(each.length / 2)];
      out = Object.assign({}, mid.m);
      for (const k of ["harvest", "income", "et", "irrigation", "water", "soil", "rootDays", "soilLoss", "forage", "reliability", "bareDays"]) out[k] = median(each.map((e) => e.m[k]));
      out.range = { failed: [Math.min(...each.map((e) => e.m.failed)), Math.max(...each.map((e) => e.m.failed))], models: each.length };
      out.showModel = mid.model;
    }
    return (state.scenarioCache[cacheKey] = out);
  }
  function itemsFor(period) {
    if (period === "past") return state.items;
    return shortlist().map((x) => Object.assign({}, x, { m: metricsFor(x, period) }));
  }
  // Only the best variant of each crop combination, so the list shows real choices.
  function distinctTop(ranked, n) {
    const seen = new Set(), out = [];
    for (const x of ranked) {
      const key = x.rot.crops.slice().sort().join("+") + "|" + x.rot.pattern;
      if (seen.has(key)) continue;
      seen.add(key); out.push(x);
      if (out.length >= n) break;
    }
    return out;
  }
  function customCard(sel, rerender) {
    const box = $(sel);
    box.hidden = state.period !== "custom";
    if (state.period !== "custom") return;
    clear(box);
    const row = (label, key, min, max, step, fmt) => {
      const out = h("output", { text: fmt(state.custom[key]) });
      const input = h("input", { type: "range", min, max, step, value: state.custom[key], "aria-label": label });
      paintRange(input);
      input.addEventListener("input", () => { out.textContent = fmt(+input.value); });
      input.addEventListener("change", () => { state.custom[key] = +input.value; delete state.wxCache.custom; state.scenarioCache = {}; state.runCache = {}; rerender(); });
      return [h("span", { text: label }), input, out];
    };
    box.append(h("h2", { text: t("period.custom") }), h("p", { class: "hint", style: "margin-top:0", text: t("whatif.sub") }),
      h("div", { class: "scenario-sliders" }, row(t("whatif.warm"), "dT", "-1", "5", "0.5", (v) => `${v > 0 ? "+" : ""}${v} °C`), row(t("whatif.rain"), "rain", "-40", "40", "5", (v) => `${v > 0 ? "+" : ""}${v}%`)));
  }
  function periodSeg(sel, cardSel, noteSel, rerender) {
    seg($(sel), PERIODS(), state.period, (id) => { state.period = id; history.replaceState(history.state, "", pageUrl()); rerender(); });
    customCard(cardSel, rerender);
    const note = $(noteSel);
    note.hidden = state.period !== "ssp245" && state.period !== "ssp585";
    if (!note.hidden) note.textContent = t("period.note." + state.period);
  }

  // Full simulation of one rotation under the current period, with its daily weather.
  function runOf(id, traceIndex) {
    const item = state.items.find((x) => x.id === id);
    const period = state.period;
    let wx = state.wx;
    if (period === "custom") wx = wxFor("custom");
    else if (period !== "past") wx = wxFor(`${metricsFor(item, period).showModel}|${period}`);
    const opts = Object.assign({}, simOptions());
    if (traceIndex != null) opts.trace = traceIndex;
    return { run: E.simulate(wx, state.soil, item.rot, opts), wx };
  }
  function rotOptions(sel, value, onPick) {
    clear(sel);
    const ranked = distinctTop(E.rank(state.items, state.w), 8);
    const list = state.current && !ranked.some((x) => x.id === state.current.id) ? [state.current, ...ranked] : ranked;
    if (value && !list.some((x) => x.id === value)) list.unshift(state.items.find((x) => x.id === value));
    list.forEach((x) => sel.append(h("option", { value: x.id, text: (x.rot.isCurrent ? t("plan.nowPrefix") : "") + planName(x.rot) })));
    sel.value = value;
    sel.onchange = () => onPick(sel.value);
  }

  // ------------------------------------------------------------------- data
  let layerMap = null, layerOverlay = null;
  const LAYERS = [
    { id: "truecolor", layer: "MODIS_Terra_CorrectedReflectance_TrueColor", tms: "GoogleMapsCompatible_Level9", ext: "jpeg" },
    { id: "rain", layer: "IMERG_Precipitation_Rate", tms: "GoogleMapsCompatible_Level6", ext: "png", legend: "GPM_Precipitation_Rate" },
    { id: "soil", layer: "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", tms: "GoogleMapsCompatible_Level6", ext: "png", legend: "SMAP_Analyzed_Soil_Moisture" },
    { id: "ndvi", layer: "MODIS_Terra_L3_NDVI_16Day", tms: "GoogleMapsCompatible_Level9", ext: "png", legend: "MODIS_L3_NDVI" },
    { id: "temp", layer: "MERRA2_2m_Air_Temperature_Monthly", tms: "GoogleMapsCompatible_Level6", ext: "png", monthly: true, legend: "MERRA2_2m_Air_Temperature_Monthly" },
    { id: "grace", layer: "GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI", tms: "GoogleMapsCompatible_Level6", ext: "png", legend: "GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI", fixed: "2022-06-01" },
  ];
  function layerDate(L1) {
    if (L1.fixed) return L1.fixed;
    const v = $("#layer-date").value || new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    if (L1.monthly) { const d = new Date(Date.now() - 100 * 864e5); return `${d.toISOString().slice(0, 7)}-01`; }
    if (L1.id === "ndvi") { const d = new Date(v + "T00:00:00Z"); const y = d.getUTCFullYear(); const doy = Math.floor((d - Date.UTC(y, 0, 1)) / 864e5); const snapped = new Date(Date.UTC(y, 0, 1 + Math.max(0, Math.floor((doy - 16) / 16) * 16))); return snapped.toISOString().slice(0, 10); }
    return v;
  }
  function renderLayer() {
    const L1 = LAYERS.find((x) => x.id === state.layer);
    if (!layerMap) {
      layerMap = window.L ? L.map("layer-map", { minZoom: 2, maxZoom: 12 }) : null;
      if (!layerMap) return;
      baseLayers(layerMap);
      $("#layer-date").value = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      $("#layer-date").addEventListener("change", renderLayer);
    }
    const P = state.pack;
    if (state.layerAt !== P) { layerMap.setView([P.lat, P.lon], 6); state.layerAt = P; if (state.layerPin) state.layerPin.remove(); state.layerPin = L.marker([P.lat, P.lon]).addTo(layerMap); }
    setTimeout(() => layerMap.invalidateSize(), 0);
    seg($("#layer-seg"), LAYERS.map((x) => ({ id: x.id, label: t("layer." + x.id) })), state.layer, (id) => { state.layer = id; renderLayer(); });
    if (layerOverlay) layerOverlay.remove();
    const date = layerDate(L1);
    const max = parseInt(L1.tms.match(/\d+$/)[0], 10);
    layerOverlay = gibsLayer(L1.layer, L1.tms, L1.ext, date, { maxNativeZoom: max, maxZoom: 14, opacity: L1.id === "truecolor" ? 1 : 0.8 }).addTo(layerMap);
    layerOverlay.setZIndex(3);
    const cap = $("#layer-caption"); clear(cap);
    cap.append(`${t("layer.what." + L1.id)} ${t("layer.date", { date })}`);
    if (L1.legend) cap.append(h("br"), h("img", { src: `https://gibs.earthdata.nasa.gov/legends/${L1.legend}_H.svg`, alt: t("layer." + L1.id), style: "max-width:min(100%,380px);margin-top:6px" }));
  }
  function monthlyClimate() {
    const c = state.clim, out = [];
    const edges = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
    for (let m = 0; m < 12; m++) {
      let rain = 0, et0 = 0, tx = 0, tn = 0;
      const n = edges[m + 1] - edges[m];
      for (let d = edges[m]; d < edges[m + 1]; d++) { rain += c.rainRaw[d]; et0 += c.et0[d]; tx += c.tmax[d]; tn += c.tmin[d]; }
      out.push({ rain, et0, tx: tx / n, tn: tn / n });
    }
    return out;
  }
  const legLine = (label, color, kind) => h("span", { class: "leg-line" }, h("i", { class: kind || "", style: kind === "bar" ? `background:${color}` : `border-color:${color}` }), label);
  function renderData() {
    const c = state.clim, P = state.pack, mo = monthlyClimate();
    const svg = $("#clim-chart"); clear(svg);
    const { W, H } = fit(svg, 0.55, 230, 320);
    const x0 = 34, x1 = W - 30, y0 = 10, y1 = H - 24, w = (x1 - x0) / 12;
    const maxMm = Math.max(50, ...mo.map((m) => Math.max(m.rain, m.et0))) * 1.08;
    const tMin = Math.min(0, ...mo.map((m) => m.tn)), tMax = Math.max(35, ...mo.map((m) => m.tx)) + 2;
    const Y = (v) => y1 - (v / maxMm) * (y1 - y0), YT = (v) => y1 - ((v - tMin) / (tMax - tMin)) * (y1 - y0);
    for (let i = 0; i <= 4; i++) {
      const mm = (maxMm * i) / 4, ty = tMin + ((tMax - tMin) * i) / 4;
      s("line", { x1: x0, x2: x1, y1: Y(mm), y2: Y(mm), stroke: "#e6eae4" }, svg);
      s("text", { x: x0 - 6, y: Y(mm) + 4, "text-anchor": "end", "font-size": 11, fill: "#3e6db0", text: Math.round(mm) }, svg);
      s("text", { x: x1 + 6, y: Y(mm) + 4, "font-size": 11, fill: "#b4521e", text: `${Math.round(ty)}°` }, svg);
    }
    const monthStyle = w < 34 ? "narrow" : "short";
    mo.forEach((m, i) => {
      s("rect", { x: x0 + i * w + Math.min(5, w * 0.14), y: Y(m.rain), width: w - 2 * Math.min(5, w * 0.14), height: y1 - Y(m.rain), fill: "#5b8fd6", rx: 3 }, svg);
      s("text", { x: x0 + i * w + w / 2, y: y1 + 16, "text-anchor": "middle", "font-size": 12, fill: "#56625a", text: monthName(i, monthStyle) }, svg);
    });
    const line = (f, stroke, dash, yf) => s("polyline", { points: mo.map((m, i) => `${x0 + i * w + w / 2},${yf(f(m))}`).join(" "), fill: "none", stroke, "stroke-width": 2.5, "stroke-dasharray": dash || "", "stroke-linejoin": "round" }, svg);
    line((m) => m.et0, "#0f7d74", "6 4", Y);
    line((m) => m.tx, "#d0582e", "", YT);
    line((m) => m.tn, "#e9a27f", "", YT);
    const legend = $("#clim-legend"); clear(legend);
    legend.append(legLine(t("data.leg.rain"), "#5b8fd6", "bar"), legLine(t("data.leg.demand"), "#0f7d74", "dash"), legLine(t("data.leg.high"), "#d0582e"), legLine(t("data.leg.low"), "#e9a27f"));
    $("#clim-caption").textContent = t("data.caption", { a: c.y0, b: c.y1 });
    const facts = $("#clim-facts"); clear(facts);
    const dl = h("dl", { class: "facts" });
    const row = (k, v, small) => dl.append(h("dt", { text: k }), h("dd", {}, v, small ? h("small", { text: small }) : null));
    row(t("data.f.rain"), t("data.f.rain.v", { n: Math.round(c.annualRain) }), t("data.f.rain.s", { n: Math.round(c.annualEt0) }));
    row(t("data.f.growing"), c.growing.length ? c.growing.slice(0, 2).map((p) => (p.days >= 360 ? t("data.allYear") : t("data.f.growing.v", { a: dayName(p.start), b: dayName(p.end), n: p.days }))).join(", ") : t("data.f.growing.none"), t("data.f.growing.s"));
    row(t("data.f.frost"), c.frostFree.length && c.frostFree[0].days >= 360 ? t("data.allYear") : c.frostFree.length ? t("data.f.frost.v", { a: dayName(c.frostFree[0].start), b: dayName(c.frostFree[0].end) }) : t("data.f.frost.none"));
    const sl = state.soil;
    row(t("data.f.soil"), t("data.f.soil.v", { texture: t("texture." + E.textureClass(sl.sand, sl.clay)), n: num(sl.soc, 1) }), t("data.f.soil.s", { source: sl.source || t("soil.yours"), n: Math.round(sl.taw1m) }));
    if (P.slope) row(t("data.f.slope"), `${P.slope.slope}%`, P.slope.source);
    if (P.landCover) row(t("data.f.cover"), P.landCover.name, P.landCover.isCrop ? "MODIS, 2022" : `MODIS, 2022. ${t("data.f.cover.warn")}`);
    row(t("data.f.elev"), `${Math.round(P.elev)} m`);
    if (sl.ph != null) row(t("data.f.ph"), t("data.f.ph.v", { n: num(sl.ph, 1) }), sl.phTested ? t("soil.yours") : t("data.f.ph.s"));
    if (state.suitable) {
      dl.append(h("dt", { text: t("data.f.could") }), h("dd", {}, h("div", { class: "crop-chips" }, state.suitable.slice(0, 10).map((x) => h("span", { class: "crop-chip" }, photo(x.crop.id, "xs"), cropName(x.crop.id)))), h("small", { text: t("data.f.could.s") })));
    }
    facts.append(dl);

    const tr = E.climateTrends(state.wx, c);
    const tab = $("#trends"); clear(tab);
    if (tr) {
      tr.items.forEach((it) => {
        const sign = it.perDecade > 0 ? "+" : "";
        const unitKey = it.unit === "days" ? "unit.days" : "unit.mm";
        const change = t(unitKey, { n: `${sign}${num(it.perDecade, 1)}` });
        tab.append(h("div", { class: "trend" },
          h("div", { class: "trend-top" }, h("b", { text: t("trend." + it.name) + (it.from > tr.years[0] ? ` (${t("trend.from", { y: it.from })})` : "") }), h("span", { text: t(unitKey, { n: num(it.mean, it.unit === "days" && it.mean < 3 ? 1 : 0) }) })),
          h("p", { text: t("trend.what." + it.name) }),
          h("p", { class: "change " + (it.significant && !it.drifts ? "clear" : ""), text: it.drifts ? t("trend.drifts", { v: num(tr.drift.change, 1) }) : t(it.significant ? "trend.clear" : "trend.notClear", { v: change }) })));
      });
    } else {
      tab.append(h("p", { text: t("trend.none") }));
    }
    const nowBox = $("#now-facts"); clear(nowBox);
    if (P.smap && P.smap.length > 30) {
      const last = P.smap[P.smap.length - 1];
      const doy = Math.floor((Date.parse(last.date) - Date.UTC(+last.date.slice(0, 4), 0, 1)) / 864e5);
      const same = P.smap.filter((p) => { const d = Math.floor((Date.parse(p.date) - Date.UTC(+p.date.slice(0, 4), 0, 1)) / 864e5); return Math.abs(d - doy) <= 20 && p.date !== last.date; });
      const normal = same.reduce((a, p) => a + p.v, 0) / (same.length || 1);
      const diff = ((last.v - normal) / (normal || 1)) * 100;
      const how = Math.abs(diff) < 5 ? t("now.normal") : t(diff > 0 ? "now.wetter" : "now.drier", { n: num(Math.abs(diff)) });
      nowBox.append(h("p", {}, h("b", { text: t("now.smap") + " " }), t("now.smap.v", { v: num(last.v, 2), date: last.date, how })));
    }
    const g = graceTrend();
    if (g) nowBox.append(h("p", {}, h("b", { text: t("now.grace") + " " }), t(g.trend < 0 ? "now.grace.down" : "now.grace.up", { n: num(Math.abs(g.trend), 1), a: g.first, b: g.last }) + (g.significant ? "" : ` ${t("now.grace.unclear")}`)));
    renderLayer();
  }
  function graceTrend() {
    const G = state.pack.grace;
    if (!G || G.length < 20) return null;
    const xs = G.map((p) => +p.date.slice(0, 4) + (+p.date.slice(5, 7) - 1) / 12);
    const tr = E.trend(G.map((p) => p.v), xs);
    return { trend: tr.slope, significant: tr.p < 0.05, first: G[0].date.slice(0, 4), last: G[G.length - 1].date.slice(0, 4) };
  }

  // ----------------------------------------------------------------- replay
  // Ten boxes to a row, one row for each ten years: big enough to tap on a phone and easy to count.
  function yearBlock(title, y0, y1, cellFor, img) {
    const rows = [];
    for (let start = y0; start <= y1; start += 10) {
      const cells = [];
      for (let y = start; y < start + 10; y++) cells.push((y <= y1 && cellFor(y)) || h("span", { class: "ycell none" }));
      rows.push(h("div", { class: "yrow" }, h("span", { class: "yr", text: String(start) }), cells));
    }
    return h("div", { class: "yblock" }, h("h3", {}, img ? photo(img, "xs") : null, title), rows);
  }
  function pressCell(target) {
    document.querySelectorAll('#rep-years [aria-pressed="true"]').forEach((b) => b.setAttribute("aria-pressed", "false"));
    if (target) target.setAttribute("aria-pressed", "true");
  }
  function seasonDetail(c, seasons) {
    const box = $("#rep-detail"); clear(box);
    box.append(h("div", { class: "yd-head" }, photo(c.crop, "xs"), h("span", { text: `${c.year} · ${cropName(c.crop)}` }), h("span", { class: "chip " + c.status, text: statusWord(c.status) })));
    if (c.status !== "good") box.append(h("p", { text: whyText(c.why) }));
    if (c.sown) {
      box.append(h("p", { text: t("rep.d.harvest", { n: num(c.yield, 1), p: Math.round(c.ry * 100) }) }), h("p", { text: t("rep.d.rain", { r: c.rain, d: c.drySpell }) }));
      box.append(h("button", { type: "button", class: "btn", onclick: () => { state.simRot = state.repRot; state.simSeason = seasons.indexOf(c); state.day = 0; go("simulate"); play(); } }, icon("play"), t("rep.watch")));
    }
  }
  function renderReplay() {
    periodSeg("#rep-period", "#custom-card-rep", "#rep-period-note", renderReplay);
    rotOptions($("#rep-rot"), state.repRot, (id) => { state.repRot = id; renderReplay(); });
    const item = state.items.find((x) => x.id === state.repRot);
    const { run: R, wx } = runOf(state.repRot);
    const m = E.summarize(R, state.soil);
    const shown = R.seasons.filter((x) => x.year >= R.firstYear);
    const y0 = R.firstYear, y1 = wx.year[wx.n - 1];
    const slots = item.rot.slots.filter((x) => !x.isCover);
    const annual = {}; for (let i = 0; i < wx.n; i++) annual[wx.year[i]] = (annual[wx.year[i]] || 0) + wx.rain[i];
    const years = Object.keys(annual).map(Number).filter((y) => y >= y0);
    const meanRain = years.reduce((a, y) => a + annual[y], 0) / years.length;

    const bar = $("#rep-bar"); clear(bar);
    [["good", m.good], ["warn", m.stressed], ["fail", m.failed]].forEach(([cls, n]) => bar.append(h("i", { class: cls, style: `width:${(100 * n) / (m.seasons || 1)}%` })));
    const statsBox = $("#rep-stats"); clear(statsBox);
    $("#rep-total").textContent = t("rep.total", { n: m.seasons });
    stat(statsBox, statusWord("good"), String(m.good), "good");
    stat(statsBox, statusWord("warn"), String(m.stressed), "warn");
    stat(statsBox, statusWord("fail"), String(m.failed), "fail");
    const pm = state.period !== "past" && state.period !== "custom" ? metricsFor(item, state.period) : null;
    $("#rep-trend").textContent = t("rep.trend", { a: y0, b: m.midYear - 1, p: Math.round(m.failRateEarly * 100), c: m.midYear, d: y1, q: Math.round(m.failRateRecent * 100) }) + (E.temperatureDrift(state.wx).drifts ? ` ${t("rep.trend.drift")}` : "") + (pm ? ` ${t("tile.models", { a: pm.range.failed[0], b: pm.range.failed[1] })}` : "");

    const box = $("#rep-years"); clear(box);
    slots.forEach((slot, k) => {
      const worst = { good: 0, warn: 1, fail: 2 };
      const byYear = {};
      shown.filter((c) => rotSlotIndex(item.rot, c.slot) === k).forEach((c) => { if (!byYear[c.year] || worst[c.status] > worst[byYear[c.year].status]) byYear[c.year] = c; });
      box.append(yearBlock(cropName(slot.crop), y0, y1, (y) => {
        const c = byYear[y];
        if (!c) return null;
        const label = `${y}, ${cropName(c.crop)}: ${statusWord(c.status)}${c.status === "good" ? "" : " (" + whyText(c.why) + ")"}`;
        const cell = h("button", { type: "button", class: "ycell " + c.status, title: label, "aria-label": label, "aria-pressed": "false", text: STATUS_MARK[c.status] });
        const open = () => { pressCell(cell); seasonDetail(c, R.seasons); };
        cell.addEventListener("click", open);
        cell.addEventListener("mouseenter", open);
        cell.addEventListener("focus", open);
        return cell;
      }, slot.crop));
    });
    box.append(yearBlock(t("rep.rainBlock"), y0, y1, (y) => {
      if (annual[y] == null) return null;
      const diff = annual[y] / meanRain - 1;
      const cls = diff <= -0.25 ? "r-2" : diff <= -0.1 ? "r-1" : diff < 0.1 ? "r0" : diff < 0.25 ? "r1" : "r2";
      const text = t("rep.d.rainYear", { y, r: Math.round(annual[y]), how: Math.abs(diff) < 0.02 ? t("rep.d.normal") : t(diff > 0 ? "rep.d.above" : "rep.d.below", { n: Math.round(Math.abs(diff) * 100) }) });
      const cell = h("button", { type: "button", class: "ycell " + cls, title: text, "aria-label": text, "aria-pressed": "false" });
      const open = () => { pressCell(cell); const d = $("#rep-detail"); clear(d); d.append(h("div", { class: "yd-head", text })); };
      cell.addEventListener("click", open);
      cell.addEventListener("mouseenter", open);
      cell.addEventListener("focus", open);
      return cell;
    }));
    // The Pacific at the end of each year, when El Nino and La Nina are usually at their strongest, to set beside the rows above.
    if (state.enso) {
      box.append(yearBlock(t("rep.ensoBlock"), y0, y1, (y) => {
        const i = (y - state.enso.first) * 12 + 11;
        if (i >= state.enso.oni.length) return null;
        const ph = state.enso.phase[i], v = state.enso.oni[i];
        const text = ph > 0 ? t("rep.d.nino", { y, v: num(v, 1) }) : ph < 0 ? t("rep.d.nina", { y, v: num(Math.abs(v), 1) }) : t("rep.d.neutral", { y });
        const cell = h("button", { type: "button", class: "ycell " + (ph > 0 ? "nino" : ph < 0 ? "nina" : "r0"), title: text, "aria-label": text, "aria-pressed": "false", text: ph > 0 ? "E" : ph < 0 ? "L" : "" });
        const open = () => { pressCell(cell); const d = $("#rep-detail"); clear(d); d.append(h("div", { class: "yd-head", text })); };
        cell.addEventListener("click", open);
        cell.addEventListener("mouseenter", open);
        cell.addEventListener("focus", open);
        return cell;
      }));
    }

    const legend = $("#rep-legend"); clear(legend);
    [["good", t("rep.leg.good")], ["warn", t("rep.leg.poor")], ["fail", t("rep.leg.failed")]].forEach(([cls, text]) => legend.append(h("span", {}, h("i", { class: "sw " + cls, text: STATUS_MARK[cls] }), text)));
    legend.append(h("span", {}, h("i", { class: "sw r-2" }), t("rep.leg.dry")), h("span", {}, h("i", { class: "sw r2" }), t("rep.leg.wet")));
    if (state.enso) legend.append(h("span", {}, h("i", { class: "sw nino", text: "E" }), t("enso.nino")), h("span", {}, h("i", { class: "sw nina", text: "L" }), t("enso.nina")));
    const detail = $("#rep-detail"); clear(detail);
    detail.append(h("p", { class: "muted", text: t("rep.tap") }));

    const why = $("#rep-why"); clear(why);
    Object.entries(m.byCrop).forEach(([id, b]) => {
      const reasons = Object.entries(b.why).sort((a, c) => c[1] - a[1]);
      const farm = state.market && state.market.yield[E.marketCrop(id)];
      why.append(h("div", { class: "why-row" }, photo(id, "sm"), h("b", { text: cropName(id) }),
        h("span", { text: t("rep.why.counts", { f: b.failed, n: b.n, s: b.stressed }) }),
        h("span", { text: t("rep.why.yield", { n: num(b.yield, 1) }) }),
        farm ? h("span", { text: t("fact.farms", { country: state.market.name, n: num(farm[0], 1) }) }) : null,
        h("span", { text: reasons.length ? t("rep.why.top", { why: whyText(reasons[0][0]), n: reasons[0][1] }) : t("rep.why.none") })));
    });
    $("#rep-note").textContent = state.period === "past" ? `${t("rep.note.past")} ${t("rep.note.rain")}` : state.period === "custom" ? t("rep.note.custom") : t("rep.note.model", { model: metricsFor(item, state.period).showModel });
  }
  const rotSlotIndex = (rot, slotIdx) => { const mains = rot.slots.filter((x) => !x.isCover); return mains.indexOf(rot.slots[slotIdx]); };

  // --------------------------------------------------------------- simulate
  let view = null, raf = 0, last = 0;
  function seasonFromTrace(c, wx) {
    const daily = c.trace.map((d) => Object.assign({}, d, { stage: d.g < 0.08 ? "sow" : ["veg", "flower", "grain", "harvest"][d.stage] }));
    const flowerDays = daily.map((d, i) => (d.stage === "flower" ? i : -1)).filter((i) => i >= 0);
    const cr = CROPS[c.crop];
    const startMs = Date.parse(wx.start + "T00:00:00Z") + c.sowIdx * 864e5;
    const fmt = dateFmt({ day: "numeric", month: "short", year: "numeric" });
    return {
      N: daily.length - 1, daily, year: c.year, st: c.status, why: whyText(c.why), yieldPct: Math.round(c.ry * 100), yieldT: num(c.yield, 1),
      crop: { id: c.crop, name: cropName(c.crop), tall: cr.tall, heatT: cr.heat[0] }, hotDays: c.hot, flowerStart: flowerDays[0] || 0, flowerEnd: flowerDays[flowerDays.length - 1] || 0,
      dateText: (d) => fmt.format(startMs + d * 864e5),
    };
  }
  function drawSim() { view.render(state.day); const dayBox = $("#sim-day"); dayBox.value = String(state.day); paintRange(dayBox); }
  function frame(now) {
    if (!state.playing) return;
    const dt = (now - last) / 1000; last = now;
    state.day = Math.min(view.season.N + 1.5, state.day + dt * 14 * state.speed);
    drawSim();
    if (state.day >= view.season.N + 1.5) { pause(); return; }
    raf = requestAnimationFrame(frame);
  }
  function setPlayLabel() {
    const b = $("#sim-play");
    b.querySelector("use").setAttribute("href", state.playing ? "#i-pause" : "#i-play");
    $("#sim-play-label").textContent = t(state.playing ? "sim.pause" : "sim.play");
  }
  function play() { if (!view || !view.season) return; if (state.day >= view.season.N + 1.4) state.day = 0; state.playing = true; last = performance.now(); setPlayLabel(); raf = requestAnimationFrame(frame); }
  function pause() { state.playing = false; cancelAnimationFrame(raf); setPlayLabel(); }
  function renderSim() {
    if (!view) {
      view = new S2R.SeasonView($("#sim-view"));
      // On a phone the controls belong right under the picture they move.
      document.querySelector(".sv-scene").after($("#player"));
      $("#sim-play").addEventListener("click", () => (state.playing ? pause() : play()));
      $("#sim-day").addEventListener("input", (e) => { pause(); state.day = Number(e.target.value); drawSim(); });
      $("#sim-season").addEventListener("change", (e) => { state.simSeason = +e.target.value; state.day = 0; pause(); renderSim(); });
    }
    setPlayLabel();
    rotOptions($("#sim-rot"), state.simRot, (id) => { state.simRot = id; state.simSeason = null; state.day = 0; pause(); renderSim(); });
    seg($("#sim-speed"), [{ id: 1, label: "1×" }, { id: 2, label: "2×" }, { id: 4, label: "4×" }], state.speed, (id) => { state.speed = id; renderSim(); });
    const plain = runOf(state.simRot).run;
    const eligible = plain.seasons.map((c, i) => ({ c, i })).filter(({ c }) => c.year >= plain.firstYear && c.sown);
    const sel = $("#sim-season"); clear(sel);
    if (!eligible.length) return;
    eligible.forEach(({ c, i }) => sel.append(h("option", { value: i, text: `${c.year}, ${cropName(c.crop)}: ${statusWord(c.status)}${c.status === "good" ? "" : " (" + whyText(c.why) + ")"}` })));
    if (state.simSeason == null || !eligible.some((x) => x.i === state.simSeason)) {
      // Start on a season worth seeing: the most recent failed or stressed one.
      const bad = eligible.filter(({ c }) => c.status !== "good").pop() || eligible[eligible.length - 1];
      state.simSeason = bad.i;
    }
    sel.value = state.simSeason;
    const traced = runOf(state.simRot, state.simSeason);
    const c = traced.run.seasons[state.simSeason];
    if (!c || !c.trace) return;
    const S = seasonFromTrace(c, traced.wx);
    view.setSeason(S);
    const slider = $("#sim-day"); slider.max = String(S.N + 1.5);
    state.day = Math.min(state.day, S.N + 1.5);
    drawSim();
    const box = $("#sim-summary"); clear(box);
    stat(box, t("sim.s.rain"), t("unit.mm", { n: c.rain }));
    stat(box, t("sim.s.used"), t("unit.mm", { n: c.et }));
    stat(box, t("sim.s.dry"), t("unit.days", { n: c.drySpell }));
    stat(box, t("sim.hot"), String(c.hot));
    stat(box, t("sim.s.result"), `${statusWord(c.status)} · ${Math.round(c.ry * 100)}%`, c.status);
  }

  // ------------------------------------------------------------------- rank
  function checks() {
    if (state.checksFor === state.pack && state.checks) return state.checks;
    const out = { smapR: null };
    const P = state.pack, wx = state.wx;
    if (P.smap && P.smap.length > 30 && state.items.length) {
      const item = state.current || state.items[0];
      const daily = new Float32Array(wx.n);
      E.simulate(wx, state.soil, item.rot, Object.assign({ soilDaily: daily }, simOptions()));
      const startMs = Date.parse(wx.start + "T00:00:00Z");
      const sim = [], obs = [], dates = [], months = [];
      for (const p of P.smap) {
        const i = Math.round((Date.parse(p.date + "T00:00:00Z") - startMs) / 864e5);
        if (i < 0 || i >= wx.n) continue;
        sim.push(daily[i]); obs.push(p.v); dates.push(p.date); months.push(wx.month[i]);
      }
      if (sim.length > 30) {
        const anomalies = (v) => { const a = new Float64Array(12), n = new Float64Array(12); v.forEach((x, i) => { a[months[i]] += x; n[months[i]]++; }); return v.map((x, i) => x - a[months[i]] / n[months[i]]); };
        Object.assign(out, { smapR: E.pearson(sim, obs), smapAnom: E.pearson(anomalies(sim), anomalies(obs)), sim, obs, dates });
      }
    }
    const item = state.current || state.items[0];
    const green = P.ndvi && P.ndvi.length > 60 ? P.ndvi : P.hls && P.hls.length > 30 ? P.hls : null;
    if (green && item) out.green = E.greennessCheck(wx, E.simulate(wx, state.soil, item.rot, simOptions()), green);
    // Keep the check for this field only once all its data has arrived.
    if (P.smap && P.ndvi) { state.checksFor = state.pack; state.checks = out; }
    return out;
  }
  function pickPlan(id) {
    state.selected = id;
    renderRanking();
    $("#answer").scrollIntoView({ behavior: glide(), block: "start" });
  }
  function renderRanking() {
    const period = state.period;
    const ranked = E.rank(itemsFor(period), state.w);
    let shown = distinctTop(ranked, 5);
    const cur = state.current && ranked.find((x) => x.id === state.current.id);
    if (cur && !shown.some((x) => x.id === cur.id)) shown = [...shown.slice(0, 4), cur];
    // Keep one crop you already know: a smaller step than changing everything, shown even if it ranks lower.
    const small = cur && ranked.find((x) => x.id !== cur.id && x.rot.crops.some((c) => cur.rot.crops.includes(c)) && x.rot.crops.some((c) => !cur.rot.crops.includes(c)));
    if (small && !shown.some((x) => x.id === small.id)) shown = [...shown.slice(0, 3), small, ...shown.slice(3).filter((x) => x === cur || shown.indexOf(x) < 4)].slice(0, 5);
    if (cur && !shown.some((x) => x.id === cur.id)) shown[shown.length - 1] = cur;
    if (!state.selected || !shown.some((x) => x.id === state.selected)) state.selected = shown[0] ? shown[0].id : null;
    const ids = shown.map((x) => x.id);
    const list = $("#ranking"); clear(list);
    shown.forEach((x, i) => {
      const pos = ranked.indexOf(x) + 1;
      const facts = [t("opt.failed", { a: x.m.failed, b: x.m.seasons }), t("opt.soil", { n: x.m.soil }), t(state.irrigation !== "none" ? "opt.irrigation" : "opt.water", { n: Math.round(state.irrigation !== "none" ? x.m.irrigation : x.m.et) })];
      if (state.w.money > 0 && x.m.income != null) facts.push(t("opt.value", { v: usd(x.m.income) }));
      list.append(h("li", {}, h("button", { type: "button", class: "opt", "aria-pressed": String(x.id === state.selected), onclick: () => pickPlan(x.id) },
        h("span", { class: "opt-pos", text: String(pos) }),
        h("span", { class: "opt-photos" }, [...new Set(x.rot.crops)].slice(0, 2).map((id) => photo(id, "sm"))),
        h("span", { class: "opt-main" },
          h("span", { class: "opt-name" }, h("i", { style: `background:${colorOf(x.id, ids)}` }), planName(x.rot)),
          i === 0 || x.rot.isCurrent || (small && x.id === small.id) ? h("span", { class: "badges" },
            i === 0 ? h("span", { class: "badge", text: t("badge.best") }) : null,
            x.rot.isCurrent ? h("span", { class: "badge now", text: t("badge.now") }) : null,
            small && x.id === small.id ? h("span", { class: "badge", text: t("badge.small") }) : null) : null,
          h("span", { class: "opt-facts", text: facts.join(" · ") })),
        h("span", { class: "opt-score" }, String(Math.round(x.score)), h("small", { text: t("opt.fit") })))));
    });
    $("#rank-caption").textContent = t(period === "past" ? "rank.caption" : "rank.caption.future", { n: state.items.length, m: ranked.length });
    const sel = shown.find((x) => x.id === state.selected);
    renderAnswer(sel, shown[0], shown[1], cur, ranked);
    renderEnso(sel, cur);
    renderExplain(sel, cur);
    scatter(shown, ids);
  }
  // The answer first: which plan, how well it fits, and what would change against what the farmer grows now.
  function renderAnswer(x, top, runnerUp, cur, ranked) {
    const box = $("#answer"); clear(box);
    if (!x) return;
    const isTop = x.id === top.id, isCur = cur && x.id === cur.id;
    const lead = !cur && isTop ? t("hero.fits") : isTop && isCur ? t("hero.keep") : isTop ? t("hero.fits") : isCur ? t("hero.current") : t("hero.option", { n: ranked.indexOf(x) + 1, m: ranked.length });
    const notes = [];
    if (!cur) notes.push(t("hero.noCurrent"));
    if (isTop && isCur && runnerUp) notes.push(t("hero.alt", { plan: lower(planName(runnerUp.rot)) }));
    box.append(h("div", { class: "hero-top" },
      h("div", { class: "badges" }, h("span", { class: "badge" + (isCur ? " now" : ""), text: lead })),
      h("h2", { text: planName(x.rot) }),
      h("div", { class: "match" }, h("span", { text: t("hero.score", { n: Math.round(x.score) }) }), h("div", { class: "bar" }, h("i", { style: `width:${Math.round(x.score)}%` }))),
      notes.map((n) => h("p", { class: "hero-note", text: n }))));
    box.append(cropFacts(x));
    const list = tiles(x, cur && !isCur ? cur : null);
    box.append(h("div", { class: "tiles" + (list.length > 4 ? " five" : "") }, list));
    box.append(calendar(x.rot));
    box.append(h("div", { class: "hero-sec cta-row" },
      h("button", { type: "button", class: "btn primary", onclick: () => { state.repRot = x.id; go("replay"); } }, icon("grid"), t("cta.seasons")),
      h("button", { type: "button", class: "btn", onclick: () => { state.simRot = x.id; state.simSeason = null; state.day = 0; go("simulate"); } }, icon("play"), t("cta.watch"))));
    box.append(h("p", { class: "advice", text: t("advice") }));
    const shareBtn = h("button", { type: "button", class: "linkish", onclick: () => shareResult(shareBtn) }, t("cta.share"));
    box.append(h("p", { class: "hero-sec share-row" }, shareBtn, h("button", { type: "button", class: "linkish", onclick: () => window.print() }, t("cta.print"))));
  }
  async function shareResult(btn) {
    try {
      if (navigator.share) await navigator.share({ title: document.title, url: location.href });
      else { await navigator.clipboard.writeText(location.href); btn.textContent = t("cta.copied"); }
    } catch (error) { /* the person closed the share sheet */ }
  }
  addEventListener("beforeprint", () => document.querySelectorAll("#explain details").forEach((d) => { d.open = true; }));
  // Each crop in the plan, by picture: what it might yield here, what farms in this country get, and what it sells for.
  function cropFacts(x) {
    const market = state.market;
    const rows = [...new Set(x.rot.slots.map((sl) => sl.crop))].map((id) => {
      const lines = [];
      const b = x.m.byCrop[id];
      if (CROPS[id].cover) lines.push(t("fact.cover"));
      else {
        if (b) lines.push(t("fact.sim", { n: num(b.yield, 1) }));
        if (market) {
          const key = E.marketCrop(id);
          if (market.yield[key]) lines.push(t("fact.farms", { country: market.name, n: num(market.yield[key][0], 1) }));
          lines.push(t(market.price[key] ? "fact.price" : market.priceEst[key] ? "fact.priceEst" : "fact.priceWorld", { v: usd(E.farmPrice(id, market)), y: market.priceYear }));
        }
      }
      return h("div", { class: "crop-fact" }, photo(id, "md"), h("div", {}, h("b", { text: cropName(id) }), lines.map((l) => h("small", { text: l }))));
    });
    return h("div", { class: "hero-sec crop-facts" }, rows, market ? h("p", { class: "caption", text: t("fact.note") }) : null);
  }
  function tiles(x, cur) {
    const m = x.m, c = cur ? cur.m : null;
    const tile = (key, value, sub, verdict) => h("div", { class: "tile " + (verdict > 0 ? "better" : verdict < 0 ? "worse" : "") },
      h("div", { class: "k", text: t(key) }),
      h("span", { class: "v", text: value }),
      h("div", { class: "d" }, verdict && key !== "tile.food" ? h("span", { class: "flag", text: t(verdict > 0 ? "tile.better" : "tile.worse") + " · " }) : null, sub || ""));
    const of = (a) => t("tile.of", { a: a.failed, b: a.seasons });
    const rate = (a) => a.failed / (a.seasons || 1);
    const out = [tile("tile.failed", of(m), m.range ? t("tile.models", { a: m.range.failed[0], b: m.range.failed[1] }) : c ? t("tile.now", { v: of(c) }) : "", c ? Math.sign(rate(c) - rate(m)) : 0)];
    if (c) {
      const diff = Math.round((100 * (m.harvest - c.harvest)) / (c.harvest || 1));
      const same = Math.abs(diff) < 2;
      out.push(tile("tile.food", same ? t("tile.same") : t(diff > 0 ? "tile.more" : "tile.less", { n: Math.abs(diff) }), t("tile.vsNow"), same ? 0 : Math.sign(diff)));
    } else {
      out.push(tile("tile.food", t("tile.food.abs", { n: num(m.harvest / 1000, 1) }), t("tile.food.note")));
    }
    if (m.income != null) out.push(tile("tile.value", usd(m.income), c ? t("tile.now", { v: usd(c.income) }) : t("tile.value.d"), c && Math.abs(m.income - c.income) > 0.02 * c.income ? Math.sign(m.income - c.income) : 0));
    const irrigated = state.irrigation !== "none";
    const use = (a) => Math.round(irrigated ? a.irrigation : a.et);
    out.push(tile(irrigated ? "tile.irrigation" : "tile.water", t("unit.mm", { n: use(m) }), c ? t("tile.now", { v: t("unit.mm", { n: use(c) }) }) : "", c && Math.abs(use(m) - use(c)) >= 5 ? Math.sign(use(c) - use(m)) : 0));
    out.push(tile("tile.soil", `${m.soil}/100`, c ? t("tile.now", { v: `${c.soil}/100` }) : "", c && Math.abs(m.soil - c.soil) >= 2 ? Math.sign(m.soil - c.soil) : 0));
    if (state.w.forage > 0) out.push(tile("tile.feed", t("unit.tha", { n: num(m.forage, 1) }), c ? t("tile.now", { v: t("unit.tha", { n: num(c.forage, 1) }) }) : "", c && Math.abs(m.forage - c.forage) >= 0.1 ? Math.sign(m.forage - c.forage) : 0));
    return out;
  }
  // A year as a strip of twelve months: when to sow, and how long each crop stays in the field.
  function calendar(rot) {
    const wrap = (d) => ((d % 365) + 365) % 365;
    const bars = (track, from, days, cls) => {
      const start = wrap(from), end = start + Math.max(1, days);
      const put = (a, b) => track.append(h("i", { class: "cal-bar " + cls, style: `left:${(a / 365) * 100}%;width:${((b - a) / 365) * 100}%` }));
      put(start, Math.min(end, 365));
      if (end > 365) put(0, end - 365); // crosses New Year
    };
    const rows = rot.slots.map((sl, i) => {
      const track = h("div", { class: "cal-track", "aria-hidden": "true" });
      let name, small;
      if (sl.isCover) {
        name = t("cal.cover");
        small = t("cal.cover.when", { from: dayName(wrap(sl.open)), n: sl.typicalDays });
        bars(track, sl.open, sl.typicalDays, "cover");
      } else {
        const mainIndex = rot.slots.filter((y) => !y.isCover).indexOf(sl);
        name = cropName(sl.crop) + (rot.pattern === "alternate" ? ` (${t("cal.year", { n: mainIndex + 1 })})` : "");
        small = t("cal.when", { from: dayName(wrap(sl.open)), to: dayName(wrap(sl.close)), n: sl.typicalDays });
        bars(track, sl.open, wrap(sl.sow - sl.open) + sl.typicalDays, "grow");
        bars(track, sl.open, wrap(sl.close - sl.open) + 1, "sowing");
      }
      return h("div", { class: "cal-row" }, h("div", { class: "cal-name" }, photo(sl.crop, "xs"), h("b", { text: name }), h("small", { text: small })), track);
    });
    const months = h("div", { class: "cal-months", "aria-hidden": "true" }, Array.from({ length: 12 }, (_, m) => h("span", { text: monthName(m, "narrow") })));
    const legend = h("div", { class: "cal-legend" },
      h("span", {}, h("i", { style: "background:var(--accent)" }), t("cal.leg.sow")),
      h("span", {}, h("i", { style: "background:#a9d9bd" }), t("cal.leg.grow")),
      rot.slots.some((x) => x.isCover) ? h("span", {}, h("i", { style: "background:#d8c690" }), t("cal.cover")) : null);
    return h("div", { class: "hero-sec" }, h("h3", { text: t("cal.title") }), months, rows, legend);
  }
  // The last reading of NOAA's index, unless the file the app carries has gone stale.
  function ensoNow() {
    const e = state.enso;
    if (!e) return null;
    const i = e.oni.length - 1, m = i % 12, y = e.first + Math.floor(i / 12);
    if (Date.now() - Date.UTC(y, m, 15) > 150 * 864e5) return null;
    const v = e.oni[i];
    return { kind: e.phase[i] > 0 || v >= E.ENSO_LIMIT ? "nino" : e.phase[i] < 0 || v <= -E.ENSO_LIMIT ? "nina" : "neutral", v, strong: Math.abs(v) >= 1.5, when: `${monthName((m + 11) % 12)}-${monthName((m + 1) % 12)} ${y}` };
  }
  function ensoOf(item) {
    return state.ensoCache[item.id] || (state.ensoCache[item.id] = E.ensoSplit(E.simulate(state.wx, state.soil, item.rot, simOptions()), state.wx, state.enso));
  }
  // How a plan held up in past El Nino and La Nina seasons here. A strong El Nino makes this the first thing some farmers will ask.
  function renderEnso(x, cur) {
    const box = $("#enso-card"); clear(box);
    box.hidden = !state.enso || !x || state.period !== "past";
    if (box.hidden) return;
    const now = ensoNow();
    const title = !now ? "enso.title.history" : now.kind === "neutral" ? "enso.title.neutral" : `enso.title.${now.kind}${now.strong ? "Strong" : ""}`;
    const lead = !now ? t("enso.hist") : now.kind === "neutral" ? t("enso.now.neutral", { when: now.when }) : t(now.kind === "nino" ? "enso.now.warm" : "enso.now.cool", { v: num(Math.abs(now.v), 1), when: now.when });
    box.append(h("h2", { text: t(title) }), h("p", { class: "enso-lead", text: lead }));
    const row = (item) => {
      const split = ensoOf(item);
      return h("div", { class: "enso-row" },
        h("div", { class: "enso-plan" }, [...new Set(item.rot.crops)].slice(0, 2).map((id) => photo(id, "xs")), h("b", { text: (item.rot.isCurrent ? t("plan.nowPrefix") : "") + planName(item.rot) })),
        h("div", { class: "enso-cells" }, ["nino", "nina", "neutral"].map((k) => h("div", { class: "enso-cell " + k + (now && now.kind === k ? " now" : "") }, h("span", { text: t("enso." + k) }), h("b", { text: t("enso.failed", { a: split[k].failed, b: split[k].n }) })))));
    };
    box.append(row(x));
    if (cur && cur.id !== x.id) box.append(row(cur));
    const split = ensoOf(x), other = (split.nina.rain * split.nina.sown + split.neutral.rain * split.neutral.sown) / ((split.nina.sown + split.neutral.sown) || 1);
    if (split.nino.rain != null && split.nino.sown >= 3) box.append(h("p", { class: "caption", text: t("enso.rain", { a: Math.round(split.nino.rain), b: Math.round(other) }) }));
    box.append(h("p", { class: "caption", text: t("enso.note") }));
  }
  function burnedYears(B) {
    if (!B) return null;
    const count = {};
    for (const m of B.months) count[m.date.slice(5)] = (count[m.date.slice(5)] || 0) + 1;
    return { years: new Set(B.months.map((m) => m.date.slice(0, 4))).size, span: B.last - B.first + 1, first: B.first, top: Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 2).sort() };
  }
  function renderExplain(item, cur) {
    const box = $("#explain"); clear(box);
    if (!item) return;
    const g = graceTrend();
    const now = ensoNow();
    const ex = X.explain(item, cur, { soil: state.soil, clim: state.clim, grace: g, market: state.market, scenario: state.period, years: [item.m ? state.wx.year[0] + 1 : 0, state.wx.year[state.wx.n - 1]], checks: checks(), water: state.pack.water, burned: burnedYears(state.pack.burned), enso: now && now.kind !== "neutral" && state.period === "past" ? { kind: now.kind, split: ensoOf(item) } : null });
    const block = (key, ico, arr) => {
      if (!arr.length) return;
      const d = h("details", { class: "acc" }, h("summary", {}, icon(ico), h("span", { text: t("acc." + key) }), icon("chev", "chev")), h("div", { class: "acc-body" }, h("ul", {}, arr.map((l) => h("li", { text: l })))));
      d.open = state.acc.has(key);
      d.addEventListener("toggle", () => { if (d.open) state.acc.add(key); else state.acc.delete(key); });
      box.append(d);
    };
    block("why", "sprout", ex.why);
    block("risks", "alert", ex.risks);
    block("benefits", "check", ex.benefits);
    block("evidence", "sat", ex.evidence);
    block("gaps", "help", ex.gaps);
  }
  function scatter(shown, ids) {
    const svg = $("#scatter"); clear(svg);
    const { W, H } = fit(svg, 0.7, 240, 340);
    const x0 = 34, x1 = W - 12, y0 = 22, y1 = H - 42;
    const rel = shown.map((x) => x.m.reliability), soil = shown.map((x) => x.m.soil);
    const lo = Math.max(0, Math.floor(Math.min(...rel) / 10) * 10 - 10), up = 100;
    const yLo = Math.max(0, Math.floor(Math.min(...soil) / 10) * 10 - 10), yUp = Math.min(100, Math.ceil(Math.max(...soil) / 10) * 10 + 10);
    const X1 = (v) => x0 + ((v - lo) / (up - lo)) * (x1 - x0), Y1 = (v) => y1 - ((v - yLo) / (yUp - yLo)) * (y1 - y0);
    for (let v = yLo; v <= yUp; v += 10) { s("line", { x1: x0, x2: x1, y1: Y1(v), y2: Y1(v), stroke: "#e6eae4" }, svg); s("text", { x: x0 - 6, y: Y1(v) + 4, "text-anchor": "end", "font-size": 12, fill: "#5f6b63", text: String(v) }, svg); }
    const stepX = (up - lo) / 10 > 6 && W < 420 ? 20 : 10;
    for (let v = lo; v <= up; v += stepX) { s("line", { x1: X1(v), x2: X1(v), y1: y0, y2: y1, stroke: "#e6eae4" }, svg); s("text", { x: X1(v), y: y1 + 16, "text-anchor": "middle", "font-size": 12, fill: "#5f6b63", text: v + "%" }, svg); }
    s("text", { x: (x0 + x1) / 2, y: H - 6, "text-anchor": "middle", "font-size": 13, fill: "#48554d", text: t("scatter.x") }, svg);
    s("text", { x: 0, y: 12, "font-size": 13, fill: "#48554d", text: t("scatter.y") }, svg);
    shown.forEach((x) => {
      const cx = X1(x.m.reliability), cy = Y1(x.m.soil);
      if (x.id === state.selected) s("circle", { cx, cy, r: 14, fill: "none", stroke: "#14201a", "stroke-width": 1.5 }, svg);
      const c = s("circle", { cx, cy, r: 9, fill: colorOf(x.id, ids), stroke: "#fff", "stroke-width": 2, style: "cursor:pointer" }, svg);
      c.addEventListener("click", () => { state.selected = x.id; renderRanking(); });
      tipOn(c, planName(x.rot), [t("scatter.tip", { n: num(x.m.reliability), s: x.m.soil })]);
    });
  }
  $("#scatter-box").addEventListener("toggle", () => { if ($("#scatter-box").open && state.wx) renderRanking(); });
  function renderRank() {
    $("#rank-sub").textContent = t("rank.sub", { field: state.pack.name });
    periodSeg("#rank-period", "#custom-card-rank", "#rank-period-note", renderRank);
    renderRanking();
  }

  // ---------------------------------------------------------------- monitor
  // One clear view a month of the field and what is around it, so that people can see for themselves what the chart below says.
  function renderStrip(P) {
    const card = $("#strip-card"), box = $("#strip"); clear(box);
    const series = P.hls || [];
    card.hidden = !series.length;
    if (card.hidden) return;
    const since = Date.parse(series[series.length - 1].date) - 365 * 864e5;
    const months = new Map(); // month -> its clear views
    for (const p of series) {
      if (Date.parse(p.date) < since) continue;
      const k = p.date.slice(0, 7);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(p);
    }
    card.hidden = months.size < 3; // one or two pictures show no change through the year
    if (card.hidden) return;
    const fmt = dateFmt({ month: "short", year: "numeric" });
    const fromMid = (p) => Math.abs(+p.date.slice(8) - 15);
    [...months.values()].slice(-12).forEach((views) => {
      views.sort((a, b) => fromMid(a) - fromMid(b));
      let i = 0;
      // GIBS lacks some HLS scenes and then sends a black picture: try the month's next clear view, else drop the month.
      const next = () => {
        if (++i < views.length) Object.assign(img, { src: N.hlsImage(P.lat, P.lon, views[i].date, views[i].sensor, 256), alt: t("mon.strip.alt", { date: views[i].date }) });
        else { cell.remove(); card.hidden = !box.children.length; }
      };
      const img = h("img", { crossorigin: "anonymous", src: N.hlsImage(P.lat, P.lon, views[0].date, views[0].sensor, 256), alt: t("mon.strip.alt", { date: views[0].date }), width: "256", height: "256", loading: "lazy", decoding: "async", onerror: next, onload: () => { if (noData(img)) next(); } });
      const cell = h("figure", { class: "strip-cell" }, h("span", { class: "strip-img" }, img), h("figcaption", {}, fmt.format(Date.parse(views[0].date + "T00:00:00Z"))));
      box.append(cell);
    });
  }
  // True when over a tenth of a picture is pure black, which is how GIBS fills where it has no scene.
  function noData(img) {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 32;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let black = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 24) black++;
      return black > 102;
    } catch { return false; } // a picture the browser will not let us read: keep it
  }
  function renderMonitor() {
    const P = state.pack;
    renderStrip(P);
    const svg = $("#ndvi"); clear(svg);
    const notes = $("#monitor-notes"); clear(notes);
    const bars = $("#bare-bars"); clear(bars);
    const { W, H } = fit(svg, 0.34, 240, 340);
    // HLS sees the field itself at 30 m; MODIS has the longer record but each pixel covers about 6 hectares.
    const hls = P.hls && P.hls.length >= 20 ? E.compositeNdvi(P.hls) : null;
    const data = hls || P.ndvi;
    if (!data || data.length < 20) {
      s("text", { x: 12, y: 34, "font-size": 15, fill: "#48554d", text: t(P.hls || P.ndvi ? "mon.few" : "mon.fetching") }, svg);
      svg.setAttribute("viewBox", `0 0 ${W} 60`);
      $("#ndvi-caption").textContent = "";
      return;
    }
    const a = E.analyseNdvi(data);
    const from = data.slice(-120), offset = data.length - from.length;
    const pts = from.map((p, i) => ({ t: Date.parse(p.date), v: a.smooth[i + offset], date: p.date }));
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const x0 = 30, x1 = W - 8, y0 = 10, y1 = H - 24, X1 = (v) => x0 + ((v - t0) / (t1 - t0)) * (x1 - x0), Y1 = (v) => y1 - Math.max(0, v) * (y1 - y0);
    pts.forEach((p, i) => {
      if (p.v >= a.threshold) return;
      const next = pts[i + 1] ? pts[i + 1].t : p.t + 16 * 864e5;
      s("rect", { x: X1(p.t), y: y0, width: Math.max(2, X1(next) - X1(p.t)), height: y1 - y0, fill: "#a8794f", opacity: 0.16 }, svg);
    });
    [0, 0.2, 0.4, 0.6, 0.8, 1].forEach((v) => { s("line", { x1: x0, x2: x1, y1: Y1(v), y2: Y1(v), stroke: "#e6eae4" }, svg); s("text", { x: x0 - 6, y: Y1(v) + 4, "text-anchor": "end", "font-size": 12, fill: "#5f6b63", text: v.toFixed(1) }, svg); });
    s("line", { x1: x0, x2: x1, y1: Y1(a.threshold), y2: Y1(a.threshold), stroke: "#c9a36b", "stroke-dasharray": "5 4" }, svg);
    const yFirst = new Date(t0).getUTCFullYear(), yLast = new Date(t1).getUTCFullYear();
    for (let y = yFirst; y <= yLast; y++) { const xx = X1(Date.UTC(y, 6, 1)); if (xx > x0 && xx < x1) s("text", { x: xx, y: y1 + 18, "text-anchor": "middle", "font-size": 13, fill: "#48554d", text: String(y) }, svg); }
    s("polyline", { points: pts.map((p) => `${X1(p.t).toFixed(1)},${Y1(p.v).toFixed(1)}`).join(" "), fill: "none", stroke: "#2f8f5b", "stroke-width": 2.5, "stroke-linejoin": "round" }, svg);
    if (hls) {
      P.hls.filter((p) => { const tt = Date.parse(p.date); return tt >= t0 && tt <= t1; }).forEach((p) => {
        const c = s("circle", { cx: X1(Date.parse(p.date)), cy: Y1(p.ndvi), r: W < 500 ? 2.2 : 2.6, fill: p.sensor === "S" ? "#2a78d6" : "#eb6834", opacity: 0.75 }, svg);
        tipOn(c, `NDVI ${p.ndvi.toFixed(2)}`, [p.date, p.sensor === "S" ? "Sentinel-2" : "Landsat"]);
      });
    } else {
      pts.forEach((p) => {
        const c = s("circle", { cx: X1(p.t), cy: Y1(p.v), r: W < 500 ? 3 : 3.5, fill: "#2f8f5b" }, svg);
        tipOn(c, `NDVI ${p.v.toFixed(2)}`, [p.date, t(p.v < a.threshold ? "mon.tip.bare" : "mon.tip.grow")]);
      });
    }
    $("#ndvi-caption").textContent = `${t("mon.read", { v: a.threshold.toFixed(2) })} ${t(hls ? "mon.cap.hls" : "mon.cap.modis", { field: P.name })}`;
    const years = E.fullYears(data).filter((y) => y in a.perYear).slice(-12);
    const maxDays = Math.max(...years.map((y) => a.perYear[y]), 1);
    years.forEach((y) => bars.append(h("div", { class: "bars-row" }, h("span", { text: y }), h("div", {}, h("i", { style: `width:${(a.perYear[y] / maxDays) * 100}%` })), h("span", { text: t("unit.days", { n: a.perYear[y] }) }))));
    if (years.length) notes.append(h("p", {}, h("b", { text: t("mon.bareDays", { n: Math.round(a.bareDays) }) + " " }), t(years.length === 1 ? "mon.bareDays.one" : "mon.bareDays.more", { y: Math.min(5, years.length), n: num(a.cropsPerYear, 1) })));
    else bars.append(h("p", { class: "muted", text: t("mon.fewYears") }));
    const item = state.current;
    if (item) {
      notes.append(h("p", { text: t("mon.erosion", { plan: lower(planName(item.rot)), p: Math.round(item.m.erosiveBareShare * 100), n: num(item.m.soilLoss, 1) }) }));
      const withCover = state.items.find((x) => x.id === item.id + "+cover");
      if (withCover && withCover.m.soilLoss < item.m.soilLoss) notes.append(h("p", { text: t("mon.cover", { n: num(withCover.m.soilLoss, 1), d: Math.round(withCover.m.rootDays - item.m.rootDays) }) }));
    }
    if (!hls) notes.append(h("p", { class: "muted", text: t("mon.pixel") }));
    if (P.water) {
      const n = P.water.occurrence;
      notes.append(h("p", {}, h("b", { text: t("mon.water") + " " }), n > 0 ? t("mon.water.v", { n }) : t("mon.water.none")));
    }
    const burned = burnedYears(P.burned);
    if (burned) {
      notes.append(h("p", {}, h("b", { text: t("mon.fire") + " " }), burned.years ? t("mon.fire.v", { a: burned.years, b: burned.span, months: burned.top.map((k) => monthName(+k - 1, "long")).join(t("x.and")) }) : t("mon.fire.none", { y: burned.first })));
    }
  }

  // ------------------------------------------------------------------ trust
  function renderTrust() {
    const c = checks();
    const svg = $("#smap-chart"); clear(svg);
    const box = $("#trust-checks"); clear(box);
    const legend = $("#smap-legend"); clear(legend);
    const { W, H } = fit(svg, 0.48, 210, 280);
    if (!c.sim) {
      s("text", { x: 12, y: 34, "font-size": 15, fill: "#48554d", text: t(state.pack.smap ? "trust.few" : "trust.fetching") }, svg);
      svg.setAttribute("viewBox", `0 0 ${W} 60`);
    } else {
      const toZ = (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return v.map((x) => (x - m) / sd); };
      const A = toZ(c.sim), B = toZ(c.obs);
      const x0 = 10, x1 = W - 10, y0 = 10, y1 = H - 22;
      const T = c.dates.map((d) => Date.parse(d)), t0 = T[0], t1 = T[T.length - 1];
      const X1 = (v) => x0 + ((v - t0) / (t1 - t0)) * (x1 - x0), Y1 = (v) => y1 - ((Math.max(-3, Math.min(3, v)) + 3) / 6) * (y1 - y0);
      s("line", { x1: x0, x2: x1, y1: Y1(0), y2: Y1(0), stroke: "#d4dad3" }, svg);
      s("polyline", { points: B.map((v, i) => `${X1(T[i]).toFixed(1)},${Y1(v).toFixed(1)}`).join(" "), fill: "none", stroke: "#3b8ee0", "stroke-width": 2 }, svg);
      s("polyline", { points: A.map((v, i) => `${X1(T[i]).toFixed(1)},${Y1(v).toFixed(1)}`).join(" "), fill: "none", stroke: "#b4521e", "stroke-width": 2 }, svg);
      const yFirst = new Date(t0).getUTCFullYear(), yLast = new Date(t1).getUTCFullYear();
      for (let y = yFirst; y <= yLast; y += 2) s("text", { x: X1(Date.UTC(y, 6, 1)), y: y1 + 16, "text-anchor": "middle", "font-size": 12, fill: "#48554d", text: String(y) }, svg);
      legend.append(legLine("NASA SMAP L4", "#3b8ee0"), legLine(t("trust.leg.sim"), "#b4521e"), h("span", { class: "muted", text: t("trust.leg.scaled") }));
      const strength = (r) => t(r >= 0.7 ? "trust.strong" : r >= 0.5 ? "trust.moderate" : r >= 0.3 ? "trust.weak" : "trust.veryWeak");
      box.append(h("p", {}, h("b", { text: t("trust.match", { how: strength(c.smapR), r: c.smapR.toFixed(2) }) + " " }), t("trust.match.more", { how: strength(c.smapAnom), r: c.smapAnom.toFixed(2), n: c.sim.length })));
    }
    if (c.green) {
      const g = c.green;
      box.append(h("h3", { text: t("trust.two") }), h("p", { text: t("trust.two.text", { n: g.n, r: g.r.toFixed(2) }) }));
      if (g.zBad != null && g.nBad >= 3) box.append(h("p", { text: t(g.zBad < g.zGood ? "trust.green.less" : "trust.green.noLess", { n: Math.abs(g.zGood - g.zBad).toFixed(1) }) }));
      if (g.disagree.length) {
        box.append(h("p", { text: t("trust.disagree") }),
          h("ul", {}, g.disagree.slice(0, 6).map((d) => h("li", { text: t(d.z < 0 ? "trust.disagree.low" : "trust.disagree.high", { y: d.year, crop: lower(cropName(d.crop)), status: lower(statusWord(d.status)) }) }))));
      }
    }
    const P = state.pack;
    const pend = t("trust.pending");
    const have = [`SMAP ${P.smap ? P.smap.length : pend}`, `HLS ${P.hls ? P.hls.length : pend}`, `MODIS ${P.ndvi ? P.ndvi.length : pend}`, `GRACE ${P.grace ? P.grace.length : pend}`].join(", ");
    renderCredits();
    box.append(h("p", { class: "caption", text: t("trust.have", { list: have }) + (P.weather.rainInfo ? ` ${t("trust.rain", { n: P.weather.rainInfo.imergDays })}` : "") }));
    const lim = $("#limits"); clear(lim);
    X.LIMITS.forEach((k) => lim.append(h("li", { text: t("limit." + k) })));
    const gl = $("#glossary"); clear(gl);
    X.GLOSSARY.forEach((k) => gl.append(h("dt", { text: t(`gl.${k}.t`) }), h("dd", { text: t(`gl.${k}.d`) })));
    const so = $("#sources"); clear(so);
    X.SOURCES.forEach(([a, b, url]) => so.append(h("li", {}, h("a", { href: url, target: "_blank", rel: "noopener", text: a }), h("span", { text: b }))));
  }

  // Whoever took each crop photo gets the credit their licence asks for.
  let credits = null;
  async function renderCredits() {
    const box = $("#photo-credits");
    if (box.childElementCount) return;
    credits = credits || await fetch("data/crop-photos.json").then((r) => r.json()).catch(() => null);
    if (!credits || box.childElementCount) return;
    Object.entries(credits).forEach(([id, c]) => box.append(h("li", {}, photo(id, "xs"), h("span", {}, h("a", { href: c.page, target: "_blank", rel: "noopener", text: c.author }), ` (${c.licence})`))));
  }

  // ------------------------------------------------------------------ start
  (async () => {
    applyLang();
    if (saved.soil) { $("#soil-sand").value = saved.soil.sand || ""; $("#soil-clay").value = saved.soil.clay || ""; $("#soil-soc").value = saved.soil.soc || ""; $("#soil-ph").value = saved.soil.ph || ""; }
    $("#cap").value = state.cap;
    paintRange($("#cap"));
    history.replaceState({ screen: "field", step: 1 }, "", location.href);
    document.querySelectorAll(".screen").forEach((sc) => sc.classList.toggle("on", sc.id === "screen-field"));
    if (saved.point && Number.isFinite(saved.point.lat) && Number.isFinite(saved.point.lon) && !params.get("field")) setPoint(saved.point.lat, saved.point.lon, false, saved.placeName);
    renderField();
    const opened = await loadDemos();
    // A shared link to a live field: check what it says before trusting it, then work the answer out again.
    const lat = parseFloat(params.get("lat")), lon = parseFloat(params.get("lon"));
    if (!opened && !params.get("field") && Math.abs(lat) <= 84 && Math.abs(lon) <= 180) {
      setPoint(lat, lon, false);
      if (["single", "double", "alternate"].includes(params.get("plant"))) state.pattern = params.get("plant");
      const [a, b] = (params.get("crops") || "").split(",");
      if (CROPS[a] && !CROPS[a].cover) state.crop1 = a;
      if (CROPS[b] && !CROPS[b].cover) state.crop2 = b;
      if (["none", "limited", "full"].includes(params.get("water"))) state.irrigation = params.get("water");
      state.floods = params.get("floods") === "1";
      state.floodsByFarmer = true;
      await run();
    }
  })();
  window.S2R_APP = { state, go, play, pause, setDay: (d) => { state.day = d; if (view) drawSim(); }, run, setStep };
})();
