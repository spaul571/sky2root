"""Download a real MODIS NDVI time series for the prototype's monitoring screen.

Source: MOD13Q1 v6.1 (250 m, 16-day composites) through the ORNL DAAC MODIS
web service, which needs no login and returns at most 10 dates per request.
The point is a cropland pixel near Sorriso, Mato Grosso, Brazil, where soy and
then maize are grown each year, so the curve shows two crops and a bare spell.

Run from the prototype folder:
    uv run python tools/fetch_ndvi.py
Writes data/ndvi-field.js (loaded by index.html as window.S2R_NDVI).
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://modis.ornl.gov/rst/api/v1/MOD13Q1"
LAT, LON = -12.62, -55.86
YEARS = range(2019, 2025)


def get(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Sky2Root-prototype/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def main() -> None:
    dates = get(f"{API}/dates?latitude={LAT}&longitude={LON}")["dates"]
    wanted = [d for d in dates if int(d["calendar_date"][:4]) in YEARS]
    series = []
    for i in range(0, len(wanted), 10):
        chunk = wanted[i:i + 10]
        url = (f"{API}/subset?latitude={LAT}&longitude={LON}&band=250m_16_days_NDVI"
               f"&startDate={chunk[0]['modis_date']}&endDate={chunk[-1]['modis_date']}"
               f"&kmAboveBelow=0&kmLeftRight=0")
        for row in get(url)["subset"]:
            value = row["data"][0]
            if value > -2000:
                series.append({"date": row["calendar_date"], "ndvi": round(value * 0.0001, 4)})
        print(f"  {chunk[-1]['calendar_date']}: {len(series)} points", flush=True)
    payload = {
        "source": "MODIS MOD13Q1 v6.1 NDVI, 250 m, 16-day (ORNL DAAC web service)",
        "place": "Cropland near Sorriso, Mato Grosso, Brazil",
        "lat": LAT, "lon": LON, "series": series,
    }
    out = ROOT / "data" / "ndvi-field.js"
    out.parent.mkdir(exist_ok=True)
    out.write_text("window.S2R_NDVI = " + json.dumps(payload, indent=1) + ";\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)} ({len(series)} points)")


if __name__ == "__main__":
    main()
