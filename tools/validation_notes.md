## What this shows, and what it does not

**Where it holds up.**

- Soil water follows SMAP moderately to well at five of seven fields, in wet and dry spells as well as in seasons (anomaly correlation 0.46 to 0.78). The weakest are Ludhiana, where SMAP does not see the irrigation, and Bogura, whose rice and flooding are hard for both.
- Iowa is the fairest yield test: one field in a country whose maize mostly grows in that climate. There the simulation follows national yield anomalies well, catches all of the worst years including the 1988 and 2012 droughts, and simulates a yield close to the national mean.
- Where water is what limits the crop, seasons follow satellite greenness: maize at Machakos, millet at Maradi and second-crop maize at Sorriso. So the two independent methods agree where it matters most.
- The rain record shows El Niño's known effects in all four regions that have one: wetter short rains at Machakos, drier rains at Maradi and Lilongwe, a weaker monsoon at Ludhiana. So what the app says about El Niño years rests on a real signal, though it is strongest at Machakos and weak at Lilongwe.
- Water use follows MODIS through the seasons at most fields (correlation 0.43 to 0.77; 0.28 at Bogura), and the yearly totals are close at Lilongwe.

**Where it does not.**

- National yields barely move with a single field in large or varied countries (Brazil, India, Bangladesh). That says more about the test than about the model, but the test cannot confirm those sites.
- At Lilongwe, the simulation misses the bad national years of 2005 and 2016 and only calls 1992 stressed. These were large national losses, and this field's rain shows no failure. Our rain may miss what farmers saw, or the losses may have come from elsewhere or from input shortages; we cannot tell which here.
- Peak greenness says little for crops that rarely lack water, such as soybean at Sorriso and maize at Iowa, where it saturates.
- At Machakos, about three seasons in four count as failed. "Failed" means under half of what the crop could give with enough water, not an empty field, and yields there are far below potential. The comparison between crops is the useful part: sorghum and sesame fail far less often than maize, which matches local advice to grow drought-tolerant crops. The absolute rate is probably too harsh.
- Simulated yields are water-limited potentials under good management. Where fertiliser is scarce they are many times real yields (Maradi, Lilongwe), so read them as a comparison.
- The soybean rows at Iowa flag most years, more than we believe is true, so soybean's stress may be overstated.
- Simulated water use runs 14 to 24% above MODIS at Ames, Bogura, Machakos and Sorriso. Either could be off, and these checks cannot say which. From year to year the two barely agree, except at Machakos: the correlation of anomalies is near zero at most fields.
- Two MODIS totals look wrong rather than the simulation. At Maradi it gives about 74 mm a year where about 540 mm of rain falls, which would leave over 85% of the rain to run off or drain. At Ludhiana it gives about 348 mm for irrigated double-cropped land.
- The temperature record drifts where MERRA-2's rain drifts. At Bogura the mean daily high falls 2.9 °C across the record and at Sorriso it rises 2.3 °C, more than real change. Temperature trends at those fields and at Ludhiana are therefore flagged in the app and not reported as change. Season totals move little when the drift is removed (at most 2 failed and 6 poor seasons), but Bogura's apparent fall in failures over time goes away, so "fewer failures lately" there is an artefact. A record of temperature free of this drift would be the next improvement.
- Bogura's monsoon rain is 35% higher in El Niño years in this record, with no known reason to expect that. Sets of nine to fourteen years can do this by chance, which is why the app shows counts and calls them a guide.

**What the checks changed.** No parameter was tuned to match these numbers, but looking at them exposed real faults, which we fixed by following the sources more closely:

1. Reanalysis rain drifts badly over time. Rain before 1998 now keeps only its ranks from MERRA-2.
2. FAO-56's linear stress with mid-range rooting made Iowa maize fail in most years. We moved to AquaCrop's calibrated stress curve and FAO's deep-soil rooting depths.
3. A record warm March led the model to sow maize in Iowa weeks before frost. Tender crops now avoid times of year with frost in more than 1 year in 10.
4. Longest-season varieties gave impossible yields, so only short and medium varieties are used.
5. Heat limits killed rice in Punjab, where reanalysis runs hot and irrigated canopies stay cooler than the air. The heat check now uses canopy temperature.

Fixing faults while looking at the validation means these checks are not fully independent of the model's development. A fair next test is fields never used here.

## Sources for this check

- SMAP L4 through NASA GIBS; MODIS MOD13Q1 and MOD16A2GF through ORNL DAAC; NASA POWER and GPM IMERG.
- Ropelewski, C.F., Halpert, M.S. (1987). Global and regional scale precipitation patterns associated with the El Niño/Southern Oscillation. *Monthly Weather Review* 115, 1606-1626. Ropelewski, C.F., Halpert, M.S. (1989). Precipitation patterns associated with the high index phase of the Southern Oscillation. *Journal of Climate* 2, 268-284.
- NOAA Climate Prediction Center, Oceanic Niño Index: https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php
- FAOSTAT Crops and Livestock Products, bulk download. https://www.fao.org/faostat/en/#data/QCL
- Known bad years are widely reported drought years, and the table shows each year's national yield against its trend so that they can be checked in FAOSTAT.
