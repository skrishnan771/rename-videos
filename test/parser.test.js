'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanName, parseFilename, formatFilename } = require('../lib/parser');

test('scene filename with episode title and release group', () => {
  assert.equal(
    cleanName('Breaking.Bad.S05E14.Ozymandias.1080p.BluRay.x265-PSA.mkv'),
    'Breaking Bad S05 E14 - Ozymandias.mkv'
  );
});

test('movie with year and release tags', () => {
  assert.equal(
    cleanName('The.Dark.Knight.2008.1080p.BluRay.x264-SPARKS.mkv'),
    'The Dark Knight (2008).mkv'
  );
});

test('bracket-prefixed scene release', () => {
  assert.equal(
    cleanName('[Squid Game 2 - 640Kbps) - 15GB - ESub] Squid Game S02E05 Friend or Foe.mkv'),
    'Squid Game S02 E05 - Friend or Foe.mkv'
  );
});

test('anime standalone episode', () => {
  assert.equal(
    cleanName('Demon.Slayer.EP26.1080p.CR.WEB-DL.mkv'),
    'Demon Slayer E26.mkv'
  );
});

test('anime special: SP with number', () => {
  assert.equal(
    cleanName('Attack.on.Titan.SP02.1080p.mkv'),
    'Attack on Titan SP02.mkv'
  );
});

test('anime special: OVA', () => {
  assert.equal(
    cleanName('Fullmetal.Alchemist.OVA.1080p.mkv'),
    'Fullmetal Alchemist OVA.mkv'
  );
});

test('anime special: Special', () => {
  assert.equal(
    cleanName('Sword.Art.Online.Special.1080p.mkv'),
    'Sword Art Online Special.mkv'
  );
});

test('anime special: ONA', () => {
  assert.equal(
    cleanName('My.Anime.ONA.1080p.mkv'),
    'My Anime ONA.mkv'
  );
});

test('season pack folder', () => {
  assert.equal(
    cleanName('Chernobyl Season 1 Complete 720p WEB-DL x264 [i_c]', true),
    'Chernobyl S01'
  );
});

test('site-prefixed release', () => {
  assert.equal(
    cleanName('www.TamilRockers.ws - Pushpa The Rise (2021) 720p WEB-DL HIN-TAM x264.mkv'),
    'Pushpa the Rise (2021).mkv'
  );
});

test('already-clean filename is left untouched', () => {
  assert.equal(cleanName('Breaking Bad S05 E14 - Ozymandias.mkv'), 'Breaking Bad S05 E14 - Ozymandias.mkv');
});

// ── Regression: trailing "(N)" episode index must not be silently dropped ───
// Bug: "Silicon Valley (2014) (0).mkv" used to lose the "(0)" entirely and
// collapse to "Silicon Valley (2014).mkv", destroying the episode number.
test('bug regression: trailing "(0)" after year is preserved as episode 0, not dropped', () => {
  const result = cleanName('Silicon Valley (2014) (0).mkv');
  assert.equal(result, 'Silicon Valley (2014) E00.mkv');
  assert.notEqual(result, 'Silicon Valley (2014).mkv');
});

test('trailing "(N)" after year works for non-zero episode indices too', () => {
  assert.equal(cleanName('Silicon Valley (2014) (7).mkv'), 'Silicon Valley (2014) E07.mkv');
});

test('bare numbered episode convention (Indian daily-soap style, no year)', () => {
  const parsed = parseFilename('CID (1500).mkv');
  assert.equal(parsed.episode, 1500);
  assert.equal(formatFilename(parsed), 'CID E1500.mkv');
});

test('numbered episode convention combined with a year', () => {
  assert.equal(cleanName('CID (1998) (1500).mkv'), 'CID (1998) E1500.mkv');
});

test('a lone "(year)" is never mistaken for an episode index', () => {
  const parsed = parseFilename('The Matrix (1999).mkv');
  assert.equal(parsed.year, '1999');
  assert.equal(parsed.episode, null);
  assert.equal(formatFilename(parsed), 'The Matrix (1999).mkv');
});

test('an explicit SxxExx match takes priority over a trailing "(N)"', () => {
  // Guards against the new trailing-paren rule firing when a real season/
  // episode marker already claimed the episode.
  const parsed = parseFilename('Silicon Valley S02E01 (0).mkv');
  assert.equal(parsed.season, 2);
  assert.equal(parsed.episode, 1);
});

test('anime specials are not reinterpreted by the trailing "(N)" rule', () => {
  const parsed = parseFilename('Attack on Titan SP02 (2013).mkv');
  assert.equal(parsed.specialType, 'SP');
  assert.equal(parsed.specialNum, 2);
  assert.equal(parsed.episode, null);
});

test('folder names round-trip through cleanName without an extension', () => {
  assert.equal(cleanName('Silicon Valley (2014)', true), 'Silicon Valley (2014)');
});

// ── Regression: bare "(N)" episodes inside per-season folders must not ──────
// collapse to the same filename across every season.
// Bug: "Silicon Valley (2014)\Season 2\Silicon Valley (2014) (1).mkv" and the
// identically-numbered episode 1 in Season 1/3/4/5/6 all produced the same
// season-less "Silicon Valley (2014) E01.mkv", destroying the season info.
test('bug regression: a "Season N" parent folder is adopted as the season for a bare "(N)" episode', () => {
  assert.equal(
    cleanName('Silicon Valley (2014) (1).mkv', false, 'Season 2'),
    'Silicon Valley (2014) S02 E01.mkv'
  );
});

