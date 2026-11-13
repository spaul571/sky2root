"""What is grown in each country, how much farms harvest, and what they are paid, from the FAOSTAT bulk downloads.

A crop rarely grown in a country is likely to lack seed, know-how and buyers, so the app does not suggest it unless
the farmer asks. National yields and farm-gate prices put the simulation's comparison into real tonnes and money.

Download first (see extract_faostat.py for qcl.zip):
    curl -L -o data/faostat_prices/prices.zip "https://bulks-faostat.fao.org/production/Prices_E_All_Data_(Normalized).zip"
    curl -L -o data/faostat_value/value.zip "https://bulks-faostat.fao.org/production/Value_of_Production_E_All_Data_(Normalized).zip"
Then:
    uv run --with pycountry python -I tools/build_country_crops.py
"""

import csv
import io
import json
import statistics
import zipfile
from collections import defaultdict
from pathlib import Path

import pycountry

ROOT = Path(__file__).resolve().parent.parent
ITEMS = {
    "Maize (corn)": "maize", "Sorghum": "sorghum", "Millet": "millet", "Rice": "rice", "Wheat": "wheat", "Barley": "barley",
    "Soya beans": "soybean", "Cow peas, dry": "cowpea", "Beans, dry": "bean", "Groundnuts, excluding shelled": "groundnut",
    "Chick peas, dry": "chickpea", "Lentils, dry": "lentil", "Sunflower seed": "sunflower", "Sesame seed": "sesame",
    "Rape or colza seed": "mustard", "Mustard seed": "mustard", "Potatoes": "potato",
}
FIRST_YEAR = 2019  # the last few years, to smooth out one bad season
FIRST_PRICE_YEAR = 2015  # many countries report late, but prices far older than this mislead (India's latest are from 2008)


def rows(path):
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if "All_Data" in n)
        with z.open(name) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin-1"))


area = defaultdict(lambda: defaultdict(float))
total = defaultdict(float)
per_year = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: [0.0, 0.0])))  # country, crop, year: area, production
produced = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))  # country, crop, year: tonnes, for implicit prices
for row in rows(ROOT / "data" / "faostat" / "qcl.zip"):
    if row["Element"] not in ("Area harvested", "Production") or int(row["Year"]) < FIRST_YEAR or not row["Value"]:
        continue
    item, code, value = row["Item"], row["Area Code (M49)"].strip("'"), float(row["Value"])
    if row["Element"] == "Area harvested":
        if "Total" in item or "rimary" in item or "Treenuts" in item:  # FAOSTAT's own subtotals
            continue
        total[code] += value
        if item in ITEMS:
            area[code][ITEMS[item]] += value
    if item in ITEMS:
        per_year[code][ITEMS[item]][row["Year"]][0 if row["Element"] == "Area harvested" else 1] += value
        if row["Element"] == "Production":
            produced[code][ITEMS[item]][row["Year"]] += value

# Each year's yield from production over area, so rapeseed and mustard, reported apart, combine correctly.
yields = defaultdict(dict)
for code, crops in per_year.items():
    for crop, years in crops.items():
        values = [prod / ha for ha, prod in years.values() if ha > 0 and prod > 0]
        if values:
            yields[code][crop] = [round(statistics.mean(values), 2), round(max(values), 2)]

price_by_year = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
for row in rows(ROOT / "data" / "faostat_prices" / "prices.zip"):
    if row["Element"] == "Producer Price (USD/tonne)" and row["Item"] in ITEMS and int(row["Year"]) >= FIRST_PRICE_YEAR and row["Value"] and float(row["Value"]) > 0:
        price_by_year[row["Area Code (M49)"].strip("'")][ITEMS[row["Item"]]][int(row["Year"])].append(float(row["Value"]))

