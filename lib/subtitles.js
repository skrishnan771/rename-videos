'use strict';

const path = require('path');
const { resolveConflict } = require('./conflict-resolver');

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
function buildSubtitleRenames(videoRename, subtitleFiles, reservedPaths, existsFn) {
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

    const finalName = resolveConflict(subDir, newSubName, false, reservedPaths, '', subPath, existsFn);
    reservedPaths.add(path.join(subDir, finalName));

    results.push({ filePath: subPath, original: subFilename, newName: finalName, parent: subDir });
  }

  return results;
}

module.exports = { buildSubtitleRenames };
