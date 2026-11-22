const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const normalize = (body) => body.replace(/\r\n/g, '\n').trim();

function readReleaseNotes(root, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)) {
    throw new Error(`Invalid release tag: ${tag}`);
  }
  const file = join(root, 'docs', 'releases', `${tag}.md`);
  const body = normalize(readFileSync(file, 'utf8'));
  if (!body) throw new Error(`Release notes are empty: ${file}`);
  if (!/[\u3040-\u30ff]/u.test(body)) {
    throw new Error(`Release notes must contain Japanese text: ${file}`);
  }
  if (body.split('\n').some((line) => line.replace(/^#+\s*/, '').trim() === `MaCa Editor ${tag}`)) {
    throw new Error(`Do not repeat the release title in ${file}`);
  }
  return body;
}

function verifyReleaseNotes(expected, actual) {
  if (!expected?.trim() || normalize(actual ?? '') !== normalize(expected)) {
    throw new Error('Published release notes do not match the Japanese source');
  }
}

module.exports = { readReleaseNotes, verifyReleaseNotes };
