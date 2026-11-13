# Sky2Root

**Test-drive your next crop rotation on 40 years of NASA data, before you plant.**

Team Groot · NASA Space Apps Challenge 2026 · *Field Shift: Adapting Farms with NASA Data*

**Try it: https://spaul571.github.io/sky2root/** · [Video walkthrough (4 min)](https://youtu.be/ICkOCiKVnNE) · Demo: [7 slides](demo/Sky2Root-demo-slides.pdf) · [Methods](docs/METHODS.md) · [Validation](docs/VALIDATION.md)

Farmers get about forty seasons in a lifetime, and shifting rains, heat at flowering and worn-out soil make old crop rotations fail more often. NASA already measures rain, heat, soil moisture and greenness for every field on Earth, but as satellite files, not answers. Sky2Root turns that data into a decision. Mark any field on Earth and say what matters most: a reliable harvest, saving water, healthier soil or animal feed. Sky2Root then simulates every season since 1985, day by day, for each candidate rotation, tests them against a hotter 2050 with five climate models, estimates what each does to the soil, and ranks them by your priorities. For each option it shows why it came up, the evidence, the possible benefits, what is unknown, and what to check locally.

It supports farmers and advisers. It does not replace their judgement.

## Run it

The app is static: no server, no login, no install. Any web server will do, because browsers block data files opened directly from disk:

```bash
python -m http.server 8000 --directory app
# then open http://localhost:8000
```

Open an example, or find your field and answer three short questions. A new field gives its first full answer in about 10 seconds, and slower layers fill in over the next 1-2 minutes. Once opened, a field keeps working offline, except for the monthly pictures of the field, which come from NASA as you view them.

To try it on a phone, run the same command, then open `http://<your computer's address>:8000` on the same Wi-Fi. Browsers allow "Use my location" and offline use only on `https://` or `localhost`, so those two work on a phone once the app is hosted.

For demos, the URL takes `?field=bogura-bangladesh&screen=rank&period=ssp245&lang=bn`. A result for any other field can be shared as a link, such as `?lat=24.92&lon=89.28&plant=double&crops=rice,wheat&water=limited&floods=1&screen=rank`, which works the answer out again when opened.

## Screens

The app is built for phones first, and works from a 320 px phone to a wide desktop. Words are plain and the answer comes first; the detail is one tap away. The main path is in English, Spanish, French, Kiswahili, Hindi, Bangla and Portuguese. The translations are machine-drafted and need a native speaker's review. Long technical notes on the Climate, From space and How sure screens stay in English, and those screens say so.

| Screen (`?screen=`) | What it shows |
| --- | --- |
| My field (`field`) | Three short steps: where your field is; what you grow and your water; what matters to you. Crops are chosen by photo as well as by name, with those most grown in the country first. Landsat's record of water on the spot suggests whether the land floods. Optional: what you can sell, your soil test |
| Best plan (`rank`) | The answer: the best crop plan for your priorities, against what you grow now, and when to plant. Each crop by photo, with its simulated yield, what farms in the country get, and the farm price; a rough harvest value; how the plan did in past El Niño and La Niña seasons, and what the Pacific is doing now. Then why, what to check, the evidence, what is unknown, and the other options |
| Past seasons (`replay`) | Every season since 1985 for one plan, one box per year, beside rain and El Niño years; past climate, 2050 scenarios, or your own what-if |
| Watch a season (`simulate`) | One real season, day by day: rain, soil water, growth, heat at flowering |
| Climate (`data`) | The climate here, how it has changed, soil pH, the crops that could grow here, and NASA map layers at this field |
| From space (`monitor`) | True-colour pictures of the field through the last year, its greenness at 30 m, bare-soil days, water seen by Landsat, burned land nearby, and how much erosive rain falls on bare ground |
| How sure? (`trust`) | The simulation against SMAP, and a statistical second opinion; what it cannot tell you; the words explained; sources |

## NASA data

| Dataset | What Sky2Root uses it for |
| --- | --- |
| NASA POWER | Daily temperature, dew point, wind and sunshine since 1984: crop water demand and crop development |
| GPM IMERG | Daily rain since 1998: planting dates, dry spells, soil water, erosion |
| SMAP L4 | Root-zone soil moisture since 2015: an independent check, and "wetter or drier than usual now" |
| HLS (Landsat, Sentinel-2) | Greenness of the field itself at 30 m: bare-soil days, crops per year; true-colour pictures of the field, through NASA GIBS |
| MODIS MOD13Q1, MCD12Q1 | Long greenness record since 2001; land cover check |
| MODIS MCD64A1 | Burned land within 1 km of the field since 2001, a sign of residue burning |
| MODIS MOD16A2GF | An independent check of simulated crop water use (validation only) |
| Landsat, through JRC Global Surface Water | How often water was seen on the spot since 1984: suggests whether the land floods |
| NEX-GDDP-CMIP6 | 2041-2060 climate change from 5 models and 2 scenarios |
| GRACE / GRACE-FO | Long-term water storage trend, to flag water-hungry rotations |
| SRTM | Slope, for erosion |
| NASA GIBS | Map layers |

Other data: ISRIC SoilGrids 2.0 (soil, including pH); FAO-56, FAO-33, AquaCrop and FAO EcoCrop (crop parameters, soil pH limits); FAOSTAT (what is grown in each country, national yields, farm prices, value of production); NOAA's Oceanic Niño Index (El Niño and La Niña since 1950).

