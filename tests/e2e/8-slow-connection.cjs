// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/8-slow-connection.cjs      (or npm run e2e for all of them)
// On a slow connection the screen appears before the server has answered. Anything pressed in that moment
// (sign up, Play now) must still work. This caught a real bug on the live site: the name was sent before "hello".
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
const puppeteer = require('./quiet.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const slowPage = async () => {
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.on('pageerror', e => errors.push(e.message));
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    // a slow phone connection: every request and the live connection take about 1.5 s to start
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 200 * 1024 / 8 });
    return page;
  };

  // 1. a new visitor types a name and presses Enter at once
  const A = await slowPage();
  await A.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await A.waitForSelector('#screen-join:not([hidden])', { timeout: 60000 });
  await A.type('#form-join [data-f=name]', 'Quick ' + Date.now().toString(36).slice(-4));
  await A.keyboard.press('Enter');
  const home = await A.waitForSelector('#screen-lobby:not([hidden])', { timeout: 30000 }).then(() => true).catch(() => false);
  check('signing up before the server answered still works', home);

  // 2. the same person comes back and presses Play now before the server answers
  await A.close();
  const B = await slowPage();
  await B.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await B.waitForSelector('#screen-lobby:not([hidden])', { timeout: 60000 });
  await B.$eval('[data-act=quick-play]', e => e.click());
  const table = await B.waitForSelector('#screen-table:not([hidden])', { timeout: 30000 }).then(() => true).catch(() => false);
  check('pressing Play now before the server answered still works', table);

  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
