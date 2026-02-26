# Example: Clean and standardize 2,000 CSV files

Save this file as `my_prompt.md` and run:
```bash
cleave --verify "python verify_outputs.py" --max-sessions 25 my_prompt.md
```

---

You are cleaning and standardizing ~2,000 CSV files exported from a legacy system.
Each file represents one month of transaction data from one of 40 retail locations.
The files have inconsistent formats that need to be normalized into a unified schema.

## Project Layout
```
./raw/                — 2,000 raw CSV files (READ ONLY, do not modify)
./clean/              — OUTPUT: cleaned CSVs go here (one per input file)
./rejected/           — OUTPUT: files that couldn't be cleaned
./logs/               — OUTPUT: processing logs
./schema.json         — Target schema definition (already exists)
./verify_outputs.py   — Verification script (already exists)
```

## Known Issues in Raw Data

The raw CSVs have these problems (varies by file):
- Some use `;` as delimiter, some `,`, some `\t`
- Date formats: MM/DD/YYYY, DD-MM-YYYY, YYYY/MM/DD, "January 5, 2023"
- Currency: some have `$`, some have just numbers, some use commas as decimal
- Headers: some files have headers, some don't, some have them on row 2 or 3
- Encoding: mix of UTF-8, Latin-1, CP1252 (watch for mojibake in store names)
- Some files have trailing summary rows ("Total:", "Grand Total", blank rows)
- Phone numbers: (555) 123-4567, 555-123-4567, 5551234567, +1-555-123-4567
- Empty files, files with only headers, files with corrupt data

## Target Schema (from schema.json)

Every output CSV must have exactly these columns in this order:
```
transaction_id    — string, unique identifier
date              — YYYY-MM-DD format
store_id          — string, 3-digit zero-padded (e.g., "007")
store_name        — string, UTF-8, title case
amount            — decimal, 2 places, no currency symbols
currency          — ISO 4217 code (USD, EUR, etc.)
customer_phone    — E.164 format (+15551234567) or empty
category          — one of: grocery, electronics, clothing, pharmacy, other
notes             — string, trimmed, max 500 chars
```

## Workflow

1. Write a Python cleaning script (`clean.py`) that handles all known issues
2. Process files in batches of ~100
3. For each file:
   - Detect delimiter, encoding, header row
   - Parse and normalize every field to target schema
   - Write cleaned output to `./clean/` with same filename
   - If a file can't be cleaned: move to `./rejected/` with an error log
4. After each batch: run `python verify_outputs.py` to check schema compliance
5. If verification fails: fix the cleaning script and reprocess failed files

## What "Done" Means

Every raw file has either a cleaned version in `./clean/` or is in `./rejected/`
with an explanation. `python verify_outputs.py` exits 0.

## How to Start

Check `.cleave/PROGRESS.md`. If empty:
1. Sample 10 random files to understand the variation
2. Write `clean.py` to handle the common cases
3. Process a test batch of 50 files
4. Fix edge cases as they appear
5. Scale up to full processing

When at ~50% context, STOP and do the handoff procedure.
