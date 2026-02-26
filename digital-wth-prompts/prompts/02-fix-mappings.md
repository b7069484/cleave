# Stage 2: Fix Image-to-Screen Mappings

You are fixing the image-to-screen mappings for the Digital Witness to History (Digital WTH) platform. The previous automated integration mapped images by filename number — not by content. Result: wrong images on screens, fabricated captions, duplicates everywhere.

## Prerequisites

Stage 1 (audit-images) produced `audit-reports/IMAGE_VISION_AUDIT.json` — a vision-verified catalog of what every image ACTUALLY depicts. Use this as your ground truth.

## CONTEXT BUDGET — READ THIS FIRST

⚠️ **YOU ARE RUNNING IN A RELAY.** You may NOT finish all 46 modules in one session.

**HARD RULES:**
- Process modules in groups of 5-8
- **After every 8 modules, STOP and save your progress** to the remapping report and updated JSONs
- **DO NOT process more than 15 modules per session.** The relay will give you more sessions.
- If you reach ~50% of your context, STOP and begin the handoff procedure immediately

## Project Structure

- **Vision audit:** `audit-reports/IMAGE_VISION_AUDIT.json` (what each image actually shows)
- **Chapter JSONs:** `src/content/chapterN.json` (46 chapters)
- **Images:** `src/assets/images/` (~143 files)
- **Knowledge file:** `.cleave/shared/KNOWLEDGE.md` (cross-stage insights from audit)

**NOTE:** Explore the actual project structure first. Paths above reflect the cloned repo. There are NO local `wth ch XX/` directories — only `src/content/`.

## JSON Schemas (CRITICAL — 4 different formats)

- **Schema A (Modules 1-28):** `sections[] → screens[]`, image field: `archivalImages[]` array with `{key, caption, source}`, also `image` field for primary
- **Schema B (Modules 29-34):** Flat `screens[]`, image field: `archival_image{}` object with `{image_key, alt_text, caption, source_archive, rights_status}`
- **Schema C (Modules 35-37):** Flat `screens[]`, image field: `visual{}` object with `{type, asset_key, alt_text}`
- **Schema D (Modules 38-46):** Flat `screens[]`, image field: `archival_image_key` (bare string path)

## What To Do

### For each module (1-46), for each screen:

1. **Read the screen's content** — title, type, text/narration/body, topic
2. **Search the vision audit** for images from that module whose `actual_description` and `topics` semantically match the screen's content
3. **Rank candidates** by relevance:
   - STRONG match: image description directly relates to screen topic (e.g., screen about "Kristallnacht" + image showing "broken storefront windows with Star of David")
   - WEAK match: image is from the right historical period but not specific to the screen topic
   - NO match: image has nothing to do with the screen — remove it
4. **Pick the BEST match** for each screen. If no good match exists, leave the image field empty rather than forcing a wrong image.
5. **Write an accurate caption** based on the vision audit's `actual_description`:
   - WRONG: "European leaders whose militarism drove the continent to war" (fabricated from screen topic)
   - RIGHT: "Political cartoon depicting European powers as competing figures, circa 1914" (describes actual image)
6. **Check for duplicates** — if the same image is assigned to multiple screens, keep only the BEST match and remove it from the others
7. **Remove corrupt/blank images** — anything flagged as `corrupt` or `quality: "poor"` with no discernible content in the audit

### Update the Chapter JSONs

Update `src/content/chapterN.json` files directly. These are the only JSONs — there is no separate "local" vs "repo" copy.

### Output

1. Updated chapter JSON files (both local and repo)
2. `audit-reports/IMAGE_REMAPPING_REPORT.md` with:
   - Per-module: how many images remapped, removed, left empty
   - List of screens that have NO suitable image (gap list)
   - List of images that matched NO screen (unused images)
   - List of duplicates that were resolved

## CRITICAL RULES

- **Never fabricate captions.** Only describe what's actually in the image per the vision audit.
- **Never force a bad match.** An empty image field is better than a wrong image.
- **Don't reuse the filename as evidence** — `m01_s05_road_to_war.jpg` does NOT mean it shows "the road to war." Trust only the vision audit description.
- **Process all 4 schemas.** Each has different field names for images.
- **Preserve existing correct mappings.** If the original mapping was actually right (image matches screen), keep it.

## Handoff Procedure

When you reach your module limit OR finish all 46 modules:

1. **Save the remapping report** with current results
2. **Update `.cleave/stages/fix-mappings/PROGRESS.md`:**
   - STATUS: `IN_PROGRESS` or `MAPPINGS_FIXED`
   - Modules completed: list
   - Modules remaining: list
3. **Update `.cleave/stages/fix-mappings/KNOWLEDGE.md`:**
   - Schema quirks discovered
   - Image matching patterns that worked well
4. **Write `.cleave/stages/fix-mappings/NEXT_PROMPT.md`:**
   - Full context for next session (ZERO memory)
   - Which modules are done, which remain
   - Path to partial remapping report
   - Reference the vision audit JSON path

If ALL modules are remapped:
- Set `STATUS: MAPPINGS_FIXED` in PROGRESS.md
- Print `TASK_FULLY_COMPLETE`
