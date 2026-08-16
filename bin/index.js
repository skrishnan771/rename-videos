#!/usr/bin/env node

// ============================================================
//  Intelligent Video File & Folder Renamer  v7
//
//  Features:
//    • Smart name cleaning  (scene, streaming, anime, Indian)
//    • Subtitle pairing     (.srt/.ass/.sub follow their video)
//    • Anime specials       (SP01, OVA, Special recognised)
//    • Duplicate detection  (name + file-size based; preserves
//                            resolution when conflicts occur)
//    • Undo                 (--undo reverses last run; log saved
//                            in the scanned directory)
//    • Force mode           (--force skips the Y/N prompt)
//    • Progress bars        (spinner → scan, bars → plan + rename)
//    • Colored output       (zero dependencies, pure ANSI)
//    • Atomic safety        (plan everything; abort on any error)
//    • Stale-file guards    (re-check existence before each rename)
//    • Camera file skip     (VID_, IMG_, timestamps left untouched)
//    • Folder guard         (only rename dirs that contain videos)
//
//  Usage:
//    rename-videos [--path="./videos"] [--force] [--undo] [--help]
//
//  This file is the CLI entry point only — it wires stdin/stdout, argv, and
//  the filesystem together. The actual renaming logic lives in ../lib and is
//  unit-tested independently of any of that I/O (see ../test).
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { performance } = require('perf_hooks');

