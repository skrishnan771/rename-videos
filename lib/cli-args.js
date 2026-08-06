'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  ARGUMENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse CLI arguments.  Supported forms:
 *   --path="./videos"  |  --path ./videos  |  ./videos  (bare positional)
 *   --force            skip Y/N confirmation
 *   --undo             reverse last run (reads log from --path directory)
 *   --help             print usage and exit
 *
 * @param {string[]} argv — defaults to process.argv.slice(2)
 */
function parseArgs(argv = process.argv.slice(2)) {
  let argPath = null;
  let force = false;
  let undo = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (/^--force$/i.test(arg)) { force = true; continue; }
    if (/^--undo$/i.test(arg)) { undo = true; continue; }
    if (/^--help$/i.test(arg)) { help = true; continue; }

    // --path="value"  or  --path=value  (handles quoted and unquoted)
    const eqMatch = arg.match(/^--path=(.+)$/i);
    if (eqMatch) {
      argPath = eqMatch[1].replace(/^["']|["']$/g, '');
      continue;
    }

    // --path value  (next token, but not if it starts with --)
    if (/^--path$/i.test(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      argPath = argv[++i].replace(/^["']|["']$/g, '');
      continue;
    }

    // Bare positional (no leading --)
    if (!arg.startsWith('--')) argPath = arg;
  }

  return { argPath, force, undo, help };
}

module.exports = { parseArgs };
