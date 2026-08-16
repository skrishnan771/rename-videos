'use strict';

const fsp = require('fs/promises');
const path = require('path');
const { VIDEO_EXTENSIONS, SUBTITLE_EXTENSIONS, SCAN_CONCURRENCY } = require('./constants');
const { shouldSkipDir } = require('./skip-dirs');
const { isTTY, c } = require('./colors');
const { writeStatus, clearStatus, Semaphore } = require('./progress');

// ─────────────────────────────────────────────────────────────────────────────
//  SCANNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively scan a directory tree in parallel.
 *
 * Returns:
 *   videoFiles    — all video file paths
 *   subtitleFiles — all subtitle file paths
 *   dirs          — all directory paths, sorted deepest-first
 *   videoDirs     — Set of dirs containing ≥1 video (direct or nested)
 *   skippedDirs   — array of { path, reason } for pruned subtrees
 *   entryIndex    — dir → Set of every child name in it, lowercased. Lets the
 *                   planner answer "does this destination already exist?" from
 *                   memory instead of a sync stat per candidate rename. It
 *                   records *all* entries, not just media, so a collision with
 *                   an unrelated file is still caught. The executor re-checks
 *                   on disk before each rename, so a stale index can never
 *                   cause an overwrite.
 *
 * Displays a live spinner + running count while scanning because the total
 * is unknown until the full tree has been traversed.
 */
async function scanTree(rootDir) {
  const videoFiles = [];
  const subtitleFiles = [];
  const dirs = [];
  const skippedDirs = []; // { path, reason } — reported after scan
  const directVideoMap = new Map(); // dir → video files directly inside it
  const entryIndex = new Map(); // dir → Set of lowercased child names

  let dirsScanned = 0;
  let videosFound = 0;

  const sem = new Semaphore(SCAN_CONCURRENCY);

  const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinIdx = 0;
  const spinTimer = isTTY ? setInterval(() => {
    writeStatus(
      c.cyan(`  ${SPINNER[spinIdx++ % SPINNER.length]}  Scanning…  `) +
      `${c.bold(dirsScanned)} folders  ${c.bold(videosFound)} videos found`
    );
  }, 80) : null;

  async function recurse(current) {
    await sem.acquire();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
      dirsScanned++;
    } catch (err) {
      // Permission error or disappeared mid-scan — warn and skip subtree
      console.warn(`\n  ${c.yellow('⚠')}  Cannot read: ${current} — ${err.message}`);
      return;
    } finally {
      sem.release();
    }

    // Build a cheap child-name list for the marker check (no stat calls)
    const childNames = entries.map(e => e.name);

    // ── Skip-directory check ────────────────────────────────────────────────
    // Run on every directory we descend into (not just top-level) so that
    // node_modules nested inside a project, or a git repo anywhere in the
    // tree, are all pruned without touching their contents.
    const dirName = path.basename(current);
    // Don't prune the rootDir itself — the user explicitly pointed at it
    if (current !== rootDir) {
      const { skip, reason } = shouldSkipDir(current, dirName, childNames);
      if (skip) {
        skippedDirs.push({ path: current, reason });
        return; // prune entire subtree
      }
    }

    // Index child names for the planner's collision check — after the skip
    // test, so pruned subtrees cost nothing
    entryIndex.set(current, new Set(childNames.map(n => n.toLowerCase())));

    const subTasks = [];
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory()) {
        dirs.push(fullPath);
        subTasks.push(recurse(fullPath));
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(ext)) {
        videoFiles.push(fullPath);
        videosFound++;
        if (!directVideoMap.has(current)) directVideoMap.set(current, []);
        directVideoMap.get(current).push(fullPath);
      } else if (entry.isFile() && SUBTITLE_EXTENSIONS.has(ext)) {
        subtitleFiles.push(fullPath);
      }
    }

    if (subTasks.length) await Promise.all(subTasks);
  }

  await recurse(rootDir);

  if (spinTimer) clearInterval(spinTimer);
  clearStatus();

  // Files are discovered in whatever order the parallel readdir fan-out
  // happens to complete, which differs between identical runs. That leaked
  // into the plan: when two files collide, which one keeps the plain name and
  // which gets the "[720p]" tag was decided by discovery order. Sort so a
  // given tree always produces the same plan.
  videoFiles.sort();
  subtitleFiles.sort();

  // Sort deepest-first so child dirs are renamed before their parents.
  // Depth is precomputed: comparators run O(n log n) times, and splitting the
  // path inside one allocated two throwaway arrays per comparison.
  const depthOf = new Map();
  for (const d of dirs) {
    let depth = 0;
    for (let i = 0; i < d.length; i++) if (d[i] === path.sep) depth++;
    depthOf.set(d, depth);
  }
  dirs.sort((a, b) => depthOf.get(b) - depthOf.get(a));

  // Build videoDirs: walk deepest-first so parents inherit children's status
  const videoDirs = new Set();
  for (const dir of dirs) {
    if (directVideoMap.has(dir)) videoDirs.add(dir);
    if (videoDirs.has(dir)) videoDirs.add(path.dirname(dir)); // propagate upward
  }

  return { videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs, entryIndex };
}

module.exports = { scanTree };
