#!/usr/bin/env node

// ============================================================
//  Intelligent Video File & Folder Renamer  v7
//
//  Features:
//    • Smart name cleaning  (scene, streaming, anime, Indian)
//    • Subtitle pairing     (.srt/.ass/.sub follow their video)
//    • Anime specials       (SP01, OVA, Special recognised)
//    • Duplicate detection  (name + file-size based; preserves
//                            resolution when conflicts occur)
//    • Undo                 (--undo reverses last run; log saved
//                            in the scanned directory)
//    • Force mode           (--force skips the Y/N prompt)
//    • Progress bars        (spinner → scan, bars → plan + rename)
//    • Colored output       (zero dependencies, pure ANSI)
//    • Atomic safety        (plan everything; abort on any error)
//    • Stale-file guards    (re-check existence before each rename)
//    • Camera file skip     (VID_, IMG_, timestamps left untouched)
//    • Folder guard         (only rename dirs that contain videos)
//
//  Usage:
//    node rename-videos.js [--path="./videos"] [--force] [--undo] [--help]
// ============================================================

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { performance } = require('perf_hooks');

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
//  HELP TEXT
// ─────────────────────────────────────────────────────────────────────────────

function printHelp() {
  const B = (s) => c.bold(s);
  const G = (s) => c.cyan(s);
  const D = (s) => c.gray(s);

  console.log(`
${c.bold(c.cyan('Intelligent Video File & Folder Renamer'))}  ${c.gray('v7')}

${B('USAGE')}
  node rename-videos.js [options]

${B('OPTIONS')}
  ${G('--path="<dir>"')}    Directory to scan. Defaults to current working directory.
                   Accepts:  --path="./movies"  |  --path ./movies  |  ./movies

  ${G('--force')}           Skip the Y/N confirmation prompt and rename immediately.
                   ${D('Useful for scripting or automated pipelines.')}

  ${G('--undo')}            Reverse the most recent rename run.
                   Reads the .rename-log.json from the scanned directory.
                   Combines with --path to undo a run in a specific folder.
                   ${D('The log is deleted after a successful undo.')}

  ${G('--help')}            Show this help text and exit.

${B('WHAT GETS RENAMED')}
  ${c.green('✔')} Video files       .mkv .mp4 .avi .mov .wmv .flv .webm .m4v .ts .mpg …
  ${c.green('✔')} Subtitle files    .srt .ass .ssa .sub .vtt .idx  (paired to their video)
  ${c.green('✔')} Folders           Only those containing at least one video file

  ${c.yellow('⚠')} Camera files are ${B('never')} renamed:
      VID_20190624_191055.mp4   IMG_20210101.jpg   20190624_191055.mp4

${B('SKIPPED DIRECTORIES')}
  The scanner automatically prunes subtrees that are clearly not media:

  By exact name:  node_modules  .git  .venv  venv  __pycache__  target
                  .gradle  dist  coverage  .cache  .next  .bundle  vendor …

  By marker file: if a directory contains package.json, Cargo.toml, go.mod,
                  requirements.txt, pyproject.toml, Gemfile, pom.xml, etc.
                  the entire subtree is skipped (catches project roots with
                  non-standard names like "media-server" or "my-project").

  Skipped directories are reported after the scan summary.
  ${D('The root --path directory itself is never auto-skipped.')}

${B('NAME CLEANING')}
  Scene filenames:   Breaking.Bad.S05E14.Ozymandias.1080p.BluRay.x265-PSA.mkv
                  →  Breaking Bad S05 E14 - Ozymandias.mkv

  Movies with year:  The.Dark.Knight.2008.1080p.BluRay.x264-SPARKS.mkv
                  →  The Dark Knight (2008).mkv

  Bracket prefixes:  [Squid Game 2 - 640Kbps) - 15GB - ESub] Squid Game S02E05 Friend or Foe.mkv
                  →  Squid Game S02 E05 - Friend or Foe.mkv

  Anime episodes:    Demon.Slayer.EP26.1080p.CR.WEB-DL.mkv
                  →  Demon Slayer E26.mkv

  Anime specials:    Attack.on.Titan.SP02.1080p.mkv       → Attack on Titan SP02.mkv
                     Fullmetal.Alchemist.OVA.1080p.mkv    → Fullmetal Alchemist OVA.mkv
                     Sword.Art.Online.Special.1080p.mkv   → Sword Art Online Special.mkv

  Season packs:      Chernobyl Season 1 Complete 720p WEB-DL x264 [i_c]
                  →  Chernobyl S01

  Site-prefixed:     www.TamilRockers.ws - Pushpa The Rise (2021) 720p WEB-DL HIN-TAM x264.mkv
                  →  Pushpa the Rise (2021).mkv

${B('SUBTITLE PAIRING')}
  Subtitles in the same directory as their video are renamed to match:
    Breaking.Bad.S05E14.en.srt  →  Breaking Bad S05 E14 - Ozymandias.en.srt
    Breaking.Bad.S05E14.srt     →  Breaking Bad S05 E14 - Ozymandias.srt
  Language codes (.en, .fr, .en.forced, .en.sdh) are preserved.

${B('DUPLICATE HANDLING')}
  When two files would rename to the same destination, the resolution tag
  is extracted from the original filename and appended instead of "(2)":
    Movie.1080p.mkv  +  Movie.720p.mkv  →  both become "Movie (2010).mkv"
    Resolved as:  Movie (2010) [1080p].mkv  +  Movie (2010) [720p].mkv

${B('UNDO')}
  After every run, a ${G('.rename-log.json')} is saved inside the scanned directory.
  Run with ${G('--undo')} (and optionally ${G('--path')}) to reverse every rename.
  The log is automatically deleted after a successful undo.

${B('EXAMPLES')}
  node rename-videos.js
  node rename-videos.js --path="/mnt/media/movies"
  node rename-videos.js --path="./shows" --force
  node rename-videos.js --path="./shows" --undo
`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA / TIMESTAMP DETECTION
//  Files auto-generated by phones/cameras must never be renamed.
//    VID_20190624_191055, IMG_20210101_120000, DCIM_001, DSC_0001,
//    20190624_191055, 2019-06-24_19-10-55
// ─────────────────────────────────────────────────────────────────────────────

const CAMERA_PREFIX_RE = /^(?:VID|IMG|DCIM|DSC|PIC|MOV|MVI|P|GOPR|GX|DJI)_\d{4,}/i;
const TIMESTAMP_PREFIX_RE = /^\d{8}[_-]\d{6}/;

function isCameraFile(filename) {
  // Strip leading bracket content like "[Drive\Google Photos] VID_..."
  // before testing so prefixed camera files are also caught
  let base = path.basename(filename, path.extname(filename));
  base = base.replace(/^\[[^\]]*\]\s*/, '').trim();
  return CAMERA_PREFIX_RE.test(base) || TIMESTAMP_PREFIX_RE.test(base);
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAME-CLEANING WORD LISTS
// ─────────────────────────────────────────────────────────────────────────────

// Words that signal "everything from here onward is technical junk"
const STOP_WORDS = [
  // Source / encode type
  'REMUX', 'BDREMUX', 'BD', 'BLURAY', 'BLU-RAY', 'BDRIP',
  'WEBRIP', 'WEB-RIP', 'WEB-DL', 'WEBDL', 'HDTV', 'HDRIP',
  'DVDRIP', 'DVDSCR', 'R5', 'DVDR', 'PDTV',
  // Release flags
  'PROPER', 'REPACK', 'REAL', 'READNFO', 'EXTENDED',
  'THEATRICAL', 'UNRATED', 'DIRECTORS', 'DC',
  'UNTOUCHED', 'RETAIL', 'INTERNAL', 'IMAX',
  // Resolution (used as stop word in title, extracted separately for dup handling)
  '4K', 'UHD', '2160P', '1080P', '1080I', '720P', '576P', '480P',
  // HDR / color
  'SDR', 'HDR', 'HDR10', 'DV', 'DOLBYVISION',
  // Video codec
  'HEVC', 'AVC', 'AV1', 'X265', 'X264', 'H265', 'H264', 'XVID', 'DIVX',
  // Audio codec
  'AAC', 'DD5', 'DD2', 'EAC3', 'DTS', 'TRUEHD', 'ATMOS', 'AC3', 'FLAC', 'MP3', 'OPUS',
  // Language / subtitle flags
  'DUAL', 'MULTI', 'DUBBED', 'SUBBED', 'ESUB', 'ENGSUB', 'TRUE',
  // Streaming service tags
  'CR', 'NF', 'AMZN', 'DSNP', 'HMAX', 'ATVP', 'PCOK', 'PMTP',
  // Folder-specific junk
  'COMPLETE', 'FULL', 'PACK', 'COLLECTION', 'SERIES', 'SEASON',
];

// Language tags that mark where the title ends
const LANG_WORDS = [
  'ENGLISH', 'HINDI', 'TAMIL', 'TELUGU', 'MALAYALAM', 'KANNADA',
  'BENGALI', 'MARATHI', 'PUNJABI', 'GUJARATI',
  'JAPANESE', 'KOREAN', 'CHINESE', 'FRENCH', 'GERMAN',
  'SPANISH', 'ITALIAN', 'PORTUGUESE', 'RUSSIAN', 'ARABIC',
  'ENG', 'HIN', 'TAM', 'TEL', 'MAL', 'KAN', 'JPN', 'KOR',
];

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

// Language tag surrounded by non-word separators
const LANG_RE = new RegExp(
  `(?:^|[\\s._\\-])(?:${LANG_WORDS.join('|')})(?:[\\s._\\-]|$)`, 'i'
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

// ─────────────────────────────────────────────────────────────────────────────
//  NAME PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a raw filename into structured components:
 * {
 *   title, year, season, episode, episodeEnd, episodeTitle,
 *   specialType,   ← 'SP', 'OVA', 'Special', or null
 *   specialNum,    ← numeric part for SP01 (or null)
 *   ext, useSEPStyle
 * }
 *
 * useSEPStyle — true when season found via "S01 EP01-07" or "Season N"
 *               (not SxxExx), preserving that folder display style
 */
function parseFilename(raw) {
  const ext = path.extname(raw);
  let base = path.basename(raw, ext);

  // ── Step 1: Strip site prefixes ───────────────────────────────────────────
  // "www.site.tld   -   Title" with any amount of surrounding whitespace
  base = base.replace(/^www\.[^\s]+\s*[-–]\s*/i, '');

  // ── Step 2: Normalise word separators ─────────────────────────────────────
  if (isDotSeparated(base)) {
    // Scene-style: "Breaking.Bad.S05E14" → "Breaking Bad S05E14"
    base = expandDots(base);
  } else {
    // Dash-only: "Game-of-Thrones-S06E09-..." with no spaces
    const dashes = (base.match(/-/g) || []).length;
    const spaces = (base.match(/ /g) || []).length;
    if (dashes > 3 && spaces < 2) {
      base = base
        .replace(/(S\d{1,2}E\d{1,3})-?(E\d{1,3})/gi, '$1\x01$2') // protect SxxExx-Exx range
        .replace(/((?:19|20)\d{2})/g, '\x02$1\x02')                // protect years
        .replace(/-/g, ' ')
        .replace(/\x01/g, '-')
        .replace(/\x02/g, '');
    }
  }

  // ── Step 3: Strip square-bracket content entirely ─────────────────────────
  // "[Squid Game 2 - ESub]" prefix, "[i_c]" suffix
  base = base.replace(/\[[^\]]*\]/g, ' ');

  // ── Step 4: Strip technical parentheses, preserve year / alternate titles ─
  // Remove: (DTS 5.1), (AAC 2.0), (H.264), (2 0) — keep (2023), (Magadheera)
  base = base.replace(
    /\(\s*(?:DD|DTS|ATMOS|AC3|AAC|TRUE|HEVC|AVC|H\.?\d{3}|\d+\.\d+|\d+\s*Kbps)[^)]*\)/gi, ' '
  );
  base = base.replace(/\(\s*\d+\s+\d+\s*\)/g, ' '); // "(2 0)" digit-space-digit
  base = base.replace(/\(\s*\(/g, '(');               // collapse orphaned "((" → "("

  // ── Step 5: Remove size / bitrate markers ─────────────────────────────────
  // "640Kbps", "15GB" — then clean up orphaned ) ] left behind
  base = base.replace(SIZE_TAG_RE, '');
  base = base.replace(/(?<!\w)[)\]]/g, '');    // stray closing brackets
  base = base.replace(/\s*-\s*-\s*/g, ' - '); // collapse double-dashes

  // ── Step 6: Strip trailing scene folder release tags ──────────────────────
  // ".AG]", ".MX]", ".WORLD]" — common on torrent folder names
  base = base.replace(FOLDER_TAG_RE, '');

  // ── Step 7: Extract year (1900–2099) ──────────────────────────────────────
  let year = null;
  const yearMatch = base.match(/\b((?:19|20)\d{2})\b/);
  if (yearMatch) year = yearMatch[1];

  // ── Step 8: Detect anime specials BEFORE episode matching ─────────────────
  // Patterns: SP01 | OVA | Special (must appear before SxxExx so they aren't
  // swallowed by the episode regex in priority-1 below)
  //
  //   Attack.on.Titan.SP02.1080p.mkv   → specialType="SP", specialNum=2
  //   Fullmetal.Alchemist.OVA.1080p     → specialType="OVA", specialNum=null
  //   Sword.Art.Online.Special.1080p    → specialType="Special", specialNum=null
  let specialType = null;
  let specialNum = null;
  let specialMatch = null;

  const spMatch = base.match(/\bSP(\d{1,2})\b/i);
  if (spMatch) {
    specialType = 'SP';
    specialNum = parseInt(spMatch[1], 10);
    specialMatch = spMatch;
  }

  if (!specialMatch) {
    const ovaMatch = base.match(/\bOVA\b/i);
    if (ovaMatch) { specialType = 'OVA'; specialMatch = ovaMatch; }
  }

  if (!specialMatch) {
    const spcMatch = base.match(/\bSpecial\b/i);
    if (spcMatch) { specialType = 'Special'; specialMatch = spcMatch; }
  }

  // ── Step 9: Extract season / episode — five patterns in priority order ────
  const SE_RE = /\bS(\d{1,2})[ ._]?E(\d{1,3})(?:[ ._-]?E(\d{1,3}))?\b/i;
  let season = null, episode = null, episodeEnd = null, seMatch = null;

  // Priority 1 — Standard "S02E05" or "S02E01-E04" (most common)
  const standardSE = base.match(SE_RE);
  if (standardSE) {
    seMatch = standardSE;
    season = parseInt(standardSE[1], 10);
    episode = parseInt(standardSE[2], 10);
    if (standardSE[3]) episodeEnd = parseInt(standardSE[3], 10);
  }

  // Priority 2 — Long-form "Season 1 Episode 5"
  if (!seMatch) {
    const longForm = base.match(/\bSeason\s+(\d{1,2})\s+Episode\s+(\d{1,3})\b/i);
    if (longForm) {
      season = parseInt(longForm[1], 10);
      episode = parseInt(longForm[2], 10);
    }
  }

  // Priority 3 — Season-only "Season 1 Complete" (folder packs)
  if (!seMatch) {
    const seasonOnly = base.match(/\bSeason\s+(\d{1,2})\b/i);
    if (seasonOnly) season = parseInt(seasonOnly[1], 10);
  }

  // Priority 4 — Folder-style "S01 EP01-07" (season + separate EP range)
  if (!seMatch && season === null) {
    const sepStyle = base.match(/\bS(\d{1,2})\s+EP?(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/i);
    if (sepStyle) {
      season = parseInt(sepStyle[1], 10);
      episode = parseInt(sepStyle[2], 10);
      if (sepStyle[3]) episodeEnd = parseInt(sepStyle[3], 10);
    }
  }

  // Priority 5 — Standalone "EP26" or "E26" (anime, OVA — no season)
  // Only run when no special type was detected to avoid double-matching
  if (season === null && episode === null && !specialMatch) {
    const standalone = base.match(/\b(?:EP?|Episode)[ ._]?(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/i);
    if (standalone) {
      episode = parseInt(standalone[1], 10);
      if (standalone[2]) episodeEnd = parseInt(standalone[2], 10);
    }
  }

  // ── Step 10: Extract episode title ────────────────────────────────────────
  // Text between SxxExx and the first tech/language stop tag
  // e.g. "S02E05 One More Game WEBRip" → episodeTitle = "One More Game"
  let episodeTitle = null;
  if (seMatch) {
    let afterSE = base.slice(seMatch.index + seMatch[0].length);
    const cutAt = Math.min(
      firstMatchIndex(afterSE, STOP_RE),
      firstMatchIndex(afterSE, LANG_RE)
    );
    afterSE = stripReleaseGroup(afterSE.slice(0, cutAt));
    afterSE = afterSE.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/^[-\s]+|[-\s]+$/g, '');
    if (afterSE.length > 1) episodeTitle = titleCase(afterSE);
  }

  // ── Step 11: Extract title ────────────────────────────────────────────────
  // Everything before the first of: SxxExx / Special / Season / EP / year / stop word
  let title = base;

  if (seMatch) title = title.slice(0, seMatch.index);
  if (specialMatch) title = title.slice(0, specialMatch.index); // cut before SP/OVA/Special
  title = title.replace(/\bSeason\s+\d.*/i, '');
  title = title.replace(/\b(?:EP?|Episode)[ ._]?\d.*/i, '');

  // Cut before the year (stored separately)
  if (year) {
    const yi = title.indexOf(year);
    if (yi > 0) title = title.slice(0, yi);
  }

  // Cut at first stop word or language tag
  const stopCut = Math.min(
    firstMatchIndex(title, STOP_RE),
    firstMatchIndex(title, LANG_RE)
  );
  if (stopCut < title.length) title = title.slice(0, stopCut);

  // Final tidy
  title = stripReleaseGroup(title);
  title = title.replace(FOLDER_TAG_RE, '');
  title = title.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[-\s.]+|[-\s.]+$/g, '')
    .replace(/\s*\($/, '').trim(); // remove trailing orphaned "("
  title = titleCase(title);

  // useSEPStyle: true when season came from "S01 EP…" or "Season N" (not SxxExx)
  const useSEPStyle = season !== null && !seMatch;

  return {
    title, year, season, episode, episodeEnd, episodeTitle,
    specialType, specialNum, ext, useSEPStyle
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  NAME FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble parsed components back into a clean filename string.
 *
 * Output examples:
 *   "Breaking Bad S05 E14 - Ozymandias.mkv"
 *   "The Dark Knight (2008).mkv"
 *   "Attack on Titan SP02.mkv"                 ← anime special
 *   "Fullmetal Alchemist OVA.mkv"              ← OVA
 *   "Sword Art Online Special.mkv"             ← Special
 *   "Kuttram Purindhavan (2025) S01 EP01-07"   ← useSEPStyle folder
 *   "Chernobyl S01"                            ← season-only folder
 *   "Demon Slayer E26.mkv"                     ← standalone episode
 */
function formatFilename({ title, year, season, episode, episodeEnd, episodeTitle,
  specialType, specialNum, ext, useSEPStyle }) {
  if (!title) return null;

  let out = title;
  if (year) out += ` (${year})`;

  // ── Anime specials take priority over regular episode numbering ────────────
  if (specialType) {
    if (specialType === 'SP' && specialNum !== null) {
      out += ` SP${String(specialNum).padStart(2, '0')}`;
    } else {
      // OVA / Special — no number
      out += ` ${specialType}`;
    }

  } else if (season !== null && episode !== null) {
    const s = String(season).padStart(2, '0');
    const e = String(episode).padStart(2, '0');

    if (useSEPStyle) {
      // Folder range style: "S01 EP01-07"
      out += episodeEnd !== null
        ? ` S${s} EP${e}-${String(episodeEnd).padStart(2, '0')}`
        : ` S${s} EP${e}`;
    } else {
      // Standard style: "S02 E05" (space between S and E for readability)
      out += episodeEnd !== null
        ? ` S${s} E${e}-E${String(episodeEnd).padStart(2, '0')}`
        : ` S${s} E${e}`;
    }
    if (episodeTitle) out += ` - ${episodeTitle}`;

  } else if (season !== null) {
    // Season-only (e.g. "Chernobyl Season 1 Complete" folder)
    out += ` S${String(season).padStart(2, '0')}`;

  } else if (episode !== null) {
    // Standalone episode (anime, OVA without SP tag)
    out += episodeEnd !== null
      ? ` E${String(episode).padStart(2, '0')}-E${String(episodeEnd).padStart(2, '0')}`
      : ` E${String(episode).padStart(2, '0')}`;
    if (episodeTitle) out += ` - ${episodeTitle}`;
  }

  return out + ext;
}

/**
 * Public entry point — returns the cleaned name, or the original if nothing
 * changed or parsing fails.  Never throws.
 */
function cleanName(name, isFolder = false) {
  try {
    if (isFolder) {
      // Folders have no extension — append a dummy one so parseFilename's
      // ext-stripping logic works normally, then discard it afterward
      const parsed = parseFilename(name + '.__tmp__');
      parsed.ext = '';
      const out = formatFilename(parsed);
      return (out && out.length > 0) ? out : name;
    }
    const parsed = parseFilename(name);
    const result = formatFilename(parsed);
    if (!result || result === parsed.ext) return name;
    return result;
  } catch {
    // Parsing failure — leave file untouched rather than corrupting it
    return name;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SUBTITLE PAIRING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find subtitle files in the same directory that belong to a given video rename,
 * and build rename records for them.
 *
 * Matching: subtitle basename (minus language suffix) must equal the video's
 * original basename exactly.
 *
 *   "Breaking.Bad.S05E14.srt"        → matches "Breaking.Bad.S05E14.mkv"
 *   "Breaking.Bad.S05E14.en.srt"     → also matches (strips ".en")
 *   "Breaking.Bad.S05E14.en.forced.srt" → also matches (strips ".en.forced")
 *
 * Language codes (.en, .fr, .en.forced, .en.sdh) are preserved in the output.
 */
function buildSubtitleRenames(videoRename, subtitleFiles, reservedPaths) {
  const videoBase = path.basename(videoRename.original, path.extname(videoRename.original));
  const newVideoBase = path.basename(videoRename.newName, path.extname(videoRename.newName));
  const results = [];

  for (const subPath of subtitleFiles) {
    const subDir = path.dirname(subPath);

    // Only pair subtitles in the same directory as the video
    if (subDir !== videoRename.parent) continue;

    const subExt = path.extname(subPath);
    const subFilename = path.basename(subPath);
    const subBaseFull = path.basename(subPath, subExt);

    // Strip optional language / flag suffix:
    //   "Movie.en"         → "Movie"
    //   "Movie.fr.forced"  → "Movie"
    //   "Movie.en.sdh"     → "Movie"
    const subBase = subBaseFull.replace(/\.[a-z]{2,3}(\.(forced|sdh|hi))?$/i, '');

    if (subBase !== videoBase) continue; // belongs to a different video

    const langSuffix = subBaseFull.slice(subBase.length); // e.g. ".en" or ".en.forced"
    const newSubName = newVideoBase + langSuffix + subExt;

    if (newSubName === subFilename) continue; // already clean

    const finalName = resolveConflict(subDir, newSubName, false, reservedPaths, '', subPath);
    reservedPaths.add(path.join(subDir, finalName));

    results.push({ filePath: subPath, original: subFilename, newName: finalName, parent: subDir });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DUPLICATE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the planned rename list for cases where two different source files
 * would produce the same destination name in the same directory.
 *
 * Returned warnings are informational only — the resolution-aware conflict
 * resolver (below) already assigned distinct names using resolution tags.
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

// ─────────────────────────────────────────────────────────────────────────────
//  CONFLICT RESOLVER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find a final name that doesn't collide with anything on disk OR with any
 * path already reserved by an earlier planned rename.
 *
 * Strategy for files:
 *   1. Try the clean name as-is.
 *   2. If that's taken, extract a resolution tag from the *original* filename
 *      (e.g. "1080p", "720p", "4K") and append it before trying "(2)", "(3)"…
 *      This produces:
 *        Movie (2010) [1080p].mkv  +  Movie (2010) [720p].mkv
 *      instead of the opaque:
 *        Movie (2010).mkv  +  Movie (2010) (2).mkv
 *   3. If that's also taken, fall through to numeric suffixes.
 *
 * @param {string}      parentDir      — directory the file lives in
 * @param {string}      newName        — desired clean name
 * @param {boolean}     isFolder       — true for directory renames
 * @param {Set<string>} reservedPaths  — paths already claimed by this plan
 * @param {string}      [originalName] — original filename (used for resolution extraction)
 */

function resolveConflict(parentDir, newName, isFolder, reservedPaths, originalName = '', sourcePath = '') {
  // Helper: does this candidate path collide with disk or the current plan?
  // On case-insensitive file systems (Windows/macOS), fs.existsSync may match
  // the source file itself when only casing changes — exclude it explicitly.
  const taken = (name) => {
    const p = path.join(parentDir, name);
    if (sourcePath && isCaseInsensitiveFS && p.toLowerCase() === sourcePath.toLowerCase()) return false;
    return fs.existsSync(p) || reservedPaths.has(p);
  };

  // Fast path: desired name is free
  if (!taken(newName)) return newName;

  // For files: try appending a resolution tag before falling back to numbers
  if (!isFolder && originalName) {
    const resTag = extractResolutionTag(originalName);
    if (resTag) {
      const ext = path.extname(newName);
      const base = path.basename(newName, ext);
      const withRes = `${base} ${resTag}${ext}`;
      if (!taken(withRes)) return withRes;
    }
  }

  // Numeric fallback: append " (2)", " (3)" … until a free slot is found
  let n = 2;
  for (; ;) {
    let candidate;
    if (isFolder) {
      candidate = `${newName} (${n})`;
    } else {
      const ext = path.extname(newName);
      const base = path.basename(newName, ext);
      candidate = `${base} (${n})${ext}`;
    }
    if (!taken(candidate)) return candidate;
    n++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  UNDO LOG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a log of completed renames inside the scanned directory so it always
 * travels with the files it describes and can be found with --path later.
 *
 * Format: { timestamp, targetPath, entries: [{ from, to }] }
 *   from — current (renamed) path
 *   to   — original (pre-rename) path
 */
function saveUndoLog(targetPath, completedRenames) {
  const logPath = path.join(targetPath, LOG_FILENAME);
  const log = {
    timestamp: new Date().toISOString(),
    targetPath,
    entries: completedRenames.map(r => ({
      from: path.join(r.parent, r.newName), // current path (after rename)
      to: r.filePath,                     // original path (before rename)
    })),
  };
  try {
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf8');
  } catch (err) {
    console.warn(`  ${c.yellow('⚠')}  Could not write undo log: ${err.message}`);
  }
}

/**
 * Read the undo log from the given directory and reverse every rename.
 * Renames are applied in reverse order (last → first) so nested folder
 * renames don't break each other's paths.
 * The log file is deleted after a fully successful undo.
 */
function runUndo(targetPath) {
  const logPath = path.join(targetPath, LOG_FILENAME);

  if (!fs.existsSync(logPath)) {
    console.error(c.red(`✖  No undo log found in: ${targetPath}`));
    console.error(c.gray('   Run a rename first, or specify the correct --path.'));
    process.exit(1);
  }

  let log;
  try {
    log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
  } catch (err) {
    console.error(c.red(`✖  Could not read undo log: ${err.message}`));
    process.exit(1);
  }

  console.log(`\n${c.bold('════════════════════════════════════════')}`);
  console.log(c.bold(c.cyan('  Undo Last Rename Run')));
  console.log(c.bold('════════════════════════════════════════'));
  console.log(`\n  Original run: ${c.gray(log.timestamp)}`);
  console.log(`  Entries to reverse: ${c.cyan(log.entries.length)}\n`);

  let succeeded = 0, skipped = 0, failed = 0;

  // Reverse order: undo deepest/last renames first so paths stay valid
  for (const entry of [...log.entries].reverse()) {
    let stat;
    try { stat = fs.statSync(entry.from); } catch { stat = null; }

    if (!stat) {
      console.log(`  ${c.yellow('⚠')}  ${c.yellow('Skipped')} (not found): ${c.gray(entry.from)}`);
      skipped++; continue;
    }

    const isSamePath = isCaseInsensitiveFS
      ? entry.to.toLowerCase() === entry.from.toLowerCase()
      : entry.to === entry.from;
    if (fs.existsSync(entry.to) && !isSamePath) {
      console.log(`  ${c.yellow('⚠')}  ${c.yellow('Skipped')} (target already exists): ${c.gray(entry.to)}`);
      skipped++; continue;
    }

    try {
      fs.renameSync(entry.from, entry.to);
      console.log(`  ${c.green('✔')}  ${path.basename(entry.from)}  →  ${c.green(path.basename(entry.to))}`);
      succeeded++;
    } catch (err) {
      console.log(`  ${c.red('✖')}  ${entry.from} — ${c.red(err.message)}`);
      failed++;
    }
  }

  // Delete the log only when everything succeeded so partial undos can be retried
  if (failed === 0 && succeeded > 0) {
    try { fs.unlinkSync(logPath); } catch { /* ignore */ }
  }

  printSummary({ succeeded, skipped, failed, verb: 'Reversed' });
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEMAPHORE  (caps concurrent readdir calls)
// ─────────────────────────────────────────────────────────────────────────────

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

const sem = new Semaphore(SCAN_CONCURRENCY);

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

// ─────────────────────────────────────────────────────────────────────────────
//  SCANNER — SKIP LIST
//
//  Directories that are never media folders and can contain enormous numbers
//  of files (thousands of tiny JS/Python/Rust files) that would make the scan
//  hang for minutes on a developer machine.
//
//  Two tiers:
//    SKIP_EXACT   — exact directory names always skipped (case-insensitive)
//    SKIP_MARKERS — if ANY of these files/dirs exist inside a directory,
//                   that directory and its entire subtree are skipped.
//                   This catches repos whose top-level name is non-standard
//                   (e.g. a project named "movies-api" still has package.json).
// ─────────────────────────────────────────────────────────────────────────────

// Exact names that are definitively non-media at any nesting level
const SKIP_EXACT = new Set([
  // JS / Node
  'node_modules', '.npm', '.yarn', '.pnp',
  // Python
  '__pycache__', '.venv', 'venv', 'env', 'site-packages', '.tox', '.mypy_cache',
  // Rust / Cargo
  'target',
  // Java / JVM
  '.gradle', '.mvn', 'build', 'out',
  // Ruby
  '.bundle', 'vendor',
  // Generic tooling / version control
  '.git', '.svn', '.hg',
  // IDE / editor state
  '.idea', '.vscode', '.vs',
  // OS noise
  '.Spotlight-V100', '.Trashes', '.fseventsd',
  // Distribution / cache artefacts
  'dist', 'coverage', '.cache', '.parcel-cache', '.next', '.nuxt', '.sass-cache', '.webpack', '.eslintcache',
  // docker, virtualisation
  'docker', 'vagrant', 'virtualenvs'
]);

// Marker files/dirs: if a directory contains one of these, skip its subtree.
// Lets us catch projects named anything (e.g. "awesome-media-server") that
// happen to have a package.json / Cargo.toml / requirements.txt inside.
// NOTE: .git is intentionally NOT here — a repo root may contain media files
// at its top level.  Only the .git *subdirectory itself* is blocked via SKIP_EXACT.
const SKIP_MARKERS = [
  'package.json',    // Node / JS project root
  'Cargo.toml',      // Rust project root
  'go.mod',          // Go module root
  'requirements.txt',// Python project
  'setup.py',        // Python package
  'pyproject.toml',  // Modern Python project
  'Gemfile',         // Ruby project root
  'pom.xml',         // Maven (Java)
  'build.gradle',    // Gradle (Java/Kotlin)
];

/**
 * Decide whether to skip an entire directory subtree during scanning.
 *
 * Returns { skip: true, reason } when the directory should be pruned, or
 * { skip: false } when it is safe to descend.
 *
 * @param {string}   dirPath  — absolute path of the directory to test
 * @param {string}   dirName  — basename of the directory (for exact-name check)
 * @param {string[]} children — names of immediate children (for marker check)
 */
function shouldSkipDir(dirPath, dirName, children) {
  // Tier 1: exact name match (fast O(1) Set lookup)
  if (SKIP_EXACT.has(dirName.toLowerCase())) {
    return { skip: true, reason: `"${dirName}" is a known non-media directory` };
  }

  // Tier 2: marker file present — this directory is a project/repo root
  for (const marker of SKIP_MARKERS) {
    if (children.includes(marker)) {
      return { skip: true, reason: `contains ${marker} (project/repo root)` };
    }
  }

  return { skip: false };
}

// ─────────────────────────────────────────────────────────────────────────────
//  SCANNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively scan a directory tree in parallel.
 *
 * Returns:
 *   videoFiles    — all video file paths
 *   subtitleFiles — all subtitle file paths
 *   dirs          — all directory paths, sorted deepest-first
 *   videoDirs     — Set of dirs containing ≥1 video (direct or nested)
 *   skippedDirs   — array of { path, reason } for pruned subtrees
 *
 * Displays a live spinner + running count while scanning because the total
 * is unknown until the full tree has been traversed.
 */
async function scanTree(rootDir) {
  const videoFiles = [];
  const subtitleFiles = [];
  const dirs = [];
  const skippedDirs = []; // { path, reason } — reported after scan
  const directVideoMap = new Map(); // dir → video files directly inside it

  let dirsScanned = 0;
  let videosFound = 0;

  const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinIdx = 0;
  const spinTimer = isTTY ? setInterval(() => {
    writeStatus(
      c.cyan(`  ${SPINNER[spinIdx++ % SPINNER.length]}  Scanning…  `) +
      `${c.bold(dirsScanned)} folders  ${c.bold(videosFound)} videos found`
    );
  }, 80) : null;

  async function recurse(current) {
    await sem.acquire();
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
      dirsScanned++;
    } catch (err) {
      // Permission error or disappeared mid-scan — warn and skip subtree
      console.warn(`\n  ${c.yellow('⚠')}  Cannot read: ${current} — ${err.message}`);
      return;
    } finally {
      sem.release();
    }

    // Build a cheap child-name list for the marker check (no stat calls)
    const childNames = entries.map(e => e.name);

    // ── Skip-directory check ────────────────────────────────────────────────
    // Run on every directory we descend into (not just top-level) so that
    // node_modules nested inside a project, or a git repo anywhere in the
    // tree, are all pruned without touching their contents.
    const dirName = path.basename(current);
    // Don't prune the rootDir itself — the user explicitly pointed at it
    if (current !== rootDir) {
      const { skip, reason } = shouldSkipDir(current, dirName, childNames);
      if (skip) {
        skippedDirs.push({ path: current, reason });
        return; // prune entire subtree
      }
    }

    const subTasks = [];
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const ext = path.extname(entry.name).toLowerCase();

      if (entry.isDirectory()) {
        dirs.push(fullPath);
        subTasks.push(recurse(fullPath));
      } else if (entry.isFile() && VIDEO_EXTENSIONS.has(ext)) {
        videoFiles.push(fullPath);
        videosFound++;
        if (!directVideoMap.has(current)) directVideoMap.set(current, []);
        directVideoMap.get(current).push(fullPath);
      } else if (entry.isFile() && SUBTITLE_EXTENSIONS.has(ext)) {
        subtitleFiles.push(fullPath);
      }
    }

    if (subTasks.length) await Promise.all(subTasks);
  }

  await recurse(rootDir);

  if (spinTimer) clearInterval(spinTimer);
  clearStatus();

  // Sort deepest-first so child dirs are renamed before their parents
  dirs.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

  // Build videoDirs: walk deepest-first so parents inherit children's status
  const videoDirs = new Set();
  for (const dir of dirs) {
    if (directVideoMap.has(dir)) videoDirs.add(dir);
    if (videoDirs.has(dir)) videoDirs.add(path.dirname(dir)); // propagate upward
  }

  return { videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs };
}

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

// ─────────────────────────────────────────────────────────────────────────────
//  ARGUMENT PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse CLI arguments.  Supported forms:
 *   --path="./videos"  |  --path ./videos  |  ./videos  (bare positional)
 *   --force            skip Y/N confirmation
 *   --undo             reverse last run (reads log from --path directory)
 *   --help             print usage and exit
 */
function parseArgs() {
  const argv = process.argv.slice(2);
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

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const { argPath, force, undo, help } = parseArgs();

  // ── Help mode ─────────────────────────────────────────────────────────────
  if (help) { printHelp(); return; }

  const targetPath = argPath ? path.resolve(argPath) : process.cwd();

  // Validate target directory exists and is a directory
  try {
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      console.error(c.red(`✖  Not a directory: ${targetPath}`)); process.exit(1);
    }
  } catch {
    console.error(c.red(`✖  Path not found: ${targetPath}`)); process.exit(1);
  }

  // ── Undo mode ─────────────────────────────────────────────────────────────
  // Log is always read from (and saved to) the scanned directory so --path
  // correctly identifies which log file to use
  if (undo) { runUndo(targetPath); return; }

  // ── Banner ────────────────────────────────────────────────────────────────
  console.log(`\n${c.bold('════════════════════════════════════════')}`);
  console.log(c.bold(c.cyan('  Intelligent Video Renamer  v7')));
  console.log(c.bold('════════════════════════════════════════'));
  console.log(`\n  Scanning: ${c.cyan(targetPath)}`);
  if (force) console.log(`  Mode: ${c.yellow('--force')} ${c.gray('(no confirmation prompt)')}`);
  console.log(`  ${c.gray('(including all subfolders)')}\n`);

  // ── PHASE 1: Scan ─────────────────────────────────────────────────────────
  const t0 = performance.now();
  let videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs;

  try {
    ({ videoFiles, subtitleFiles, dirs, videoDirs, skippedDirs } = await scanTree(targetPath));
  } catch (err) {
    console.error(c.red(`\n✖  Fatal scan error: ${err.message}`));
    console.error(c.gray('   No changes have been made.'));
    process.exit(1);
  }

  const scanMs = (performance.now() - t0).toFixed(0);
  console.log(
    `  Found ${c.bold(c.cyan(videoFiles.length))} video(s), ` +
    `${c.bold(c.cyan(subtitleFiles.length))} subtitle(s), ` +
    `${c.bold(c.cyan(videoDirs.size))} media folder(s) ` +
    `${c.gray(`in ${scanMs}ms`)}`
  );

  // Report skipped subtrees so the user knows they were intentionally pruned
  if (skippedDirs.length > 0) {
    console.log(
      `  ${c.yellow('⚠')}  Skipped ${c.bold(c.yellow(skippedDirs.length))} ` +
      `non-media director${skippedDirs.length === 1 ? 'y' : 'ies'} ` +
      c.gray('(project/repo roots, dependency trees)')
    );
    // Show individual paths only at a reasonable count — beyond that just summarise
    const SHOW_LIMIT = 5;
    const toShow = skippedDirs.slice(0, SHOW_LIMIT);
    for (const s of toShow) {
      const rel = s.path.replace(targetPath, '').replace(/^[/\\]/, '') || path.basename(s.path);
      console.log(`     ${c.gray('↳')} ${c.gray(rel)}  ${c.gray('(' + s.reason + ')')}`);
    }
    if (skippedDirs.length > SHOW_LIMIT) {
      console.log(`     ${c.gray(`… and ${skippedDirs.length - SHOW_LIMIT} more`)}`);
    }
  }
  console.log();

  // ── PHASE 2: Plan all renames ─────────────────────────────────────────────
  // Nothing is touched on disk in this phase.
  // Any planning error aborts the entire run with zero disk changes.
  const planErrors = [];
  const fileRenames = []; // video file renames
  const subRenames = []; // subtitle renames (paired to their video)
  const dirRenames = []; // folder renames

  // reservedPaths tracks destinations already claimed by this plan so the
  // conflict resolver doesn't double-book names within a single run
  const reservedPaths = new Set();

  const planTotal = videoFiles.length + dirs.length;
  let planDone = 0;

  // ── Plan: video files ─────────────────────────────────────────────────────
  for (const file of videoFiles) {
    planDone++;
    if (isTTY && planTotal > 200) progressBar(planDone, planTotal, 'planning…', 'cyan');

    try {
      const name = path.basename(file);

      // Camera / timestamp files are never renamed
      if (isCameraFile(name)) continue;

      const newName = cleanName(name);
      if (newName === name) continue; // already clean, no action needed

      const parent = path.dirname(file);
      // Pass original name to resolver so it can extract the resolution tag
      // when a naming conflict occurs (produces "[1080p]" instead of "(2)")
      const finalName = resolveConflict(parent, newName, false, reservedPaths, name, file);
      reservedPaths.add(path.join(parent, finalName));

      const record = { filePath: file, original: name, newName: finalName, parent };
      fileRenames.push(record);

      // Immediately pair any matching subtitles to follow this video rename
      const pairedSubs = buildSubtitleRenames(record, subtitleFiles, reservedPaths);
      subRenames.push(...pairedSubs);

    } catch (err) {
      planErrors.push(`File: ${file} — ${err.message}`);
    }
  }

  // ── Plan: folders ─────────────────────────────────────────────────────────
  for (const dir of dirs) {
    planDone++;
    if (isTTY && planTotal > 200) progressBar(planDone, planTotal, 'planning…', 'cyan');

    try {
      // Only rename folders that contain at least one video file
      if (!videoDirs.has(dir)) continue;

      const name = path.basename(dir);
      const newName = cleanName(name, true);
      if (newName === name || newName.length === 0) continue; // already clean

      const parent = path.dirname(dir);
      const finalName = resolveConflict(parent, newName, true, reservedPaths, '', dir);
      reservedPaths.add(path.join(parent, finalName));

      dirRenames.push({ filePath: dir, original: name, newName: finalName, parent });

    } catch (err) {
      planErrors.push(`Folder: ${dir} — ${err.message}`);
    }
  }

  clearStatus();

  // Any planning error → abort with zero disk changes
  if (planErrors.length > 0) {
    console.error(c.red('\n✖  Planning errors detected. No changes will be made:\n'));
    planErrors.forEach(e => console.error(`   ${c.red('•')} ${e}`));
    process.exit(1);
  }

  // ── Duplicate detection ────────────────────────────────────────────────────
  // Check for name collisions after resolution-aware conflict resolution.
  // At this point every rename has a unique finalName, so duplicates here
  // would indicate an unexpected edge case — surface as a warning, not abort.
  const allPlanned = [...fileRenames, ...subRenames, ...dirRenames];
  const dupWarnings = detectDuplicates(allPlanned);
  if (dupWarnings.length > 0) {
    console.log(c.yellow(`⚠  Naming conflicts resolved (resolution tags applied where possible):\n`));
    dupWarnings.forEach(w => console.log(`   ${c.yellow('•')} ${w}`));
    console.log('');
  }

  const totalRenames = allPlanned.length;
  if (totalRenames === 0) {
    console.log(c.green('✔  Nothing to rename — all files already clean.'));
    return;
  }

  // ── PHASE 3: Preview ──────────────────────────────────────────────────────
  // Helper to print one rename row consistently
  const printRenameRow = (r, rootPath) => {
    const rel = r.parent.replace(rootPath, '').replace(/^[/\\]/, '');
    const prefix = rel ? `${c.gray('[' + rel + ']')} ` : '';
    console.log(`  ${prefix}${c.gray(r.original)}\n  ${c.gray('→')} ${c.cyan(r.newName)}\n`);
  };

  if (fileRenames.length > 0) {
    console.log(c.bold(`FILES (${fileRenames.length}):`));
    fileRenames.forEach(r => printRenameRow(r, targetPath));
  }
  if (subRenames.length > 0) {
    console.log(c.bold(`SUBTITLES (${subRenames.length}):`));
    subRenames.forEach(r => printRenameRow(r, targetPath));
  }
  if (dirRenames.length > 0) {
    console.log(c.bold(`FOLDERS (${dirRenames.length}):`));
    dirRenames.forEach(r => printRenameRow(r, targetPath));
  }

  // ── PHASE 4: Confirm ──────────────────────────────────────────────────────
  if (!force) {
    const answer = await new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(
        `${c.bold(`Rename ${c.cyan(totalRenames)} item(s)?`)} ${c.gray('(Y/N)')} `,
        a => { rl.close(); resolve(a.trim()); }
      );
    });
    if (answer.toLowerCase() !== 'y') {
      console.log(c.gray('\nCancelled. No changes made.'));
      return;
    }
  }

  // ── PHASE 5: Execute ──────────────────────────────────────────────────────
  // Videos and subtitles first (before their parent folder paths change),
  // then folders deepest-first (already sorted that way by scanTree).
  const completedLog = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  // Shared accumulator — keeps the progress bar consistent across all three batches
  const tally = (r, offset) => {
    succeeded += r.succeeded;
    skipped += r.skipped;
    failed += r.failed;
    return offset + r.succeeded + r.skipped + r.failed;
  };

  let offset = 0;
  offset = tally(executeRenames(fileRenames, false, completedLog, offset, totalRenames), offset);
  offset = tally(executeRenames(subRenames, false, completedLog, offset, totalRenames), offset);
  tally(executeRenames(dirRenames, true, completedLog, offset, totalRenames), offset);

  clearStatus(); // ensure progress bar is fully cleared before summary

  // ── PHASE 6: Save undo log ────────────────────────────────────────────────
  if (completedLog.length > 0) {
    saveUndoLog(targetPath, completedLog);
    console.log(`\n  ${c.gray('💾  Undo log saved →')} ${c.cyan(path.join(targetPath, LOG_FILENAME))}`);
    console.log(`  ${c.gray('Run with --undo to reverse.')}`);
  }

  printSummary({ succeeded, skipped, failed });
}

main().catch(err => {
  console.error(c.red(`\n✖  Unexpected error: ${err.message}`));
  console.error(c.gray('   No changes have been made.'));
  process.exit(1);
});