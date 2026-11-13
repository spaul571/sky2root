"""Pull national crop yields out of the FAOSTAT bulk download, for tools/validate.js.

Download first:
    curl -L -o data/faostat/qcl.zip "https://bulks-faostat.fao.org/production/Production_Crops_Livestock_E_All_Data_(Normalized).zip"
Then:
    uv run python -I tools/extract_faostat.py
"""

import csv
import io
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AREAS = {"Brazil", "Bangladesh", "Kenya", "United States of America", "Niger", "India", "Malawi"}
ITEMS = {"Maize (corn)": "maize", "Soya beans": "soybean", "Rice": "rice", "Wheat": "wheat", "Millet": "millet", "Sorghum": "sorghum", "Groundnuts, excluding shelled": "groundnut", "Cow peas, dry": "cowpea", "Beans, dry": "bean", "Rape or colza seed": "mustard", "Lentils, dry": "lentil"}

out: dict = {}
with zipfile.ZipFile(ROOT / "data" / "faostat" / "qcl.zip") as z:
    name = next(n for n in z.namelist() if "All_Data" in n)
    with z.open(name) as raw:
        for row in csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1")):
            if row["Element"] != "Yield" or row["Area"] not in AREAS or row["Item"] not in ITEMS:
                continue
            value = float(row["Value"] or 0)
            unit = row["Unit"]
            t_per_ha = value / {"hg/ha": 10000, "kg/ha": 1000, "100 g/ha": 10000}[unit]
            out.setdefault(row["Area"], {}).setdefault(ITEMS[row["Item"]], {})[row["Year"]] = round(t_per_ha, 3)

path = ROOT / "data" / "faostat" / "yields.json"
path.write_text(json.dumps(out))
for area, crops in out.items():
    print(area, {c: (min(v), max(v), v[max(v)]) for c, v in crops.items()})
