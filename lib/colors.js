'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  COLOR  (zero-dependency ANSI color helper — no chalk required)
//  Automatically disabled when stdout is not a TTY (e.g. piped to a file)
// ─────────────────────────────────────────────────────────────────────────────

const isTTY = !!process.stdout.isTTY;

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgGreen: '\x1b[42m',
};

/**
 * Wrap text in an ANSI code only when running in a real TTY.
 * Falls back to plain text when piped / redirected.
 */
const c = new Proxy({}, {
  get: (_, color) => (text) =>
    isTTY && ANSI[color] ? `${ANSI[color]}${text}${ANSI.reset}` : String(text),
});

module.exports = { isTTY, ANSI, c };
