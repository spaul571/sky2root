"""Build the app's global climate-change grid from NASA NEX-GDDP-CMIP6.

The app replays past seasons under 2041-2060 climate (the delta-change method).
It needs, for any point on Earth and in seconds, how much each month warms and
how much its rain changes. NEX-GDDP-CMIP6 files hold one global chunk per day,
so a single-point read still costs the whole file (30-50 s per file through the
NCCS subset service, hundreds of files per field). This job does the work once:

  1. Reads sampled days from the public S3 copy (no login) and averages them to
     a 2 degree grid. Rain is noisier than temperature, so it is read more often.
  2. `--assemble` turns the sums into monthly deltas per model and scenario and
     writes app/data/cmip6-deltas.bin.

Reference period 1995-2014 and mid-century 2041-2060 follow IPCC AR6. The models
are the five ISIMIP3b models, chosen by ISIMIP to be independent and to span low
to high climate sensitivity.

    uv run python -I tools/build_cmip6_deltas.py            # resumable download
    uv run python -I tools/build_cmip6_deltas.py --assemble # write the app file
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import fsspec
import h5py
import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
PARTIAL = ROOT / "data" / "cmip6_partial"
OUT = ROOT / "app" / "data" / "cmip6-deltas.bin"
S3 = "https://nex-gddp-cmip6.s3.us-west-2.amazonaws.com/"

MODELS = {
    "GFDL-ESM4": "r1i1p1f1",
    "IPSL-CM6A-LR": "r1i1p1f1",
    "MPI-ESM1-2-HR": "r1i1p1f1",
    "MRI-ESM2-0": "r1i1p1f1",
    "UKESM1-0-LL": "r1i1p1f2",
}
SSPS = ["ssp245", "ssp585"]
WINDOWS = {"historical": range(1995, 2015), "ssp245": range(2041, 2061), "ssp585": range(2041, 2061)}
EVERY_N_DAYS = {"tasmax": 10, "tasmin": 10, "pr": 5}
BLOCK = 8  # 0.25 degree cells per 2 degree cell
NLAT, NLON = 75, 180  # 60S-90N, 0-360E
FILL = 1e19
T_STEP = 0.05  # degrees C per int8 step, so +-6.35 C
RAIN_STEPS_PER_DOUBLING = 40  # so a ratio of 0.11 to 9.0


def list_keys(prefix: str) -> list[str]:
    keys, token = [], None
    while True:
        params = {"list-type": "2", "prefix": prefix}
        if token:
            params["continuation-token"] = token
        xml = requests.get(S3, params=params, timeout=120).text
        keys += re.findall(r"<Key>([^<]+)</Key>", xml)
        match = re.search(r"<NextContinuationToken>([^<]+)", xml)
        if not match:
            return keys
        token = match.group(1)


def latest_files(model: str, variant: str, exp: str, var: str) -> dict[int, str]:
    """Year to key, newest file version per year (NASA reissued some as _v1.1, _v2.0)."""
    best: dict[int, tuple[tuple[int, ...], str]] = {}
    for key in list_keys(f"NEX-GDDP-CMIP6/{model}/{exp}/{variant}/{var}/{var}_day"):
        match = re.search(r"_(\d{4})(?:_v([\d.]+))?\.nc$", key)
        if not match:
            continue
        year = int(match.group(1))
        version = tuple(int(x) for x in match.group(2).split(".")) if match.group(2) else (0,)
        if year not in best or version > best[year][0]:
            best[year] = (version, key)
    return {year: value[1] for year, value in best.items()}


def partial_path(model: str, exp: str, var: str, year: int) -> Path:
    return PARTIAL / f"{model}__{exp}__{var}__{year}.npz"


def read_one(task: tuple[str, str, str, int, str]) -> str:
    model, exp, var, year, key = task
    out = partial_path(model, exp, var, year)
    if out.exists():
        return f"have {out.name}"
    last_error = None
    for attempt in range(4):
        try:
            sums = np.zeros((12, NLAT, NLON))
            counts = np.zeros((12, NLAT, NLON), dtype=np.int64)
            with fsspec.open(S3 + key, "rb", block_size=2**20) as remote, h5py.File(remote, "r") as nc:
                data = nc[var]
                days = data.shape[0]
                step = EVERY_N_DAYS[var]
                # A different offset each year, so the 20 years together cover every day of the cycle.
                for day in range(year % step, days, step):
                    grid = np.asarray(data[day], dtype=np.float64)
                    good = grid < FILL
                    grid[~good] = 0.0
                    month = min(11, 12 * day // days)  # shortcut: ignores calendar months (365/360 day models), about a day off at most
                    sums[month] += grid.reshape(NLAT, BLOCK, NLON, BLOCK).sum(axis=(1, 3))
                    counts[month] += good.reshape(NLAT, BLOCK, NLON, BLOCK).sum(axis=(1, 3))
            tmp = out.with_suffix(".tmp.npz")
            np.savez_compressed(tmp, sums=sums.astype(np.float32), counts=counts.astype(np.int32))
            tmp.replace(out)
            return f"done {out.name}"
        except Exception as error:  # network hiccups on a long job: retry, then report and move on
            last_error = error
            time.sleep(5 * (attempt + 1))
    return f"FAILED {out.name}: {last_error}"


def download(workers: int) -> None:
    PARTIAL.mkdir(parents=True, exist_ok=True)
    tasks = []
    for model, variant in MODELS.items():
        for exp, years in WINDOWS.items():
            for var in EVERY_N_DAYS:
                files = latest_files(model, variant, exp, var)
                missing = [y for y in years if y not in files]
                if missing:
                    sys.exit(f"{model} {exp} {var}: no files for {missing}")
                tasks += [(model, exp, var, y, files[y]) for y in years]
    todo = [t for t in tasks if not partial_path(*t[:4]).exists()]
    print(f"{len(tasks)} files in total, {len(todo)} to read", flush=True)
    started = time.time()
    failed = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(read_one, t) for t in todo]
        for i, future in enumerate(as_completed(futures), 1):
            message = future.result()
            failed += message.startswith("FAILED")
            elapsed = time.time() - started
            print(f"[{i}/{len(todo)}] {elapsed / 60:.1f} min, about {elapsed / i * (len(todo) - i) / 60:.0f} min left: {message}", flush=True)
    print(f"Finished with {failed} failures", flush=True)


def climatology(model: str, exp: str, var: str) -> tuple[np.ndarray, np.ndarray]:
    sums = np.zeros((12, NLAT, NLON))
    counts = np.zeros((12, NLAT, NLON))
    for year in WINDOWS[exp]:
        with np.load(partial_path(model, exp, var, year)) as z:
            sums += z["sums"]
            counts += z["counts"]
    return sums, counts


def smooth_months(a: np.ndarray) -> np.ndarray:
    """Keep the annual mean and two harmonics: the true change varies slowly through the year, sampling noise does not."""
    spectrum = np.fft.rfft(a, axis=0)
    spectrum[3:] = 0
    return np.fft.irfft(spectrum, n=12, axis=0)


def three_month(a: np.ndarray) -> np.ndarray:
    return np.roll(a, 1, axis=0) + a + np.roll(a, -1, axis=0)


def assemble() -> None:
    land = None
    blocks = []
    for model in MODELS:
        for ssp in SSPS:
            for var in ("tasmax", "tasmin"):
                hs, hc = climatology(model, "historical", var)
                fs, fc = climatology(model, ssp, var)
                with np.errstate(invalid="ignore", divide="ignore"):
                    delta = fs / fc - hs / hc
                has_data = (hc.min(axis=0) > 0) & (fc.min(axis=0) > 0)
                land = has_data if land is None else land & has_data
                delta = smooth_months(np.nan_to_num(delta))
                blocks.append(np.clip(np.round(delta / T_STEP), -127, 127).astype(np.int8))
            hs, hc = climatology(model, "historical", "pr")
            fs, fc = climatology(model, ssp, "pr")
            with np.errstate(invalid="ignore", divide="ignore"):
                # Three-month rain sums: a ratio of two nearly dry months is only noise.
                hist = three_month(hs) / three_month(hc) * 86400
                fut = three_month(fs) / three_month(fc) * 86400
                # A floor of 0.1 mm/day keeps ratios in deserts sensible.
                ratio = (np.maximum(fut, 0) + 0.1) / (np.maximum(hist, 0) + 0.1)
            log_ratio = smooth_months(np.nan_to_num(np.log2(ratio)))
            blocks.append(np.clip(np.round(log_ratio * RAIN_STEPS_PER_DOUBLING), -127, 127).astype(np.int8))
    # Index grid: land cell number + 1 per grid cell, 0 where there is no data.
    index = np.zeros((NLAT, NLON), dtype=np.uint16)
    index[land] = np.arange(1, land.sum() + 1)
    # Output order: cell, model, scenario, variable (tasmax, tasmin, pr), month.
    cube = np.stack(blocks, axis=0).reshape(len(MODELS), len(SSPS), 3, 12, NLAT, NLON)
    cells = cube[:, :, :, :, land]  # model, ssp, var, month, cell
    cells = np.moveaxis(cells, -1, 0)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "wb") as f:
        f.write(index.astype("<u2").tobytes())
        f.write(cells.tobytes())
    print(f"Wrote {OUT.relative_to(ROOT)}: {int(land.sum())} land cells, {OUT.stat().st_size / 1e6:.2f} MB")
    t = cells[:, :, :, 0, :] * T_STEP
    r = 2 ** (cells[:, :, :, 2, :] / RAIN_STEPS_PER_DOUBLING)
    print(f"Tmax change: {t.min():.2f} to {t.max():.2f} C, mean {t.mean():.2f}. Rain ratio: {r.min():.2f} to {r.max():.2f}, median {np.median(r):.3f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--assemble", action="store_true", help="write the app file from the downloaded sums")
    parser.add_argument("--workers", type=int, default=14)
    args = parser.parse_args()
    if args.assemble:
        assemble()
    else:
        download(args.workers)
