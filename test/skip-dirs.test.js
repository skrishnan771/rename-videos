'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipDir } = require('../lib/skip-dirs');

test('skips a directory by exact name match', () => {
  const result = shouldSkipDir('/repo/node_modules', 'node_modules', ['some-pkg']);
  assert.equal(result.skip, true);
});

test('exact name match is case-insensitive', () => {
  const result = shouldSkipDir('/repo/Node_Modules', 'Node_Modules', []);
  assert.equal(result.skip, true);
});

test('skips a directory containing a project marker file', () => {
  const result = shouldSkipDir('/media-server', 'media-server', ['package.json', 'index.js']);
  assert.equal(result.skip, true);
  assert.match(result.reason, /package\.json/);
});

test('does not skip an ordinary media directory', () => {
  const result = shouldSkipDir('/movies/Inception (2010)', 'Inception (2010)', ['Inception.mkv']);
  assert.equal(result.skip, false);
});
