'use strict';

const fs = require('fs');
const path = require('path');
const { isCaseInsensitiveFS } = require('./constants');
const { extractResolutionTag } = require('./text-utils');

// ─────────────────────────────────────────────────────────────────────────────
//  CONFLICT RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a final name that doesn't collide with anything on disk OR with any
 * path already reserved by an earlier planned rename.
 *
 * Strategy for files:
 *   1. Try the clean name as-is.
 *   2. If that's taken, extract a resolution tag from the *original* filename
 *      (e.g. "1080p", "720p", "4K") and append it before trying "(2)", "(3)"…
 *      This produces:
 *        Movie (2010) [1080p].mkv  +  Movie (2010) [720p].mkv
 *      instead of the opaque:
 *        Movie (2010).mkv  +  Movie (2010) (2).mkv
 *   3. If that's also taken, fall through to numeric suffixes.
 *
 * @param {string}      parentDir      — directory the file lives in
 * @param {string}      newName        — desired clean name
 * @param {boolean}     isFolder       — true for directory renames
 * @param {Set<string>} reservedPaths  — paths already claimed by this plan
 * @param {string}      [originalName] — original filename (used for resolution extraction)
 * @param {string}      [sourcePath]   — original full path (excluded from collision check
 *                                       on case-insensitive filesystems when only casing differs)
 * @param {(p: string) => boolean} [existsFn] — collision check, defaults to fs.existsSync
 *                                               (injectable for testing without touching disk)
 */
function resolveConflict(parentDir, newName, isFolder, reservedPaths, originalName = '', sourcePath = '', existsFn = fs.existsSync) {
  // Helper: does this candidate path collide with disk or the current plan?
  // On case-insensitive file systems (Windows/macOS), fs.existsSync may match
  // the source file itself when only casing changes — exclude it explicitly.
  const taken = (name) => {
    const p = path.join(parentDir, name);
    if (sourcePath && isCaseInsensitiveFS && p.toLowerCase() === sourcePath.toLowerCase()) return false;
    return existsFn(p) || reservedPaths.has(p);
  };

  // Fast path: desired name is free
  if (!taken(newName)) return newName;

  // For files: try appending a resolution tag before falling back to numbers
  if (!isFolder && originalName) {
    const resTag = extractResolutionTag(originalName);
    if (resTag) {
      const ext = path.extname(newName);
      const base = path.basename(newName, ext);
      const withRes = `${base} ${resTag}${ext}`;
      if (!taken(withRes)) return withRes;
    }
  }

  // Numeric fallback: append " (2)", " (3)" … until a free slot is found
  let n = 2;
  for (; ;) {
    let candidate;
    if (isFolder) {
      candidate = `${newName} (${n})`;
    } else {
      const ext = path.extname(newName);
      const base = path.basename(newName, ext);
      candidate = `${base} (${n})${ext}`;
    }
    if (!taken(candidate)) return candidate;
    n++;
  }
}

module.exports = { resolveConflict };
