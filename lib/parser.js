'use strict';

const path = require('path');
const { SIZE_TAG_RE, FOLDER_TAG_RE } = require('./constants');
const { titleCase, isDotSeparated, expandDots, firstJunkIndex, stripReleaseGroup } = require('./text-utils');

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
 *
 * @param {string} raw            — the raw filename (or folder name) to parse
 * @param {string} [folderName]   — basename of the file's immediate parent
 *                                  directory. Used ONLY as a season hint for
 *                                  the bare trailing "(N)" episode convention
 *                                  (see Priority 6 below) — a file with no
 *                                  season marker of its own that sits inside
 *                                  a "Season 2" folder should become
 *                                  "S02 E01", not an ambiguous "E01" that's
 *                                  indistinguishable from every other season's
 *                                  episode 1.
 */
function parseFilename(raw, folderName = null) {
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
  // Patterns: SP01 | OVA | Special | ONA (must appear before SxxExx so they aren't
  // swallowed by the episode regex in priority-1 below)
  //
  //   Attack.on.Titan.SP02.1080p.mkv   → specialType="SP", specialNum=2
  //   Fullmetal.Alchemist.OVA.1080p     → specialType="OVA", specialNum=null
  //   Sword.Art.Online.Special.1080p    → specialType="Special", specialNum=null
  //   My.Anime.ONA.1080p                 → specialType="ONA", specialNum=null
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

  if (!specialMatch) {
    const onaMatch = base.match(/\bONA\b/i);
    if (onaMatch) { specialType = 'ONA'; specialMatch = onaMatch; }
  }

  // ── Step 9: Extract season / episode — six patterns in priority order ─────
  const SE_RE = /\bS(\d{1,2})[ ._]*(?:E|EP)(\d{1,3})(?:[ ._-]?(?:E|EP)(\d{1,3}))?\b/i;
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

  // A multi-season pack ("Season 1-6", "S01-S06") matches the season patterns
  // above but only yields the FIRST number, which would mislabel the whole
  // collection. Flag it so callers can refuse to render a range as one season.
  const seasonRange = /\bSeason\s+\d{1,2}\s*[-–]\s*\d{1,2}\b/i.test(base)
    || /\bS\d{1,2}\s*[-–]\s*S\d{1,2}\b/i.test(base);

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

  // Priority 6 — Bare trailing episode index in parens: "Title (2014) (0)",
  // "CID (1500)". Common for daily-soap / numbered releases (esp. Indian TV)
  // that carry no season info, just a running episode count. Only the LAST
  // "(N)" group in the string qualifies, and only when it isn't the year
  // itself, so real content is no longer silently dropped by the trailing-
  // junk cleanup in Step 11.
  //
  // Trade-off: this shape is identical to the "(2)", "(3)"… suffix this same
  // tool appends on a naming conflict (see conflict-resolver.js). A file that
  // already carries a conflict-resolution suffix from an older run could be
  // reinterpreted as an episode number if re-scanned. Accepted here because
  // losing real episode numbers on first run is worse than a rare, low-harm
  // relabeling on a re-run of already-renamed output.
  let trailingEpisodeMatch = null;
  let seasonFromFolder = false;
  if (season === null && episode === null && !specialMatch) {
    const parenNums = [...base.matchAll(/\((\d{1,4})\)/g)];
    const lastParen = parenNums[parenNums.length - 1];
    const isTrailing = lastParen &&
      lastParen.index + lastParen[0].length >= base.replace(/\s+$/, '').length;
    if (lastParen && isTrailing && lastParen[1] !== year) {
      episode = parseInt(lastParen[1], 10);
      trailingEpisodeMatch = lastParen;

      // The bare index alone can't tell two seasons apart (every season's
      // first episode is "(1)"). If the parent folder names a season, adopt
      // it so "Season 2\Show (1).mkv" becomes "Show S02 E01", not a bare
      // "E01" that collides in spirit with every other season's episode 1.
      if (folderName) {
        const folderSeason = folderName.match(/\bSeason\s+(\d{1,2})\b/i) || folderName.match(/^S(\d{1,2})$/i);
        if (folderSeason) {
          season = parseInt(folderSeason[1], 10);
          seasonFromFolder = true;
        }
      }
    }
  }

  // ── Step 10: Extract episode title ────────────────────────────────────────
  // Text between SxxExx and the first tech/language stop tag
  // e.g. "S02E05 One More Game WEBRip" → episodeTitle = "One More Game"
  let episodeTitle = null;
  if (seMatch) {
    let afterSE = base.slice(seMatch.index + seMatch[0].length);
    const cutAt = firstJunkIndex(afterSE);
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
  if (trailingEpisodeMatch) title = title.slice(0, trailingEpisodeMatch.index); // cut before bare "(N)" index
  title = title.replace(/\bSeason\s+\d.*/i, '');
  title = title.replace(/\b(?:EP?|Episode)[ ._]?\d.*/i, '');

  // Cut before the year (stored separately)
  if (year) {
    const yi = title.indexOf(year);
    if (yi > 0) title = title.slice(0, yi);
  }

  // Cut at first stop word or language tag
  const stopCut = firstJunkIndex(title);
  if (stopCut < title.length) title = title.slice(0, stopCut);

  // Final tidy
  title = stripReleaseGroup(title);
  title = title.replace(FOLDER_TAG_RE, '');
  title = title.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[-\s.]+|[-\s.]+$/g, '')
    .replace(/\s*\($/, '').trim(); // remove trailing orphaned "("
  title = titleCase(title);

  // useSEPStyle: true when season came from "S01 EP…" or "Season N" in the
  // FILENAME itself (not SxxExx). A season adopted from the parent folder
  // name always renders in the clean "S02 E01" style, never "S02 EP01".
  const useSEPStyle = season !== null && !seMatch && !seasonFromFolder;

  return {
    title, year, season, episode, episodeEnd, episodeTitle,
    specialType, specialNum, ext, useSEPStyle, seasonRange
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
 *   "My Anime ONA.mkv"                         ← ONA
 *   "Kuttram Purindhavan (2025) S01 EP01-07"   ← useSEPStyle folder
 *   "Chernobyl S01"                            ← season-only folder
 *   "Demon Slayer E26.mkv"                     ← standalone episode
 *   "CID (1998) E1500.mkv"                     ← bare trailing episode index
 */
function formatFilename({ title, year, season, episode, episodeEnd, episodeTitle,
  specialType, specialNum, ext, useSEPStyle, seasonRange }) {
  // ── Title-less season folder ──────────────────────────────────────────────
  // "Season 3 (BluRay)" carries no show name — Step 11 strips the whole string
  // because it *starts* with the season marker, leaving title empty. The season
  // is the entire identity here, so emit it instead of bailing out; otherwise
  // cleanName's fallback returns the name verbatim and the release tag survives.
  // Ranges are excluded — "Season 1-6" must not collapse to "Season 1".
  if (!title) {
    if (season !== null && episode === null && !specialType && !seasonRange) {
      return `Season ${season}${ext}`;
    }
    return null;
  }

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
    // Standalone episode (anime, OVA without SP tag, or bare "(N)" index)
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
 *
 * @param {string} name             — filename or folder name to clean
 * @param {boolean} [isFolder]      — true when renaming a directory
 * @param {string} [folderName]     — basename of the file's immediate parent
 *                                    directory (files only) — see parseFilename
 */
function cleanName(name, isFolder = false, folderName = null) {
  try {
    if (isFolder) {
      // Folders have no extension — append a dummy one so parseFilename's
      // ext-stripping logic works normally, then discard it afterward
      const parsed = parseFilename(name + '.__tmp__');
      parsed.ext = '';
      const out = formatFilename(parsed);
      return (out && out.length > 0) ? out : name;
    }
    const parsed = parseFilename(name, folderName);
    const result = formatFilename(parsed);
    if (!result || result === parsed.ext) return name;
    return result;
  } catch {
    // Parsing failure — leave file untouched rather than corrupting it
    return name;
  }
}

module.exports = { parseFilename, formatFilename, cleanName };
