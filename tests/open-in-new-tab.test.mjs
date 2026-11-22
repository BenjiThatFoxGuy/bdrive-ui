import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileTabDestination } from '../src/utils/file-tab-destination.ts';

const drive = { view: 'my-drive', params: { path: '/Recordings' } };

test('folders open inside the drive', () => {
  assert.deepEqual(fileTabDestination(drive, { id: 'folder', name: 'THE FINALS', isDir: true }), {
    to: '/$view', params: { view: 'my-drive' }, search: { path: '/Recordings/THE FINALS' },
  });
});

test('files retain the listing context and request the in-app viewer', () => {
  assert.deepEqual(fileTabDestination({ view: 'search', params: { query: 'clip', selectId: 'old' } }, { id: 'clip-id', name: 'clip.mp4' }), {
    to: '/$view', params: { view: 'search' }, search: { query: 'clip', previewId: 'clip-id' },
  });
});

test('shared previews stay in the share without putting credentials in the URL', () => {
  assert.deepEqual(fileTabDestination({ id: 'share', path: '/Photos', password: 'secret' }, { id: 'img', name: 'photo.png' }), {
    to: '/share/$id', params: { id: 'share' }, search: { path: '/Photos', previewId: 'img' },
  });
});

test('archives open the archive browser even when not marked previewable', () => {
  assert.deepEqual(fileTabDestination(drive, { id: 'archive', name: 'example.zip', isZip: true, openable: false }), {
    to: '/$view', params: { view: 'browse' }, search: { zipId: 'archive', zipPath: '/', archiveType: 'zip' },
  });
});

test('unsupported files do not get a direct download tab', () => {
  assert.equal(fileTabDestination(drive, { id: 'file', name: 'example.bin', openable: false }), undefined);
});
