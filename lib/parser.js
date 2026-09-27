'use strict';

const path = require('path');
const { SIZE_TAG_RE, FOLDER_TAG_RE } = require('./constants');
const { titleCase, isDotSeparated, expandDots, firstMatchIndex, firstJunkIndex, stripReleaseGroup } = require('./text-utils');

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
    /\(\s*(?:DD|DTS|ATMOS|AC3|AAC|TRUE|HEVC|AVC|H\.?\d{3}|\d+\.\d+|\d+\s*Kbps|\d{3,4}[pi]\b|4K\b)[^)]*\)/gi, ' '
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

  // ── Step 6b: Multi-disc marker ("CD1", "Disc 2") ──────────────────────────
  // Lifted out of the string so CD1 and CD2 of one movie don't collapse to the
  // same name; re-appended by formatFilename.
  let disc = null;
  const discMatch = base.match(/\b(CD|DIS[CK])[ ._-]?(\d{1,2})\b/i);
  if (discMatch) {
    disc = { cd: discMatch[1].toUpperCase() === 'CD', num: parseInt(discMatch[2], 10) };
    base = base.slice(0, discMatch.index) + ' ' + base.slice(discMatch.index + discMatch[0].length);
  }

  // ── Step 7: Air date (daily shows) and year (1900–2099) ───────────────────
  // "The.Daily.Show.2024.01.15" — the date IS the episode identity.
  const dateMatch = base.match(/\b((?:19|20)\d{2})[ .-](0[1-9]|1[0-2])[ .-](0[1-9]|[12]\d|3[01])\b/);
  const airDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : null;

  // Year = the LAST year-like token before any episode marker, never one that
  // opens the name: "Blade Runner 2049 2017", "1917 2019", "2012 2009".
  const SE_RE = /\bS(\d{1,2})[ ._]*(?:E|EP)(\d{1,3})(?:(?:[ ._-]?(?:E|EP)(\d{1,3}))+|-(\d{1,3}))?\b/i;
  const NXN_RE = /\b(\d{1,2})x(\d{2,3})\b/i;
  const markerAt = Math.min(firstMatchIndex(base, SE_RE), firstMatchIndex(base, NXN_RE));
  const nameStart = base.search(/\S/);
  const yearCandidates = [...base.matchAll(/\b((?:19|20)\d{2})\b/g)].filter(m =>
    m.index !== nameStart && !(dateMatch && m.index === dateMatch.index));
  const beforeMarker = yearCandidates.filter(m => m.index < markerAt);
  const yearMatch = (beforeMarker.length ? beforeMarker : yearCandidates).pop() || null;
  const year = yearMatch ? yearMatch[1] : null;

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

  // ── Step 9: Extract season / episode — patterns in priority order ─────────
  let season = null, episode = null, episodeEnd = null, seasonEnd = null, seMatch = null;

  // Priority 1 — Standard "S02E05", ranges "S02E01-E04" / "S02E01-02",
  // multi-episode "S01E01E02E03" (group 3 holds the last repetition)
  const standardSE = base.match(SE_RE);
  if (standardSE) {
    seMatch = standardSE;
    season = parseInt(standardSE[1], 10);
    episode = parseInt(standardSE[2], 10);
    const end = standardSE[3] || standardSE[4];
    if (end) episodeEnd = parseInt(end, 10);
  }

  // Priority 1b — Older "1x05" scene style
  if (!seMatch) {
    const nxn = base.match(NXN_RE);
    if (nxn) {
      seMatch = nxn;
      season = parseInt(nxn[1], 10);
      episode = parseInt(nxn[2], 10);
    }
  }

  // Priority 1c — Daily-show air date; splits title / episode title like SxxExx
  if (!seMatch && dateMatch) seMatch = dateMatch;

  // Priority 2 — Long-form "Season 1 Episode 5"
  if (!seMatch) {
    const longForm = base.match(/\bSeason\s+(\d{1,2})\s+Episode\s+(\d{1,3})\b/i);
    if (longForm) {
      season = parseInt(longForm[1], 10);
      episode = parseInt(longForm[2], 10);
    }
  }

  // Priority 3 — Season-only folder packs: a multi-season range "Season 1-6" /
  // "S01-S06" (kept as a range, never collapsed to its first season) or
  // "Season 1 Complete"
  let seasonMarkMatch = null;
  if (!seMatch && episode === null) {
    const range = base.match(/\bSeasons?\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i)
      || base.match(/\bS(\d{1,2})\s*[-–]\s*S(\d{1,2})\b/i);
    if (range) {
      seasonMarkMatch = range;
      season = parseInt(range[1], 10);
      seasonEnd = parseInt(range[2], 10);
    } else {
      const seasonOnly = base.match(/\bSeason\s+(\d{1,2})\b/i);
      if (seasonOnly) season = parseInt(seasonOnly[1], 10);
    }
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

  // Priority 4b — Bare "S03" folder tag ("The.Office.US.2005.S03.1080p")
  if (!seMatch && season === null && episode === null) {
    const bareSeason = base.match(/\bS(\d{1,2})\b/i);
    if (bareSeason) {
      seasonMarkMatch = bareSeason;
      season = parseInt(bareSeason[1], 10);
    }
  }

  // Priority 5 — Standalone "EP26" or "E26" (anime, OVA — no season)
  // Only run when no special type was detected to avoid double-matching
  if (!seMatch && season === null && episode === null && !specialMatch) {
    const standalone = base.match(/\b(?:EP?|Episode)[ ._]?(\d{1,4})(?:\s*[-–]\s*(\d{1,3}))?\b/i);
    if (standalone) {
      episode = parseInt(standalone[1], 10);
      if (standalone[2]) episodeEnd = parseInt(standalone[2], 10);
    }
  }

  // Priority 5b — Fansub absolute episode "[Group] Show - 24 (1080p)": a
  // " - N" followed only by junk or brackets. Skipped when a year exists so
  // "Movie - 2 (2019)" isn't read as episode 2.
  let absoluteMatch = null;
  if (!seMatch && season === null && episode === null && !specialMatch && !year) {
    for (const m of base.matchAll(/\s[-–]\s+(\d{1,4})(?:v\d)?(?=\s|$)/g)) {
      const rest = base.slice(m.index + m[0].length).trim();
      if (/^(?:19|20)\d{2}$/.test(m[1])) continue;
      if (rest === '' || rest[0] === '(' || firstJunkIndex(rest) === 0) {
        absoluteMatch = m;
        episode = parseInt(m[1], 10);
        break;
      }
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
  if (!seMatch && season === null && episode === null && !specialMatch) {
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

  // Every marker index is into `base`, and title only ever shrinks from the
  // end, so each can be applied directly
  for (const m of [seMatch, specialMatch, trailingEpisodeMatch, absoluteMatch, seasonMarkMatch, yearMatch]) {
    if (m && m.index < title.length) title = title.slice(0, m.index);
  }
  title = title.replace(/\bSeasons?\s+\d.*/i, '');
  title = title.replace(/\b(?:EP?|Episode)[ ._]?\d.*/i, '');

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
    specialType, specialNum, ext, useSEPStyle, seasonEnd,
    airDate: seMatch && seMatch === dateMatch ? airDate : null, disc,
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
 *   "The Daily Show 2024-01-15 - Guest.mkv"    ← daily show air date
 *   "Friends S01-S10"                          ← multi-season pack folder
 *   "Movie Name (2003) CD1.avi"                ← multi-disc part
 */
function formatFilename({ title, year, season, episode, episodeEnd, episodeTitle,
  specialType, specialNum, ext, useSEPStyle, seasonEnd = null, airDate = null, disc = null }) {
  const pad = (n) => String(n).padStart(2, '0');
  const discTag = disc ? (disc.cd ? ` CD${disc.num}` : ` Disc ${disc.num}`) : '';

  // ── Title-less season folder ──────────────────────────────────────────────
  // "Season 3 (BluRay)" carries no show name — Step 11 strips the whole string
  // because it *starts* with the season marker, leaving title empty. The season
  // is the entire identity here, so emit it instead of bailing out; otherwise
  // cleanName's fallback returns the name verbatim and the release tag survives.
  if (!title) {
    if (season !== null && episode === null && !specialType) {
      return `Season ${season}${seasonEnd !== null ? `-${seasonEnd}` : ''}${discTag}${ext}`;
    }
    return null;
  }

  let out = title;
  if (year) out += ` (${year})`;

  // ── Anime specials take priority over regular episode numbering ────────────
  if (specialType) {
    // OVA / Special / ONA carry no number
    out += specialType === 'SP' && specialNum !== null ? ` SP${pad(specialNum)}` : ` ${specialType}`;

  } else if (airDate) {
    out += ` ${airDate}`;
    if (episodeTitle) out += ` - ${episodeTitle}`;

  } else if (season !== null && episode !== null) {
    const s = pad(season);
    const e = pad(episode);

    if (useSEPStyle) {
      // Folder range style: "S01 EP01-07"
      out += episodeEnd !== null ? ` S${s} EP${e}-${pad(episodeEnd)}` : ` S${s} EP${e}`;
    } else {
      // Standard style: "S02 E05" (space between S and E for readability)
      out += episodeEnd !== null ? ` S${s} E${e}-E${pad(episodeEnd)}` : ` S${s} E${e}`;
    }
    if (episodeTitle) out += ` - ${episodeTitle}`;

  } else if (season !== null) {
    // Season-only folder: "Chernobyl S01", or a pack "Friends S01-S10"
    out += ` S${pad(season)}${seasonEnd !== null ? `-S${pad(seasonEnd)}` : ''}`;

  } else if (episode !== null) {
    // Standalone episode (anime, OVA without SP tag, or bare "(N)" index)
    out += episodeEnd !== null ? ` E${pad(episode)}-E${pad(episodeEnd)}` : ` E${pad(episode)}`;
    if (episodeTitle) out += ` - ${episodeTitle}`;
  }

  return out + discTag + ext;

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
