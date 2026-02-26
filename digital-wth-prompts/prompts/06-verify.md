# Stage 6: Visual QA Verification

You are performing the final quality assurance pass for the Digital Witness to History (Digital WTH) platform. All previous stages have completed — images remapped, loader fixed, videos embedded, previews replaced. Your job is to **visually verify** a sample of screens and catch anything that was missed.

## Prerequisites

All prior stages completed:
- Stage 1: `audit-reports/IMAGE_VISION_AUDIT.json` (what each image actually shows)
- Stage 2: `audit-reports/IMAGE_REMAPPING_REPORT.md` (mapping changes made)
- Stage 3: `audit-reports/LOADER_SECURITY_FIX_REPORT.md` (code fixes applied)
- Stage 4: `audit-reports/VIDEO_EMBED_REPORT.md` (video URL fixes)
- Stage 5: `audit-reports/PREVIEW_REPLACEMENT_REPORT.md` (preview replacements)

## Project Structure

- **Module JSONs (local):** `wth ch XX/Chapter_XX_*.json` (46 modules)
- **Module JSONs (repo):** `src/content/chapterN.json`
- **Public images:** `src/assets/images/`
- **Vision audit:** `audit-reports/IMAGE_VISION_AUDIT.json`
- **App source:** `src/`

## What To Do

### 1. Sample Screen Verification (5 per module = ~230 screens)

For each of the 46 modules, pick 5 screens to verify (spread across the module — screen 1, a middle screen, the last screen, and 2 random):

1. **Read the screen JSON** — get the title, content/narration text, topic
2. **Read the mapped image file** using the Read tool — actually LOOK at the image
3. **Check image-content match:** Does the image relate to what the screen is about?
   - ✅ PASS: Image clearly relates to screen topic
   - ⚠️ WEAK: Image is from the right era but not specific to the topic
   - ❌ FAIL: Image has nothing to do with the screen content
4. **Check caption accuracy:** Does the caption describe what's actually in the image?
   - ✅ PASS: Caption accurately describes the visible image content
   - ❌ FAIL: Caption describes something not in the image, or is fabricated
5. **Check for duplicates:** Is this same image used on any other screen in any module?
6. **Record results** for each checked screen

### 2. Video Embed Verification

For each module that has video screens:
1. Check that the `videoUrl` uses embed format: `https://www.youtube.com/embed/VIDEO_ID`
2. Check that there are NO external link URLs (`watch?v=`, `youtu.be/`)
3. Verify that the video caption exists and is descriptive

### 3. Preview Image Verification

For modules 5-46:
1. Find the preview image reference for each module
2. **Read/LOOK at the preview image** — confirm it's a real archival photograph (not AI-generated)
3. Confirm it's relevant to the module topic
4. Confirm it's not overly graphic for a module selection screen

### 4. Loader Compatibility Spot-Check

For 5 randomly selected image paths from different modules:
1. Trace the image key through the loader code path
2. Confirm that `/images/modules/...` paths would resolve correctly (public-path passthrough)
3. Confirm that any remaining legacy registry-based keys still resolve

### 5. Duplicate Check (Global)

Run a final pass across ALL module JSONs:
1. Collect every image key/path assigned to any screen
2. Check for any image that appears on more than one screen
3. For any duplicates found, determine which screen is the better match and flag the other for removal

### 6. Fix Any Issues Found

If you find problems during verification:
1. **Image-content mismatch:** Search the vision audit for a better image match. If found, swap it. If not, leave the image field empty.
2. **Bad caption:** Rewrite it based on the vision audit's `actual_description`
3. **Duplicate:** Remove from the weaker match, leave on the stronger one
4. **AI preview still present:** Select a replacement archival image following Stage 5 criteria
5. **Wrong video URL format:** Convert to embed format
6. **Update both local and repo JSONs** for any fixes

## Output

`audit-reports/FINAL_QA_REPORT.md` with:

### Summary Statistics
- Total screens checked: X/~1500
- Image-content match: X pass, X weak, X fail
- Caption accuracy: X pass, X fail
- Duplicates found: X
- Video format issues: X
- AI previews remaining: X
- Issues fixed during QA: X

### Per-Module Results Table
| Module | Screens Checked | Image Match | Caption OK | Video OK | Preview OK | Issues Fixed |
|--------|----------------|-------------|------------|----------|------------|-------------|
| 1      | 5              | 5/5 ✅      | 5/5 ✅     | 2/2 ✅   | ✅         | 0           |
| ...    | ...            | ...         | ...        | ...      | ...        | ...         |

### Issues Found and Fixed
List each issue with: module, screen, what was wrong, what was fixed

### Remaining Issues (Could Not Fix)
List anything that needs human intervention (e.g., no suitable image exists in the collection for a screen)

### Confidence Assessment
- Overall data integrity: HIGH/MEDIUM/LOW
- Image-screen matching quality: HIGH/MEDIUM/LOW
- Caption accuracy: HIGH/MEDIUM/LOW
- Video embed completeness: HIGH/MEDIUM/LOW
- Preview image quality: HIGH/MEDIUM/LOW

## CRITICAL RULES

- **Actually LOOK at images.** Do not verify by comparing text descriptions only — use the Read tool on image files.
- **Be thorough but strategic.** 5 screens per module is the minimum — if you find issues in a module, check MORE screens from that module.
- **Fix issues as you find them.** Don't just report — fix what you can.
- **Update both local and repo JSONs** for any changes.
- **Don't re-introduce fabricated captions.** Only write captions that describe what's visually in the image.

## When Complete

Set STATUS: ALL_VERIFIED in .cleave/stages/verify/PROGRESS.md and print TASK_FULLY_COMPLETE.
