// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/5-result-card.cjs      (or npm run e2e for all of them)
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
// Plays a quick game to the end, presses Share, and saves the result picture the app made.
const fs = require('fs');
const puppeteer = require('./quiet.cjs');
const OUT = OUT_DIR;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__shared = [];
    navigator.canShare = d => !!(d && d.files);
    navigator.share = async d => { window.__shared.push({ text: d.text, files: d.files ? await Promise.all([...d.files].map(f => f.arrayBuffer().then(b => ({ name: f.name, type: f.type, b64: btoa(String.fromCharCode(...new Uint8Array(b).slice(0, 0))), size: b.byteLength, url: URL.createObjectURL(f) })))) : null }); };
  });
  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await page.type('#form-join [data-f=name]', 'Asha');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#screen-lobby:not([hidden])');
  await page.$eval('[data-act=start-game]', e => e.click());
  await page.waitForSelector('#screen-table:not([hidden])');
  await wait(400);
  await page.$eval('[data-act=sheet][data-arg=settings]', e => e.click()); await wait(200);
  await page.$eval('[data-act=set][data-arg="lives=1"]', e => e.click()); await wait(200);
  await page.$eval('[data-act=sheet-close]', e => e.click());
  await page.$eval('[data-act=add-bot]', e => e.click()); await wait(400);
  await page.$eval('#t-start', e => e.click()); await wait(800);
  const L = await page.$eval('.letter', e => e.textContent.trim());
  await page.type('#in-song', `${L}ilwale Ka Gaana`); await page.keyboard.press('Enter');
  for (let i = 0; i < 120 && !(await page.$('.trophy')); i++) {
    if (await page.$('[data-act=skip-bot]')) await page.$eval('[data-act=skip-bot]', e => e.click()).catch(() => {});
    if (await page.$('#in-song')) await page.$eval('[data-act=pass]', e => e.click()).catch(() => {});
    await wait(500);
  }
  await page.$eval('#modal-root [data-act=share-result]', e => e.click());
  await wait(1500);
  const shared = await page.evaluate(() => window.__shared[0]);
  console.log(shared && shared.files ? `PASS  Share sends a picture: ${shared.files[0].name}, ${shared.files[0].type}, ${(shared.files[0].size / 1024).toFixed(0)} KB` : 'FAIL  no picture shared');
  if (shared && shared.files) {
    const b64 = await page.evaluate(async u => { const b = await (await fetch(u)).blob(); return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }); }, shared.files[0].url);
    fs.writeFileSync(OUT + '40-result-card.jpg', Buffer.from(b64, 'base64'));
    console.log('saved 40-result-card.jpg');
  }
  console.log(errors.length ? 'FAIL  page errors: ' + errors.join(' | ') : 'PASS  no page errors');
  await browser.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
