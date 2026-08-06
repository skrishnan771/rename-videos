'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDuplicates } = require('../lib/duplicates');

test('reports no warnings when every destination is unique', () => {
  const renames = [
    { parent: '/movies', newName: 'A.mkv', original: 'a.mkv' },
    { parent: '/movies', newName: 'B.mkv', original: 'b.mkv' },
  ];
  assert.deepEqual(detectDuplicates(renames), []);
});

test('reports a warning when two sources collide on the same destination', () => {
  const renames = [
    { parent: '/movies', newName: 'Movie (2010).mkv', original: 'Movie.1080p.mkv' },
    { parent: '/movies', newName: 'Movie (2010).mkv', original: 'Movie.720p.mkv' },
  ];
  const warnings = detectDuplicates(renames);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Movie \(2010\)\.mkv/);
  assert.match(warnings[0], /Movie\.1080p\.mkv/);
  assert.match(warnings[0], /Movie\.720p\.mkv/);
});

test('same destination name in different directories does not collide', () => {
  const renames = [
    { parent: '/movies/a', newName: 'Movie.mkv', original: 'movie.mkv' },
    { parent: '/movies/b', newName: 'Movie.mkv', original: 'movie.mkv' },
  ];
  assert.deepEqual(detectDuplicates(renames), []);
});
