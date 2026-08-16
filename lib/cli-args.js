'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  ARGUMENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse CLI arguments.  Supported forms:
 *   --path="./videos"  |  --path ./videos  |  ./videos  (bare positional)
 *   --force            skip Y/N confirmation
 *   --undo             reverse last run (reads log from --path directory)
 *   --help  | -h       print usage and exit
 *
 * Anything else that looks like a flag is returned in `unknown` rather than
 * ignored. Silently dropping an unrecognised flag meant a typo ("--forse")
 * degraded into a full rename run against the current working directory, and
 * "-h" was parsed as a *path*, producing a baffling "Path not found: …\-h".
 *
 * @param {string[]} argv — defaults to process.argv.slice(2)
 * @returns {{argPath, force, undo, help, unknown: string[]}}
 */
function parseArgs(argv = process.argv.slice(2)) {
  let argPath = null;
  let force = false;
  let undo = false;
  let help = false;
  const unknown = [];

  // A bare "help" verb is accepted alongside --help/-h; every other bare token
  // is a path, so this must stay an exact match.
  const isHelp = (a) => /^(?:--help|-h|-\?|help)$/i.test(a);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (/^--force$/i.test(arg)) { force = true; continue; }
    if (/^--undo$/i.test(arg)) { undo = true; continue; }
    if (isHelp(arg)) { help = true; continue; }

    // --path="value"  or  --path=value  (handles quoted and unquoted)
    const eqMatch = arg.match(/^--path=(.+)$/i);
    if (eqMatch) {
      argPath = eqMatch[1].replace(/^["']|["']$/g, '');
      continue;
    }

    // --path value  (next token, but not if it is itself a flag)
    if (/^--path$/i.test(arg) && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      argPath = argv[++i].replace(/^["']|["']$/g, '');
      continue;
    }

    // Any other dash-prefixed token is a mistake, not a path
    if (arg.startsWith('-')) { unknown.push(arg); continue; }

    argPath = arg; // bare positional
  }

  return { argPath, force, undo, help, unknown };
}

module.exports = { parseArgs };
