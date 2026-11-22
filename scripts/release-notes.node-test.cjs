const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readReleaseNotes, verifyReleaseNotes } = require('./release-notes.cjs');

test('release notes reject missing/blank/non-Japanese/repeated-title sources and preserve Markdown', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'maca-release-notes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs', 'releases'), { recursive: true });
  const file = join(root, 'docs', 'releases', 'v2.6.0.md');
  assert.throws(() => readReleaseNotes(root, 'v2.6.0'), /ENOENT/);
  for (const invalid of ['', ' \r\n ', 'English notes only', '# MaCa Editor v2.6.0\n日本語の概要']) {
    writeFileSync(file, invalid);
    assert.throws(() => readReleaseNotes(root, 'v2.6.0'));
  }
  writeFileSync(file, '\uFEFF日本語の概要。\r\n\r\n## 変更\r\n\r\n- `code` と [リンク](https://example.com)\r\n');
  assert.equal(readReleaseNotes(root, 'v2.6.0'), '日本語の概要。\n\n## 変更\n\n- `code` と [リンク](https://example.com)');
  assert.throws(() => readReleaseNotes(root, '../../other'), /Invalid release tag/);
  writeFileSync(join(root, 'docs', 'releases', 'v2.6.0-rc.1.md'), '試験版です。');
  assert.equal(readReleaseNotes(root, 'v2.6.0-rc.1'), '試験版です。');
});

test('publication verification detects empty or overwritten body', () => {
  const expected = '日本語の概要。\n\n## 変更\n- 修正';
  verifyReleaseNotes(expected, `${expected.replace(/\n/g, '\r\n')}\r\n`);
  for (const actual of [null, '', 'Generated English notes', '別の日本語概要']) {
    assert.throws(() => verifyReleaseNotes(expected, actual), /do not match/);
  }
  assert.throws(() => verifyReleaseNotes('', ''), /do not match/);
});
