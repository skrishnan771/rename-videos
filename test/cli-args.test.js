'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/cli-args');

test('defaults when no arguments are given', () => {
  assert.deepEqual(parseArgs([]), { argPath: null, force: false, undo: false, help: false });
});

test('--path="value" (quoted, equals form)', () => {
  const { argPath } = parseArgs(['--path="./movies"']);
  assert.equal(argPath, './movies');
});

test('--path=value (unquoted, equals form)', () => {
  const { argPath } = parseArgs(['--path=./movies']);
  assert.equal(argPath, './movies');
});

test('--path value (space-separated form)', () => {
  const { argPath } = parseArgs(['--path', './movies']);
  assert.equal(argPath, './movies');
});

test('bare positional path with no leading flag', () => {
  const { argPath } = parseArgs(['./movies']);
  assert.equal(argPath, './movies');
});

test('--path followed by another flag does not consume it as the value', () => {
  const { argPath, force } = parseArgs(['--path', '--force']);
  assert.equal(argPath, null);
  assert.equal(force, true);
});

test('--force, --undo, --help flags', () => {
  assert.equal(parseArgs(['--force']).force, true);
  assert.equal(parseArgs(['--undo']).undo, true);
  assert.equal(parseArgs(['--help']).help, true);
});

test('flags are case-insensitive', () => {
  assert.equal(parseArgs(['--FORCE']).force, true);
});

test('combining path and force', () => {
  const result = parseArgs(['--path=./shows', '--force']);
  assert.equal(result.argPath, './shows');
  assert.equal(result.force, true);
});
