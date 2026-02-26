# Example: Localize an app into 15 languages

Save this file as `my_prompt.md` and run:
```bash
cleave --git-commit --max-sessions 20 my_prompt.md
```

---

You are localizing a React web application into 15 languages. The English source
strings are already extracted into JSON files. You need to translate every string,
handle pluralization rules, adapt date/number formats, and verify the translations
compile correctly.

## Project Layout
```
./src/
  i18n/
    en/              — English source strings (READ ONLY, source of truth)
      common.json    — ~200 shared strings (buttons, labels, errors)
      dashboard.json — ~150 dashboard strings
      settings.json  — ~100 settings strings
      onboarding.json — ~80 onboarding flow strings
      emails.json    — ~60 email template strings
    de/              — German (OUTPUT — you create/populate these)
    fr/              — French
    es/              — Spanish
    pt/              — Portuguese
    it/              — Italian
    nl/              — Dutch
    pl/              — Polish
    ja/              — Japanese
    ko/              — Korean
    zh/              — Chinese (Simplified)
    ar/              — Arabic
    he/              — Hebrew
    ru/              — Russian
    tr/              — Turkish
    hi/              — Hindi
  i18n/config.ts     — i18n configuration (already exists)
```

## Translation Rules

1. **Copy the JSON structure exactly** — same keys, same nesting
2. **Translate the values only** — never change the keys
3. **Preserve interpolation variables:** `{{name}}`, `{{count}}`, `{0}` stay untouched
4. **Handle pluralization** using the language's plural rules:
   - English: `one` / `other`
   - Arabic: `zero` / `one` / `two` / `few` / `many` / `other`
   - Japanese: `other` only (no plural distinction)
   - Polish: `one` / `few` / `many` / `other`
5. **RTL languages** (Arabic, Hebrew): ensure no LTR-specific formatting in strings
6. **Don't translate:**
   - Brand names ("Acme Corp" stays "Acme Corp")
   - Technical terms in code context
   - Placeholder emails/URLs
7. **Cultural adaptation:**
   - Date format hints should match locale ("MM/DD" → "DD.MM" for German)
   - Currency examples should use local currency where appropriate
8. **After each language:** run `npx i18next-parser --config i18next-parser.config.js`
   to verify all keys are present and no interpolation variables are broken

## Workflow

For EACH language:
1. Create the locale directory if it doesn't exist
2. For each JSON file (common, dashboard, settings, onboarding, emails):
   - Read the English source
   - Translate every string
   - Write the translated JSON with identical structure
3. Run the parser to verify completeness
4. Move to the next language

## Priority Order

Start with the highest-traffic languages:
1. es (Spanish), 2. fr (French), 3. de (German), 4. ja (Japanese),
5. zh (Chinese), 6. pt (Portuguese), 7. ko (Korean), 8. ar (Arabic),
then the rest in any order.

## What "Done" Means

All 15 language directories contain all 5 JSON files with every key translated.
`npx i18next-parser` reports 0 missing keys for all locales. No broken
interpolation variables. No untranslated English strings left in non-English files.

## How to Start

Check `.cleave/PROGRESS.md`. If empty:
1. `cat src/i18n/en/common.json | python -c "import sys,json; print(len(json.load(sys.stdin)))"` to count keys
2. Start with Spanish (es) — common.json first
3. Work through all 5 files for that language before moving to the next

When at ~50% context, STOP and do the handoff procedure.
