# Sky2Root: methods

How Sky2Root turns NASA data into a crop rotation comparison, what each number rests on, and which values are our own assumptions. The code is in [`app/js/engine.js`](../app/js/engine.js) (science), [`app/js/nasa.js`](../app/js/nasa.js) (data) and [`app/js/explain.js`](../app/js/explain.js) (reasons). Results of checking it against independent data are in [VALIDATION.md](VALIDATION.md).

Sky2Root is a decision-support tool. It compares options and explains why. It does not replace a farmer's judgement or local agricultural advice.

## 1. Data for any point on Earth

The app runs in the browser with no server and no login. Each source below answers browsers directly.

| Data | Used for | Resolution | Access |
| --- | --- | --- | --- |
| NASA POWER: temperature, dew point, wind, solar radiation (MERRA-2, CERES) | Reference ET and crop development | about 50 km, daily from 1984 | POWER API |
| GPM IMERG V07 | Rain | 0.1°, daily from 1998 | Through the POWER API |
| MERRA-2 corrected rain | Rain before 1998 only, after quantile mapping | about 50 km, daily | POWER API |
| HLS v2.0 (Landsat 8/9, Sentinel-2) | Greenness of the field itself | 30 m, every 2-3 days | Public mirror on Microsoft Planetary Computer |
| MODIS MOD13Q1, MCD12Q1 | Long greenness record, land cover check | 250 m / 500 m | ORNL DAAC web service |
| MODIS MCD64A1 | Burned land within 1 km of the field | 500 m, monthly from 2000 | ORNL DAAC web service |
| JRC Global Surface Water, from every Landsat scene | How often water was seen on the spot (section 3) | 30 m, 1984-2020 | Public mirror on Microsoft Planetary Computer |
| SMAP L4 root-zone soil moisture | Independent check of the simulation; "wetter or drier than usual now" | 9 km, daily from 2015 | Colour-decoded from NASA GIBS (section 1.2) |
| GRACE / GRACE-FO mascons (JPL) | Long-term water storage trend | about 300 km, monthly 2002-2022 | Colour-decoded from NASA GIBS |
| NEX-GDDP-CMIP6 | 2041-2060 climate change, 5 models, 2 scenarios | 0.25° reduced to 2° (section 5) | AWS open data, prepared once |
| SRTM, through Terrain Tiles | Slope for erosion | about 38 m | AWS open data |
| ISRIC SoilGrids 2.0 (CC BY 4.0) | Sand, clay, organic carbon, CEC; pH from the 25 km copy | 250 m; 25 km copy in the app | REST service, with the copy as fallback |
| FAOSTAT crops, producer prices, value of production (CC BY 4.0) | Crop mix, national yields, farm prices (section 7) | Country, yearly | Prepared once, in the app |
| NOAA Oceanic Niño Index | El Niño and La Niña (section 8) | Tropical Pacific, monthly from 1950 | Prepared once, in the app |

### 1.1 Rain

Rain is the weakest link of reanalysis, and it drifts as the gauges behind it change. At Bogura, MERRA-2 corrected rain gives 717 mm a year for 1985-1997, 1,624 mm for 1998-2010 and 2,036 mm since. At Sorriso it gives 646 mm for 2015 where IMERG gives 1,575 mm. Used directly it would invent droughts, and scaling it over the shared years does not help. So:

- From 1998 on, rain is IMERG.
- Before 1998, each day keeps its rank among pre-satellite days of the same calendar month, and takes the IMERG value at that rank. The year-to-year pattern comes from MERRA-2, the climate from IMERG. This assumes that 1985-1997 had a climate like the satellite era's, so **a real change in mean rain across 1998 cannot appear**. Rain trends therefore use satellite years only.

IMERG comes in UTC days and the POWER weather in local solar days, a difference of up to a few hours that we accept. Seasons before 1998 rest on model rain and carry more uncertainty, which [VALIDATION.md](VALIDATION.md) measures. The Past seasons screen says where satellite rain begins.

