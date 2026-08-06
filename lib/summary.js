'use strict';

const { c } = require('./colors');

// ─────────────────────────────────────────────────────────────────────────────
//  SUMMARY PRINTER  (DRY helper used by both main and runUndo)
// ─────────────────────────────────────────────────────────────────────────────

function printSummary({ succeeded, skipped, failed, verb = 'Renamed' }) {
  console.log(`\n${c.gray('────────────────────────────────────────')}`);
  console.log(`  ${c.green('✔')} ${verb}:  ${c.bold(c.green(succeeded))}`);
  if (skipped > 0) console.log(`  ${c.yellow('⚠')} Skipped:  ${c.bold(c.yellow(skipped))}`);
  if (failed > 0) console.log(`  ${c.red('✖')} Failed:   ${c.bold(c.red(failed))}`);
  console.log(c.gray('────────────────────────────────────────'));
}

module.exports = { printSummary };