See **[docs/METHODS.md](docs/METHODS.md)** for how every number is made and what it rests on, and **[docs/VALIDATION.md](docs/VALIDATION.md)** for how the simulation compares with data it never saw.

## Code

| Path | What it does |
| --- | --- |
| `app/js/engine.js` | Science core: FAO-56 water balance, crops, calendar, rotations, soil, ranking, trends. Pure functions, no browser needed |
| `app/js/nasa.js` | Fetches NASA data for any point; includes small PNG and COG readers |
| `app/js/explain.js` | Plain-language reasons, glossary, limits, sources |
| `app/js/i18n.js` | Every word the app shows, in each language |
| `app/js/app.js`, `app/js/season-view.js`, `app/index.html`, `app/css/` | Screens |
| `app/sw.js` | Offline support |
| `app/data/` | Prepared data: climate change (`cmip6-deltas.bin`), soil (`soil-grid.bin.gz`), crops, yields and prices by country (`country-crops.json`), El Niño index (`enso.json`), photo credits (`crop-photos.json`) |
| `app/img/crops/` | A photo of each crop |
| `app/fields/` | NASA data for 7 example fields, so demos work without a connection |
| `tools/build_fields.js`, `tools/fields.json` | Downloads the example fields |
| `tools/build_cmip6_deltas.py`, `tools/check_cmip6_grid.py` | Builds and checks the climate-change grid from NEX-GDDP-CMIP6 |
| `tools/build_soil_grid.py` | Builds the soil grid from SoilGrids |
| `tools/extract_faostat.py`, `tools/validate.js` | Validation against independent data; writes `docs/VALIDATION.md` |
| `tools/build_country_crops.py` | Share of crop area, national yields and farm prices per crop and country, from FAOSTAT |
| `tools/build_enso.js` | The Oceanic Niño Index from NOAA. Rerun it to keep "what the Pacific is doing now" current |
| `tools/build_crop_photos.py` | Downloads the chosen crop photos from Wikimedia Commons, crops them and records their credits |
| `tests/` | Unit tests, including FAO-56's worked example; translation and asset checks; a smoke test of the app at six device sizes |
| `demo/` | The project demo: 7 slides (`slides.html`, printed to `Sky2Root-demo-slides.pdf`) and the 30-second video (`video.html`), built from screenshots of the app by the scripts in `demo/tools/` |

```bash
node --test "tests/*.test.js"         # unit tests and translation checks
uv run --with playwright python tests/ui_smoke.py   # the real app in Chrome, phone to desktop
node tools/build_fields.js            # download example fields (needs nothing but Node)
node tools/validate.js                # check against SMAP, MODIS, FAOSTAT (see tools/extract_faostat.py first)
uv run python -I tools/build_cmip6_deltas.py && uv run python -I tools/build_cmip6_deltas.py --assemble
uv run --with playwright python demo/tools/make_shots.py                  # screenshots of the app for the demo
uv run --with playwright --with pypdf python demo/tools/render_slides.py  # demo slides to PDF
uv run --with playwright --with imageio-ffmpeg --with kokoro-onnx --with soundfile python demo/tools/render_video.py  # 30-second video
```

## How SI tools were used

An SI coding assistant (Claude Code, by Anthropic) was used throughout development: to read data documentation and test NASA services, to write and debug most of the code and tests, and to draft the documentation, the demo slides and the demo video layout. The team directed the work, made the decisions and reviewed the results. The voices in the videos are the team's own.


The app itself uses no generative SI at runtime. Its reasons are written from the simulation's numbers by fixed rules.

## Licences of materials used

| Material | Licence |
| --- | --- |
| NASA data (POWER, IMERG, SMAP, MODIS, HLS, NEX-GDDP-CMIP6, GRACE, SRTM, GIBS) | Open, no restriction |
| ISRIC SoilGrids 2.0 | CC BY 4.0 |
| Leaflet 1.9.4 (`app/vendor/leaflet/`) | BSD 2-Clause |
| Archivo font (`app/css/archivo-latin.woff2`) | SIL Open Font License |
| Terrain Tiles (AWS open data) | Open; attribution to Mapzen and sources |
| FAOSTAT crop statistics, producer prices and value of production (`app/data/country-crops.json`) | CC BY 4.0 (FAO) |
| Crop photos (`app/img/crops/`) | Public domain, CC0 or CC BY; author and licence of each in `app/data/crop-photos.json` and on the How sure? screen |
| JRC Global Surface Water (Pekel et al. 2016) | Free to use with attribution: EC JRC / Google |
| NOAA Oceanic Niño Index (`app/data/enso.json`) | US Government work, public domain |
| OpenStreetMap Nominatim (place search, country lookup) | ODbL; attribution to OpenStreetMap contributors |
| FAO publications and EcoCrop parameters | Cited as sources; values used as scientific facts |
| Satellite pictures in the demo (`demo/shots/`) | NASA HLS and Blue Marble through NASA GIBS, open |

## Team Groot

| Name | Role |
| --- | --- |
| Shrikanta Paul | Team Lead |
| MD. Nurol Amin | Earth Data Engineer |
| Kazi Meherunnesa Eva | Crop and Climate Modeller |
| Fardin Ahmed Alvi | Frontend and UX Designer |
| Animesh Dey | Hardware and IoT Engineer |
