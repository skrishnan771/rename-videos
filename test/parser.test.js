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

test('cleanName never throws on pathological input', () => {
  assert.doesNotThrow(() => cleanName(''));
  assert.doesNotThrow(() => cleanName('....mkv'));
  assert.doesNotThrow(() => cleanName('(((()))).mkv'));
});
