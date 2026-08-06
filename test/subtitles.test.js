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
