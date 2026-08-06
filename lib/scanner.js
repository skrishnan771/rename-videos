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

  // Sort deepest-first so child dirs are renamed before their parents
  dirs.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

  // Build videoDirs: walk deepest-first so parents inherit children's status
  const videoDirs = new Set();
  for (const dir of dirs) {
    if (directVideoMap.has(dir)) videoDirs.add(dir);
    if (videoDirs.has(dir)) videoDirs.add(path.dirname(dir)); // propagate upward
  }

  return { videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs };
}

module.exports = { scanTree };
