# Stage 4: Fix Video Embeds

You are fixing video integration for the Digital Witness to History (Digital WTH) platform. Videos should be embedded as playable `<iframe>` players within each module — NOT as external "Watch on YouTube" links.

## The Problem

The previous automated integration added YouTube URLs to module JSONs, but:
1. Some URLs use the **watch format** (`youtube.com/watch?v=ID`) instead of the **embed format** (`youtube.com/embed/ID`)
2. The frontend component may render videos as **external links** (`<a href=...>`) instead of **embedded players** (`<iframe src=...>`)
3. Video captions may be inaccurate or missing

## Project Structure

- **Module JSONs (local):** `src/content/chapterN.json` (46 modules, 4 schemas)
- **Module JSONs (repo):** `src/content/chapterN.json`
- **App source:** `src/` (React components)
- **Video metadata:** Check `videos/` directory and chapter JSONs for video fields

## JSON Video Fields by Schema

- **Schema A (Modules 1-28):** Look for `videoUrl`, `videoCaption`, `videoSource` in screen objects
- **Schema B (Modules 29-34):** Look for `video{}` object with `{url, caption, source}`
- **Schema C (Modules 35-37):** Look for `visual{type: "video", ...}` objects
- **Schema D (Modules 38-46):** Look for `video_url` or `videoUrl` string fields

## What To Do

### 1. Audit All Video URLs

For every screen across all 46 modules:

1. Find all video-related fields (`videoUrl`, `video_url`, `video.url`, `visual.asset_key` where type is video)
2. For each URL, classify it:
   - **Correct embed:** `https://www.youtube.com/embed/VIDEO_ID` ✅
   - **Watch URL (needs fixing):** `https://www.youtube.com/watch?v=VIDEO_ID` → convert to embed format
   - **Short URL (needs fixing):** `https://youtu.be/VIDEO_ID` → convert to embed format
   - **Missing protocol:** `youtube.com/...` → add `https://www.`
   - **Non-YouTube:** Flag for manual review
   - **Empty/null:** Note as missing
3. Extract the VIDEO_ID from any format and rewrite as: `https://www.youtube.com/embed/VIDEO_ID`

### 2. Fix the Frontend Video Component

Find the React component(s) that render video screens:

1. Search for: `videoUrl`, `video_url`, `iframe`, `<a` in components
2. Check if the component uses `<iframe>` or `<a>`:
   - If `<iframe src={videoUrl}>` — the embed format will work ✅
   - If `<a href={videoUrl}>` or similar external link — **this is the problem**
3. If the component renders external links instead of iframes, fix it:

```jsx
// WRONG — renders as external link
<a href={screen.videoUrl} target="_blank">Watch on YouTube</a>

// RIGHT — renders as embedded player
<div className="video-container" style={{ position: 'relative', paddingBottom: '56.25%', height: 0 }}>
  <iframe
    src={screen.videoUrl}
    title={screen.videoCaption || 'Video'}
    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
    frameBorder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowFullScreen
  />
</div>
```

4. Ensure the component handles all 4 JSON schemas (different field names for video URLs)
5. Add proper loading states and error handling (invalid URL → show message, not broken iframe)

### 3. Add Embed Parameters

For each embed URL, append recommended parameters:
```
https://www.youtube.com/embed/VIDEO_ID?rel=0&modestbranding=1
```
- `rel=0` — don't show related videos at the end (keeps students on topic)
- `modestbranding=1` — minimal YouTube branding

### 4. Verify Video Captions

For each screen with a video:
1. Read the screen's content (topic, title, narration text)
2. Read the video caption
3. If the caption is empty, write one based on the screen content: "Video: [topic of the screen]"
4. If the caption is clearly fabricated or doesn't match (from the automated integration), fix it

### 5. Check Video Availability

For a **sample** of video IDs (at least 10 from different modules):
1. Use WebFetch to check `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=VIDEO_ID&format=json`
2. If the video is unavailable (404 or error), flag it in the report
3. Do NOT remove unavailable videos — just flag them (they may come back, or may need replacement)

### 6. Update BOTH Local and Repo JSONs

After fixing video URLs in the local JSONs (`src/content/chapterN.json`), sync to the repo JSONs (`src/content/chapterN.json`). Use the same ID matching rules as Stage 2:
- Modules 1-7: Match by screen number
- Modules 8-19: Local `chN-screen-X` → repo `screen-X`
- Modules 20-21: Local `chN-screen-X` → repo `chN-XXX`
- Modules 22-28: Repo has screens in sections
- Modules 29-46: Match by screen number (integer)

## Output

1. Updated chapter JSONs with corrected embed URLs (both local and repo)
2. Updated React component(s) if iframe rendering was needed
3. `audit-reports/VIDEO_EMBED_REPORT.md` with:
   - Total videos found across all modules
   - How many URLs were converted (watch→embed, short→embed)
   - List of any non-YouTube or unavailable videos
   - Whether frontend component was modified (and what changed)
   - Per-module video count

## CRITICAL RULES

- **Every video must use embed format.** No watch URLs, no external links.
- **Don't remove videos.** Even if unavailable, keep the reference (flag it instead).
- **Test the embed URL format** — `https://www.youtube.com/embed/VIDEO_ID` is the only correct format.
- **Preserve the video's position** in the screen. Don't move videos between screens.
- **Handle all 4 JSON schemas.** Video field names differ across schemas.

## When Complete

Set STATUS: VIDEOS_FIXED in .cleave/stages/fix-videos/PROGRESS.md and print TASK_FULLY_COMPLETE.
