# Stage 3: Fix Loader, SCORM Export & Security Issues

You are fixing critical code-level issues in the Digital Witness to History (Digital WTH) platform. These were flagged by automated code reviews (Gemini, Codex) on PR #1 and must be resolved before the app can properly display the remapped images.

## Prerequisites

Stage 2 (fix-mappings) updated the chapter JSONs with corrected image paths using `/images/modules/module_XX/...` public-path format. However, the app's existing image loader does NOT understand these paths — it only resolves from a hardcoded registry. This stage fixes that disconnect.

## Project Structure

- **App source:** `src/` (React + TypeScript)
- **Image loader:** `src/hooks/useImage.ts` or `src/utils/imageLoader.ts` (resolves image keys to URLs)
- **Image registry:** `src/assets/images/index.ts` or similar (maps keys → imported image modules)
- **SCORM exporter:** `src/utils/scormExporter.ts` or `src/services/scormExporter.ts` (packages modules for LMS)
- **Media service:** `src/lib/mediaService.ts` (upload/update/delete media — has security issues)
- **Module JSONs (local):** `wth ch XX/Chapter_XX_*.json`
- **Module JSONs (repo):** `src/content/chapterN.json`
- **Public images:** `src/assets/images/`
- **.gitattributes:** Root of repo

## What To Do

### 1. Fix the Image Loader

The app uses a custom image loading system (`useImage` hook or `loadImage` utility) that resolves image keys from a registry (imported modules in `src/assets/images/`). The Stage 2 remapping wrote paths like `/images/modules/module_01/m01_s05_photo.jpg` — these are **public-path** URLs that can be served directly by the web server, but the existing loader doesn't know how to handle them.

**Find and fix the loader:**

1. Search for the image loading code: `useImage`, `loadImage`, `getImageUrl`, `resolveImage`, or `imageLoader`
2. Identify how it currently resolves image keys (likely: looks up key in a JS/TS module map)
3. Add a **public-path passthrough**: if the image key starts with `/images/` or `/public/`, return it directly as a URL without registry lookup
4. Ensure the fallback (missing image placeholder) still works for keys not found in either path

```typescript
// Example fix pattern:
function resolveImageUrl(key: string): string {
  // Public-path images — serve directly
  if (key.startsWith('/images/') || key.startsWith('/public/')) {
    return key;
  }
  // Legacy registry lookup
  return imageRegistry[key] || PLACEHOLDER_IMAGE;
}
```

### 2. Fix SCORM Export

The SCORM exporter (`scormExporter.ts`) packages modules for offline LMS use. It builds an `imageMap` from the image registry, so the new `/images/modules/...` paths won't be included.

1. Find the SCORM export code
2. Locate where it builds the image map/manifest
3. Add logic to also collect images from `src/assets/images/` paths
4. Ensure the SCORM package includes the actual image files for any public-path references
5. Update the image URL rewriting in the SCORM HTML templates to handle public paths

### 3. Fix Security Issues in mediaService.ts

The media service has three security vulnerabilities:

**a) IDOR in updateMedia/deleteMedia:**
- `updateMedia(mediaId)` and `deleteMedia(mediaId)` don't verify that the requesting user owns the media
- Fix: Add an authorization check that verifies the current user matches the media owner
- Pattern: `if (media.ownerId !== currentUser.id) throw new ForbiddenError()`

**b) Path traversal in uploadMedia:**
- `moduleId` parameter is used to construct file paths without sanitization
- A malicious `moduleId` like `../../etc` could write files outside the intended directory
- Fix: Sanitize moduleId — strip `..`, `/`, `\`, and any non-alphanumeric characters except `-` and `_`

```typescript
function sanitizeModuleId(moduleId: string): string {
  return moduleId.replace(/[^a-zA-Z0-9_-]/g, '');
}
```

**c) Input validation:**
- Add file type validation (only allow image MIME types)
- Add file size limits
- Validate that uploaded files are actually images (check magic bytes, not just extension)

### 4. Fix .gitattributes for Case-Insensitive LFS Patterns

The current `.gitattributes` has case-sensitive patterns like `*.jpg filter=lfs`. Some images may have `.JPG`, `.PNG`, `.JPEG` extensions.

Fix patterns to be case-insensitive:
```
*.[jJ][pP][gG] filter=lfs diff=lfs merge=lfs -text
*.[jJ][pP][eE][gG] filter=lfs diff=lfs merge=lfs -text
*.[pP][nN][gG] filter=lfs diff=lfs merge=lfs -text
*.[gG][iI][fF] filter=lfs diff=lfs merge=lfs -text
*.[wW][eE][bB][pP] filter=lfs diff=lfs merge=lfs -text
*.[sS][vV][gG] filter=lfs diff=lfs merge=lfs -text
```

### 5. Sanitize Filenames with Spaces/Special Characters

Some image files have spaces or special characters in their names that break URL encoding in browsers.

1. Scan all files in `src/assets/images/` for filenames containing spaces, parentheses, brackets, or other URL-unsafe characters
2. Rename them: replace spaces with `_`, remove parentheses and brackets, lowercase everything
3. Update ALL references to the renamed files in:
   - Chapter JSONs (both local and repo copies)
   - The image manifest (`manifest.json`)
   - The vision audit (`IMAGE_VISION_AUDIT.json`)
   - Any CSS or HTML that references them

### 6. Remove Test/Duplicate Files

Clean up test and temporary files that shouldn't be in production:

1. Find and remove: `*_test.*`, `*_tmp.*`, `tmp_*`, `test_*`, `*.bak`, `*.orig`
2. Check for any zero-byte files
3. Remove any files that the vision audit flagged as corrupt AND have no discernible content
4. Update manifests and JSONs to remove references to deleted files

## Output

1. Updated source code files with loader, SCORM, and security fixes
2. Sanitized filenames in `src/assets/images/`
3. Updated JSONs with corrected paths (reflecting any renames)
4. `audit-reports/LOADER_SECURITY_FIX_REPORT.md` with:
   - What was fixed in the image loader (before/after code)
   - What was fixed in SCORM export
   - Security fixes applied to mediaService.ts
   - List of renamed files (old name → new name)
   - List of deleted test/temp files
   - .gitattributes changes

## CRITICAL RULES

- **Don't break existing functionality.** The image loader must still work for any legacy registry-based keys.
- **Test your changes.** After modifying the loader, verify that at least a few image paths resolve correctly by tracing the code path.
- **Don't skip the security fixes.** These are real vulnerabilities, not theoretical.
- **Update BOTH local and repo JSONs** if you rename any image files.
- **Preserve git-lfs tracking.** Don't accidentally un-track images from LFS.

## When Complete

Set STATUS: LOADER_FIXED in .cleave/stages/fix-loader/PROGRESS.md and print TASK_FULLY_COMPLETE.
