// Repo hygiene, shared by CI and anyone running npm run check.
// Everything here is a hard failure: this repository is English-only and
// carries no tool-attribution strings.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HANGUL = /[ᄀ-ᇿㄱ-ㆎꥠ-꥿가-힣ힰ-퟿ﾠ-ￜ]/;
const BANNED = [
  /Co-Authored-By: Claude/i,
  /Generated with \[?Claude/i,
  /\u{1F916}/u,
  /^#{1,6} [\u{1F300}-\u{1FAFF}✀-➿]/mu,
  /^\s*\/\/ ={4,}/m,
];
const CLICHES = /\b(seamlessly|leverage|delve|cutting-edge|game-chang\w*|revolutioniz\w*)\b/i;

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];

for (const file of files) {
  if (file === 'scripts/check.mjs') continue;
  if (/\.(png|jpg|gif|ico|epub|zip|woff2?)$/.test(file)) continue;
  const body = readFileSync(file, 'utf8');
  const folded = body.normalize('NFKC');
  if (HANGUL.test(folded)) problems.push(`${file}: Korean text (this repository is English-only)`);
  for (const re of BANNED) {
    if (re.test(body)) problems.push(`${file}: banned pattern ${re}`);
  }
  if (CLICHES.test(body)) problems.push(`${file}: marketing cliche ${CLICHES.exec(body)[0]}`);
}

let log = '';
try {
  log = execSync('git log --format=%B -n 30', { encoding: 'utf8' });
} catch {}
if (/Co-Authored-By: Claude|Generated with \[?Claude|\u{1F916}/iu.test(log)) {
  problems.push('git log: attribution trailer in a recent commit message');
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check: ${files.length} files clean`);
