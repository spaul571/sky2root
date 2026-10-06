# Sky2Root concept prototype

A clickable prototype of Sky2Root (Team Groot, NASA Space Apps 2026, *Field Shift*). Open `index.html` in Chrome or Edge; it runs offline from the files in this folder.

**What is real and what is illustrative.** The satellite images (MODIS true colour, MODIS NDVI, GPM IMERG rain, SMAP soil moisture, MERRA-2 temperature) and the greenness curve on the Monitor screen are real NASA data. The example farm, its 40 years of seasons, the rotation results, the soil scores and the district farms are illustrative: a fixed, seeded example that shows how the tool will behave.

## Screens

| Screen | What it shows |
| --- | --- |
| Field | Tap the satellite map to place a field; soil, water source, current rotation and the farmer's priorities |
| NASA data | Real NASA layers over the same area, each with what it tells Sky2Root and its resolution |
| Simulate | One season, day by day: weather, soil water, crop growth, heat at flowering, and the result |
| Replay | All 80 seasons since 1985 for each rotation, past climate or the 2050 what-if; click a season to watch it |
| Rank | The four rotations ranked by the farmer's priorities, a reliability-versus-soil chart and the reason in plain language |
| Monitor | Real MODIS NDVI for a field near Sorriso, Brazil, 2019–2024, with bare-soil days counted per year |
| District | An extension agent's view of 42 farms, their recommended rotations and which need a visit |

The language menu switches the interface between English, Español, Français, Kiswahili, हिन्दी, বাংলা and Português.

For demos and screenshots, the URL takes `?screen=simulate&lang=es&day=60`.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `css/app.css`, `js/app.js` | The app shell, styles and screen logic |
| `js/model.js` | Shared data model: the example farm, crops, rotations, season results, ranking and the daily season simulation |
| `js/season-view.js` | The day-by-day season drawing |
| `data/ndvi-field.js` | Real MODIS NDVI series (written by `tools/fetch_ndvi.py`) |
| `assets/` | NASA GIBS images and fonts |

## How the season simulation works

Daily weather for each season comes from that season's rain and heat indices: rain events, a mid-season dry spell whose length grows in dry years, and hot days around flowering in hot years. Each crop then runs a simple FAO-56-style soil water bucket: rain fills the root zone, the crop draws water at a rate set by its growth stage and the day's heat, and stress begins when less than half the available water is left. The season's label (good, stressed or failed) uses the same rule as the 40-year report card, so the two always agree.

In the real tool, the same steps run on NASA POWER daily weather, GPM IMERG rainfall, SMAP soil moisture and NEX-GDDP-CMIP6 projections for the farmer's own field.

## Refreshing the real NDVI data

```bash
cd prototype
uv run python tools/fetch_ndvi.py
```
