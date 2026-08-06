'use strict';

const { SMALL_WORDS, RELEASE_GROUP_RE, RESOLUTION_RE } = require('./constants');

// ─────────────────────────────────────────────────────────────────────────────
//  TEXT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Title-case a string.
 *   • Preserves content inside parentheses exactly as-is — non-English words
 *     like (Magadheera) have unknown correct casing.
 *   • Preserves all-caps acronyms: KGF, NF, DV …
 *   • Capitalises each segment of hyphenated words: Rising-Origin
 *   • Lowercases small words mid-title: of, the, and …
 */
function titleCase(str) {
  return str.replace(/(\([^)]*\))|([^(]+)/g, (_, paren, text) => {
    if (paren) return paren; // leave (Magadheera) untouched
    return text.split(' ').map((word, i) => {
      if (!word) return word;
      if (/^[A-Z]{2,}$/.test(word)) return word; // all-caps acronym
      if (i !== 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.split('-')
        .map(seg => seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg)
        .join('-');
    }).join(' ');
  });
}

/**
 * Returns true when dots outnumber spaces — dot-separated scene filename
 * like "Breaking.Bad.S05E14.mkv"
 */
function isDotSeparated(str) {
  return (str.match(/\w\.\w/g) || []).length > (str.match(/ /g) || []).length;
}

/**
 * Expand dot separators to spaces while protecting real decimal dots
 * in version numbers and audio formats (5.1, H.264, 7.1).
 */
function expandDots(str) {
  return str
    .replace(/(\d)\.(\d)/g, '$1\x00$2') // temporarily shield digit.digit
    .replace(/\./g, ' ')
    .replace(/\x00/g, '.');
}

/** Returns the index of the first match of re in str, or str.length if none. */
function firstMatchIndex(str, re) {
  const m = str.match(re);
  return (m && m.index >= 0) ? m.index : str.length;
}

/**
 * Strip a trailing all-caps release group suffix, e.g. "-VARYG", "-PSA".
 * Does NOT strip mixed-case words like "-Origin" or "-Bastards".
 */
function stripReleaseGroup(str) {
  const m = str.match(RELEASE_GROUP_RE);
  if (!m) return str;
  return /^[A-Z][A-Z0-9]*$/.test(m[1]) ? str.slice(0, m.index).trim() : str;
}

/**
 * Extract a resolution token from a raw filename for duplicate labelling.
 * Returns a bracketed string like "[1080p]", or "" if none found.
 *   "Movie.1080p.BluRay.mkv" → "[1080p]"
 *   "Movie.4K.HDR.mkv"       → "[4K]"
 *   "Movie.mkv"              → ""
 */
function extractResolutionTag(rawName) {
  const m = rawName.match(RESOLUTION_RE);
  return m ? `[${m[1].toLowerCase()}]` : '';
}

module.exports = {
  titleCase,
  isDotSeparated,
  expandDots,
  firstMatchIndex,
  stripReleaseGroup,
  extractResolutionTag,
};
