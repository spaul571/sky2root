// The Oceanic Nino Index from NOAA, for the app to carry: NOAA's server does not answer browsers directly.
// Rerun it to bring "what the Pacific is doing now" up to date (NOAA adds a value each month).
//
//   node tools/build_enso.js
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const res = await fetch("https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt", { headers: { "User-Agent": "Sky2Root-tools/1.0" } });
  if (!res.ok) throw new Error(`NOAA: ${res.status}`);
  // Each row is a three-month average: DJF 1950 is centred on January 1950, so rows run month by month.
  const rows = (await res.text()).trim().split("\n").slice(1).map((line) => line.trim().split(/\s+/));
  const SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"];
  rows.forEach(([season, year], i) => {
    if (season !== SEASONS[i % 12] || +year !== 1950 + Math.floor(i / 12)) throw new Error(`unexpected row ${i}: ${season} ${year}`);
  });
  const out = { source: "NOAA CPC Oceanic Nino Index, ERSST", first: 1950, oni: rows.map((r) => +r[3]) };
  const file = path.join(__dirname, "..", "app", "data", "enso.json");
  fs.writeFileSync(file, JSON.stringify(out));
  const last = rows[rows.length - 1];
  console.log(`${rows.length} months to ${last[0]} ${last[1]}: ${last[3]}. Wrote ${path.relative(process.cwd(), file)} (${fs.statSync(file).size} bytes)`);
})();
