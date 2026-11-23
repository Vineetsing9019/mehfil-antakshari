// Design check: the professional look must stay in place (no neon glows, no decorative lights,
// and the professional stylesheet loads after the old one). Runs with npm test.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const pub = path.join(__dirname, '..', 'public');
const pro = fs.readFileSync(path.join(pub, 'theme-pro.css'), 'utf8');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

console.log('Design check');
check('the professional stylesheet is linked after the old one', () => {
  const old = html.indexOf('href="/app.css"');
  const next = html.indexOf('href="/theme-pro.css"');
  assert.ok(old > -1 && next > old, 'theme-pro.css must load after app.css');
});
check('text shadows (neon glow) are switched off everywhere', () => {
  assert.match(pro, /text-shadow:\s*none\s*!important/);
});
check('the decorative top lights are hidden', () => {
  assert.match(pro, /\.lights\s*\{\s*display:\s*none\s*!important/);
});
check('the offline cache includes the professional stylesheet', () => {
  assert.match(sw, /\/theme-pro\.css/);
});
check('the page has a theme colour matching the accent', () => {
  assert.match(html, /name="theme-color" content="#3c4fd6"/);
});

check('the installed app (manifest) uses the light page colour and the accent, not the old dark purple', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'manifest.json'), 'utf8'));
  assert.strictEqual(m.background_color, '#f5f6fa');
  assert.strictEqual(m.theme_color, '#3c4fd6');
});

console.log(`${passed} design checks passed`);
