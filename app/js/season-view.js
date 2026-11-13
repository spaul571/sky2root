/* Sky2Root: the day-by-day season view.
 *
 *   const view = new S2R.SeasonView(container);
 *   view.setSeason(season);   // built by app.js from one simulated season's daily trace
 *   view.render(46.5);        // any day from 0 to N; past N the result stamp shows
 *
 * render() is a pure function of the day, so the app can play it in real time
 * or step through it one frame at a time.
 *
 * Only the field scene is a fixed drawing. The labels, gauges and rain chart are ordinary
 * elements, so that the page's CSS can stack them on a phone and keep their text readable.
 */
(function (global) {
  "use strict";
  const S2R = global.S2R || (global.S2R = {});
  const NS = "http://www.w3.org/2000/svg";
  const W = 600, H = 430;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const T = (key, vars) => S2R.i18n.t(key, vars);

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, text, attrs) {
    const t = el("text", Object.assign({ x, y, fill: "#16201b" }, attrs || {}), parent);
    t.textContent = text;
    return t;
  }
  function box(tag, cls, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  // Colours are mixed as [r, g, b] arrays; mix() accepts hex strings or arrays
  // and returns an array, rgb() turns one into a CSS colour.
  function rgbArr(c) { return Array.isArray(c) ? c : [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mixA(a, b, p) { const A = rgbArr(a), B = rgbArr(b); return A.map((v, i) => Math.round(lerp(v, B[i], clamp(p, 0, 1)))); }
  const rgb = (arr) => `rgb(${arr.join(",")})`;
  const mix = (a, b, p) => rgb(mixA(a, b, p));

  const STATUS_COLOR = { good: "#0c8f0c", warn: "#b87800", fail: "#c93030" };
  const STAGES = ["sow", "veg", "flower", "grain", "harvest"];

  class SeasonView {
    constructor(container, opts) {
      this.opts = Object.assign({ showStamp: true }, opts || {});
      const scene = box("div", "sv-scene", container);
      this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, scene);
      this.buildPanel(container);
      this.buildChart(container);
      this.buildScene();
    }

    buildScene() {
      const s = this.svg;
      // ---- field panel
      const field = el("g", {}, s);
      this.sky = el("rect", { x: 0, y: 0, width: 600, height: 305 }, field);
      this.haze = el("rect", { x: 0, y: 180, width: 600, height: 125, fill: "#f6b75a", opacity: 0 }, field);
      this.sun = el("circle", { cx: 505, cy: 72, r: 34, fill: "#ffd54a" }, field);
      this.sunRays = el("g", { stroke: "#ffd54a", "stroke-width": 4, "stroke-linecap": "round" }, field);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        el("line", { x1: 505 + Math.cos(a) * 44, y1: 72 + Math.sin(a) * 44, x2: 505 + Math.cos(a) * 56, y2: 72 + Math.sin(a) * 56 }, this.sunRays);
      }
      this.clouds = [0, 1, 2].map((i) => {
        const g = el("g", { fill: "#ffffff" }, field);
        el("ellipse", { cx: 0, cy: 0, rx: 62, ry: 26 }, g);
        el("circle", { cx: -26, cy: -14, r: 26 }, g);
        el("circle", { cx: 18, cy: -24, r: 32 }, g);
        return { g, base: 120 + i * 190, y: 60 + (i % 2) * 46 };
      });
      this.drops = el("g", { stroke: "#5b8fd6", "stroke-width": 2.4, "stroke-linecap": "round" }, field);
      this.dropLines = [];
      for (let i = 0; i < 46; i++) {
        this.dropLines.push({ l: el("line", { x1: 0, y1: 0, x2: -4, y2: 14 }, this.drops), x: (i * 137) % 600, y0: (i * 71) % 300 });
      }
      // ground and soil water
      el("rect", { x: 0, y: 305, width: 600, height: 125, fill: "#7a5233" }, field);
      this.water = el("rect", { x: 0, y: 430, width: 600, height: 0, fill: "#3b8ee0", opacity: 0.7 }, field);
      this.waterTop = el("path", { d: "", fill: "none", stroke: "#cfe6ff", "stroke-width": 3, opacity: 0.9 }, field);
      el("rect", { x: 0, y: 298, width: 600, height: 12, fill: "#8b6440" }, field);
      for (let i = 0; i < 9; i++) el("path", { d: `M${30 + i * 70} 304 q 12 -5 24 0`, stroke: "#6a4528", "stroke-width": 3, fill: "none" }, field);
      this.waterLabel = txt(field, 18, 416, "", { "font-size": 22, fill: "#ffffff", "font-weight": 600 });
      // plants
      this.plants = [];
      for (let i = 0; i < 7; i++) {
        const x = 70 + i * 77;
        const g = el("g", {}, field);
        const stem = el("line", { x1: x, y1: 304, x2: x, y2: 304, "stroke-width": 5, "stroke-linecap": "round" }, g);
        const leaves = [0, 1, 2, 3, 4, 5].map((j) => el("ellipse", { cx: 0, cy: 0, rx: 0, ry: 6 }, g));
        const tassel = el("g", { stroke: "#c9a640", "stroke-width": 3, "stroke-linecap": "round", opacity: 0 }, g);
        for (let j = -1; j <= 1; j++) el("line", { x1: 0, y1: 0, x2: j * 9, y2: -18 }, tassel);
        const cob = el("ellipse", { cx: 0, cy: 0, rx: 7, ry: 15, fill: "#e8c75a", opacity: 0 }, g);
        const flowers = [0, 1, 2].map(() => el("circle", { cx: 0, cy: 0, r: 5, fill: "#b58ad8", opacity: 0 }, g));
        const pods = [0, 1, 2].map(() => el("ellipse", { cx: 0, cy: 0, rx: 3.5, ry: 12, fill: "#7fb34f", opacity: 0 }, g));
        this.plants.push({ x, stem, leaves, tassel, cob, flowers, pods });
      }
      // stamp
      this.stamp = el("g", { opacity: 0 }, s);
      this.stampRect = el("rect", { x: -240, y: -56, width: 480, height: 112, rx: 16, fill: "#ffffff", "stroke-width": 5 }, this.stamp);
      this.stampTitle = txt(this.stamp, 0, -8, "", { "text-anchor": "middle", "font-size": 36, "font-weight": 700 });
      this.stampSub = txt(this.stamp, 0, 30, "", { "text-anchor": "middle", "font-size": 21, fill: "#3d4a42" });
    }

    buildPanel(container) {
      const P = box("div", "sv-panel", container);
      const head = box("div", "sv-head", P);
      this.photo = box("img", "crop-img sm", head);
      this.photo.alt = "";
      this.title = box("h2", "sv-title", head);
      this.dateLine = box("p", "sv-date", P);
      const stages = box("ol", "sv-stages", P);
      this.chips = STAGES.map((id) => ({ id, n: box("li", "", stages) }));
      const G = box("div", "sv-gauges", P);
      const gauge = (cls) => {
        const g = box("div", "gauge " + cls, G);
        const k = box("span", "g-k", g), v = box("b", "g-v", g), bar = box("div", "g-bar", g);
        return { g, k, v, bar, fill: box("i", "", bar), note: box("small", "", g) };
      };
      this.gWater = gauge("water");
      box("s", "g-mark", this.gWater.bar);
      this.gGrowth = gauge("growth");
      this.gHeat = gauge("heat");
    }

    buildChart(container) {
      const C = box("div", "sv-chart", container);
      const legend = box("div", "legend", C);
      this.legRain = box("span", "leg-rain", legend);
      this.legSoil = box("span", "leg-soil", legend);
      this.legFlower = box("span", "leg-flower", legend);
      // Stretched to the width of the page: bars and line scale, and strokes keep their width.
      this.plot = el("svg", { class: "sv-plot", preserveAspectRatio: "none", viewBox: "0 0 100 100", "aria-hidden": "true" }, C);
      this.flowerBand = el("rect", { y: 0, height: 100, fill: "#f6c46a", opacity: 0.3 }, this.plot);
      this.rainBars = el("g", { fill: "#5b8fd6" }, this.plot);
      this.swLine = el("polyline", { fill: "none", stroke: "#0f7d74", "stroke-width": 2.5, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }, this.plot);
      this.cursor = el("line", { y1: 0, y2: 100, stroke: "#16201b", "stroke-width": 1.5, "stroke-dasharray": "4 4", "vector-effect": "non-scaling-stroke" }, this.plot);
      const axis = box("div", "sv-axis", C);
      this.axisStart = box("span", "", axis);
      this.axisEnd = box("span", "", axis);
    }

    setSeason(season) {
      this.season = season;
      const S = season, N = S.N;
      this.svg.setAttribute("aria-label", T("sim.aria"));
      this.plot.setAttribute("viewBox", `0 0 ${N + 1} 100`);
      this.flowerBand.setAttribute("x", S.flowerStart);
      this.flowerBand.setAttribute("width", Math.max(0, S.flowerEnd - S.flowerStart + 1));
      while (this.rainBars.firstChild) this.rainBars.removeChild(this.rainBars.firstChild);
      this.bars = S.daily.map((d, i) => el("rect", { x: i + 0.15, width: 0.7, y: 100, height: 0 }, this.rainBars));
      this.drawnDay = -1;
      this.title.textContent = T("sim.sown", { crop: S.crop.name, year: S.year });
      this.photo.src = `img/crops/${S.crop.id}.webp`;
      this.chips.forEach((c) => { c.n.textContent = T("stage." + c.id); });
      this.gWater.k.textContent = T("sim.soil");
      this.gWater.note.textContent = T("sim.soil.note");
      this.gGrowth.k.textContent = T("sim.growth");
      this.gHeat.k.textContent = T("sim.hot");
      this.gHeat.note.textContent = T("sim.hot.note");
      this.legRain.textContent = T("sim.rain");
      this.legSoil.textContent = T("sim.soil");
      this.legFlower.textContent = T("stage.flower");
      this.axisStart.textContent = S.dateText(0);
      this.axisEnd.textContent = S.dateText(N);
      const color = STATUS_COLOR[S.st];
      this.stampRect.setAttribute("stroke", color);
      this.stampTitle.setAttribute("fill", color);
      this.stampTitle.textContent = `${T("status." + S.st)} · ${S.yieldPct}%`;
      const sub = S.st === "good" ? T("sim.stamp.good", { n: S.yieldT }) : `${S.why} · ${T("unit.tha", { n: S.yieldT })}`;
      this.stampSub.textContent = sub;
      this.stampSub.setAttribute("font-size", Math.min(21, Math.floor(860 / Math.max(sub.length, 1))));
    }

    render(day) {
      const S = this.season;
      if (!S) return;
      const N = S.N;
      const dd = clamp(day, 0, N);
      const d = Math.min(N, Math.floor(dd));
      const frac = day - Math.floor(day);
      const D = S.daily[d];
      const g = dd / N;

      // sky and weather
      const cloudy = D.cloud, raining = D.rain > 0.5;
      const hot = D.hot;
      let sky = mix("#6ab6ec", "#a9b6bf", cloudy);
      if (raining) sky = mix("#8796a1", "#6f7d88", Math.min(1, D.rain / 30));
      this.sky.setAttribute("fill", sky);
      this.haze.setAttribute("opacity", hot && !raining ? 0.45 : 0);
      this.sun.setAttribute("fill", hot ? "#ff9b3d" : "#ffd54a");
      this.sun.setAttribute("opacity", raining ? 0.15 : 1 - cloudy * 0.6);
      this.sunRays.setAttribute("opacity", raining ? 0 : 1 - cloudy * 0.8);
      this.sunRays.setAttribute("stroke", hot ? "#ff9b3d" : "#ffd54a");
      this.clouds.forEach((c, i) => {
        const x = ((c.base + dd * 9 + i * 40) % 760) - 80;
        c.g.setAttribute("transform", `translate(${x},${c.y})`);
        c.g.setAttribute("opacity", raining ? 0.95 : cloudy * 0.95);
        c.g.setAttribute("fill", raining ? "#d3d9de" : "#ffffff");
      });
      this.drops.setAttribute("opacity", raining ? Math.min(1, 0.4 + D.rain / 25) : 0);
      if (raining) this.dropLines.forEach((p, i) => {
        const y = (p.y0 + frac * 300 * 3 + i * 7) % 300;
        p.l.setAttribute("x1", p.x); p.l.setAttribute("y1", y); p.l.setAttribute("x2", p.x - 4); p.l.setAttribute("y2", y + 14);
      });

      // soil water in the ground
      const swH = 112 * D.swFrac;
      this.water.setAttribute("y", 430 - swH);
      this.water.setAttribute("height", swH);
      let wave = `M0 ${430 - swH}`;
      for (let x = 0; x <= 600; x += 30) wave += ` Q ${x + 15} ${430 - swH + (x / 30 % 2 ? 4 : -4) + Math.sin(dd + x) * 1.5} ${x + 30} ${430 - swH}`;
      this.waterTop.setAttribute("d", swH > 3 ? wave : "");
      this.waterLabel.textContent = `${T("sim.soil")} ${Math.round(D.swFrac * 100)}%`;

      // plants
      const stress = 1 - D.ks;
      const lateFail = S.st === "fail" ? smooth(0.6, 1, g) : 0;
      const ripe = smooth(0.82, 1, g);
      let leafA = mixA(mixA("#3f9a46", "#c8b446", stress * 0.9), "#d1a83c", ripe * 0.8);
      if (lateFail > 0) leafA = mixA(leafA, "#7d5b33", lateFail);
      const leaf = rgb(leafA);
      const Hmax = S.crop.tall ? 205 : 98;
      const h = Hmax * smooth(0.02, 0.62, g) * (1 - 0.25 * lateFail);
      const droop = stress * 26 + lateFail * 30;
      this.plants.forEach((p, i) => {
        const jitter = (i % 3) * 0.04;
        const ph = h * (0.92 + jitter);
        const top = 304 - ph;
        p.stem.setAttribute("y2", top);
        p.stem.setAttribute("stroke", leaf);
        p.leaves.forEach((lf, j) => {
          const side = j % 2 ? 1 : -1;
          const at = 304 - ph * (0.25 + 0.13 * Math.floor(j / 2) * (S.crop.tall ? 1.6 : 1.2));
          const L = (S.crop.tall ? 44 : 30) * smooth(0.04 + j * 0.03, 0.4 + j * 0.03, g);
          // SVG angles turn clockwise: -28 points up-right, 208 up-left; drought
          // stress lowers both leaves towards the ground.
          const ang = side < 0 ? 208 - droop * 0.6 : -28 + droop * 0.6;
          lf.setAttribute("rx", L / 2);
          lf.setAttribute("ry", S.crop.tall ? 6 : 8);
          lf.setAttribute("fill", leaf);
          lf.setAttribute("transform", `translate(${p.x},${Math.min(300, at)}) rotate(${ang}) translate(${L / 2},0)`);
        });
        if (S.crop.tall) {
          p.tassel.setAttribute("opacity", smooth(0.4, 0.46, g));
          p.tassel.setAttribute("transform", `translate(${p.x},${top})`);
          p.cob.setAttribute("opacity", smooth(0.56, 0.64, g) * (1 - lateFail * 0.6));
          p.cob.setAttribute("transform", `translate(${p.x + 9},${top + ph * 0.42}) rotate(18)`);
          p.cob.setAttribute("fill", mix("#e8c75a", "#b98f3a", lateFail));
        } else {
          const fl = smooth(0.4, 0.46, g) * (1 - smooth(0.6, 0.68, g));
          const pod = smooth(0.58, 0.66, g);
          p.flowers.forEach((f, j) => { f.setAttribute("opacity", fl); f.setAttribute("cx", p.x + (j - 1) * 13); f.setAttribute("cy", top + 6 + (j % 2) * 10); });
          p.pods.forEach((f, j) => { f.setAttribute("opacity", pod); f.setAttribute("fill", mix("#7fb34f", "#b49243", Math.max(ripe, lateFail))); f.setAttribute("transform", `translate(${p.x + (j - 1) * 14},${top + 14 + (j % 2) * 8}) rotate(${(j - 1) * 20})`); });
        }
      });

      // labels and gauges
      this.chips.forEach((c) => c.n.classList.toggle("on", c.id === D.stage));
      this.cursor.setAttribute("x1", dd + 0.5); this.cursor.setAttribute("x2", dd + 0.5);
      if (d !== this.drawnDay) {
        this.drawnDay = d;
        this.dateLine.textContent = T("sim.day", { d, n: N, date: S.dateText(d) });
        this.gWater.v.textContent = `${Math.round(D.swFrac * 100)}%`;
        this.gWater.fill.style.width = `${D.swFrac * 100}%`;
        this.gWater.fill.style.background = D.swFrac < 0.5 ? mix("#3484d6", "#c96a30", (0.5 - D.swFrac) * 2) : "#3484d6";
        this.gGrowth.v.textContent = `${Math.round(g * 100)}%`;
        this.gGrowth.fill.style.width = `${g * 100}%`;
        this.gGrowth.note.textContent = T("stage." + D.stage);
        this.gHeat.v.textContent = String(D.hotSoFar);
        this.gHeat.fill.style.width = `${Math.min(100, D.hotSoFar * 10)}%`;
        this.gHeat.g.classList.toggle("hot", !!D.hot);

        // chart
        this.bars.forEach((b, i) => {
          const bh = i <= d ? Math.min(93, S.daily[i].rain * 1.6) : 0;
          b.setAttribute("y", 100 - bh); b.setAttribute("height", bh);
        });
        const pts = [];
        for (let i = 0; i <= d; i++) pts.push(`${i + 0.5},${(100 - 93 * S.daily[i].swFrac).toFixed(1)}`);
        this.swLine.setAttribute("points", pts.join(" "));
      }

      // result stamp
      const sp = this.opts.showStamp ? smooth(N + 0.2, N + 1.2, day) : 0;
      this.stamp.setAttribute("opacity", sp);
      this.stamp.setAttribute("transform", `translate(300 190) rotate(-4) scale(${lerp(1.2, 1, sp)})`);
    }
  }

  S2R.SeasonView = SeasonView;
})(window);
