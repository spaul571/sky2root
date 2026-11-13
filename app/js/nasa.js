/* Sky2Root data layer: fetches NASA data for any point on Earth, in the browser or in Node.
 * Every service used here answers browsers directly and needs no login or key.
 *
 *   NASA POWER        daily weather, plus GPM IMERG rain
 *   ORNL DAAC         MODIS NDVI, land cover and burned area
 *   HLS v2.0          30 m greenness from Landsat and Sentinel-2 (public mirror on Microsoft's Planetary Computer)
 *   NASA GIBS         SMAP L4 root-zone soil moisture and GRACE/GRACE-FO water storage,
 *                     read from the pixels of NASA's published map layers with their colour tables
 *   Global Surface Water  how often Landsat saw water on a pixel, 1984-2020 (JRC, public mirror on the Planetary Computer)
 *   NEX-GDDP-CMIP6    change per month for 2041-2060, from our own grid (tools/build_cmip6_deltas.py)
 *   SoilGrids         sand, clay, organic carbon (ISRIC, not NASA)
 *   Terrain Tiles     elevation with NASA SRTM as main source, for slope
 *   Nominatim         which country a point is in, to look up what is grown there in FAOSTAT
 */
(function (global) {
  "use strict";
  const S2R = global.S2R || (global.S2R = {});

  const cfg = {
    cache: null, // { get(url) -> Uint8Array | null, put(url, bytes) }, historical data never changes so hits stay valid
    readAsset: async (path) => new Uint8Array(await (await fetch(path)).arrayBuffer()), // Node replaces this with a file read
    assetBase: "data/",
  };

  async function getBytes(url, opts) {
    const o = opts || {};
    if (cfg.cache && !o.noCache) {
      const hit = await cfg.cache.get(url);
      if (hit) return hit;
    }
    let lastError = null;
    for (let attempt = 0; attempt < (o.retries || 3); attempt++) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), o.timeout || 90000);
      try {
        const res = await fetch(url, { signal: abort.signal, headers: o.headers });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        clearTimeout(timer);
        if (cfg.cache && !o.noCache) await cfg.cache.put(url, bytes);
        return bytes;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt + 1 < (o.retries || 3)) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw new Error(`${url.split("?")[0]}: ${lastError && lastError.message}`);
  }
  const getText = async (url, o) => new TextDecoder().decode(await getBytes(url, o));
  const getJson = async (url, o) => JSON.parse(await getText(url, o));

  async function pool(items, size, worker, onEach) {
    const results = new Array(items.length);
    let next = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        try { results[i] = await worker(items[i], i); } catch (error) { results[i] = null; }
        done++;
        if (onEach) onEach(done, items.length);
      }
    }));
    return results;
  }

  // ------------------------------------------------------------------- POWER
  const POWER = "https://power.larc.nasa.gov/api/temporal/daily/point";
  const POWER_VARS = "T2M_MAX,T2M_MIN,T2MDEW,WS10M,ALLSKY_SFC_SW_DWN,PRECTOTCORR,GWETROOT";
  const FILL = -999;
  const ymd = (y, m, d) => `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;

  function powerSeries(obj, keys) {
    const out = new Array(keys.length);
    let last = 0;
    for (let i = 0; i < keys.length; i++) {
      const v = obj[keys[i]];
      if (v != null && v !== FILL) last = v;
      out[i] = v != null && v !== FILL ? v : last; // a missing day takes the last good value, these gaps are rare single days
    }
    return out;
  }
  // Weather comes from MERRA-2 and CERES/SRB through POWER; IMERG comes in UTC days only, so it is a second request.
  async function fetchWeather(lat, lon, firstYear, lastYear) {
    const common = `community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}&format=JSON`;
    const a = await getJson(`${POWER}?parameters=${POWER_VARS}&start=${ymd(firstYear, 1, 1)}&end=${ymd(lastYear, 12, 31)}&${common}`, { timeout: 180000 });
    const b = await getJson(`${POWER}?parameters=IMERG_PRECTOT&start=${ymd(Math.max(firstYear, 1998), 1, 1)}&end=${ymd(lastYear, 12, 31)}&${common}&time-standard=UTC`, { timeout: 180000 });
    const p = a.properties.parameter;
    const keys = Object.keys(p.T2M_MAX).sort();
    const merra = powerSeries(p.PRECTOTCORR, keys);
    const imergRaw = b.properties.parameter.IMERG_PRECTOT;
    const rain = harmonizeRain(keys, merra, imergRaw);
    return {
      start: `${keys[0].slice(0, 4)}-${keys[0].slice(4, 6)}-${keys[0].slice(6, 8)}`,
      elev: a.geometry.coordinates[2],
      tmax: powerSeries(p.T2M_MAX, keys), tmin: powerSeries(p.T2M_MIN, keys), tdew: powerSeries(p.T2MDEW, keys),
      wind10: powerSeries(p.WS10M, keys), rs: powerSeries(p.ALLSKY_SFC_SW_DWN, keys),
      gwetroot: powerSeries(p.GWETROOT, keys),
      rain: rain.rain, rainMerra: merra, rainInfo: rain.info,
    };
  }
  // Rain is IMERG (satellite) wherever it exists. Reanalysis rain drifts over time as its gauge inputs change: at Bogura,
  // MERRA-2 gives 717 mm a year for 1985-1997, 1624 mm for 1998-2010 and 2036 mm since; at Sorriso, 646 mm for 2015 where
  // IMERG gives 1575 mm. So it cannot be scaled over the shared years. Instead each pre-satellite day keeps its rank among
  // pre-satellite days of that month, and takes the IMERG value at the same rank: the year-to-year pattern comes from
  // MERRA-2, the climate from IMERG. This assumes the climate of 1985-1997 was like the satellite era's.
  function harmonizeRain(keys, merra, imerg) {
    const M = Array.from({ length: 12 }, () => []), I = Array.from({ length: 12 }, () => []);
    const hasImerg = (k) => imerg[k] != null && imerg[k] !== FILL;
    for (let i = 0; i < keys.length; i++) {
      const m = +keys[i].slice(4, 6) - 1;
      if (hasImerg(keys[i])) I[m].push(imerg[keys[i]]);
      else M[m].push(merra[i]);
    }
    M.forEach((a) => a.sort((x, y) => x - y));
    I.forEach((a) => a.sort((x, y) => x - y));
    const below = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
    const above = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid + 1; else hi = mid; } return lo; };
    const mapValue = (m, x) => {
      const a = M[m], b = I[m];
      if (a.length < 30 || b.length < 30) return x;
      const rank = (below(a, x) + above(a, x) - 1) / 2 / (a.length - 1); // ties take their middle rank
      return b[Math.round(Math.min(1, Math.max(0, rank)) * (b.length - 1))];
    };
    const rain = new Array(keys.length);
    let imergDays = 0;
    for (let i = 0; i < keys.length; i++) {
      if (hasImerg(keys[i])) { rain[i] = imerg[keys[i]]; imergDays++; }
      else rain[i] = mapValue(+keys[i].slice(4, 6) - 1, merra[i]);
    }
    return { rain, info: { imergDays, totalDays: keys.length, method: "pre-satellite MERRA-2 ranks mapped onto the IMERG distribution, by month" } };
  }

  // --------------------------------------------------------------- MODIS (ORNL)
  const ORNL = "https://modis.ornl.gov/rst/api/v1";
  async function fetchNdvi(lat, lon, firstYear, lastYear, onEach) {
    const list = await getJson(`${ORNL}/MOD13Q1/dates?latitude=${lat}&longitude=${lon}`);
    const dates = list.dates.filter((d) => { const y = +d.calendar_date.slice(0, 4); return y >= firstYear && y <= lastYear; });
    const chunks = [];
    for (let i = 0; i < dates.length; i += 10) chunks.push(dates.slice(i, i + 10)); // the service allows 10 dates per request
    const parts = await pool(chunks, 6, async (ch) => {
      const url = `${ORNL}/MOD13Q1/subset?latitude=${lat}&longitude=${lon}&band=250m_16_days_NDVI&startDate=${ch[0].modis_date}&endDate=${ch[ch.length - 1].modis_date}&kmAboveBelow=0&kmLeftRight=0`;
      return (await getJson(url)).subset;
    }, onEach);
    const series = [];
    for (const part of parts) {
      if (!part) continue;
      for (const row of part) if (row.data[0] > -2000) series.push({ date: row.calendar_date, ndvi: +(row.data[0] * 0.0001).toFixed(4) });
    }
    return series.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  const IGBP = ["Water", "Evergreen needleleaf forest", "Evergreen broadleaf forest", "Deciduous needleleaf forest", "Deciduous broadleaf forest", "Mixed forest", "Closed shrubland", "Open shrubland", "Woody savanna", "Savanna", "Grassland", "Permanent wetland", "Cropland", "Urban", "Cropland and natural mosaic", "Snow and ice", "Barren"];
  async function fetchLandCover(lat, lon) {
    const j = await getJson(`${ORNL}/MCD12Q1/subset?latitude=${lat}&longitude=${lon}&band=LC_Type1&startDate=A2022001&endDate=A2022001&kmAboveBelow=0&kmLeftRight=0`);
    const code = j.subset[0].data[0];
    return { code, name: IGBP[code === 17 ? 0 : code] || "Unknown", isCrop: code === 12 || code === 14, year: 2022 };
  }

  // MODIS MCD64A1 burned area: the months with burned land within 1 km of the field. A 500 m pixel is wider than most
  // fields and a burn is patchy, so a window says more about local burning than the one pixel under the pin.
  async function fetchBurned(lat, lon, firstYear, lastYear, onEach) {
    const list = await getJson(`${ORNL}/MCD64A1/dates?latitude=${lat}&longitude=${lon}`);
    const dates = list.dates.filter((d) => { const y = +d.calendar_date.slice(0, 4); return y >= firstYear && y <= lastYear; });
    const chunks = [];
    for (let i = 0; i < dates.length; i += 10) chunks.push(dates.slice(i, i + 10));
    const parts = await pool(chunks, 6, async (ch) => (await getJson(`${ORNL}/MCD64A1/subset?latitude=${lat}&longitude=${lon}&band=Burn_Date&startDate=${ch[0].modis_date}&endDate=${ch[ch.length - 1].modis_date}&kmAboveBelow=1&kmLeftRight=1`)).subset, onEach);
    const months = [];
    for (const part of parts) {
      if (!part) throw new Error("burned area: a request failed");
      for (const row of part) {
        const pixels = row.data.filter((v) => v > 0).length;
        if (pixels) months.push({ date: row.calendar_date.slice(0, 7), pixels });
      }
    }
    return { first: firstYear, last: lastYear, pixelsPerMonth: parts[0] && parts[0][0] ? parts[0][0].data.length : 0, months: months.sort((a, b) => (a.date < b.date ? -1 : 1)) };
  }

  // ---------------------------------------------------------------- PNG reader
  // A small decoder (rather than a canvas) so colours stay exact and the same code runs in Node.
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function decodePng(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(0) !== 0x89504e47) throw new Error("not a PNG");
    let pos = 8, width = 0, height = 0, depth = 8, type = 6, palette = null, alpha = null;
    const idat = [];
    while (pos < b.length) {
      const len = dv.getUint32(pos), name = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
      const data = b.subarray(pos + 8, pos + 8 + len);
      if (name === "IHDR") {
        width = dv.getUint32(pos + 8); height = dv.getUint32(pos + 12); depth = b[pos + 16]; type = b[pos + 17];
        if (b[pos + 20] !== 0) throw new Error("interlaced PNG");
      } else if (name === "PLTE") palette = data;
      else if (name === "tRNS") alpha = data;
      else if (name === "IDAT") idat.push(data);
      pos += 12 + len;
    }
    const raw = await inflate(new Blob(idat).size ? new Uint8Array(await new Blob(idat).arrayBuffer()) : new Uint8Array());
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
    const bpp = Math.max(1, (channels * depth) >> 3);
    const stride = Math.ceil((width * channels * depth) / 8);
    const img = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)], rowIn = y * (stride + 1) + 1, rowOut = y * stride;
      for (let i = 0; i < stride; i++) {
        const x = raw[rowIn + i];
        const a = i >= bpp ? img[rowOut + i - bpp] : 0, up = y > 0 ? img[rowOut - stride + i] : 0, c = y > 0 && i >= bpp ? img[rowOut - stride + i - bpp] : 0;
        let v = x;
        if (f === 1) v = x + a;
        else if (f === 2) v = x + up;
        else if (f === 3) v = x + ((a + up) >> 1);
        else if (f === 4) {
          const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
        }
        img[rowOut + i] = v;
      }
    }
    const pixel = (x, y) => {
      const r = y * stride;
      if (type === 6) { const i = r + x * 4; return [img[i], img[i + 1], img[i + 2], img[i + 3]]; }
      if (type === 2) { const i = r + x * 3; return [img[i], img[i + 1], img[i + 2], 255]; }
      if (type === 3) {
        const bit = x * depth, idx = (img[r + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], alpha && idx < alpha.length ? alpha[idx] : 255];
      }
      const g = img[r + x * channels];
      return [g, g, g, type === 4 ? img[r + x * 2 + 1] : 255];
    };
    return { width, height, pixel };
  }

  // ------------------------------------------------------------- GIBS sampling
  const GIBS = "https://gibs.earthdata.nasa.gov";
  const colormaps = {};
  // Colour to data value, from the colour table GIBS publishes for each layer.
  async function colormap(name) {
    if (colormaps[name]) return colormaps[name];
    const xml = await getText(`${GIBS}/colormaps/v1.3/${name}.xml`);
    const map = new Map();
    for (const m of xml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)"[^>]*?value="\[?([^"\])]*)[\])]?"/g)) {
      if (/transparent="true"/.test(m[0])) continue;
      const parts = m[4].split(",").map((x) => parseFloat(x));
      const finite = parts.filter((x) => Number.isFinite(x));
      if (!finite.length) continue;
      map.set(`${m[1]},${m[2]},${m[3]}`, finite.reduce((a, b) => a + b, 0) / finite.length);
    }
    return (colormaps[name] = map);
  }
  async function sampleGibs(layer, map, lat, lon, date) {
    const pad = 0.04;
    const url = `${GIBS}/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=image/png&TRANSPARENT=true&WIDTH=3&HEIGHT=3&SRS=EPSG:4326&BBOX=${(lon - pad).toFixed(3)},${(lat - pad).toFixed(3)},${(lon + pad).toFixed(3)},${(lat + pad).toFixed(3)}&TIME=${date}`;
    const png = await decodePng(await getBytes(url, { retries: 2 }));
    const px = png.pixel(1, 1);
    if (px[3] === 0) return null;
    const v = map.get(`${px[0]},${px[1]},${px[2]}`);
    return v == null ? null : v;
  }
  // SMAP L4 root-zone soil moisture (m3/m3), 12 UTC on each date, since March 2015.
  async function fetchSmap(lat, lon, endDate, stepDays, onEach) {
    const map = await colormap("SMAP_Analyzed_Soil_Moisture");
    const dates = [];
    for (let t = Date.UTC(2015, 3, 1), end = Date.parse(endDate); t <= end; t += (stepDays || 16) * 864e5) dates.push(new Date(t).toISOString().slice(0, 10));
    const values = await pool(dates, 8, (d) => sampleGibs("SMAP_L4_Analyzed_Root_Zone_Soil_Moisture", map, lat, lon, d), onEach);
    return dates.map((date, i) => ({ date, v: values[i] })).filter((p) => p.v != null);
  }
  // GRACE and GRACE-FO mascons (JPL): liquid water equivalent thickness in cm, one reading a quarter.
  async function fetchGrace(lat, lon, onEach) {
    const map = await colormap("GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI");
    const dates = [];
    for (let y = 2002; y <= 2022; y++) for (const m of ["01", "04", "07", "10"]) { if (y === 2002 && m < "07") continue; if (y === 2022 && m > "07") continue; dates.push(`${y}-${m}-01`); }
    const values = await pool(dates, 8, (d) => sampleGibs("GRACE_Tellus_Liquid_Water_Equivalent_Thickness_Mascon_CRI", map, lat, lon, d), onEach);
    return dates.map((date, i) => ({ date, v: values[i] })).filter((p) => p.v != null);
  }

  // --------------------------------------------------------------- HLS at 30 m
  // Harmonized Landsat and Sentinel-2 v2.0 from the public mirror on Microsoft's Planetary Computer: no login, and
  // cloud-optimised files, so one pixel takes two small range reads per band rather than a whole scene.
  const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
  const SAS = "https://planetarycomputer.microsoft.com/api/sas/v1/token";
  // UTM forward projection (Snyder 1987, USGS Professional Paper 1395).
  function toUtm(lat, lon, zone, southGrid) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const phi = (lat * Math.PI) / 180, dl = ((lon - (zone * 6 - 183)) * Math.PI) / 180;
    const sn = Math.sin(phi), cs = Math.cos(phi), tn = Math.tan(phi);
    const N1 = a / Math.sqrt(1 - e2 * sn * sn), T = tn * tn, C = ep2 * cs * cs, A = dl * cs;
    const M = a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
    const x = k0 * N1 * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
    let y = k0 * (M + N1 * tn * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
    if (southGrid) y += 1e7;
    return { x, y };
  }
  const sasTokens = {};
  async function sasToken(href) {
    const m = href.match(/^https:\/\/([^.]+)\.blob\.core\.windows\.net\/([^/]+)\//);
    const key = `${m[1]}/${m[2]}`;
    if (!sasTokens[key]) sasTokens[key] = (await getJson(`${SAS}/${key}`, { noCache: true })).token;
    return sasTokens[key];
  }
  // Reads pixels from a tiled, deflate-compressed GeoTIFF; only the features HLS and Global Surface Water files use.
  async function cogPixels(url, token, col, row, radius) {
    const range = async (from, to) => getBytes(`${url}?${token}`, { noCache: true, retries: 2, headers: { Range: `bytes=${from}-${to}` } });
    const head = await range(0, 16383);
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (dv.getUint16(0, true) !== 0x4949 || dv.getUint16(2, true) !== 42) throw new Error("not a little-endian classic TIFF");
    const ifd = dv.getUint32(4, true), count = dv.getUint16(ifd, true), tag = {};
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      tag[dv.getUint16(e, true)] = { type: dv.getUint16(e + 2, true), n: dv.getUint32(e + 4, true), at: e + 8 };
    }
    const short = (id) => (tag[id] ? (tag[id].type === 3 ? dv.getUint16(tag[id].at, true) : dv.getUint32(tag[id].at, true)) : 0);
    const tw = short(322), th = short(323), width = short(256), bits = short(258), predictor = short(317) || 1, sampleFormat = short(339) || 1;
    const across = Math.ceil(width / tw);
    const tc = Math.floor(col / tw), tr = Math.floor(row / th), index = tr * across + tc;
    // A big file's tile tables can lie past the first read.
    const u32 = async (at) => {
      if (at + 4 <= head.length) return dv.getUint32(at, true);
      const b = await range(at, at + 3);
      return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true);
    };
    const offsets = dv.getUint32(tag[324].at, true), counts = dv.getUint32(tag[325].at, true);
    const [start, size] = await Promise.all([u32(offsets + index * 4), u32(counts + index * 4)]);
    const raw = await inflate(await range(start, start + size - 1));
    const bytes = bits >> 3, out = [];
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    // Horizontal differencing: each sample is stored as the change from the one to its left.
    const decoded = bytes === 2 ? new Int32Array(tw * th) : new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) {
      let prev = 0;
      for (let x = 0; x < tw; x++) {
        const at = (y * tw + x) * bytes;
        if (at + bytes > raw.length) continue;
        let v = bytes === 2 ? view.getUint16(at, true) : raw[at];
        if (predictor === 2) { v = (v + prev) & (bytes === 2 ? 0xffff : 0xff); prev = v; }
        if (bytes === 2 && sampleFormat === 2 && v > 32767) v -= 65536;
        decoded[y * tw + x] = v;
      }
    }
    const cx = col - tc * tw, cy = row - tr * th;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && y >= 0 && x < tw && y < th) out.push(decoded[y * tw + x]);
      }
    }
    return out;
  }
  async function fetchHls(lat, lon, fromDate, toDate, onEach) {
    const pad = 0.0005;
    const items = [];
    let body = { collections: ["hls2-s30", "hls2-l30"], bbox: [lon - pad, lat - pad, lon + pad, lat + pad], datetime: `${fromDate}/${toDate}`, limit: 500, query: { "eo:cloud_cover": { lt: 50 } } };
    for (let page = 0; page < 6 && body; page++) {
      const res = await fetch(STAC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HLS search: ${res.status}`);
      const j = await res.json();
      items.push(...j.features);
      const next = (j.links || []).find((l) => l.rel === "next");
      body = next && next.body ? next.body : null;
    }
    // A field can sit in two overlapping tiles: keep the clearest scene of each day and sensor.
    const best = new Map();
    for (const f of items) {
      const key = f.properties.datetime.slice(0, 10) + f.collection;
      if (!best.has(key) || f.properties["eo:cloud_cover"] < best.get(key).properties["eo:cloud_cover"]) best.set(key, f);
    }
    const scenes = [...best.values()];
    const results = await pool(scenes, 8, async (f) => {
      const p = f.properties, tf = p["proj:transform"], epsg = p["proj:epsg"];
      const u = toUtm(lat, lon, epsg % 100, Math.floor(epsg / 100) === 327); // HLS tiles south of the equator use the northern grid, with negative northings
      const col = Math.floor((u.x - tf[2]) / tf[0]), row = Math.floor((u.y - tf[5]) / tf[4]);
      if (col < 0 || row < 0 || col >= p["proj:shape"][1] || row >= p["proj:shape"][0]) return null;
      const token = await sasToken(f.assets.Fmask.href);
      // Bits of the HLS quality band: 1 cloud, 2 next to cloud or shadow, 3 cloud shadow, 4 snow or ice, 5 water.
      const mask = (await cogPixels(f.assets.Fmask.href, token, col, row, 0))[0];
      if (mask === undefined || mask & 0b111110) return null;
      const nirBand = f.collection === "hls2-s30" ? "B8A" : "B05";
      const [red, nir] = await Promise.all([cogPixels(f.assets.B04.href, token, col, row, 1), cogPixels(f.assets[nirBand].href, token, col, row, 1)]);
      let sum = 0, n = 0;
      red.forEach((r, i) => { const v = nir[i]; if (r > -1000 && v > -1000 && r + v > 0) { sum += (v - r) / (v + r); n++; } });
      return n ? { date: p.datetime.slice(0, 10), ndvi: +(sum / n).toFixed(3), sensor: f.collection === "hls2-s30" ? "S" : "L" } : null;
    }, onEach);
    return results.filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // A true-colour view of the land around a point, about 2.6 km across, from the HLS layers NASA GIBS publishes.
  function hlsImage(lat, lon, date, sensor, size) {
    const pad = 0.012, padLon = pad / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const layer = sensor === "S" ? "HLS_S30_Nadir_BRDF_Adjusted_Reflectance" : "HLS_L30_Nadir_BRDF_Adjusted_Reflectance";
    return `${GIBS}/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&STYLES=&FORMAT=image/jpeg&WIDTH=${size}&HEIGHT=${size}&SRS=EPSG:4326&BBOX=${(lon - padLon).toFixed(4)},${(lat - pad).toFixed(4)},${(lon + padLon).toFixed(4)},${(lat + pad).toFixed(4)}&TIME=${date}`;
  }

  // JRC Global Surface Water, from every Landsat scene of 1984-2020: how often each 30 m pixel was seen as water (percent
  // of clear views) and for how many months of 2020. Looks about 100 m around the pin, because a pin is rarely exact.
  async function fetchSurfaceWater(lat, lon) {
    const res = await fetch(STAC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collections: ["jrc-gsw"], bbox: [lon - 1e-4, lat - 1e-4, lon + 1e-4, lat + 1e-4], limit: 1 }) });
    if (!res.ok) throw new Error(`surface water search: ${res.status}`);
    const f = (await res.json()).features[0];
    if (!f) return null; // beyond the tiles: the map has none above 80 N or below 60 S
    const tf = f.properties["proj:transform"];
    const col = Math.floor((lon - tf[2]) / tf[0]), row = Math.floor((lat - tf[5]) / tf[4]);
    const token = await sasToken(f.assets.occurrence.href);
    const [occurrence, months] = await Promise.all([cogPixels(f.assets.occurrence.href, token, col, row, 3), cogPixels(f.assets.seasonality.href, token, col, row, 3)]);
    const seen = occurrence.filter((v) => v <= 100);
    const mid = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
    return { occurrence: mid(seen), months: mid(months.filter((v) => v <= 12)), wetPixels: seen.filter((v) => v >= 5).length, pixels: seen.length };
  }

  // ------------------------------------------------------------------- CMIP6
  const CMIP6 = {
    models: ["GFDL-ESM4", "IPSL-CM6A-LR", "MPI-ESM1-2-HR", "MRI-ESM2-0", "UKESM1-0-LL"],
    ssps: ["ssp245", "ssp585"],
    nLat: 75, nLon: 180, tStep: 0.05, rainPerDoubling: 40,
  };
  let cmip6Bytes = null;
  // Monthly change, 2041-2060 against 1995-2014, per model and scenario, from the grid cell at this point.
  async function loadDeltas(lat, lon) {
    if (!cmip6Bytes) cmip6Bytes = await cfg.readAsset(cfg.assetBase + "cmip6-deltas.bin");
    const { nLat, nLon, models, ssps } = CMIP6;
    const b = cmip6Bytes;
    const index = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + nLat * nLon * 2));
    const row = Math.floor((lat + 60) / 2), col = Math.floor((((lon % 360) + 360) % 360) / 2);
    let cell = 0;
    for (let r = 0; r <= 3 && !cell; r++) { // a small island or coast may fall outside the land grid: use the nearest land
      for (let dy = -r; dy <= r && !cell; dy++) {
        for (let dx = -r; dx <= r && !cell; dx++) {
          const y = row + dy;
          if (y < 0 || y >= nLat) continue;
          cell = index[y * nLon + ((col + dx + nLon) % nLon)];
        }
      }
    }
    if (!cell) return null;
    const perCell = models.length * ssps.length * 3 * 12;
    const offset = nLat * nLon * 2 + (cell - 1) * perCell;
    const data = new Int8Array(b.buffer, b.byteOffset + offset, perCell);
    const out = {};
    let i = 0;
    for (const model of models) {
      out[model] = {};
      for (const ssp of ssps) {
        const read = (f) => { const a = []; for (let m = 0; m < 12; m++) a.push(f(data[i++])); return a; };
        const dTmax = read((v) => v * CMIP6.tStep), dTmin = read((v) => v * CMIP6.tStep);
        const rainRatio = read((v) => Math.pow(2, v / CMIP6.rainPerDoubling));
        out[model][ssp] = { dTmax, dTmin, rainRatio };
      }
    }
    return out;
  }

  // ------------------------------------------------------- country and markets
  // Which country this point is in (OpenStreetMap Nominatim), for what is grown there (FAOSTAT, tools/build_country_crops.py).
  async function fetchCountry(lat, lon) {
    const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=3&lat=${lat}&lon=${lon}`, { timeout: 20000, retries: 1 });
    return j.address && j.address.country_code ? j.address.country_code.toUpperCase() : null;
  }
  let countryCrops = null;
  async function cropsInCountry(code) {
    if (!countryCrops) countryCrops = JSON.parse(new TextDecoder().decode(await cfg.readAsset(cfg.assetBase + "country-crops.json")));
    return code && countryCrops[code] ? Object.assign({ world: countryCrops._world }, countryCrops[code]) : null;
  }

  // NOAA's Oceanic Nino Index (tools/build_enso.js): one value a month, the Pacific's warmth against normal.
  async function loadEnso() {
    return JSON.parse(new TextDecoder().decode(await cfg.readAsset(cfg.assetBase + "enso.json")));
  }

  // -------------------------------------------------------------------- soil
  const SOIL_DEPTHS = [["0-5cm", 5], ["5-15cm", 10], ["15-30cm", 15], ["30-60cm", 30], ["60-100cm", 40]];
  async function fetchSoil(lat, lon) {
    const q = ["sand", "clay", "soc", "cec"].map((p) => `property=${p}`).join("&") + "&" + SOIL_DEPTHS.map((d) => `depth=${d[0]}`).join("&");
    const j = await getJson(`https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&${q}&value=mean`, { timeout: 45000, retries: 1 });
    const get = {};
    for (const layer of j.properties.layers) {
      const f = layer.unit_measure.d_factor;
      get[layer.name] = {};
      for (const d of layer.depths) get[layer.name][d.label] = d.values.mean == null ? null : d.values.mean / f;
    }
    const avg = (name, depths) => {
      let s = 0, w = 0;
      for (const [label, thick] of depths) { const v = get[name][label]; if (v != null) { s += v * thick; w += thick; } }
      return w ? s / w : null;
    };
    const sand = avg("sand", SOIL_DEPTHS), clay = avg("clay", SOIL_DEPTHS), soc = avg("soc", SOIL_DEPTHS);
    if (sand == null || clay == null || soc == null) throw new Error("no soil mapped here");
    const top = SOIL_DEPTHS.slice(0, 2);
    const coarse = await soilFromGrid(lat, lon).catch(() => null); // pH is a guide and a soil test beats it, so it does not need a second call to a slow service
    return { sand, clay, soc: soc / 10, cec: avg("cec", SOIL_DEPTHS), sandTop: avg("sand", top), clayTop: avg("clay", top), socTop: avg("soc", top) / 10, ph: coarse ? coarse.ph : null, source: "SoilGrids 2.0, 250 m" };
  }
  // The coarse copy the app carries (tools/build_soil_grid.py), for when the service is slow or down.
  let soilGrid = null;
  async function soilFromGrid(lat, lon) {
    if (!soilGrid) {
      const gz = await cfg.readAsset(cfg.assetBase + "soil-grid.bin.gz");
      const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"));
      soilGrid = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const nLat = 600, nLon = 1440, row = Math.floor((90 - lat) / 0.25), col = Math.floor(((lon + 180) % 360) / 0.25);
    const NONE = 255, band = (b, i) => soilGrid[b * nLat * nLon + i];
    for (let r = 0; r <= 4; r++) { // a coast or lake may fall on an empty cell: use the nearest soil
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const y = row + dy;
          if (y < 0 || y >= nLat) continue;
          const i = y * nLon + ((col + dx + nLon) % nLon);
          if (band(0, i) !== NONE && band(1, i) !== NONE && band(2, i) !== NONE) {
            return { sand: band(0, i), clay: band(1, i), soc: band(2, i) / 10, socTop: band(3, i) / 10, cec: band(4, i) === NONE ? null : band(4, i) * 0.2, ph: band(5, i) === NONE ? null : band(5, i) / 10, source: "SoilGrids 2.0, coarse 25 km copy" };
          }
        }
      }
    }
    return null;
  }

  // Slope from Terrain Tiles (elevation in the colour of each pixel, 30-40 m per pixel at zoom 12).
  async function fetchSlope(lat, lon) {
    const z = 12, n = 2 ** z;
    const xf = ((lon + 180) / 360) * n;
    const latRad = (lat * Math.PI) / 180;
    const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    const tx = Math.floor(xf), ty = Math.floor(yf);
    const png = await decodePng(await getBytes(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`));
    const px = Math.max(5, Math.min(250, Math.floor((xf - tx) * 256))), py = Math.max(5, Math.min(250, Math.floor((yf - ty) * 256))); // shortcut: stays inside the tile, moves the sample up to 5 pixels at a tile edge
    const elev = (x, y) => { const p = png.pixel(x, y); return p[0] * 256 + p[1] + p[2] / 256 - 32768; };
    const size = (156543.03 * Math.cos(latRad)) / n;
    // Measured across 3 pixels each way and averaged over a small window: radar elevation noise of a few metres
    // would read as a false slope of several percent between neighbouring pixels.
    let total = 0, count = 0;
    for (let y = py - 2; y <= py + 2; y++) {
      for (let x = px - 2; x <= px + 2; x++) {
        const dx = (elev(x + 3, y) - elev(x - 3, y)) / (6 * size), dy = (elev(x, y + 3) - elev(x, y - 3)) / (6 * size);
        total += Math.sqrt(dx * dx + dy * dy); count++;
      }
    }
    return { slope: +((100 * total) / count).toFixed(2), elevation: elev(px, py), source: "Terrain Tiles (NASA SRTM and other sources), 38 m" };
  }

  S2R.nasa = { cfg, CMIP6, cogPixels, getBytes, getJson, getText, pool, decodePng, colormap, sampleGibs, fetchWeather, harmonizeRain, fetchNdvi, fetchLandCover, fetchSmap, fetchGrace, fetchHls, fetchBurned, fetchSurfaceWater, hlsImage, toUtm, loadDeltas, loadEnso, fetchCountry, cropsInCountry, fetchSoil, soilFromGrid, fetchSlope };
})(typeof window !== "undefined" ? window : globalThis);
