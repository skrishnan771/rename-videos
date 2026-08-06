'use strict';

const fs = require('fs');
const path = require('path');
const { isCaseInsensitiveFS } = require('./constants');
const { isTTY, c } = require('./colors');
const { progressBar, clearStatus } = require('./progress');

// ─────────────────────────────────────────────────────────────────────────────
//  RENAME EXECUTOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a list of planned rename records with a live progress bar.
 * Re-checks existence and destination availability immediately before each
 * rename — guards against stale state from user activity between plan and exec.
 *
 * @param {Array}    renames      — { filePath, original, newName, parent }[]
 * @param {boolean}  expectDir    — true when renaming directories
 * @param {Array}    completedLog — records of successful renames (for undo log)
 * @param {number}   doneOffset   — number of items already counted (for shared bar)
 * @param {number}   grandTotal   — total items across all batches (for shared bar)
 * @returns {{ succeeded, skipped, failed }}
 */
function executeRenames(renames, expectDir, completedLog, doneOffset, grandTotal) {
  let succeeded = 0, skipped = 0, failed = 0;

  for (const r of renames) {
    // Update rename progress bar
    const doneSoFar = doneOffset + succeeded + skipped + failed;
    if (isTTY && grandTotal > 0) progressBar(doneSoFar, grandTotal, 'renaming…', 'green');

    // Stale-state guard: re-verify the item still exists and is the right type
    let stat;
    try { stat = fs.statSync(r.filePath); } catch { stat = null; }

    const stillValid = stat && (expectDir ? stat.isDirectory() : stat.isFile());
    if (!stillValid) {
      clearStatus();
      console.log(`  ${c.yellow('⚠')}  ${c.yellow('Skipped')} (no longer ${expectDir ? 'a directory' : 'a file'}): ${r.original}`);
      skipped++; continue;
    }

    // Stale-state guard: re-verify destination hasn't appeared since planning
    const dest = path.join(r.parent, r.newName);
    const isSamePath = isCaseInsensitiveFS
      ? dest.toLowerCase() === r.filePath.toLowerCase()
      : dest === r.filePath;
    if (fs.existsSync(dest) && !isSamePath) {
      clearStatus();
      console.log(`  ${c.yellow('⚠')}  ${c.yellow('Skipped')} (destination exists): ${r.original} → ${r.newName}`);
      skipped++; continue;
    }

    try {
      fs.renameSync(r.filePath, dest);
      clearStatus();
      console.log(`  ${c.green('✔')}  ${r.original}  →  ${c.green(r.newName)}`);
      completedLog.push(r);
      succeeded++;
    } catch (err) {
      clearStatus();
      console.log(`  ${c.red('✖')}  ${r.original} — ${c.red(err.message)}`);
      failed++;
    }
  }

  return { succeeded, skipped, failed };
}

module.exports = { executeRenames };
