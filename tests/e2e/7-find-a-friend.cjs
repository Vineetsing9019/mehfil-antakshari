// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/7-find-a-friend.cjs      (or npm run e2e for all of them)
// Home: search a friend by name, invite them, or join their open table. Link-only tables can't be joined this way.
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
const puppeteer = require('./quiet.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  const make = async name => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    return page;
  };
  const signUp = async (p, name) => {
    await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#screen-join:not([hidden])');
    await p.type('#form-join [data-f=name]', name);
    await p.keyboard.press('Enter');
    await p.waitForSelector('#screen-lobby:not([hidden])');
  };
  const rows = p => p.$$eval('#find-list .mrow', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));

  const stamp = Date.now().toString(36).slice(-4);
  const A = await make('A'), B = await make('B');
  await signUp(A, `Tanvi ${stamp}`);
  await signUp(B, `Rahul ${stamp}`);
  await wait(500);

  check('home has "Find a friend"', !!(await A.$('[data-act=find-friend]')));
  await A.$eval('[data-act=find-friend]', e => e.click());
  await wait(200);
  await A.type('#find-q', `rahul ${stamp}`);
  await wait(300);
  let r = await rows(A);
  check('typing a name finds the friend who is online', r.length === 1 && r[0].includes('Rahul') && r[0].includes('Invite'), r.join(' | '));
  await A.screenshot({ path: OUT_DIR + 'find-a-friend.png' });
  await A.$eval('#find-list [data-act=req]', e => e.click());
  await wait(600);
  const inv = await B.$eval('#modal-root', e => e.innerText).catch(() => '');
  check('Invite sends them a request', inv.includes('Tanvi') && inv.includes('Accept'), inv.slice(0, 40));
  await B.$eval('#modal-root [data-act=invite-no]', e => e.click());
  await wait(400);

  // Rahul opens a table: Tanvi can now join him from the search
  await B.$eval('[data-act=start-game]', e => e.click());
  await B.waitForSelector('#screen-table:not([hidden])');
  await wait(600);
  r = await rows(A);
  check('a friend at an open table shows Join', r.some(t => t.includes('Rahul') && t.includes('Join')), r.join(' | '));
  await A.$eval('#find-list [data-act=join-tap]', e => e.click());
  await A.waitForSelector('#screen-table:not([hidden])', { timeout: 5000 }).catch(() => {});
  const same = (await A.$eval('#t-code', e => e.textContent.trim()).catch(() => '')) === (await B.$eval('#t-code', e => e.textContent.trim()));
  check('Join takes you straight to their table', same);

  // a link-only table can't be joined from search
  await A.$eval('.t-btns [data-act=leave]', e => e.click());
  await wait(200);
  if (await A.$('#modal-root [data-act=leave-yes]')) await A.$eval('#modal-root [data-act=leave-yes]', e => e.click());
  await A.waitForSelector('#screen-lobby:not([hidden])');
  await B.$eval('[data-act=sheet][data-arg=settings]', e => e.click()); await wait(200);
  await B.$eval('[data-act=toggle-private]', e => e.click()); await wait(500);
  if ((await A.$eval('#find', e => e.hidden))) await A.$eval('[data-act=find-friend]', e => e.click());
  await A.$eval('#find-q', e => { e.value = ''; });
  await A.type('#find-q', `rahul ${stamp}`);
  await wait(400);
  r = await rows(A);
  check('a friend at a link-only table: no Join, says private', r.length === 1 && !r[0].includes('Join') && r[0].includes('private'), r.join(' | '));

  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
