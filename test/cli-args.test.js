'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/cli-args');

test('defaults when no arguments are given', () => {
  assert.deepEqual(parseArgs([]), {
    argPath: null, force: false, undo: false, help: false, unknown: [],
  });
});

test('-h, -?, and a bare "help" verb all request help', () => {
  // Previously these fell through to the positional branch and were treated as
  // a *path*, producing "Path not found: …\-h"
  for (const arg of ['-h', '-?', 'help', '-H']) {
    assert.equal(parseArgs([arg]).help, true, `${arg} should set help`);
    assert.equal(parseArgs([arg]).argPath, null, `${arg} must not become a path`);
  }
});

test('unknown flags are collected instead of silently ignored', () => {
  // A silently-dropped typo used to degrade into a full rename of the cwd
  assert.deepEqual(parseArgs(['--forse']).unknown, ['--forse']);
  assert.deepEqual(parseArgs(['-x', '--nope']).unknown, ['-x', '--nope']);
  assert.equal(parseArgs(['--forse']).force, false);
});

test('valid flags never land in unknown', () => {
  const r = parseArgs(['--path=./shows', '--force', '--undo']);
  assert.deepEqual(r.unknown, []);
  assert.equal(r.argPath, './shows');
});

test('--path does not swallow a following short flag as its value', () => {
  const { argPath, help } = parseArgs(['--path', '-h']);
  assert.equal(argPath, null);
  assert.equal(help, true);
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
