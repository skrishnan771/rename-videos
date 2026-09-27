'use strict';

const fs = require('fs');
const path = require('path');
const { pathKey, samePath } = require('./constants');
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
 * The returned name is reserved in reservedPaths before returning, so no two
 * planned renames can ever claim the same destination. It may equal the
 * source's own name (e.g. "Movie [1080p].mkv" on a re-run) — callers treat
 * that as "nothing to do".
 *
 * @param {string}      parentDir      — directory the file lives in
 * @param {string}      newName        — desired clean name
 * @param {boolean}     isFolder       — true for directory renames
 * @param {Set<string>} reservedPaths  — pathKey()s already claimed by this plan
 * @param {string}      [originalName] — original filename (used for resolution extraction)
 * @param {string}      [sourcePath]   — original full path; never collides with itself
 * @param {(p: string) => boolean} [existsFn] — collision check, defaults to fs.existsSync
 *                                               (injectable for testing without touching disk)
 */
function resolveConflict(parentDir, newName, isFolder, reservedPaths, originalName = '', sourcePath = '', existsFn = fs.existsSync) {
  // Does this candidate collide with disk or the current plan? The source
  // itself never counts: without that, a re-run on Linux saw its own
  // "Movie (2010) [1080p].mkv" as taken and renamed it to "... (2).mkv".
  const taken = (name) => {
    const p = path.join(parentDir, name);
    if (sourcePath && samePath(p, sourcePath)) return false;
    return existsFn(p) || reservedPaths.has(pathKey(p));
  };
  const reserve = (name) => {
    reservedPaths.add(pathKey(path.join(parentDir, name)));
    return name;
  };

  // Fast path: desired name is free
  if (!taken(newName)) return reserve(newName);

  // For files: try appending a resolution tag before falling back to numbers
  if (!isFolder && originalName) {
    const resTag = extractResolutionTag(originalName);
    if (resTag) {
      const ext = path.extname(newName);
      const base = path.basename(newName, ext);
      const withRes = `${base} ${resTag}${ext}`;
      if (!taken(withRes)) return reserve(withRes);
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
    if (!taken(candidate)) return reserve(candidate);

    n++;
  }
}

module.exports = { resolveConflict };
