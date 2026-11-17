// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/10-age-check.cjs      (or npm run e2e for all of them)
// Mehfil is 16+: every time it opens it asks "Are you 16 or older?". Yes opens the app; No blocks it kindly.
// Nothing connects to the server before the answer, so an invite link can't seat anyone who hasn't said yes.
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
const puppeteer = require('./quiet.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], askAge: true });
  const errors = [];
  const make = async name => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    // watch the live connection: did the page talk to the server?
    page.__ws = [];
    const cdp = await page.createCDPSession(); await cdp.send('Network.enable');
    cdp.on('Network.webSocketCreated', e => page.__ws.push(e.url));
    return page;
  };
  const gateText = p => p.$eval('#agegate', e => (e.hidden ? '' : e.innerText.replace(/\s+/g, ' ')));

  // 1. Yes: the app opens
  const A = await make('A');
  await A.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(1200);
  check('opening Mehfil asks "Are you 16 or older?"', (await gateText(A)).includes('Are you 16 or older?'));
  check('nothing connects to the server before the answer', A.__ws.length === 0, `${A.__ws.length} connections`);
  const prim = await A.$$eval('#agegate .btn-primary', b => b.map(x => x.textContent.trim()));
  check('one main button: "Yes, I\'m 16+"', prim.length === 1 && prim[0] === "Yes, I'm 16+", prim.join(' | '));
  await A.screenshot({ path: OUT_DIR + 'age-ask.png' });
  await A.$eval('[data-act=age-yes]', e => e.click());
  await wait(800);
  check('Yes opens the app', (await gateText(A)) === '' && !(await A.$eval('#screen-join', e => e.hidden)));
  check('Yes connects to the server', A.__ws.length >= 1);
  await A.type('#form-join [data-f=name]', 'Adult');
  await A.keyboard.press('Enter');
  const home = await A.waitForSelector('#screen-lobby:not([hidden])', { timeout: 15000 }).then(() => true).catch(() => false);
  check('after Yes, signing up works as usual', home);
  await A.reload({ waitUntil: 'domcontentloaded' });
  await wait(800);
  check('not asked again when the app refreshes in the same tab', (await gateText(A)) === '');
  const A2 = await A.browserContext().newPage();
  await A2.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(800);
  check('asked again when Mehfil is opened again (new tab)', (await A2.$eval('#agegate', e => e.innerText)).includes('16 or older'));

  // 2. No: blocked, kindly
  const B = await make('B');
  await B.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await wait(800);
  await B.$eval('[data-act=age-no]', e => e.click());
  await wait(400);
  const blocked = await gateText(B);
  check('No shows a kind "Mehfil is for 16+" message', blocked.includes('Sorry, Mehfil is for 16+') && blocked.includes('turn 16'), blocked.slice(0, 60));
  check('No has no way into the app (no buttons)', (await B.$$eval('#agegate button', b => b.length)) === 0);
  check('No never connects to the server', B.__ws.length === 0);
  await B.screenshot({ path: OUT_DIR + 'age-no.png' });

  // 3. an invite link does nothing until Yes
  await A.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await A.waitForSelector('#screen-lobby:not([hidden])', { timeout: 15000 });
  await wait(1500);
  await A.$eval('[data-act=start-jam]', e => e.click());
  await A.waitForSelector('#screen-table:not([hidden])', { timeout: 15000 });
  await wait(500);
  const code = await A.$eval('#t-code', e => e.textContent.trim());
  const C = await make('C');
  await C.goto(`${BASE}/?t=${code}`, { waitUntil: 'domcontentloaded' });
  await wait(1500);
  const membersBefore = await A.$$eval('.seat', s => s.length);
  check('an invite link alone does not seat anyone before Yes', membersBefore === 1 && C.__ws.length === 0, `${membersBefore} seat(s)`);

  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
