'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCameraFile } = require('../lib/camera');

test('VID_ prefixed camera file is detected', () => {
  assert.equal(isCameraFile('VID_20190624_191055.mp4'), true);
});

test('IMG_ prefixed camera file is detected', () => {
  assert.equal(isCameraFile('IMG_20210101_120000.mp4'), true);
});

test('bare timestamp filename is detected', () => {
  assert.equal(isCameraFile('20190624_191055.mp4'), true);
});

test('camera file wrapped in a bracketed source label is still detected', () => {
  // Note: the bracket content must not contain a path separator — path.basename()
  // splits on "\" on win32, which would truncate the bracket before it's stripped.
  assert.equal(isCameraFile('[Google Photos] VID_20190624_191055.mp4'), true);
});

test('regular movie filename is not a camera file', () => {
  assert.equal(isCameraFile('The Dark Knight (2008).mkv'), false);
});

test('anime filename is not a camera file', () => {
  assert.equal(isCameraFile('Demon Slayer E26.mkv'), false);
});
