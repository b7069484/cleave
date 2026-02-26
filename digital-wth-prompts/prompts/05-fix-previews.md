# Stage 5: Replace AI-Generated Module Preview Images

You are replacing placeholder preview/thumbnail images for the Digital Witness to History (Digital WTH) platform. Modules 5-46 currently have AI-generated placeholder thumbnails that need to be replaced with real archival photographs from each module's image collection.

## Prerequisites

Stage 2 (fix-mappings) corrected the image-to-screen assignments. Stage 1 (audit-images) produced `audit-reports/IMAGE_VISION_AUDIT.json` with quality assessments and descriptions of every image.

## The Problem

The module selection grid/list shows a preview image for each module. Modules 1-4 have real archival photos as previews, but modules 5-46 have AI-generated placeholder images that:
- Look artificial and out of place in a historical education platform
- Don't represent the actual content of the module
- Undermine the credibility of the platform

## Project Structure

- **Vision audit:** `audit-reports/IMAGE_VISION_AUDIT.json` (quality + description of every image)
- **Module JSONs (local):** `wth ch XX/Chapter_XX_*.json`
- **Module JSONs (repo):** `src/content/chapterN.json`
- **App source:** `src/`
- **Public images:** `src/assets/images/`
- **Current preview images:** Search for thumbnail/preview/cover references in module configs or component code

## What To Do

### 1. Find Where Preview Images Are Defined

Search for the module preview/thumbnail configuration:

1. Look in module JSON files for fields like: `previewImage`, `thumbnail`, `coverImage`, `heroImage`, `moduleImage`, `image`
2. Look in the app source for: module list/grid components, card components, dashboard/home page
3. Check for a separate config file that maps modules to preview images
4. Check `src/assets/images/` for a preview images directory or mapping
5. Document where exactly the preview images are referenced (file path + field name)

### 2. Identify AI-Generated Previews

For modules 5-46:
1. Find the current preview image path/key for each module
2. Use the Read tool to **look at** the current preview image
3. Confirm it's AI-generated (characteristics: too-perfect rendering, unnatural lighting, no film grain, no archival aging, sometimes with AI artifacts)
4. Modules 1-4 should already have real archival photos — verify this and leave them alone

### 3. Select Replacement Images

For each module (5-46), choose the best archival image as the new preview. Use the vision audit data to select:

**Selection criteria (in priority order):**
1. **High quality** — `quality: "good"` in the audit (clear, high resolution, not blurry)
2. **Iconic / representative** — the image should represent the module's overall topic, not a niche subtopic
3. **Visually compelling** — photographs are preferred over document scans or text-heavy images
4. **Not too graphic** — avoid extremely disturbing images even if historically significant (this is for the module selection screen, not the module content itself)
5. **Not already the primary image on screen 1** — pick a different image to add visual variety
6. **Not a duplicate** — don't pick an image that's already a preview for another module

**For each module, document your reasoning:**
```
Module 12 (Kristallnacht):
  Selected: /images/modules/module_12/m12_s03_synagogue.jpg
  Reason: Clear photograph of destroyed synagogue interior, iconic representation
           of Kristallnacht. Good quality, historically significant without being
           overly graphic. Not used as preview for any other module.
  Rejected alternatives:
    - m12_s01_map.jpg (map, not compelling as preview)
    - m12_s07_document.jpg (document scan, hard to read at thumbnail size)
```

### 4. Update Preview Image References

Once you've selected the replacement image for each module:

1. Update the preview image field in the module JSON (or wherever previews are configured)
2. Use the same image path format as the existing modules 1-4 (match their convention)
3. If previews are stored separately (not in module JSONs), update that config/mapping file
4. Update both local and repo copies

### 5. Generate Preview-Sized Versions (if needed)

Check if the app expects a specific image size for previews:
1. Look at how modules 1-4 serve their preview images (original size? resized? different file?)
2. If there's a separate `thumbnails/` or `previews/` directory, you may need to copy/link the selected images there
3. If the app dynamically resizes, the original image path should work fine

## Output

1. Updated module configurations with new preview image references
2. `audit-reports/PREVIEW_REPLACEMENT_REPORT.md` with:
   - Per-module table: module number, topic, old preview (AI-generated), new preview (archival), reason for selection
   - Any modules where no suitable preview was found
   - Where preview images are configured (file path + field name)
   - Modules 1-4 status (confirmed as real archival photos, or flagged if also AI)

## CRITICAL RULES

- **Only replace AI-generated previews.** Don't change modules 1-4 if they already have real photos.
- **Actually LOOK at the selected image** before confirming it. Don't just trust the audit description — verify visually.
- **Don't pick graphic/disturbing images** for module previews. These appear in the module selection grid visible to all users (including younger students).
- **Each preview should be unique.** Don't use the same image as preview for multiple modules.
- **Match the existing convention.** Look at how modules 1-4 reference their previews and follow the same pattern.

## When Complete

Set STATUS: PREVIEWS_FIXED in .cleave/stages/fix-previews/PROGRESS.md and print TASK_FULLY_COMPLETE.