prices = defaultdict(dict)
price_years = defaultdict(list)
for code, crops in price_by_year.items():
    for crop, years in crops.items():
        recent = sorted(years)[-3:]  # the latest years a country reported: markets move, so older prices count for less
        prices[code][crop] = round(statistics.mean(statistics.mean(years[y]) for y in recent))
        price_years[code].append(recent[-1])

# Many countries report no recent farm price (India's latest is 2008). FAO still estimates what each harvest was worth,
# and that value over the tonnes grown gives a price for them.
value = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
for row in rows(ROOT / "data" / "faostat_value" / "value.zip"):
    if row["Element"] == "Gross Production Value (current thousand US$)" and row["Item"] in ITEMS and int(row["Year"]) >= 2022 and row["Value"]:
        value[row["Area Code (M49)"].strip("'")][ITEMS[row["Item"]]][row["Year"]] += float(row["Value"]) * 1000

estimated = defaultdict(dict)
for code, crops in value.items():
    for crop, years in crops.items():
        each = [usd / produced[code][crop][y] for y, usd in years.items() if produced[code][crop][y] > 0]
        if each:
            estimated[code][crop] = round(statistics.mean(each))

COMPARE = []
out = {}
for code, crops in area.items():
    country = pycountry.countries.get(numeric=code)
    if not country or not total[code]:
        continue  # regions and aggregates have no country entry
    shares = {crop: round(value / total[code], 4) for crop, value in crops.items() if value / total[code] >= 0.0005}
    out[country.alpha_2] = {"name": country.name, "shares": shares, "yield": yields.get(code, {}), "price": prices.get(code, {}), "priceEst": estimated.get(code, {})}
    if price_years[code]:
        out[country.alpha_2]["priceYear"] = max(price_years[code])

# The middle country, for a crop or country FAOSTAT has no figure for.
codes = [c.alpha_2 for c in pycountry.countries if c.alpha_2 in out]
crop_ids = sorted(set(ITEMS.values()))
out["_world"] = {
    "yield": {c: [round(statistics.median(out[k]["yield"][c][i] for k in codes if c in out[k]["yield"]), 2) for i in (0, 1)] for c in crop_ids},
    "price": {c: round(statistics.median(out[k]["price"][c] for k in codes if c in out[k]["price"])) for c in crop_ids},
}

# A few figures are plainly wrong (Mexican millet at $33 a tonne, Jamaican maize at $8,119, and FAO's estimates for Argentina after
# its currency fell): drop them, so the next source stands in. An estimate is only kept where there is no reported price.
for key, entry in out.items():
    if key != "_world":
        for kind, width in (("price", 6), ("priceEst", 3)):
            entry[kind] = {c: p for c, p in entry[kind].items() if out["_world"]["price"][c] / width <= p <= out["_world"]["price"][c] * width}
        pairs = [(entry["price"][c], entry["priceEst"][c]) for c in entry["price"] if c in entry["priceEst"]]
        for reported, implicit in pairs:
            COMPARE.append(implicit / reported)
        entry["priceEst"] = {c: p for c, p in entry["priceEst"].items() if c not in entry["price"]}
print(f"Estimated against reported prices, {len(COMPARE)} pairs: ratio {statistics.quantiles(COMPARE, n=4)}")

path = ROOT / "app" / "data" / "country-crops.json"
path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
print(f"{len(out) - 1} countries, {path.stat().st_size / 1000:.0f} KB")
print("world", out["_world"])
for c in ("US", "BD", "KE", "NE", "BR", "IN", "MW"):
    print(c, sorted(out[c]["shares"].items(), key=lambda kv: -kv[1])[:5], "yield", {k: v for k, v in list(out[c]["yield"].items())[:4]}, "price", list(out[c]["price"].items())[:4], out[c].get("priceYear"))
print("no reported or estimated price:", [k for k in codes if not out[k]["price"] and not out[k]["priceEst"]])
for c in ("IN", "AR", "MW", "ET"):
    print(c, "reported", out[c]["price"], "estimated", out[c]["priceEst"])
