// Runs every end-to-end check in order. Start the server first (npm start).
const { execFileSync } = require('child_process');
const path = require('path');
for (const f of ["1-screens.cjs","2-table-features.cjs","3-more-features.cjs","4-leave-stops-singer.cjs","5-result-card.cjs","6-video-call.cjs","7-find-a-friend.cjs","8-slow-connection.cjs","9-new-version.cjs"]) {
  console.log('\n== ' + f);
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }); }
  catch { process.exitCode = 1; }
}
