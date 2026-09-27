'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildSubtitleRenames } = require('../lib/subtitles');

const noneExist = () => false;

test('pairs a bare subtitle with its renamed video', () => {
  const parent = path.join('shows', 'Breaking Bad');
  const videoRename = {
    original: 'Breaking.Bad.S05E14.mkv',
    newName: 'Breaking Bad S05 E14 - Ozymandias.mkv',
    parent,
  };
  const subtitleFiles = [path.join(parent, 'Breaking.Bad.S05E14.srt')];

  const result = buildSubtitleRenames(videoRename, subtitleFiles, new Set(), noneExist);

  assert.equal(result.length, 1);
  assert.equal(result[0].newName, 'Breaking Bad S05 E14 - Ozymandias.srt');
});

test('preserves a language suffix when pairing', () => {
  const parent = path.join('shows', 'Breaking Bad');
  const videoRename = {
    original: 'Breaking.Bad.S05E14.mkv',
    newName: 'Breaking Bad S05 E14 - Ozymandias.mkv',
    parent,
  };
  const subtitleFiles = [path.join(parent, 'Breaking.Bad.S05E14.en.forced.srt')];

  const result = buildSubtitleRenames(videoRename, subtitleFiles, new Set(), noneExist);

  assert.equal(result.length, 1);
  assert.equal(result[0].newName, 'Breaking Bad S05 E14 - Ozymandias.en.forced.srt');
});

test('does not pair a subtitle belonging to a different video', () => {
  const parent = path.join('shows', 'Breaking Bad');
  const videoRename = {
    original: 'Breaking.Bad.S05E14.mkv',
    newName: 'Breaking Bad S05 E14 - Ozymandias.mkv',
    parent,
  };
  const subtitleFiles = [path.join(parent, 'Breaking.Bad.S05E15.srt')];

  const result = buildSubtitleRenames(videoRename, subtitleFiles, new Set(), noneExist);

  assert.equal(result.length, 0);
});

test('does not pair a subtitle from a different directory', () => {
  const videoRename = {
    original: 'Breaking.Bad.S05E14.mkv',
    newName: 'Breaking Bad S05 E14 - Ozymandias.mkv',
    parent: path.join('shows', 'Breaking Bad'),
  };
  const subtitleFiles = [path.join('shows', 'Other Show', 'Breaking.Bad.S05E14.srt')];

  const result = buildSubtitleRenames(videoRename, subtitleFiles, new Set(), noneExist);

  assert.equal(result.length, 0);
});

test('skips a subtitle that is already clean', () => {
  const parent = path.join('shows', 'Breaking Bad');
  const videoRename = {
    original: 'Breaking.Bad.S05E14.mkv',
    newName: 'Breaking Bad S05 E14 - Ozymandias.mkv',
    parent,
  };
  const subtitleFiles = [path.join(parent, 'Breaking Bad S05 E14 - Ozymandias.srt')];

  const result = buildSubtitleRenames(videoRename, subtitleFiles, new Set(), noneExist);

  assert.equal(result.length, 0);
});

test('bug regression: pairs a subtitle whose video name ends in a 2-3 letter tag (".DTS")', () => {
  const parent = path.join('movies');
  const videoRename = { original: 'Movie.2019.1080p.DTS.mkv', newName: 'Movie (2019).mkv', parent };
  const result = buildSubtitleRenames(videoRename, [path.join(parent, 'Movie.2019.1080p.DTS.srt')], new Set(), noneExist);
  assert.equal(result.length, 1);
  assert.equal(result[0].newName, 'Movie (2019).srt');
});

test('pairs region-coded, full-name and flag-only language suffixes', () => {
  const parent = path.join('movies');
  const videoRename = { original: 'Movie.2019.mkv', newName: 'Movie (2019).mkv', parent };
  const subs = ['Movie.2019.pt-BR.srt', 'Movie.2019.English.srt', 'Movie.2019.forced.srt', 'Movie.2019.Extended.srt']
    .map(s => path.join(parent, s));
  const names = buildSubtitleRenames(videoRename, subs, new Set(), noneExist).map(r => r.newName);
  assert.deepEqual(names, ['Movie (2019).pt-BR.srt', 'Movie (2019).English.srt', 'Movie (2019).forced.srt']);
});
