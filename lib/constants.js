'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv',
  '.flv', '.webm', '.m4v', '.ts', '.m2ts', '.mpg', '.mpeg',
]);

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt', '.idx']);

// Max concurrent readdir calls — prevents "too many open files" on huge trees
const SCAN_CONCURRENCY = 64;

// Undo log filename — stored inside the scanned directory so it always travels
// with the files it describes, even when --path points somewhere else
const LOG_FILENAME = 'rename-log.json';

// ─────────────────────────────────────────────────────────────────────────────
//  NAME-CLEANING WORD LISTS
// ─────────────────────────────────────────────────────────────────────────────

// Words that signal "everything from here onward is technical junk".
// Deliberately excludes tokens that double as ordinary English words in real
// titles (REAL, DC, TRUE, DUAL, FULL, …) — those live in STOP_WORDS_STRICT
// below so they only trigger on an exact-case scene-tag match.
const STOP_WORDS = [
  // Source / encode type
  'REMUX', 'BDREMUX', 'BD', 'BLURAY', 'BLU-RAY', 'BDRIP',
  'WEBRIP', 'WEB-RIP', 'WEB-DL', 'WEBDL', 'HDTV', 'HDRIP',
  'DVDRIP', 'DVDSCR', 'R5', 'DVDR', 'PDTV',
  // Release flags
  'PROPER', 'REPACK', 'READNFO', 'EXTENDED',
  'THEATRICAL', 'UNRATED', 'DIRECTORS',
  'UNTOUCHED',
  // Resolution (used as stop word in title, extracted separately for dup handling)
  '4K', 'UHD', '2160P', '1080P', '1080I', '720P', '576P', '480P',
  // HDR / color
  'SDR', 'HDR', 'HDR10', 'DV', 'DOLBYVISION',
  // Video codec
  'HEVC', 'AVC', 'AV1', 'X265', 'X264', 'H265', 'H264', 'XVID', 'DIVX',
  // Audio codec
  'AAC', 'DD5', 'DD2', 'EAC3', 'DTS', 'TRUEHD', 'ATMOS', 'AC3', 'FLAC', 'MP3', 'OPUS',
  // Language / subtitle flags
  'MULTI', 'DUBBED', 'SUBBED', 'ESUB', 'ENGSUB',
  'HARDSUB', 'SOFTSUB',
  // Streaming service tags
  'CR', 'NF', 'AMZN', 'DSNP', 'HMAX', 'ATVP', 'PCOK', 'PMTP',
  // Folder-specific junk
  'SEASON',
];

// Stop words that are also plain English words a real title might contain
// ("Dual", "True Detective", "Full Metal Jacket", "A Complete Unknown", a show
// called "DC's Legends of Tomorrow"). Scene releases conventionally write
// these tags fully uppercase, so — unlike STOP_WORDS above — they are matched
// case-SENSITIVELY (see STOP_RE_STRICT) and never against normal Title Case
// text. Trade-off: a rare tag written in mixed case (e.g. "iNTERNAL") won't be
// stripped; that's preferable to corrupting a real title that happens to
// contain one of these words.
const STOP_WORDS_STRICT = [
  'REAL', 'DC', 'RETAIL', 'INTERNAL', 'IMAX', 'TRUE', 'HC',
  'FORCED', 'DUAL', 'COMPLETE', 'FULL', 'PACK', 'COLLECTION', 'SERIES',
];

// Language tags that mark where the title ends
const LANG_WORDS = [
  'ENGLISH', 'HINDI', 'TAMIL', 'TELUGU', 'MALAYALAM', 'KANNADA',
  'BENGALI', 'MARATHI', 'PUNJABI', 'GUJARATI',
  'JAPANESE', 'KOREAN', 'CHINESE', 'FRENCH', 'GERMAN',
  'SPANISH', 'ITALIAN', 'PORTUGUESE', 'RUSSIAN', 'ARABIC',
  'ENG', 'HIN', 'TAM', 'TEL', 'MAL', 'KAN', 'JPN', 'KOR',
  'SWESUB', 'ENGSUB',
];

