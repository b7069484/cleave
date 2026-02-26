# Stage 1: Vision-Based Image Audit

You are auditing archival images for the Digital Witness to History (Digital WTH) educational platform. This is a Holocaust and WWII education project with 46 modules covering topics from WWI through the Nuremberg Trials.

## Your Task

Build a ground-truth catalog of what every image ACTUALLY depicts by LOOKING at each one. The previous integration mapped images to screens by filename only — resulting in nonsensical pairings. You must fix this by creating an accurate visual audit.

## CONTEXT BUDGET — READ THIS FIRST

⚠️ **YOU ARE RUNNING IN A RELAY.** You will NOT finish all images in one session.

**HARD RULES:**
- Process images in batches of 8
- **After every 5 batches (40 images), STOP and check your progress**
- **Count your batches.** When you reach batch 10 (80 images), STOP IMMEDIATELY and begin the handoff procedure, even if images remain
- **DO NOT process more than 10 batches per session.** The relay system will give you more sessions.
- Save partial results to `audit-reports/IMAGE_VISION_AUDIT.json` after EVERY 5 batches
- When handing off, record EXACTLY which images you've completed and which remain

**The relay will automatically start a new session to continue where you left off.** Your job is to make clean progress and hand off cleanly — NOT to finish everything in one shot.

## Project Structure

- **Images:** `src/assets/images/` (~143 files — .jpg and .png)
- **Chapter JSONs:** `src/content/chapterN.json` (46 chapters — the screens these images map to)
- **Audit output:** `audit-reports/IMAGE_VISION_AUDIT.json`

**NOTE:** If you find images in a different location (e.g., `public/images/modules/`), adapt accordingly. The structure above reflects the repo as cloned. Explore first if needed.

## What To Do

### Step 1: Inventory

First, get a complete file list:
```bash
find src/assets/images -type f \( -name "*.jpg" -o -name "*.png" -o -name "*.jpeg" -o -name "*.gif" -o -name "*.webp" \) | sort
```

Compute MD5 hashes for duplicate detection:
```bash
cd src/assets/images && md5 -r *.jpg *.png 2>/dev/null | sort -k2
```

### Step 2: Visual Audit (batches of 8)

For each image:
1. **Read the image file** using the Read tool — you are multimodal and CAN see images
2. **Write a factual 1-sentence description** of what you actually see. Be specific:
   - BAD: "Historical photo related to WWII"
   - GOOD: "Black-and-white photograph of German soldiers in a trench with sandbags, circa 1914-1918"
   - GOOD: "Political cartoon showing European leaders sitting around a table, with caricatured faces"
   - GOOD: "Nearly blank scan with faint text artifacts — content is not discernible"
3. **Categorize:** photograph, illustration, map, document-scan, propaganda-poster, portrait, memorial-photo, artwork, political-cartoon, blank/corrupt
4. **Assess quality:** good (clear, usable), poor (blurry, very small, barely visible), corrupt (blank, truncated, unreadable)
5. **Identify historical period:** pre-WWI, WWI, interwar, rise-of-nazism, WWII, holocaust, liberation, post-war, modern-memorial, unknown
6. **List 3-5 topic keywords** (e.g., "soldiers, trenches, warfare, western-front")

### Step 3: Duplicate Detection

- **Exact duplicates:** Same MD5 hash = identical files
- **Visual duplicates:** Same scene/subject in different files (different crop, resolution, format)

### Step 4: Save Results

Write/update `audit-reports/IMAGE_VISION_AUDIT.json`:

```json
{
  "audit_date": "2026-02-26",
  "total_images_found": 143,
  "images_audited": 80,
  "images_remaining": 63,
  "last_image_processed": "kristallnacht-aftermath.jpg",
  "images": {
    "adolf-hitler-1933.jpg": {
      "actual_description": "Black and white portrait photograph of Adolf Hitler in a suit, circa 1933",
      "category": "portrait",
      "quality": "good",
      "historical_period": "rise-of-nazism",
      "topics": ["hitler", "nazi-leader", "portrait", "1930s"],
      "md5": "5f0462606d6c466873ca0ffbfdae8276",
      "is_duplicate_of": null,
      "file_size_kb": 45
    }
  },
  "duplicates": [
    {
      "files": ["europe-1919-map.jpg", "europe-map-1919-detailed.jpg"],
      "type": "exact",
      "md5": "f36e85aa526ad931a21dadabc5c32bab"
    }
  ],
  "corrupt_images": [],
  "summary": {
    "good_quality": 0,
    "poor_quality": 0,
    "corrupt": 0,
    "exact_duplicates": 0,
    "visual_duplicates": 0
  }
}
```

## CRITICAL RULES

- **Actually LOOK at every image.** Do not guess from the filename.
- **Be honest about what you see.** If an image is blank, say so. If it's unrelated to its filename, say so.
- **Do not invent content.** Only describe what is visually present in the image.
- **Mark corrupt/blank images clearly.** These need to be removed, not captioned.
- **STOP AFTER 10 BATCHES.** Do the handoff. The relay handles continuation.

## Handoff Procedure

When you reach your batch limit OR finish all images:

1. **Save the audit JSON** with current results (even partial)
2. **Update `.cleave/stages/audit-images/PROGRESS.md`:**
   - STATUS: `IN_PROGRESS` (if images remain) or `IMAGE_AUDIT_COMPLETE` (if all done)
   - Images audited: X of Y
   - Last image processed: filename
   - Remaining images: list or count
3. **Update `.cleave/stages/audit-images/KNOWLEDGE.md`:**
   - Where images are located
   - Any surprises about the file structure
   - Duplicate pairs found so far
4. **Write `.cleave/stages/audit-images/NEXT_PROMPT.md`:**
   - Full context for next session (it has ZERO memory of this session)
   - Which images are done, which remain
   - Path to partial audit JSON
   - Tell next session to READ the existing JSON and CONTINUE from where you stopped

If ALL images are audited:
- Set `STATUS: IMAGE_AUDIT_COMPLETE` in PROGRESS.md
- Print `TASK_FULLY_COMPLETE`
