/* Sky2Root concept prototype: the day-by-day season view.
 *
 *   const view = new S2R.SeasonView(container);
 *   view.setSeason(S2R.model.season(2004, 0, "a", "past"));
 *   view.render(46.5);   // any day from 0 to N; past N the result stamp shows
 *
 * render() is a pure function of the day, so the prototype can play it in real
 * time or step through it one frame at a time.
 */
(function (global) {
  "use strict";
  const S2R = global.S2R || (global.S2R = {});
  const NS = "http://www.w3.org/2000/svg";
  const W = 1100, H = 640;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, text, attrs) {
    const t = el("text", Object.assign({ x, y, "font-family": "IBM Plex Sans, Segoe UI, sans-serif", fill: "#16201b" }, attrs || {}), parent);
    t.textContent = text;
    return t;
  }
  // Colours are mixed as [r, g, b] arrays; mix() accepts hex strings or arrays
  // and returns an array, rgb() turns one into a CSS colour.
  function rgbArr(c) { return Array.isArray(c) ? c : [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  function mixA(a, b, p) { const A = rgbArr(a), B = rgbArr(b); return A.map((v, i) => Math.round(lerp(v, B[i], clamp(p, 0, 1)))); }
  const rgb = (arr) => `rgb(${arr.join(",")})`;
  const mix = (a, b, p) => rgb(mixA(a, b, p));

  const STATUS = {
    good: { label: "Good", color: "#0c8f0c" },
    warn: { label: "Stressed", color: "#d48a00" },
    fail: { label: "Failed", color: "#c93030" },
  };

  class SeasonView {
    constructor(container, opts) {
      this.opts = Object.assign({ showStamp: true }, opts || {});
      this.svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "Simulated season, day by day" });
      this.svg.style.display = "block";
      container.appendChild(this.svg);
      this.build();
    }

    build() {
      const s = this.svg;
      const defs = el("defs", {}, s);
      const clip = el("clipPath", { id: "s2r-field-clip-" + (SeasonView.n = (SeasonView.n || 0) + 1) }, defs);
      el("rect", { x: 0, y: 0, width: 600, height: 430, rx: 18 }, clip);
      this.clipId = clip.getAttribute("id");

      // ---- field panel
      const field = el("g", { "clip-path": `url(#${this.clipId})` }, s);
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
      this.waterLabel = txt(field, 18, 418, "", { "font-size": 17, fill: "#ffffff", "font-weight": 600 });
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
      this.stampRect = el("rect", { x: -230, y: -52, width: 460, height: 104, rx: 16, fill: "#ffffff", "stroke-width": 5 }, this.stamp);
      this.stampTitle = txt(this.stamp, 0, -6, "", { "text-anchor": "middle", "font-size": 34, "font-weight": 700 });
      this.stampSub = txt(this.stamp, 0, 30, "", { "text-anchor": "middle", "font-size": 20, fill: "#3d4a42" });

      // ---- right panel
      const R = el("g", {}, s);
      this.title = txt(R, 630, 34, "", { "font-size": 28, "font-weight": 700 });
      this.dateLine = txt(R, 630, 66, "", { "font-size": 19, fill: "#56625a" });
      this.chips = [];
      const stages = S2R.model.STAGES;
      let cx = 630;
      stages.forEach((st) => {
        const w = st.name.length * 8 + 18;
        const g = el("g", {}, R);
        const r = el("rect", { x: cx, y: 86, width: w, height: 32, rx: 16, fill: "#eef2ec", stroke: "#d5ddd3" }, g);
        const t = txt(g, cx + w / 2, 107, st.name, { "text-anchor": "middle", "font-size": 14, fill: "#56625a", "font-weight": 600 });
        this.chips.push({ id: st.id, r, t });
        cx += w + 6;
      });
      // tank
      el("rect", { x: 640, y: 150, width: 110, height: 210, rx: 14, fill: "#f2f6f1", stroke: "#c9d3c7", "stroke-width": 2 }, R);
      this.tank = el("rect", { x: 646, y: 354, width: 98, height: 0, rx: 9, fill: "#3484d6" }, R);
      el("line", { x1: 640, x2: 750, y1: 255, y2: 255, stroke: "#c93030", "stroke-dasharray": "6 5", "stroke-width": 2 }, R);
      txt(R, 756, 260, "stress", { "font-size": 14, fill: "#c93030" });
      this.tankVal = txt(R, 695, 395, "", { "text-anchor": "middle", "font-size": 24, "font-weight": 700 });
      txt(R, 695, 420, "Soil water", { "text-anchor": "middle", "font-size": 16, fill: "#56625a" });
      // growth ring
      const C = 2 * Math.PI * 62;
      el("circle", { cx: 880, cy: 255, r: 62, fill: "none", stroke: "#e3e9e1", "stroke-width": 16 }, R);
      this.ring = el("circle", { cx: 880, cy: 255, r: 62, fill: "none", stroke: "#3f9a46", "stroke-width": 16, "stroke-linecap": "round", transform: "rotate(-90 880 255)", "stroke-dasharray": `0 ${C}` }, R);
      this.ringC = C;
      this.ringVal = txt(R, 880, 264, "", { "text-anchor": "middle", "font-size": 28, "font-weight": 700 });
      txt(R, 880, 420, "Growth", { "text-anchor": "middle", "font-size": 16, fill: "#56625a" });
      // heat
      this.heatBox = el("rect", { x: 980, y: 150, width: 112, height: 210, rx: 14, fill: "#fff6ea", stroke: "#f0d2a6", "stroke-width": 2 }, R);
      const flame = el("path", { d: "M1036 175 c 18 22 26 38 14 56 c 10 -4 16 -14 14 -26 c 14 18 14 46 -10 58 c -26 14 -54 -4 -54 -30 c 0 -22 22 -32 24 -50 c 6 10 6 20 0 28 c 14 -8 16 -22 12 -36 z", fill: "#e8743a" }, R);
      this.flame = flame;
      this.heatVal = txt(R, 1036, 330, "0", { "text-anchor": "middle", "font-size": 40, "font-weight": 700, fill: "#b4521e" });
      txt(R, 1036, 412, "Hot days at", { "text-anchor": "middle", "font-size": 15, fill: "#56625a" });
      txt(R, 1036, 430, "flowering", { "text-anchor": "middle", "font-size": 15, fill: "#56625a" });

      // ---- bottom chart
      const B = el("g", {}, s);
      this.chartTop = 470; this.chartBottom = 620;
      el("rect", { x: 0, y: 455, width: 1100, height: 180, rx: 14, fill: "#f6f8f5" }, B);
      this.flowerBand = el("rect", { y: 470, height: 150, fill: "#f6c46a", opacity: 0.25 }, B);
      this.flowerLab = txt(B, 0, 488, "Flowering", { "font-size": 14, fill: "#a36a00", "font-weight": 600 });
      el("line", { x1: 40, x2: 1080, y1: 620, y2: 620, stroke: "#c9d3c7" }, B);
      this.rainBars = el("g", { fill: "#5b8fd6" }, B);
      this.swLine = el("polyline", { fill: "none", stroke: "#0f7d74", "stroke-width": 3.5, "stroke-linejoin": "round" }, B);
      this.cursor = el("line", { y1: 466, y2: 622, stroke: "#16201b", "stroke-width": 1.5, "stroke-dasharray": "4 4" }, B);
      txt(B, 48, 486, "Rain (mm)", { "font-size": 14, fill: "#3e6db0", "font-weight": 600 });
      txt(B, 140, 486, "Soil water", { "font-size": 14, fill: "#0f7d74", "font-weight": 600 });
    }

    setSeason(season) {
      this.season = season;
      const S = season, N = S.N;
      this.x = (d) => 48 + (d / N) * 1024;
      this.flowerBand.setAttribute("x", this.x(S.flowerStart));
      this.flowerBand.setAttribute("width", this.x(S.flowerEnd) - this.x(S.flowerStart));
      this.flowerLab.setAttribute("x", this.x(S.flowerStart) + 6);
      while (this.rainBars.firstChild) this.rainBars.removeChild(this.rainBars.firstChild);
      this.bars = S.daily.map((d) => el("rect", { x: this.x(d.day) - 2.5, width: 5, y: 620, height: 0 }, this.rainBars));
      const seasonName = S2R.model.SEASONS[S.k];
      this.title.textContent = `${S.crop.name} · ${seasonName} ${S.year}`;
      const st = STATUS[S.st];
      this.stampRect.setAttribute("stroke", st.color);
      this.stampTitle.setAttribute("fill", st.color);
      this.stampTitle.textContent = S.st === "good" ? `${st.label} · ${S.yieldPct}% of potential` : `${st.label} · ${S.why}`;
      this.stampSub.textContent = S.st === "good" ? "harvest (example)" : `${S.yieldPct}% of potential harvest (example)`;
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
      const hot = D.tmax > S.crop.heatT;
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
      this.waterLabel.textContent = `Soil water ${Math.round(D.swFrac * 100)}%`;

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

      // right panel
      const date = S.dateOf(d);
      this.dateLine.textContent = `Day ${d} of ${N} · ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
      this.chips.forEach((c) => {
        const on = c.id === D.stage;
        c.r.setAttribute("fill", on ? "#1e6a46" : "#eef2ec");
        c.r.setAttribute("stroke", on ? "#1e6a46" : "#d5ddd3");
        c.t.setAttribute("fill", on ? "#ffffff" : "#56625a");
      });
      const th = 196 * D.swFrac;
      this.tank.setAttribute("y", 354 - th);
      this.tank.setAttribute("height", th);
      this.tank.setAttribute("fill", D.swFrac < 0.5 ? mix("#3484d6", "#c96a30", (0.5 - D.swFrac) * 2) : "#3484d6");
      this.tankVal.textContent = `${Math.round(D.swFrac * 100)}%`;
      this.ring.setAttribute("stroke-dasharray", `${g * this.ringC} ${this.ringC}`);
      this.ringVal.textContent = `${Math.round(g * 100)}%`;
      this.heatVal.textContent = String(D.hotSoFar);
      const flash = D.hot ? 0.5 + 0.5 * Math.abs(Math.sin(frac * Math.PI * 2)) : 0;
      this.heatBox.setAttribute("fill", D.hot ? mix("#fff6ea", "#ffd2b3", flash) : "#fff6ea");
      this.flame.setAttribute("transform", D.hot ? `translate(1036 230) scale(${1 + 0.12 * flash}) translate(-1036 -230)` : "");

      // chart
      this.bars.forEach((b, i) => {
        const v = i <= d ? S.daily[i].rain : 0;
        const bh = Math.min(140, v * 2.4);
        b.setAttribute("y", 620 - bh); b.setAttribute("height", bh);
      });
      const pts = [];
      for (let i = 0; i <= d; i++) pts.push(`${this.x(i).toFixed(1)},${(620 - 140 * S.daily[i].swFrac).toFixed(1)}`);
      this.swLine.setAttribute("points", pts.join(" "));
      this.cursor.setAttribute("x1", this.x(dd)); this.cursor.setAttribute("x2", this.x(dd));

      // result stamp
      const sp = this.opts.showStamp ? smooth(N + 0.2, N + 1.2, day) : 0;
      this.stamp.setAttribute("opacity", sp);
      this.stamp.setAttribute("transform", `translate(300 200) rotate(-6) scale(${lerp(1.25, 1, sp)})`);
    }
  }

  S2R.SeasonView = SeasonView;
})(window);
