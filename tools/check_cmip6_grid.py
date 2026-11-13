"""Check the sampled 2-degree CMIP6 grid against exact daily values at a point.

Reads complete years at one point through NASA's NCSS subset service (slow, hence
only a sample of years) and compares the monthly change with the sums in
data/cmip6_partial. Catches errors of orientation, units and month handling.

    uv run python -I tools/check_cmip6_grid.py
"""

import csv
import io
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
PARTIAL = ROOT / "data" / "cmip6_partial"
NCSS = "https://ds.nccs.nasa.gov/thredds/ncss/grid/AMES/NEX/GDDP-CMIP6"
MODEL, VARIANT, GRID = "GFDL-ESM4", "r1i1p1f1", "gr1"
POINTS = {"Sorriso": (-12.62, -55.86), "Iowa": (42.1, -93.6)}
HIST = range(1995, 2015, 4)
FUTURE = range(2041, 2061, 4)


def point_year(var: str, exp: str, year: int, lat: float, lon: float) -> np.ndarray:
    name = f"{var}_day_{MODEL}_{exp}_{VARIANT}_{GRID}_{year}_v2.0.nc"
    url = f"{NCSS}/{MODEL}/{exp}/{VARIANT}/{var}/{name}?var={var}&latitude={lat}&longitude={lon % 360}&temporal=all&accept=csv"
    r = requests.get(url, timeout=300)
    r.raise_for_status()
    sums, counts = np.zeros(12), np.zeros(12)
    for row in csv.reader(io.StringIO(r.text)):
        if not row or not re.match(r"\d{4}-", row[0]):
            continue
        m = int(row[0][5:7]) - 1
        sums[m] += float(row[-1])
        counts[m] += 1
    return sums / counts


def grid_clim(var: str, exp: str, years, lat: float, lon: float) -> np.ndarray:
    row, col = int((lat + 60) // 2), int((lon % 360) // 2)
    s, c = np.zeros(12), np.zeros(12)
    for y in years:
        z = np.load(PARTIAL / f"{MODEL}__{exp}__{var}__{y}.npz")
        s += z["sums"][:, row, col]
        c += z["counts"][:, row, col]
    return s / c


for place, (lat, lon) in POINTS.items():
    for var, scale in (("tasmax", 1), ("pr", 86400)):
        with ThreadPoolExecutor(6) as pool:
            hist = list(pool.map(lambda y: point_year(var, "historical", y, lat, lon), HIST))
            fut = list(pool.map(lambda y: point_year(var, "ssp245", y, lat, lon), FUTURE))
        h, f = np.mean(hist, axis=0) * scale, np.mean(fut, axis=0) * scale
        gh = grid_clim(var, "historical", range(1995, 2015), lat, lon) * scale
        gf = grid_clim(var, "ssp245", range(2041, 2061), lat, lon) * scale
        if var == "tasmax":
            print(f"{place} {var}: point climate {h.mean() - 273.15:.1f} C vs grid {gh.mean() - 273.15:.1f} C. Change by month:")
            print("   point", np.round(f - h, 1).tolist())
            print("   grid ", np.round(gf - gh, 1).tolist())
        else:
            print(f"{place} {var}: point climate {h.sum() * 30.4:.0f} vs grid {gh.sum() * 30.4:.0f} mm/yr; annual change point {f.sum() / h.sum():.3f} vs grid {gf.sum() / gh.sum():.3f}")
            print("   point mm/day", np.round(h, 1).tolist())
            print("   grid  mm/day", np.round(gh, 1).tolist())
