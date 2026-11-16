# Data files

Everything in this folder is derived from NASA data. None of it is AI-generated.

| Folder or file | Made from | Made by |
|---|---|---|
| `ephemeris/` | Sun and Earth positions and the Moon's orientation, NASA JPL Horizons (DE441), hourly | `pipeline/build_ephemeris.py`, `pipeline/pack_data.py` |
| `terrain/` | LRO LOLA terrain heights (NASA PDS) for the nine candidate regions | `pipeline/build_terrain.py`, `pipeline/pack_data.py` |
| `sites.json` | NASA's nine Artemis candidate regions, anchored to their IAU namesake features (USGS Gazetteer) | `pipeline/build_sites.py` |
| `validation_points.json` | Comparison with NASA PGDA product 69 lighting data | `pipeline/validate_illumination.py` |
| `validation.json` | Summary of the results of `pipeline/validate_illumination.py` and `pipeline/validate_chandrayaan3.py` | copied from those scripts' output |

**AI use (SI disclosure):** the scripts that downloaded and processed this data were written with help from
Claude (Anthropic), an AI coding assistant. The values themselves come from the NASA sources above. See the
"AI use" section of the main README.
