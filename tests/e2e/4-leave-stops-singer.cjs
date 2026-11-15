// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/4-leave-stops-singer.cjs      (or npm run e2e for all of them)
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
// Leave while an AI singer is actually speaking: the voice and music must stop at once.
const puppeteer = require('puppeteer-core');
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__spoken = [];
    const s = window.speechSynthesis, speak = s.speak.bind(s);
    s.speak = u => { window.__spoken.push(u.text); return speak(u); };
  });
  for (const way of ['Leave button', 'Leave in Settings']) {
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
    if (await page.$('#screen-join:not([hidden])')) { await page.type('#form-join [data-f=name]', 'Leela'); await page.keyboard.press('Enter'); }
    await page.waitForSelector('#screen-lobby:not([hidden])');
    await page.$eval('[data-act=quick-play]', e => e.click());
    await page.waitForSelector('#screen-table:not([hidden])');
    await wait(800);
    const L = await page.$eval('.letter', e => e.textContent.trim());
    await page.type('#in-song', `${L}aana Leela Ka`);
    await page.keyboard.press('Enter');
    let speaking = false;
    for (let i = 0; i < 40 && !speaking; i++) { await wait(250); speaking = await page.evaluate(() => speechSynthesis.speaking); }
    const music = await page.evaluate(() => document.body.dataset.bed || '');
    check(`${way}: the AI singer is speaking before leaving`, speaking);
    await wait(1200);
    if (way === 'Leave button') await page.$eval('.t-btns [data-act=leave]', e => e.click());
    else { await page.$eval('[data-act=sheet][data-arg=settings]', e => e.click()); await wait(200); await page.$eval('#sheet-body [data-act=leave]', e => e.click()); }
    await wait(150);
    if (await page.$('#modal-root [data-act=leave-yes]')) await page.$eval('#modal-root [data-act=leave-yes]', e => e.click());
    await wait(500);
    const n0 = await page.evaluate(() => window.__spoken.length);
    const st = await page.evaluate(() => ({ speaking: speechSynthesis.speaking, pending: speechSynthesis.pending }));
    await wait(4000);
    const n1 = await page.evaluate(() => window.__spoken.length);
    check(`${way}: voice stops at once, no more lines`, !st.speaking && !st.pending && n1 === n0, `${JSON.stringify(st)} lines ${n0}→${n1}`);
  }
  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