### 1.2 Reading values from NASA GIBS

SMAP L4 and GRACE normally need an Earthdata login and whole-file downloads. NASA GIBS publishes both as map layers, along with the colour table that links each colour to a data range. Sky2Root asks the GIBS WMS for a 3×3 pixel image at the field, reads the centre pixel exactly with its own PNG decoder, and looks the colour up in the table. Precision is one colour step: 0.003 m³/m³ for SMAP, 0.25 cm for GRACE. Readings are every 16 days for SMAP and every quarter for GRACE.

### 1.3 Soil

Pedotransfer functions of Saxton & Rawls (2006) convert sand, clay and organic matter (1.72 × organic carbon) to wilting point, field capacity, saturation and saturated conductivity. Sand, clay and organic carbon are depth-weighted over 0-100 cm from SoilGrids. Farmers can enter a soil test instead.

Soil pH, depth-weighted over 0-30 cm, comes from the 25 km copy, or from the farmer's soil test. It does not change the simulation. It adds a line to "check before you decide" when a crop in the plan is well outside the range FAO EcoCrop gives as best for it: more than 0.5 below it, or more than 1 above it. These margins are our judgement. EcoCrop's optimum is narrow (wheat thrives on Punjab's pH 7.9, 0.9 above it), and a 25 km value cannot speak for one field.

## 2. Reference evapotranspiration

Daily FAO-56 Penman-Monteith (Allen et al. 1998, Eq. 6), with net radiation from Chapter 3. The unit test reproduces FAO-56 Example 18 (3.88 mm/day).

- Vapour pressure from dew point.
- Wind: POWER's 10 m wind converted to the 2 m grass reference by FAO-56 Eq. 47, floored at 0.5 m/s as FAO-56 advises. We use 10 m wind because POWER's 2 m wind reflects the model's own land cover: it falls to 0.03 m/s at Sorriso, far below a grass reference.

## 3. The daily water balance

An 8-layer soil column (0.15 m then 0.25 m layers, 1.9 m in all) runs without interruption through crops and fallows, so one crop's water use carries over to the next.

- **Infiltration and runoff:** USDA curve number (NEH-630 Chapter 10), with CN from Table 9-1 of Chapter 9 by hydrologic soil group and surface: bare, crop residue, row crop or close-seeded crop, in proportion to canopy. CN moves between its dry and wet values with topsoil wetness (Hawkins et al. 1985). Water above field capacity cascades down within the day and leaves as drainage below 1.9 m.
- **Hydrologic group:** from saturated conductivity with the NEH-630 Chapter 7 limits. Texture misjudges two clays, so where clay is 30% or more and CEC per kg of clay is under 24 cmol (low-activity tropical red soils, the WRB limit), the soil drains as group B at worst; where clay is 40% or more and CEC per kg of clay is over 50 cmol (shrink-swell clays), as group D.
- **Crop water use:** FAO-56 dual crop coefficient (Chapter 7). Transpiration = Ks × Kcb × ET₀. Evaporation = Ke × ET₀, with Kr from topsoil depletion (TEW, REW) and exposed fraction 1 − fc (Eq. 71-76).
- **Roots:** grow from 0.3 m to FAO-56 Table 22's upper value by the end of crop development. FAO gives the larger values for soils with nothing restricting rooting, and we do not know of a restricting layer at an unseen field; a shallow soil would do worse than shown.
- **Stress:** AquaCrop's stomatal curve: no stress until depletion reaches the crop's threshold p, then a convex fall to zero at wilting point. p and the shape factor come from AquaCrop's calibrated crop files and move with the day's demand as in FAO-56. FAO-56's own linear Ks with its Table 22 p made maize fail in most years in Iowa, far from reality. The wetter of the whole root zone and the top 0.4 m sets the stress, because crops draw freely from wet topsoil while the subsoil is dry.
- **Paddy rice:** bunded, with up to 150 mm of ponded water, percolation of 2-8 mm/day depending on soil, and water use drawn from the pond first.
- **Floods:** land the farmer marks as flooding has waterlogged spells marked down (section 4). JRC Global Surface Water helps with that answer. It takes the middle value of the pixels about 100 m around the pin: how often water was seen, as a share of clear Landsat views since 1984. At 10% or more the app ticks the box, with a note, and the farmer can untick it. At 75% or more it asks whether the pin is on the field. Landsat can miss short floods and water under a crop, so a reading of zero never overrules the farmer. We chose the 10% and 75% limits from a few places: flooded haor at Sylhet reads 61%, a Tonle Sap margin 91%, a Jamuna char 28%, and the seven upland and example fields 0.
- **Snow:** stored below 0 °C, melting at 3 mm per degree-day.
- **Irrigation:** "full" refills the root zone when stress would begin; "some" does the same until the year's allowance is used.
- **Residue:** breaks down with a half-life of about 46 days and reduces evaporation (FAO-56: 5% per 10% cover), runoff and erosion.

## 4. Crops

Parameters are in `CROPS` in `engine.js`. Sources:

| Parameter | Source |
| --- | --- |
| Crop stages, Kcb, root depth | FAO-56 Tables 11, 17 and 22 |
| Stress threshold p and curve shape | AquaCrop Reference Manual v7.3, Annex I; FAO-56 Table 22 for sesame and mustard |
| Yield response Ky, seasonal and by stage | FAO-33 (Doorenbos & Kassam 1979), as tabled in FAO Water Reports 22; maize 0.4 / 1.5 / 0.5 / 0.2 |
| Base and upper temperature, normalized water productivity WP*, harvest index | AquaCrop Reference Manual v7.3, Annex I and II |
| Mean temperature ranges (optimum, absolute) | FAO EcoCrop database |
| Heat limits at flowering | Luo (2011), AquaCrop |
| Thermal time from short to long varieties | **Derived:** FAO-56 durations multiplied by each listed region's growing-season temperature |

Soil pH ranges come from FAO EcoCrop as well, and are advice only (section 1.3). Each crop is shown with a photo, chosen by eye from Wikimedia Commons for showing what a farmer would know it by; [`tools/build_crop_photos.py`](../tools/build_crop_photos.py) lists them and `app/data/crop-photos.json` holds each credit.

Values the sources do not give are set by analogy with a similar crop and marked in each crop's `est` field, and the app says so when it applies. They are mostly Ky, thermal limits and WP* for cowpea, millet, lentil, chickpea, mustard and sesame, and all values for the two generic cover crops.

**Development** runs on thermal time (growing degree days between base and upper temperature), so warm years mature sooner and leave less time to fill grain.

**Calendar.** For each crop, short and medium varieties, a run over the mean year (1991-2020) scores sowing every 5 days. The sowing window is every neighbouring date that keeps at least 75% of the best score. The score is `yield × relative yield²`, because a mean year hides dry years and farmers choose for dependability. Tender crops must avoid times of year with frost in more than 1 year in 10. Crops scoring under 0.6 relative yield are not suggested.

**Sowing each year** waits inside the window for warm soil (5-day mean) and either a good rain or stored water: 20 mm in 3 days (the first half of Sivakumar's 1988 onset rule, without the part that needs knowledge of the future), 35 mm in 10 days, or wet topsoil. Paddy needs 80 mm in 7 days or irrigation. If no chance comes by the window's end, the season counts as failed.

**Yield.**

```
relative yield = water × heat × cold × frost × temperature × waterlogging
water          = the worst of whole-season and each stage: 1 − Ky (1 − ETa/ETm)      FAO-33
heat, cold     = 1 − mean daily pollination loss through flowering                   AquaCrop's linear ramp
                 (the heat check uses canopy temperature: air minus 3 C x Ks, our assumption)
frost          = 0 if killed before flowering; partial if killed after
temperature    = mean EcoCrop trapezoid through flowering and grain filling
waterlogging   = 1 − 1.5 × share of days in a wet spell (only on land that floods)   our assumption
potential      = HI × WP* × Σ 1.05 (Kcb − 0.15)                                      AquaCrop's biomass rule
```

Flowering is taken as the first third of FAO-56's mid-season stage.

**Season labels:** failed below 50% of potential, stressed from 50 to 80%, good above. FEWS NET treats a Water Requirements Satisfaction Index under 50 as crop failure (citing Smith 1992) and Senay et al. describe values under 80 as a serious shortfall. A season that could not be planted counts as failed.

Yields assume adequate nutrients and control of pests and weeds. They are higher than most farms achieve and are for comparing options, so the app shows them beside what farms in the country actually get (FAOSTAT). AquaCrop's biomass rule gives dry matter: potato yields are converted to the fresh tonnes farmers weigh, taking tubers as 80% water (FAO-33 gives 75-80%).

## 5. Climate test (2050)

The delta-change method: every past season is replayed with the monthly change a climate model projects, 2041-2060 against 1995-2014 (the IPCC AR6 periods).

- Models: GFDL-ESM4, IPSL-CM6A-LR, MPI-ESM1-2-HR, MRI-ESM2-0, UKESM1-0-LL, the five chosen by ISIMIP3b to be independent and to span low to high climate sensitivity. Scenarios: SSP2-4.5 and SSP5-8.5.
- Maximum and minimum temperature are shifted. Rain is scaled. Relative humidity and radiation are held, so vapour pressure rises with warming and ET₀ follows.
- Sky2Root reports the middle model, and the range across models.

**Why a prepared grid.** NEX-GDDP-CMIP6 stores one global chunk per day, so a single point costs the whole file: 30-50 s per file through NCCS, hundreds of files per field. [`tools/build_cmip6_deltas.py`](../tools/build_cmip6_deltas.py) reads the files once from the public AWS copy and reduces them to a 2° grid of monthly changes, 2 MB in the app. To keep the download practical it reads every 10th day for temperature and every 5th day for rain, moving the sampled days each year. Temperature changes keep the annual mean and two harmonics; rain ratios use 3-month sums, and the same two harmonics. [`tools/check_cmip6_grid.py`](../tools/check_cmip6_grid.py) compares the grid with complete years at single points from NCSS: climate means agree closely (Sorriso 34.0 against 33.8 °C, Iowa 15.0 against 14.4 °C, seasonal rain in the right months in both hemispheres), which confirms orientation, units and months. Sampling noise remains in single months of a single model, so read results across models.

**Not included:** new kinds of extreme beyond the shifted past, changes in rainfall timing within a month, and CO₂ effects on crops, which may favour C3 crops such as legumes, wheat and rice.

The "Your what-if" sliders apply a uniform change in temperature and rain.

## 6. Soil health

**Soil loss** follows RUSLE (Renard et al. 1997), run daily so that it depends on what covers the ground when the rain falls:

- R: annual erosivity from Renard & Freimund (1994), shared among days with at least 12.7 mm in proportion to P^1.81 (Richardson et al. 1983).
- K: Williams (1995) from sand, silt, clay and organic carbon.
- LS: McCool et al. (1987, 1989) from SRTM slope, with an assumed 75 m slope length. Slope is measured across about 230 m because radar elevation noise makes a false slope between neighbouring pixels.
- C: canopy cover and residue subfactors, updated daily. Soil conservation practice is taken as none.

This is an estimate for comparing rotations, not a measurement. It makes no allowance for terracing or contour farming.

**Soil score (0-100)** = 30% living-root days a year, 25% share of legumes in the rotation, 20% plant families (three is full marks), 25% soil loss (log scale, zero at 50 t/ha/year). The weights are our judgement, shown so that people can disagree with them.

**Bare ground** is measured from satellites, on the From space screen. NDVI is reduced to one reading per 16 days. The bare-soil limit sits 35% of the way from this field's low (5th percentile) to its high (95th), kept between 0.2 and 0.45, because bare soil differs from place to place. A year counts when it has at least 14 readings running from early in the year to late. The same screen shows one clear true-colour view a month from the HLS layers on NASA GIBS, about 2.6 km across, so people can see it for themselves.

**Fire.** MODIS MCD64A1 burned area is read over the 25 pixels within 1 km of the field for every month since 2001, because a 500 m pixel is wider than most fields and burns are patchy. It says only that land nearby burned, not that this field did. Ludhiana, where rice stubble is burned each autumn, shows it in 20 of 25 years, mostly in October and November; the other example fields show none. Where it is seen in a fifth of years or more, "check before you decide" says that burning may undo part of the soil gains shown. The fifth is our judgement. Burning is not simulated.

## 7. Comparing rotations

Candidates: each suitable crop alone, every two-year alternation and every two-crops-a-year sequence across plant families (to break pest cycles), each with and without a cover crop, plus the farmer's own rotation. Usually 100-300 rotations.

**Markets.** Prices vary too much to model, so we use a simple guide: by default, only crops with at least 0.3% of the country's harvested crop area (FAOSTAT, 2019 onward) are suggested, as these are more likely to have seed, know-how and buyers. The farmer can tick or untick any crop. This keeps out options that are possible for the climate but hard to sell, such as pearl millet in Iowa. It also means a useful new crop for a country is not suggested unless someone asks for it.

The Best plan screen always keeps the farmer's current rotation and one "small change" option that keeps one of their crops.

**Harvest value** puts the comparison into rough money, per hectare a year, before costs:

```
value = sum over crops of  seasons a year × mean relative yield × best national yield of recent years × farm price
```

The simulation supplies only the relative yield. Its absolute yields assume good management (Lilongwe maize simulates 13.5 t/ha where Malawi's farms get 2.1), so the tonnes come from the best year of the country's own recent record (2019 onward). A crop with no national figure takes the middle country's. The price is the first of these that exists:

1. FAOSTAT's reported producer price, the mean of the latest three years a country reported since 2015. The app shows the year.
2. FAO's estimate, for countries that report none: FAOSTAT's gross production value for 2022 onward, over the tonnes grown. India's latest reported prices are from 2008, so India uses this. Where a country does report, this figure mostly just repeats its reported price, so it is not an independent check.
3. The middle price among countries, labelled as such.

Prices more than 6 times above or below the world's middle (3 times for estimates) are dropped as errors, such as Mexican millet at $33 a tonne. Value leaves out costs, which differ widely (potato far more than millet), and prices are national, so a farm's own market can differ a lot. The value counts in the ranking only if the farmer moves the "more money" slider, which starts at zero, so that a gross figure does not decide the answer unasked.

Each measure (seasons not failed, food energy, harvest value, water, soil score, feed) is scaled from 0 to 1 across the options and weighted by the farmer's sliders. With irrigation, the water measure is irrigation plus a fifth of total crop water use. **Food energy** makes different crops comparable whatever they sell for.

For each option the app states why it came up, the evidence, possible benefits, what is unknown, and what to check locally.

## 8. El Niño and La Niña

El Niño and La Niña shift rain and heat across much of the world, so they are often what a farmer most wants to know about for the coming season. Sky2Root uses NOAA's Oceanic Niño Index: an El Niño (La Niña) is the index at +0.5 (−0.5) or beyond, after rounding to 0.1, for at least five overlapping three-month periods. For each plan, each past season counts under the phase at its middle. The app shows the failed seasons in each group for the selected plan and for what the farmer grows now, the rain in those seasons, and what the Pacific is doing at the latest reading (a reading of the limit or beyond counts as under way, even before the fifth period; "strong" means 1.5 or beyond). It hides that last part if the copy in the app is over 150 days old, because NOAA's server does not answer browsers; [`tools/build_enso.js`](../tools/build_enso.js) refreshes it.

This is history, not a forecast. Groups are small, typically under fifteen seasons, so the app shows counts rather than percentages. Check 8 in [VALIDATION.md](VALIDATION.md) tests whether the rain record shows the known patterns.

## 9. Trends

Theil-Sen slope and Mann-Kendall test (normal approximation) on season rain, start of rains, longest dry spell, hot days and frost days at this field, per year from 1985.

**Temperature drift.** POWER's temperature comes from MERRA-2, whose land responds to its own rain, and that rain drifts (section 1.1). At Bogura the mean daily high falls 2.9 °C across the record as MERRA-2's rain doubles; at Sorriso it rises 2.3 °C as its rain falls. So where the mean daily high shifts more than 1.5 °C between the first ten years and the last, the app does not report hot days and frost days as a trend, and says why. The limit is our judgement, set above plausible real change over the period. Check 9 in [VALIDATION.md](VALIDATION.md) shows this makes little difference to season totals, but it does remove Bogura's apparent fall in failures over time. Correcting the record itself is not done.

## 10. Known limits

- No pests, disease, weeds, nutrients or soil organic matter dynamics. Rotations are valued partly for these, so the benefit is described but not counted.
- Floods are approximated with one rule on land the farmer marks as flooding.
- Weather is about 50 km and rain 10 km across, so a field's own experience will differ.
- Varieties are generic, short or medium. Local varieties can differ widely.
- POWER's temperatures are from reanalysis, which runs warm over irrigated land (it shows 43 °C in June at Ludhiana, several degrees above stations) and drifts over time (section 9).
- Food energy ignores price, labour and input costs. Harvest value uses national prices and ignores costs.
- ECOSTRESS is not used. The ORNL DAAC service lists its evaporative stress index without a login, but returned no data at any of the seven example fields.

## 11. Sources

- Allen, R.G., Pereira, L.S., Raes, D., Smith, M. (1998). *Crop evapotranspiration.* FAO Irrigation and Drainage Paper 56. https://www.fao.org/4/x0490e/x0490e00.htm
- Doorenbos, J., Kassam, A.H. (1979). *Yield response to water.* FAO Irrigation and Drainage Paper 33.
- Moutonnet, P. (2002). Yield response factors of field crops to deficit irrigation. In *Deficit irrigation practices*, FAO Water Reports 22. https://www.fao.org/4/Y3655E/y3655e04.htm
- Steduto, P., Hsiao, T.C., Fereres, E., Raes, D. (2012). *Crop yield response to water.* FAO Irrigation and Drainage Paper 66.
- Raes, D., Steduto, P., Hsiao, T.C., Fereres, E. *AquaCrop Reference Manual*, Version 7.3, Annexes. FAO. https://www.fao.org/docs/devbuildingforwardbetterlibraries/default-document-library/annexesaquacropv73.pdf
- FAO EcoCrop database, via the OpenCLIM copy. https://www.github.com/openclim/ecocrop
- Luo, Q. (2011). Temperature thresholds and crop production: a review. *Climatic Change* 109, 583-598. https://doi.org/10.1007/s10584-011-0028-6
- Saxton, K.E., Rawls, W.J. (2006). Soil water characteristic estimates by texture and organic matter for hydrologic solutions. *Soil Sci. Soc. Am. J.* 70, 1569-1578.
- USDA NRCS. *National Engineering Handbook Part 630, Hydrology*, Chapters 7, 9 and 10.
- Hawkins, R.H., Hjelmfelt, A.T., Zevenbergen, A.W. (1985). Runoff probability, storm depth, and curve numbers. *J. Irrig. Drain. Eng.* 111, 330-340.
- Renard, K.G., Foster, G.R., Weesies, G.A., McCool, D.K., Yoder, D.C. (1997). *Predicting soil erosion by water (RUSLE).* USDA Agriculture Handbook 703.
- Renard, K.G., Freimund, J.R. (1994). Using monthly precipitation data to estimate the R-factor in the revised USLE. *J. Hydrol.* 157, 287-306.
- Richardson, C.W., Foster, G.R., Wright, D.A. (1983). Estimation of erosion index from daily rainfall amount. *Trans. ASAE* 26, 153-156.
- McCool, D.K., Brown, L.C., Foster, G.R., Mutchler, C.K., Meyer, L.D. (1987). Revised slope steepness factor for the USLE. *Trans. ASAE* 30, 1387-1396.
- McCool, D.K., Foster, G.R., Mutchler, C.K., Meyer, L.D. (1989). Revised slope length factor for the USLE. *Trans. ASAE* 32, 1571-1576.
- Williams, J.R. (1995). The EPIC model. In *Computer Models of Watershed Hydrology*.
- Sivakumar, M.V.K. (1988). Predicting rainy season potential from the onset of rains in southern Sahelian and Sudanian climatic zones of West Africa. *Agric. For. Meteorol.* 42, 295-305.
- FEWS NET, Croplands WRSI product notes. https://earlywarning.usgs.gov/fews/product/890; Senay, G.B., et al., Landscape WRSI. https://edcftp.cr.usgs.gov/project/fews/L-WRSI/Senay%20et%20al%20hydrology-L-WRSI.pdf
- Pekel, J.-F., Cottam, A., Gorelick, N., Belward, A.S. (2016). High-resolution mapping of global surface water and its long-term changes. *Nature* 540, 418-422. https://doi.org/10.1038/nature20584
- Giglio, L., Boschetti, L., Roy, D.P., Humber, M.L., Justice, C.O. (2018). The Collection 6 MODIS burned area mapping algorithm and product. *Remote Sens. Environ.* 217, 72-85.
- NOAA Climate Prediction Center, Oceanic Niño Index: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php
- Ropelewski, C.F., Halpert, M.S. (1987). Global and regional scale precipitation patterns associated with the El Niño/Southern Oscillation. *Monthly Weather Review* 115, 1606-1626.
- FAOSTAT: Crops and livestock products; Producer prices; Value of agricultural production. https://www.fao.org/faostat/en/#data
- Thrasher, B., Wang, W., Michaelis, A., et al. (2022). NASA Global Daily Downscaled Projections, CMIP6. *Scientific Data* 9, 262. https://doi.org/10.1038/s41597-022-01393-4
- Lange, S. (2019). Trend-preserving bias adjustment and statistical downscaling with ISIMIP3BASD. *Geosci. Model Dev.* 12, 3055-3070. The ISIMIP3b model set.
- Poggio, L., de Sousa, L.M., Batjes, N.H., et al. (2021). SoilGrids 2.0. *SOIL* 7, 217-240. https://doi.org/10.5194/soil-7-217-2021
- Claverie, M., Ju, J., Masek, J.G., et al. (2018). The Harmonized Landsat and Sentinel-2 surface reflectance data set. *Remote Sens. Environ.* 219, 145-161.
- Reichle, R.H., et al. (2019). Version 4 of the SMAP Level-4 soil moisture algorithm and data product. *J. Adv. Model. Earth Syst.* 11, 3106-3130.
- NASA POWER: https://power.larc.nasa.gov/ · GPM IMERG: https://gpm.nasa.gov/data/imerg · NASA GIBS: https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api · GRACE: https://grace.jpl.nasa.gov/ · ORNL DAAC MODIS service: https://modis.ornl.gov/ · NEX-GDDP-CMIP6: https://www.nccs.nasa.gov/services/data-collections/land-based-products/nex-gddp-cmip6 · Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
