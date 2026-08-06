'use strict';

const { isTTY, ANSI, c } = require('./colors');

// ─────────────────────────────────────────────────────────────────────────────
//  TERMINAL PROGRESS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Overwrite the current terminal line in place (TTY only) */
function writeStatus(line) {
  if (!isTTY) return;
  const cols = process.stdout.columns || 80;
  const trunc = line.length > cols - 1 ? line.slice(0, cols - 4) + '…' : line;
  process.stdout.write(`\r${trunc.padEnd(cols - 1)}`);
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
