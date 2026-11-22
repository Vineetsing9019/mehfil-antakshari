// Runs every end-to-end check in order. Start the server first (npm start).
// Each check prints PASS or FAIL. A FAIL anywhere makes the whole run fail,
// not only a suite that crashes.
const { execFileSync } = require('child_process');
const path = require('path');
const files = ["1-screens.cjs","2-table-features.cjs","3-more-features.cjs","4-leave-stops-singer.cjs","5-result-card.cjs","6-video-call.cjs","7-find-a-friend.cjs","8-slow-connection.cjs","9-new-version.cjs","10-age-check.cjs"];
let failures = 0;
for (const f of files) {
  console.log('\n== ' + f);
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    failures++; // the suite crashed
  }
  process.stdout.write(out);
  failures += out.split('\n').filter(line => line.startsWith('FAIL')).length;
}
console.log(failures ? `\n${failures} end-to-end check(s) FAILED` : '\nAll end-to-end checks passed');
process.exitCode = failures ? 1 : 0;