test('different season folders no longer collide on the same episode-1 filename', () => {
  const season1 = cleanName('Silicon Valley (2014) (1).mkv', false, 'Season 1');
  const season2 = cleanName('Silicon Valley (2014) (1).mkv', false, 'Season 2');
  assert.equal(season1, 'Silicon Valley (2014) S01 E01.mkv');
  assert.equal(season2, 'Silicon Valley (2014) S02 E01.mkv');
  assert.notEqual(season1, season2);
});

test('a season folder with trailing junk still yields the right season number', () => {
  assert.equal(
    cleanName('Silicon Valley (2014) (5).mkv', false, 'Season 5 (AMZN )'),
    'Silicon Valley (2014) S05 E05.mkv'
  );
});

test('with no folder hint, the bare "(N)" episode still falls back to season-less "E0N"', () => {
  assert.equal(cleanName('Silicon Valley (2014) (1).mkv'), 'Silicon Valley (2014) E01.mkv');
});

test('a folder-derived season uses the clean "S02 E01" style, not the folder-range "S02 EP01" style', () => {
  const parsed = parseFilename('Silicon Valley (2014) (1).mkv', 'Season 2');
  assert.equal(parsed.useSEPStyle, false);
});

test('an explicit SxxExx in the filename is not overridden by a season folder hint', () => {
  assert.equal(
    cleanName('Silicon Valley S03E05.mkv', false, 'Season 2'),
    'Silicon Valley S03 E05.mkv'
  );
});

// ── Regression: STOP_WORDS/LANG_WORDS colliding with ordinary English words ─
// used inside real episode titles. Both cases below are real filenames from
// a user's library, not hypothetical: "REAL" and "IT" (case-insensitive stop
// words) matched normal-case words in the title and silently truncated it.
test('bug regression: an episode title containing "Real" is not truncated ("The Real Value")', () => {
  assert.equal(
    cleanName('The.Mentalist.S01E04.The.Real.Value.mkv'),
    'The Mentalist S01 E04 - The Real Value.mkv'
  );
});

test('bug regression: an episode title containing "It" is not truncated ("Paint It Red")', () => {
  assert.equal(
    cleanName('The.Mentalist.S01E13.Paint.It.Red.mkv'),
    'The Mentalist S01 E13 - Paint It Red.mkv'
  );
});

test('a real ALL-CAPS "REAL" scene tag is still stripped as junk', () => {
  assert.equal(
    cleanName('Movie.2020.PROPER.REAL.REPACK-GROUP.mkv'),
    'Movie (2020).mkv'
  );
});

test('movie titles that are themselves risky stop words are not blanked out', () => {
  assert.equal(cleanName('Dual.2022.1080p.BluRay.x264-GROUP.mkv'), 'Dual (2022).mkv');
  assert.equal(cleanName('Full.Metal.Jacket.1987.1080p.BluRay.x264-GROUP.mkv'), 'Full Metal Jacket (1987).mkv');
});

test('a movie literally titled "It" is not swallowed by the language-code check', () => {
  assert.equal(cleanName('It.2017.1080p.BluRay.x264-GROUP.mkv'), 'It (2017).mkv');
});

test('technical tags that are NOT in the risky list still work case-insensitively (no regression)', () => {
  // BluRay/WEBRip are legitimately written in mixed case in the wild and must
  // keep matching regardless of case — only the risky, English-word-like
  // tokens moved to strict/case-sensitive matching.
  assert.equal(
    cleanName('The.Dark.Knight.2008.1080p.bluray.x264-sparks.mkv'),
    'The Dark Knight (2008).mkv'
  );
});

test('cleanName never throws on pathological input', () => {
  assert.doesNotThrow(() => cleanName(''));
  assert.doesNotThrow(() => cleanName('....mkv'));
  assert.doesNotThrow(() => cleanName('(((()))).mkv'));
});

// ─────────────────────────────────────────────────────────────────────────────
//  Title-less season folders
// ─────────────────────────────────────────────────────────────────────────────
// Bug: "Season 3 (BluRay)" was left untouched. Step 11 strips the whole string
// (it *starts* with the season marker) leaving an empty title, formatFilename
// bailed on !title, and cleanName's fallback returned the name verbatim — so
// the release tag survived. Even a already-clean "Season 3" took that path.

test('a title-less season folder drops its release tag', () => {
  assert.equal(cleanName('Season 3 (BluRay)', true), 'Season 3');
  assert.equal(cleanName('Season 5 (AMZN WEB-DL)', true), 'Season 5');
  assert.equal(cleanName('Season 1 Complete', true), 'Season 1');
});

test('a title-less season folder normalises a zero-padded season', () => {
  assert.equal(cleanName('Season 03 (BluRay)', true), 'Season 3');
});

test('a multi-season pack folder is never collapsed to its first season', () => {
  // "Season 1-6" must not become "Season 1" — that would mislabel the whole
  // collection, and the folder holds every season subfolder beneath it.
  assert.equal(cleanName('Season 1-6', true), 'Season 1-6');
  assert.equal(cleanName('Season 1-6 (1080p)', true), 'Season 1-6 (1080p)');
});

test('a season folder that does carry a show name is unaffected', () => {
  assert.equal(cleanName('Chernobyl Season 1 (BluRay)', true), 'Chernobyl S01');
  assert.equal(cleanName('Chernobyl (2019) Season 1 (BluRay)', true), 'Chernobyl (2019) S01');
});

test('non-season folders still fall back to the original name', () => {
  assert.equal(cleanName('Specials', true), 'Specials');
  assert.equal(cleanName('Extras', true), 'Extras');
});

test('episode files inside a season folder are unaffected by the folder fix', () => {
  assert.equal(
    cleanName('Silicon Valley (2014) - S03E01 - Founder Friendly (1080p BluRay x265 Silence).mkv',
      false, 'Season 3 (BluRay)'),
    'Silicon Valley (2014) S03 E01 - Founder Friendly.mkv'
  );
});
