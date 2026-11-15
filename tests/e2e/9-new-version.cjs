// End-to-end check in a real browser (headless Chrome, phone size). Start the server on THIS computer first (npm start),
// then run: node tests/e2e/9-new-version.cjs      (it touches public/app.js's date, so it only runs against localhost)
// After a deploy, people must get the new version at once, not the copy saved on their device:
// the app refreshes itself on home (once, no loop), and waits while you are at a table.
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5090';
const APP = path.join(__dirname, '..', '..', 'public', 'app.js');
const puppeteer = require('./quiet.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
const newDeploy = () => { const t = new Date(); fs.utimesSync(APP, t, t); }; // same code, new date: the server sees a new version

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // count every time the page (re)loads
  await page.evaluateOnNewDocument(() => { sessionStorage.loads = String(Number(sessionStorage.loads || 0) + 1); });
  const loads = () => page.evaluate(() => Number(sessionStorage.loads));

  await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
  await page.waitForSelector('#screen-join:not([hidden])');
  await page.type('#form-join [data-f=name]', 'Nayan');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#screen-lobby:not([hidden])');
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready, { timeout: 10000 });
  await page.reload({ waitUntil: 'networkidle0' }); // now the saved copy is in charge
  await wait(1500);
  const before = await loads();

  // 1. a deploy happens while the person is away; they open Mehfil on home
  newDeploy();
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(3000);
  const after = await loads();
  check('after a deploy, the app refreshes itself to the new version on home', after === before + 2, `loads ${before} → ${after}`);
  await wait(3000);
  check('it refreshes only once (no loop)', (await loads()) === after, `loads ${after} → ${await loads()}`);

  // 2. a deploy happens while the person is at a table: no reload until they leave
  await page.waitForSelector('#screen-lobby:not([hidden])');
  await page.$eval('[data-act=start-jam]', e => e.click());
  await page.waitForSelector('#screen-table:not([hidden])');
  await wait(800);
  const atTable = await loads();
  newDeploy();
  // the page asks the network again when something is loaded through the service worker: open the QR code image
  await page.evaluate(() => fetch('/app.js').catch(() => {}));
  await page.evaluate(() => fetch('/').catch(() => {}));
  await wait(2500);
  const toast = await page.$eval('#toasts', t => t.innerText);
  check('at a table, no sudden reload', (await loads()) === atTable && !(await page.$eval('#screen-table', e => e.hidden)));
  check('at a table, it says it will refresh after you leave', toast.includes('Mehfil was updated'), toast.split('\n').pop());
  await page.$eval('.t-btns [data-act=leave]', e => e.click());
  await wait(2500);
  check('leaving the table loads the new version', (await loads()) === atTable + 1, `loads ${atTable} → ${await loads()}`);

  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
