"""Build the app's global soil grid from ISRIC SoilGrids (CC BY 4.0).

The SoilGrids REST service is slow and has no uptime promise, so the app carries
a coarse copy for any point on Earth and asks the service for the 250 m value when
it can. This reads the 5 km aggregated rasters and writes a 0.25 degree grid of
sand, clay and organic carbon (0-100 cm), topsoil organic carbon, cation exchange
capacity and topsoil pH. CEC per unit of clay tells deep tropical red clays from shrink-swell clays.

    uv run python -I tools/build_soil_grid.py
"""

from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "soil-grid.bin.gz"
BASE = "https://files.isric.org/soilgrids/latest/data_aggregated/5000m"
DEPTHS = [("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15), ("30-60cm", 30), ("60-100cm", 40)]
NLAT, NLON = 600, 1440  # 90N to 60S, 180W to 180E, 0.25 degrees
TRANSFORM = from_origin(-180, 90, 0.25, 0.25)
NONE = 255


def read(prop: str, depth: str) -> np.ndarray:
    url = f"{BASE}/{prop}/{prop}_{depth}_mean_5000.tif"
    with rasterio.open(url) as src:
        out = np.full((NLAT, NLON), np.nan, dtype=np.float32)
        reproject(rasterio.band(src, 1), out, dst_transform=TRANSFORM, dst_crs="EPSG:4326", src_nodata=src.nodata, dst_nodata=np.nan, resampling=Resampling.average)
    print(f"  {prop} {depth}: {np.isfinite(out).sum()} cells", flush=True)
    return out


def weighted(prop: str, depths: list[tuple[str, int]]) -> np.ndarray:
    total = sum(weight for _, weight in depths)
    result = np.zeros((NLAT, NLON), dtype=np.float32)
    for depth, weight in depths:
        result += read(prop, depth) * (weight / total)
    return result


def to_byte(a: np.ndarray, scale: float) -> np.ndarray:
    b = np.full(a.shape, NONE, dtype=np.uint8)
    good = np.isfinite(a)
    b[good] = np.clip(np.round(a[good] * scale), 0, 254).astype(np.uint8)
    return b


def main() -> None:
    # Sand and clay are stored in g/kg, organic carbon in dg/kg.
    sand = to_byte(weighted("sand", DEPTHS), 0.1)  # percent
    clay = to_byte(weighted("clay", DEPTHS), 0.1)  # percent
    soc = to_byte(weighted("soc", DEPTHS), 0.1)  # tenths of a percent (dg/kg / 10 = 0.1 % units)
    soc_top = to_byte(weighted("soc", DEPTHS[:2]), 0.1)
    cec = to_byte(weighted("cec", DEPTHS), 0.5)  # stored in mmol(c)/kg, so a byte step is 2 mmol(c)/kg
    ph = to_byte(weighted("phh2o", DEPTHS[:3]), 1)  # 0-30 cm, stored as pH x 10
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT, "wb", compresslevel=9) as f:
        for band in (sand, clay, soc, soc_top, cec, ph):
            f.write(band.tobytes())
    print(f"Wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1e6:.2f} MB, {(sand != NONE).sum()} soil cells")


if __name__ == "__main__":
    main()