// Two-letter country/language codes overlap heavily with ordinary English
// words and abbreviations ("It", "Ar", "Es", "De" as name fragments, etc).
// Same exact-case-only rule as STOP_WORDS_STRICT, for the same reason — e.g.
// "The Mentalist S01E13 Paint It Red.mkv" must not truncate at "It".
const LANG_WORDS_STRICT = ['PT', 'BR', 'ZH', 'CN', 'ES', 'FR', 'DE', 'IT', 'RU', 'AR'];

// Articles / prepositions that stay lowercase mid-title
const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor',
  'on', 'at', 'to', 'by', 'in', 'of', 'up', 'as', 'vs', 'via',
]);

// ─────────────────────────────────────────────────────────────────────────────
//  PRE-COMPILED REGEXES
// ─────────────────────────────────────────────────────────────────────────────

// Stop word surrounded by non-word separators
const STOP_RE = new RegExp(
  `(?:^|[\\s._\\-\\(\\[])(?:${STOP_WORDS.join('|')})(?:[\\s._\\-\\)\\]\\d]|$)`, 'i'
);

// Same shape as STOP_RE but case-SENSITIVE (no 'i' flag) — only matches an
// exact-uppercase scene tag, never a normal-case word inside a real title.
const STOP_RE_STRICT = new RegExp(
  `(?:^|[\\s._\\-\\(\\[])(?:${STOP_WORDS_STRICT.join('|')})(?:[\\s._\\-\\)\\]\\d]|$)`
);

// Language tag surrounded by non-word separators
const LANG_RE = new RegExp(
  `(?:^|[\\s._\\-])(?:${LANG_WORDS.join('|')})(?:[\\s._\\-]|$)`, 'i'
);

// Case-sensitive counterpart of LANG_RE for the two-letter codes — see
// LANG_WORDS_STRICT above.
const LANG_RE_STRICT = new RegExp(
  `(?:^|[\\s._\\-])(?:${LANG_WORDS_STRICT.join('|')})(?:[\\s._\\-]|$)`
);

// All-caps release group at end: "-VARYG", "-PSA"
// Only stripped when fully uppercase — not mixed-case words like "-Origin"
const RELEASE_GROUP_RE = /\s*[-–]\s*([A-Z][A-Z0-9]{1,14})\s*$/;

// Trailing scene folder release tag: " .AG]"  ".MX]"  ".WORLD]"
const FOLDER_TAG_RE = /\s*\.[A-Z]{1,5}\]?\s*$/i;

// Size / bitrate markers: "640Kbps", "15GB", "3.3GB"
const SIZE_TAG_RE = /\b\d+\.?\d*\s*(?:Kbps|Mbps|GB|MB|TB)\b/gi;

// Resolution token for duplicate-aware conflict resolver
// Extracts: 2160p → "2160p", 1080p → "1080p", 720p → "720p", 4K/UHD → "4K"
const RESOLUTION_RE = /\b(2160[pi]|1080[pi]|720[pi]|576[pi]|480[pi]|4K|UHD)\b/i;

// Detect case-insensitive filesystem (Windows, macOS) vs case-sensitive (Linux)
const isCaseInsensitiveFS = process.platform === 'win32' || process.platform === 'darwin';

module.exports = {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  SCAN_CONCURRENCY,
  LOG_FILENAME,
  STOP_WORDS,
  STOP_WORDS_STRICT,
  LANG_WORDS,
  LANG_WORDS_STRICT,
  SMALL_WORDS,
  STOP_RE,
  STOP_RE_STRICT,
  LANG_RE,
  LANG_RE_STRICT,
  RELEASE_GROUP_RE,
  FOLDER_TAG_RE,
  SIZE_TAG_RE,
  RESOLUTION_RE,
  isCaseInsensitiveFS,
};
