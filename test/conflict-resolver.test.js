'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveConflict } = require('../lib/conflict-resolver');

// existsFn is injected so these tests never touch the real filesystem.
function existsFrom(paths) {
  const set = new Set(paths);
  return (p) => set.has(p);
}

test('returns the desired name when nothing collides', () => {
  const result = resolveConflict('/movies', 'Movie (2010).mkv', false, new Set(), 'Movie.1080p.mkv', '', existsFrom([]));
  assert.equal(result, 'Movie (2010).mkv');
});

test('falls back to a resolution tag on collision when one is extractable', () => {
  const taken = path.join('/movies', 'Movie (2010).mkv');
  const result = resolveConflict('/movies', 'Movie (2010).mkv', false, new Set(), 'Movie.1080p.BluRay.mkv', '', existsFrom([taken]));
  assert.equal(result, 'Movie (2010) [1080p].mkv');
});

test('falls back to numeric suffix when no resolution tag is present', () => {
  const taken = path.join('/movies', 'Movie (2010).mkv');
  const result = resolveConflict('/movies', 'Movie (2010).mkv', false, new Set(), 'Movie.mkv', '', existsFrom([taken]));
  assert.equal(result, 'Movie (2010) (2).mkv');
});

test('numeric suffix increments past multiple existing collisions', () => {
  const base = '/movies';
  const taken = [
    path.join(base, 'Movie (2010).mkv'),
    path.join(base, 'Movie (2010) (2).mkv'),
    path.join(base, 'Movie (2010) (3).mkv'),
  ];
  const result = resolveConflict(base, 'Movie (2010).mkv', false, new Set(), 'Movie.mkv', '', existsFrom(taken));
  assert.equal(result, 'Movie (2010) (4).mkv');
});

test('respects paths already reserved by the in-progress plan, not just disk', () => {
  const reserved = new Set([path.join('/movies', 'Movie (2010).mkv')]);
  const result = resolveConflict('/movies', 'Movie (2010).mkv', false, reserved, 'Movie.mkv', '', existsFrom([]));
  assert.equal(result, 'Movie (2010) (2).mkv');
});

test('folder conflicts use plain "(N)" suffix with no extension handling', () => {
  const taken = path.join('/shows', 'Chernobyl S01');
  const result = resolveConflict('/shows', 'Chernobyl S01', true, new Set(), '', '', existsFrom([taken]));
  assert.equal(result, 'Chernobyl S01 (2)');
});

test('on a case-insensitive filesystem, the source file itself is excluded from the collision check', () => {
  // Renaming "movie.MKV" -> "Movie.mkv" is a casing-only change. On Windows/macOS
  // this must never be treated as a collision against itself, even if the
  // existence check would otherwise report every path as taken.
  const { isCaseInsensitiveFS } = require('../lib/constants');
  const sourcePath = path.join('/movies', 'movie.MKV');
  const alwaysExists = () => true;
  const result = resolveConflict('/movies', 'Movie.mkv', false, new Set(), 'movie.MKV', sourcePath, alwaysExists);
  if (isCaseInsensitiveFS) {
    assert.equal(result, 'Movie.mkv');
  } else {
    // On case-sensitive filesystems this really is a fresh name, but since
    // alwaysExists() reports everything as taken, it must fall through to a suffix.
    assert.notEqual(result, 'Movie.mkv');
  }
});
