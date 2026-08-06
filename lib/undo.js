'use strict';

const fs = require('fs');
const path = require('path');
const { LOG_FILENAME, isCaseInsensitiveFS } = require('./constants');
const { c } = require('./colors');
const { printSummary } = require('./summary');

// ─────────────────────────────────────────────────────────────────────────────
//  UNDO LOG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a log of completed renames inside the scanned directory so it always
 * travels with the files it describes and can be found with --path later.
 *
 * Format: { timestamp, targetPath, entries: [{ from, to }] }
 *   from — current (renamed) path
 *   to   — original (pre-rename) path
 */
function saveUndoLog(targetPath, completedRenames) {
  const logPath = path.join(targetPath, LOG_FILENAME);
  const log = {
    timestamp: new Date().toISOString(),
    targetPath,
    entries: completedRenames.map(r => ({
      from: path.join(r.parent, r.newName), // current path (after rename)
      to: r.filePath,                     // original path (before rename)
    })),
  };
  try {
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
  } catch (err) {
    console.warn(`  ${c.yellow('⚠')}  Could not write undo log: ${err.message}`);
  }
}

/**
 * Read the undo log from the given directory and reverse every rename.
 * Renames are applied in reverse order (last → first) so nested folder
 * renames don't break each other's paths.
 * The log file is deleted after a fully successful undo.
 */
function runUndo(targetPath) {
  const logPath = path.join(targetPath, LOG_FILENAME);

  if (!fs.existsSync(logPath)) {
    console.error(c.red(`✖  No undo log found in: ${targetPath}`));
    console.error(c.gray('   Run a rename first, or specify the correct --path.'));
    process.exit(1);
  }

  let log;
  try {
    log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (err) {
    console.error(c.red(`✖  Could not read undo log: ${err.message}`));
    process.exit(1);
  }

  console.log(`\n${c.bold('════════════════════════════════════════')}`);
  console.log(c.bold(c.cyan('  Undo Last Rename Run')));
  console.log(c.bold('════════════════════════════════════════'));
  console.log(`\n  Original run: ${c.gray(log.timestamp)}`);
  console.log(`  Entries to reverse: ${c.cyan(log.entries.length)}\n`);

  let succeeded = 0, skipped = 0, failed = 0;

  // Reverse order: undo deepest/last renames first so paths stay valid
  for (const entry of [...log.entries].reverse()) {
    let stat;
    try { stat = fs.statSync(entry.from); } catch { stat = null; }

    if (!stat) {
      console.log(`  ${c.yellow('⚠')}  ${c.yellow('Skipped')} (not found): ${c.gray(entry.from)}`);
      skipped++; continue;
    }

    const isSamePath = isCaseInsensitiveFS
      ? entry.to.toLowerCase() === entry.from.toLowerCase()
      : entry.to === entry.from;
    if (fs.existsSync(entry.to) && !isSamePath) {
      console.log(`  ${c.yellow('⚠')}  ${c.yellow('Skipped')} (target already exists): ${c.gray(entry.to)}`);
      skipped++; continue;
    }

    try {
      fs.renameSync(entry.from, entry.to);
      console.log(`  ${c.green('✔')}  ${path.basename(entry.from)}  →  ${c.green(path.basename(entry.to))}`);
      succeeded++;
    } catch (err) {
      console.log(`  ${c.red('✖')}  ${entry.from} — ${c.red(err.message)}`);
      failed++;
    }
  }

  // Delete the log only when everything succeeded so partial undos can be retried
  if (failed === 0 && succeeded > 0) {
    try { fs.unlinkSync(logPath); } catch { /* ignore */ }
  }

  printSummary({ succeeded, skipped, failed, verb: 'Reversed' });
}

module.exports = { saveUndoLog, runUndo };
