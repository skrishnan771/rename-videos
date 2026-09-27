'use strict';

const path = require('path');
const { resolveConflict } = require('./conflict-resolver');
const { LANG_WORDS } = require('./constants');

// What a subtitle may add after its video's base name: ".en", ".pt-BR",
// ".English", ".eng.forced", ".forced" — or nothing.
const LANG_SUFFIX_RE = new RegExp(
  `^(?:\\.(?:[a-z]{2,3}(?:[-_][a-z]{2,4})?|${LANG_WORDS.join('|')}))?(?:\\.(?:forced|sdh|hi|cc))?$`, 'i'
);

// ─────────────────────────────────────────────────────────────────────────────
//  SUBTITLE PAIRING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find subtitle files in the same directory that belong to a given video rename,
 * and build rename records for them.
 *
 * Matching: the subtitle basename must be the video's original basename
 * (case-insensitive) followed by nothing or a language/flag suffix.
 *
 *   "Breaking.Bad.S05E14.srt"        → matches "Breaking.Bad.S05E14.mkv"
 *   "Breaking.Bad.S05E14.en.srt"     → also matches (suffix ".en")
 *   "Breaking.Bad.S05E14.en.forced.srt" → also matches (suffix ".en.forced")
 *
 * Matching by prefix rather than stripping a suffix first matters: a video
 * whose own name ends in ".DTS" or ".AAC" used to lose that token as a
 * "language code" and its subtitle was never paired.
 *
 * Language codes (.en, .fr, .en.forced, .en.sdh) are preserved in the output.
 */
function buildSubtitleRenames(videoRename, subtitleFiles, reservedPaths, existsFn) {
  const videoBase = path.basename(videoRename.original, path.extname(videoRename.original)).toLowerCase();
  const newVideoBase = path.basename(videoRename.newName, path.extname(videoRename.newName));
  const results = [];

  for (const subPath of subtitleFiles) {
    const subDir = path.dirname(subPath);

    // Only pair subtitles in the same directory as the video
    if (subDir !== videoRename.parent) continue;

    const subExt = path.extname(subPath);
    const subFilename = path.basename(subPath);
    const subBaseFull = path.basename(subPath, subExt);

    if (!subBaseFull.toLowerCase().startsWith(videoBase)) continue;
    const langSuffix = subBaseFull.slice(videoBase.length); // e.g. ".en" or ".en.forced"
    if (!LANG_SUFFIX_RE.test(langSuffix)) continue; // belongs to a different video

    const newSubName = newVideoBase + langSuffix + subExt;
    if (newSubName === subFilename) continue; // already clean

    const finalName = resolveConflict(subDir, newSubName, false, reservedPaths, '', subPath, existsFn);
    if (finalName === subFilename) continue;


    results.push({ filePath: subPath, original: subFilename, newName: finalName, parent: subDir });
  }

  return results;
}

module.exports = { buildSubtitleRenames };