const { c, isTTY } = require('../lib/colors');
const { LOG_FILENAME } = require('../lib/constants');
const { printHelp } = require('../lib/help');
const { parseArgs } = require('../lib/cli-args');
const { isCameraFile } = require('../lib/camera');
const { cleanName } = require('../lib/parser');
const { buildSubtitleRenames } = require('../lib/subtitles');
const { detectDuplicates } = require('../lib/duplicates');
const { resolveConflict } = require('../lib/conflict-resolver');
const { scanTree } = require('../lib/scanner');
const { executeRenames } = require('../lib/executor');
const { saveUndoLog, runUndo } = require('../lib/undo');
const { clearStatus, progressBar } = require('../lib/progress');
const { printSummary } = require('../lib/summary');

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { argPath, force, undo, help, unknown } = parseArgs();

  // ── Help mode ─────────────────────────────────────────────────────────────
  if (help) { printHelp(); return; }

  // ── Unknown flags ─────────────────────────────────────────────────────────
  // Refuse to run rather than silently ignoring them: an ignored flag used to
  // fall through into a full rename of the current working directory, which is
  // the most destructive possible response to a typo.
  if (unknown.length > 0) {
    for (const flag of unknown) console.error(c.red(`✖  Unknown option: ${flag}`));
    console.error(c.gray('   Valid options: --path  --force  --undo  --help'));
    console.error(c.gray('   Run with --help for full usage.'));
    process.exit(1);
  }

  const targetPath = argPath ? path.resolve(argPath) : process.cwd();

  // Validate target directory exists and is a directory
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      console.error(c.red(`✖  Not a directory: ${targetPath}`)); process.exit(1);
    }
  } catch {
    console.error(c.red(`✖  Path not found: ${targetPath}`)); process.exit(1);
  }

  // ── Undo mode ─────────────────────────────────────────────────────────────
  // Log is always read from (and saved to) the scanned directory so --path
  // correctly identifies which log file to use
  if (undo) { runUndo(targetPath); return; }

  // ── Banner ────────────────────────────────────────────────────────────────
  console.log(`\n${c.bold('════════════════════════════════════════')}`);
  console.log(c.bold(c.cyan('  Intelligent Video Renamer  v7')));
  console.log(c.bold('════════════════════════════════════════'));
  console.log(`\n  Scanning: ${c.cyan(targetPath)}`);
  if (force) console.log(`  Mode: ${c.yellow('--force')} ${c.gray('(no confirmation prompt)')}`);
  console.log(`  ${c.gray('(including all subfolders)')}\n`);

  // ── PHASE 1: Scan ─────────────────────────────────────────────────────────
  const t0 = performance.now();
  let videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs, entryIndex;

  try {
    ({ videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs, entryIndex } = await scanTree(targetPath));
  } catch (err) {
    console.error(c.red(`\n✖  Fatal scan error: ${err.message}`));
    console.error(c.gray('   No changes have been made.'));
    process.exit(1);
  }

  const scanMs = (performance.now() - t0).toFixed(0);
  console.log(
    `  Found ${c.bold(c.cyan(videoFiles.length))} video(s), ` +
    `${c.bold(c.cyan(subtitleFiles.length))} subtitle(s), ` +
    `${c.bold(c.cyan(videoDirs.size))} media folder(s) ` +
    `${c.gray(`in ${scanMs}ms`)}`
  );

  // Report skipped subtrees so the user knows they were intentionally pruned
  if (skippedDirs.length > 0) {
    console.log(
      `  ${c.yellow('⚠')}  Skipped ${c.bold(c.yellow(skippedDirs.length))} ` +
      `non-media director${skippedDirs.length === 1 ? 'y' : 'ies'} ` +
      c.gray('(project/repo roots, dependency trees)')
    );
    // Show individual paths only at a reasonable count — beyond that just summarise
    const SHOW_LIMIT = 5;
    const toShow = skippedDirs.slice(0, SHOW_LIMIT);
    for (const s of toShow) {
      const rel = s.path.replace(targetPath, '').replace(/^[/\\]/, '') || path.basename(s.path);
      console.log(`     ${c.gray('↳')} ${c.gray(rel)}  ${c.gray('(' + s.reason + ')')}`);
    }
    if (skippedDirs.length > SHOW_LIMIT) {
      console.log(`     ${c.gray(`… and ${skippedDirs.length - SHOW_LIMIT} more`)}`);
    }
  }
  console.log();

  // ── PHASE 2: Plan all renames ─────────────────────────────────────────────
  // Nothing is touched on disk in this phase.
  // Any planning error aborts the entire run with zero disk changes.
  const planErrors = [];
  const fileRenames = []; // video file renames
  const subRenames = []; // subtitle renames (paired to their video)
  const dirRenames = []; // folder renames

  // reservedPaths tracks destinations already claimed by this plan so the
  // conflict resolver doesn't double-book names within a single run
  const reservedPaths = new Set();

  // Answer "does this path already exist?" from the scan index instead of a
  // sync stat per candidate. Directories the scanner never indexed (pruned
  // subtrees) fall back to the real filesystem so the check is never weaker
  // than before. The executor re-verifies on disk before every rename.
  const existsInScan = (p) => {
    const known = entryIndex.get(path.dirname(p));
    return known ? known.has(path.basename(p).toLowerCase()) : fs.existsSync(p);
  };

  // Subtitles bucketed by directory. Pairing previously walked the entire
  // subtitle list once per video just to discard everything outside the
  // video's own folder — quadratic, and by far the slowest phase of a run
  // (5.1s of a 5.6s plan on a 3,600-video library).
  const subsByDir = new Map();
  for (const subPath of subtitleFiles) {
    const dir = path.dirname(subPath);
    let bucket = subsByDir.get(dir);
    if (!bucket) subsByDir.set(dir, bucket = []);
    bucket.push(subPath);
  }

  const planTotal = videoFiles.length + dirs.length;
  let planDone = 0;

  // ── Plan: video files ─────────────────────────────────────────────────────
  for (const file of videoFiles) {
    planDone++;
    if (isTTY && planTotal > 200) progressBar(planDone, planTotal, 'planning…', 'cyan');

    try {
      const name = path.basename(file);

      // Camera / timestamp files are never renamed
      if (isCameraFile(name)) continue;

      const parent = path.dirname(file);
      const newName = cleanName(name, false, path.basename(parent));
      if (newName === name) continue; // already clean, no action needed

      // Pass original name to resolver so it can extract the resolution tag
      // when a naming conflict occurs (produces "[1080p]" instead of "(2)")
      const finalName = resolveConflict(parent, newName, false, reservedPaths, name, file, existsInScan);
      reservedPaths.add(path.join(parent, finalName));

      const record = { filePath: file, original: name, newName: finalName, parent };
      fileRenames.push(record);

      // Immediately pair any matching subtitles to follow this video rename
      const pairedSubs = buildSubtitleRenames(record, subsByDir.get(parent) || [], reservedPaths, existsInScan);
      subRenames.push(...pairedSubs);

    } catch (err) {
      planErrors.push(`File: ${file} — ${err.message}`);
    }
  }

  // ── Plan: folders ─────────────────────────────────────────────────────────
  for (const dir of dirs) {
    planDone++;
    if (isTTY && planTotal > 200) progressBar(planDone, planTotal, 'planning…', 'cyan');

    try {
      // Only rename folders that contain at least one video file
      if (!videoDirs.has(dir)) continue;

      const name = path.basename(dir);
      const newName = cleanName(name, true);
      if (newName === name || newName.length === 0) continue; // already clean

      const parent = path.dirname(dir);
      const finalName = resolveConflict(parent, newName, true, reservedPaths, '', dir, existsInScan);
      reservedPaths.add(path.join(parent, finalName));

      dirRenames.push({ filePath: dir, original: name, newName: finalName, parent });

    } catch (err) {
      planErrors.push(`Folder: ${dir} — ${err.message}`);
    }
  }

  clearStatus();

  // Any planning error → abort with zero disk changes
  if (planErrors.length > 0) {
    console.error(c.red('\n✖  Planning errors detected. No changes will be made:\n'));
    planErrors.forEach(e => console.error(`   ${c.red('•')} ${e}`));
    process.exit(1);
  }

  // ── Duplicate detection ────────────────────────────────────────────────────
  // Check for name collisions after resolution-aware conflict resolution.
  // At this point every rename has a unique finalName, so duplicates here
  // would indicate an unexpected edge case — surface as a warning, not abort.
  const allPlanned = [...fileRenames, ...subRenames, ...dirRenames];
  const dupWarnings = detectDuplicates(allPlanned);
  if (dupWarnings.length > 0) {
    console.log(c.yellow(`⚠  Naming conflicts resolved (resolution tags applied where possible):\n`));
    dupWarnings.forEach(w => console.log(`   ${c.yellow('•')} ${w}`));
    console.log('');
  }

  const totalRenames = allPlanned.length;
  if (totalRenames === 0) {
    console.log(c.green('✔  Nothing to rename — all files already clean.'));
    return;
  }

  // ── PHASE 3: Preview ──────────────────────────────────────────────────────
  // Helper to print one rename row consistently
  const printRenameRow = (r, rootPath) => {
    const rel = r.parent.replace(rootPath, '').replace(/^[/\\]/, '');
    const prefix = rel ? `${c.gray('[' + rel + ']')} ` : '';
    console.log(`  ${prefix}${c.gray(r.original)}\n  ${c.gray('→')} ${c.cyan(r.newName)}\n`);
  };

  if (fileRenames.length > 0) {
    console.log(c.bold(`FILES (${fileRenames.length}):`));
    fileRenames.forEach(r => printRenameRow(r, targetPath));
  }
  if (subRenames.length > 0) {
    console.log(c.bold(`SUBTITLES (${subRenames.length}):`));
    subRenames.forEach(r => printRenameRow(r, targetPath));
  }
  if (dirRenames.length > 0) {
    console.log(c.bold(`FOLDERS (${dirRenames.length}):`));
    dirRenames.forEach(r => printRenameRow(r, targetPath));
  }

  // ── PHASE 4: Confirm ──────────────────────────────────────────────────────
  if (!force) {
    const answer = await new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(
        `${c.bold(`Rename ${c.cyan(totalRenames)} item(s)?`)} ${c.gray('(Y/N)')} `,
        a => { rl.close(); resolve(a.trim()); }
      );
    });
    if (answer.toLowerCase() !== 'y') {
      console.log(c.gray('\nCancelled. No changes made.'));
      return;
    }
  }

  // ── PHASE 5: Execute ──────────────────────────────────────────────────────
  // Videos and subtitles first (before their parent folder paths change),
  // then folders deepest-first (already sorted that way by scanTree).
  const completedLog = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  // Shared accumulator — keeps the progress bar consistent across all three batches
  const tally = (r, offset) => {
    succeeded += r.succeeded;
    skipped += r.skipped;
    failed += r.failed;
    return offset + r.succeeded + r.skipped + r.failed;
  };

  let offset = 0;
  offset = tally(executeRenames(fileRenames, false, completedLog, offset, totalRenames), offset);
  offset = tally(executeRenames(subRenames, false, completedLog, offset, totalRenames), offset);
  tally(executeRenames(dirRenames, true, completedLog, offset, totalRenames), offset);

  clearStatus(); // ensure progress bar is fully cleared before summary

  // ── PHASE 6: Save undo log ────────────────────────────────────────────────
  if (completedLog.length > 0) {
    saveUndoLog(targetPath, completedLog);
    console.log(`\n  ${c.gray('💾  Undo log saved →')} ${c.cyan(path.join(targetPath, LOG_FILENAME))}`);
    console.log(`  ${c.gray('Run with --undo to reverse.')}`);
  }

  printSummary({ succeeded, skipped, failed });
}

main().catch(err => {
  console.error(c.red(`\n✖  Unexpected error: ${err.message}`));
  console.error(c.gray('   No changes have been made.'));
  process.exit(1);
});
