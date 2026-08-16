'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  SCANNER — SKIP LIST
//
//  Directories that are never media folders and can contain enormous numbers
//  of files (thousands of tiny JS/Python/Rust files) that would make the scan
//  hang for minutes on a developer machine.
//
//  Two tiers:
//    SKIP_EXACT   — exact directory names always skipped (case-insensitive)
//    SKIP_MARKERS — if ANY of these files/dirs exist inside a directory,
//                   that directory and its entire subtree are skipped.
//                   This catches repos whose top-level name is non-standard
//                   (e.g. a project named "movies-api" still has package.json).
// ─────────────────────────────────────────────────────────────────────────────

// Exact names that are definitively non-media at any nesting level
const SKIP_EXACT = new Set([
  // JS / Node
  'node_modules', '.npm', '.yarn', '.pnp',
  // Python
  '__pycache__', '.venv', 'venv', 'env', 'site-packages', '.tox', '.mypy_cache',
  // Rust / Cargo
  'target',
  // Java / JVM
  '.gradle', '.mvn', 'build', 'out',
  // Ruby
  '.bundle', 'vendor',
  // Generic tooling / version control
  '.git', '.svn', '.hg',
  // IDE / editor state
  '.idea', '.vscode', '.vs',
  // OS noise
  '.Spotlight-V100', '.Trashes', '.fseventsd',
  // Distribution / cache artefacts
  'dist', 'coverage', '.cache', '.parcel-cache', '.next', '.nuxt', '.sass-cache', '.webpack', '.eslintcache',
  // docker, virtualisation
  'docker', 'vagrant', 'virtualenvs'
]);

// Marker files/dirs: if a directory contains one of these, skip its subtree.
// Lets us catch projects named anything (e.g. "awesome-media-server") that
// happen to have a package.json / Cargo.toml / requirements.txt inside.
// NOTE: .git is intentionally NOT here — a repo root may contain media files
// at its top level.  Only the .git *subdirectory itself* is blocked via SKIP_EXACT.
const SKIP_MARKERS = [
  'package.json',    // Node / JS project root
  'Cargo.toml',      // Rust project root
  'go.mod',          // Go module root
  'requirements.txt',// Python project
  'setup.py',        // Python package
  'pyproject.toml',  // Modern Python project
  'Gemfile',         // Ruby project root
  'pom.xml',         // Maven (Java)
  'build.gradle',    // Gradle (Java/Kotlin)
];

// Set form of SKIP_MARKERS for the per-child lookup in shouldSkipDir
const SKIP_MARKER_SET = new Set(SKIP_MARKERS);

/**
 * Decide whether to skip an entire directory subtree during scanning.
 *
 * Returns { skip: true, reason } when the directory should be pruned, or
 * { skip: false } when it is safe to descend.
 *
 * @param {string}   dirPath  — absolute path of the directory to test
 * @param {string}   dirName  — basename of the directory (for exact-name check)
 * @param {string[]} children — names of immediate children (for marker check)
 */
function shouldSkipDir(dirPath, dirName, children) {
  // Tier 1: exact name match (fast O(1) Set lookup)
  if (SKIP_EXACT.has(dirName.toLowerCase())) {
    return { skip: true, reason: `"${dirName}" is a known non-media directory` };
  }

  // Tier 2: marker file present — this directory is a project/repo root.
  // One pass over the children testing a Set, rather than one full linear
  // scan of the children per marker: a media folder holding thousands of
  // files paid for nine of those scans on every directory visited.
  for (const child of children) {
    if (SKIP_MARKER_SET.has(child)) {
      return { skip: true, reason: `contains ${child} (project/repo root)` };
    }
  }

  return { skip: false };
}

module.exports = { shouldSkipDir, SKIP_EXACT, SKIP_MARKERS };
