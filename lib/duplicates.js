'use strict';

const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
//  DUPLICATE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the planned rename list for cases where two different source files
 * would produce the same destination name in the same directory.
 *
 * Returned warnings are informational only — the resolution-aware conflict
 * resolver (conflict-resolver.js) already assigned distinct names using
 * resolution tags.
 */
function detectDuplicates(allRenames) {
  const destMap = new Map(); // destPath → [rename, ...]

  for (const r of allRenames) {
    const dest = path.join(r.parent, r.newName);
    if (!destMap.has(dest)) destMap.set(dest, []);
    destMap.get(dest).push(r);
  }

  const warnings = [];
  for (const [dest, group] of destMap) {
    if (group.length < 2) continue;
    const sources = group.map(r => r.original).join('  +  ');
    warnings.push(`Destination "${path.basename(dest)}":\n     ${sources}`);
  }
  return warnings;
}

module.exports = { detectDuplicates };
