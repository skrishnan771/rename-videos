'use strict';

const { isTTY, ANSI, c } = require('./colors');

// ─────────────────────────────────────────────────────────────────────────────
//  TERMINAL PROGRESS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Matches a single SGR escape sequence ("\x1b[36m", "\x1b[0m").
const ANSI_RE = /\x1b\[[0-9;]*m/;
const ANSI_RE_G = new RegExp(ANSI_RE.source, 'g');

/** Printable width of a string, ignoring ANSI color escapes. */
function visibleLength(str) {
  return str.replace(ANSI_RE_G, '').length;
}

/**
 * Truncate to `max` *visible* characters while keeping color escapes intact,
 * then reset styling so the cut can't leak color into the rest of the line.
 */
function truncateVisible(str, max) {
  let out = '', visible = 0, i = 0;
  while (i < str.length && visible < max) {
    if (str[i] === '\x1b') {
      const m = ANSI_RE.exec(str.slice(i));
      if (m && m.index === 0) { out += m[0]; i += m[0].length; continue; }
    }
    out += str[i++];
    visible++;
  }
  return out + ANSI.reset;
}

/**
 * Overwrite the current terminal line in place (TTY only).
 *
 * Width is measured on visible characters only: every status line this module
 * emits carries ANSI color codes, and counting those as printable made the
 * line look ~14 chars longer than it renders. That truncated every bar on the
 * wrong boundary — potentially mid-escape-sequence — and defeated the padding
 * that erases the previous, longer line.
 */
function writeStatus(line) {
  if (!isTTY) return;
  const cols = process.stdout.columns || 80;
  const width = cols - 1;
  const out = visibleLength(line) > width ? truncateVisible(line, width - 1) + '…' : line;
  const pad = Math.max(0, width - visibleLength(out));
  process.stdout.write(`\r${out}${' '.repeat(pad)}`);
}

/** Erase the current status line */
function clearStatus() {
  if (!isTTY) return;
  process.stdout.write(`\r${' '.repeat((process.stdout.columns || 80) - 1)}\r`);
}

/**
 * Render a named percentage progress bar on the current terminal line.
 *   [████████░░░░░░░░]   50%  (250 / 500)  planning…
 *
 * @param {number} done   — completed items
 * @param {number} total  — total items
 * @param {string} label  — label shown to the right of the counter
 * @param {string} color  — ANSI color key for the filled bar segment
 */
function progressBar(done, total, label = '', color = 'cyan') {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const cols = process.stdout.columns || 80;
  const suffix = `  ${String(pct).padStart(3)}%  (${done} / ${total})${label ? '  ' + label : ''}`;
  const barMax = Math.max(10, cols - suffix.length - 4);
  const filled = Math.round((pct / 100) * barMax);
  const empty = barMax - filled;

  const filledBar = isTTY && ANSI[color]
    ? `${ANSI[color]}${'█'.repeat(filled)}${ANSI.reset}`
    : '█'.repeat(filled);
  const emptyBar = c.gray('░'.repeat(empty));

  writeStatus(`[${filledBar}${emptyBar}]${suffix}`);
}

/**
 * Caps concurrent async operations — prevents "too many open files" when
 * fanning out readdir calls across huge directory trees.
 */
class Semaphore {
  constructor(max) { this._max = max; this._active = 0; this._queue = []; }

  acquire() {
    return new Promise(resolve => {
      if (this._active < this._max) { this._active++; resolve(); }
      else this._queue.push(resolve);
    });
  }

  release() {
    this._active--;
    if (this._queue.length) { this._active++; this._queue.shift()(); }
  }
}

module.exports = { writeStatus, clearStatus, progressBar, Semaphore };
