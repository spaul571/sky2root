# Sky2Root

**Test-drive your next crop rotation on 40 years of NASA data, before you plant.**

Team Groot · NASA Space Apps Challenge 2026 · *Field Shift: Adapting Farms with NASA Data*

Farmers get about forty seasons in a lifetime, and shifting rains, heat at flowering and worn-out soil make old crop rotations fail more often. NASA already measures rain, heat, soil moisture and greenness for every field on Earth, but as satellite files, not answers. Sky2Root turns that data into a decision. A farmer marks a field and picks what matters most: a reliable harvest, saving water or healthier soil. Sky2Root then simulates every season since 1985, day by day, for each candidate rotation, stress-tests them against a hotter, drier 2050, scores what each does to the soil, and ranks them by the farmer's priorities with the reason in plain language.

## Run it

**Live prototype:** https://spaul571.github.io/sky2root/

Or open `prototype/index.html` in Chrome or Edge. No install or server is needed, and it works offline.

The prototype has seven screens: Field, NASA data, Simulate (one season, day by day), Replay (all 80 seasons since 1985, past climate or a 2050 what-if), Rank, Monitor (real satellite greenness for one field) and District (a view for extension agents). The interface switches between English, Español, Français, Kiswahili, हिन्दी, বাংলা and Português. Details are in [`prototype/README.md`](prototype/README.md).

## Code

| Path | What it does |
| --- | --- |
| `prototype/index.html`, `prototype/css/app.css`, `prototype/js/app.js` | App shell, styles and screen logic |
| `prototype/js/model.js` | Data model: example farm, crops, rotations, season results, ranking and the daily season simulation |
| `prototype/js/season-view.js` | Day-by-day season drawing (field, soil water, growth, heat at flowering) |
| `prototype/data/ndvi-field.js` | Real MODIS NDVI time series |
| `prototype/tools/fetch_ndvi.py` | Downloads the NDVI series from the ORNL DAAC MODIS web service |
| `prototype/assets/` | NASA GIBS satellite images and fonts |

## NASA data

| Dataset | What Sky2Root uses it for |
| --- | --- |
| NASA POWER | Daily temperature, humidity, wind, solar radiation and rain since 1981, to drive the season simulation |
| GPM IMERG | Rainfall: when rainy seasons start and how long dry spells last |
| SMAP L4 | Root-zone soil moisture, the starting point for the next season |
| HLS (Landsat and Sentinel-2) and MODIS MOD13Q1 NDVI | Field greenness, to count bare-soil days and check cover crops |
| NEX-GDDP-CMIP6 | Downscaled climate projections for the 2050 stress test |
| GRACE-FO | Regional water-storage trends, to flag thirsty rotations |
| NASADEM | Elevation and slope, for erosion |
| NASA GIBS | Satellite imagery layers shown in the app |

**What is real and what is illustrative:** the satellite images (via NASA GIBS) and the greenness curve on the Monitor screen (MODIS NDVI via the ORNL DAAC web service, a field near Sorriso, Brazil) are real NASA data. The example farm, its 40 years of season results, the soil scores and the district farms are a fixed, seeded illustration of how the tool will behave. In the full tool, the same steps run on NASA data for the farmer's own field.

## Team Groot

| Name | Role |
| --- | --- |
| Shrikanta Paul | Team Lead |
| MD. Nurol Amin | Earth Data Engineer |
| Kazi Meherunnesa Eva | Crop and Climate Modeller |
| Fardin Ahmed Alvi | Frontend and UX Designer |
| Animesh Dey | Hardware and IoT Engineer |
