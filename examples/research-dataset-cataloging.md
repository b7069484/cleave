# Example: Research and catalog public datasets for a literature review

Save this file as `my_prompt.md` and run:
```bash
cleave --max-sessions 15 my_prompt.md
```

---

You are building a comprehensive catalog of publicly available datasets relevant to
a research project on urban heat islands and environmental justice. For each dataset
found, you need to evaluate it, download metadata, and add it to a tracking spreadsheet.

## Project Layout
```
./datasets/
  catalog.xlsx       — Master spreadsheet (you create and maintain this)
  sources.md         — List of data portals to search (already exists)
  search-terms.md    — Research keywords organized by theme (already exists)
  summaries/         — OUTPUT: one .md summary per high-priority dataset
```

## Data Portals to Search (from sources.md)

1. data.gov (US federal open data)
2. NASA Earthdata / SEDAC
3. EPA Environmental Datasets
4. NOAA Climate Data Online
5. Census Bureau (demographic/socioeconomic data)
6. HUD Open Data (housing)
7. OpenStreetMap Overpass API (land use, building footprints)
8. Kaggle Datasets
9. Harvard Dataverse
10. Zenodo (academic datasets)
11. State/city open data portals (NYC, LA, Chicago, Houston, Phoenix)

## Search Themes (from search-terms.md)

- Urban heat island, land surface temperature, thermal imagery
- Tree canopy coverage, green space, impervious surfaces
- Census tract demographics, income, race/ethnicity
- Air quality, PM2.5, ozone, pollution monitoring
- Energy burden, cooling costs, AC penetration rates
- Heat-related mortality, hospital admissions, 911 calls
- Redlining maps, HOLC grades, housing discrimination history

## Catalog Spreadsheet Columns

Create `catalog.xlsx` with these columns:
| Column | Description |
|--------|-------------|
| dataset_name | Official name of the dataset |
| provider | Organization that hosts it |
| url | Direct URL to dataset page |
| description | What it contains (2-3 sentences) |
| spatial_coverage | Geographic extent (national, state, city, etc.) |
| spatial_resolution | Census tract, zip code, pixel size, etc. |
| temporal_coverage | Date range (e.g., "2010-2023") |
| temporal_resolution | Annual, monthly, daily, hourly |
| format | CSV, GeoJSON, Shapefile, NetCDF, API, etc. |
| size_estimate | File size or record count |
| license | Open, CC-BY, restricted, registration required |
| access_method | Direct download, API, request form |
| relevance_score | 1-5 (5 = core dataset, 1 = tangentially related) |
| theme | Which search theme(s) it matches |
| notes | Quality issues, gaps, related datasets |
| reviewed_date | When you evaluated it |

## Workflow

For each data portal:
1. Search using the terms from each theme
2. For each relevant result:
   - Open the dataset page and read the metadata
   - Evaluate relevance, quality, accessibility
   - Add a row to the catalog spreadsheet
   - If relevance_score >= 4: write a detailed summary in `summaries/`
3. Record which portals and search terms you've covered in PROGRESS.md

## Summary Format (for high-priority datasets)

```markdown
# [Dataset Name]

**Provider:** [Organization]
**URL:** [link]
**Relevance:** [score]/5

## Description
[2-3 paragraphs: what it contains, methodology, key variables]

## Research Utility
[How this dataset connects to the urban heat island / environmental justice research]

## Access & Format
[How to get it, file formats, any registration or API keys needed]

## Limitations
[Known gaps, quality issues, spatial/temporal limitations]

## Related Datasets
[Other datasets that pair well with this one]
```

## What "Done" Means

All 11 data portals searched with all search themes. Catalog spreadsheet contains
50+ datasets. Every dataset with relevance >= 4 has a detailed summary.
`summaries/` folder contains at least 15 detailed writeups.

## How to Start

Check `.cleave/PROGRESS.md`. If empty:
1. Create the spreadsheet with headers using openpyxl
2. Start with data.gov (largest portal, most variety)
3. Work through 2-3 search themes per session

When at ~50% context, STOP and do the handoff procedure.
