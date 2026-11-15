// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/2-table-features.cjs      (or npm run e2e for all of them)
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
const puppeteer = require('puppeteer-core');
const OUT = OUT_DIR;
const URL = BASE;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`; results.push(line); console.log(line); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const opened = [];
  browser.on('targetcreated', t => opened.push(t.url()));
  const make = async name => {
    const ctx = await browser.createBrowserContext();
    await ctx.overridePermissions(URL, ['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('dialog', d => d.dismiss());
    return page;
  };
  const signUp = async (p, name, path = '/') => {
    await p.goto(URL + path, { waitUntil: 'networkidle0' });
    await p.waitForSelector('#screen-join:not([hidden])');
    await p.type('#form-join [data-f=name]', name);
    await p.keyboard.press('Enter');
  };

  // Host makes a table, sets Hindi letters, 90s theme and 20-second turns, adds a friend and an AI singer
  const H = await make('H');
  await signUp(H, 'Hema Malini');
  await H.waitForSelector('#screen-lobby:not([hidden])');
  await H.$eval('[data-act=board]', e => e.click()); await wait(300);
  const crown = await H.$eval('#modal-root .board-list li', li => li.classList.contains('top') && li.textContent.includes('👑')).catch(() => false);
  await H.$eval('#modal-root [data-act=close]', e => e.click());
  check('this week\'s top singer has a crown on the home screen', crown);
  await H.$eval('[data-act=start-game]', e => e.click());
  await H.waitForSelector('#screen-table:not([hidden])');
  await wait(600);
  const code = await H.$eval('#t-code', e => e.textContent.trim());

  // Tap the code: the link is copied
  // Record what the app hands to the clipboard and to window.open (WhatsApp), instead of relying on headless popups.
  await H.evaluate(() => {
    window.__copied = []; window.__opened = [];
    navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); };
    window.open = u => { window.__opened.push(u); return null; };
    navigator.share = d => { window.__opened.push('https://wa.me/?text=' + encodeURIComponent(d.text + ' ' + d.url)); return Promise.resolve(); };
  });
  await H.$eval('.t-id', e => e.click());
  await wait(400);
  const clip = (await H.evaluate(() => window.__copied[0])) || '';
  const toastNow = await H.$eval('#toasts', t => t.innerText);
  check('tapping the table code copies the link', clip.endsWith(`/?t=${code}`) && toastNow.includes('copied'), clip);

  // Invite on WhatsApp opens WhatsApp with the link
  await H.$eval('[data-act=share-wa]', e => e.click());
  await wait(300);
  const wa = (await H.evaluate(() => window.__opened[0])) || '';
  check('Invite on WhatsApp opens WhatsApp with the table link', wa.startsWith('https://wa.me/') && wa.includes(encodeURIComponent(`/?t=${code}`)), wa.slice(0, 60));

  // Settings: link-only switch for the host; set theme, time and Hindi letters
  await H.$eval('[data-act=sheet][data-arg=settings]', e => e.click());
  await wait(300);
  check('host sees the Link only switch', !!(await H.$('[data-act=toggle-private]')));
  for (const arg of ['theme=decade', 'turnSec=20', 'lang=hi']) { await H.$eval(`[data-act=set][data-arg="${arg}"]`, e => e.click()); await wait(250); }
  await H.screenshot({ path: OUT + '20-settings.png' });
  await H.$eval('[data-act=sheet-close]', e => e.click());

  // A friend joins from the link and says hello in chat
  const F = await make('F');
  await signUp(F, 'Farhan', `/?t=${code}`);
  await F.waitForSelector('#screen-table:not([hidden])');
  await wait(500);
  await F.$eval('[data-act=sheet][data-arg=chat]', e => e.click());
  await wait(200);
  await F.type('#chat-in', 'Namaste sab!');
  await F.keyboard.press('Enter');
  await wait(500);
  await H.$eval('[data-act=sheet][data-arg=chat]', e => e.click());
  await wait(300);
  const link = await H.$('.who-link');
  check('other people\'s names in chat can be tapped', !!link);
  if (link) {
    await H.$eval('.who-link', e => e.click());
    await wait(400);
    const prof = await H.$eval('#modal-root', e => e.innerText).catch(() => '');
    check('tapping a name opens their profile with Block and Report', prof.includes('Farhan') && prof.includes('Block') && prof.includes('Report'));
    check('the chat sheet closes so the profile is not hidden', await H.$eval('#sheet-root', e => !e.innerHTML.trim()));
    await H.$eval('#modal-root [data-act=close]', e => e.click());
  }
  await H.$eval('[data-act=add-bot]', e => e.click());
  await wait(500);
  await H.$eval('#t-start', e => e.click());
  await wait(1200);

  // Hindi letters: the big letter is Devanagari; screen reader hears "Your turn"
  const big = await H.$eval('.letter', e => e.textContent.trim());
  check('Hindi tables show the Devanagari letter big', /[\u0900-\u097F]/.test(big), big);
  const sr = await H.$eval('#sr', e => e.textContent);
  check('screen reader is told "Your turn"', sr.startsWith('Your turn'), sr);
  const lead = await H.$eval('#t-action .lead', e => e.innerText).catch(() => '');
  check('first turn has the one-line how-to', lead.startsWith('First time?'), lead.slice(0, 50));
  check('your-turn line says which English letter to type', /\(type [A-Z]\)/.test(lead), lead.slice(0, 80));
  await H.screenshot({ path: OUT + '21-hindi-turn.png' });

  // Voice glow: the host's own seat reacts to the (fake) microphone
  await wait(800);
  const lvl = await H.$eval(`.seat[data-tok]`, e => e.style.getPropertyValue('--lvl')).catch(() => '');
  check('seats of real people react to their voice', lvl !== '' && Number(lvl) >= 0, `--lvl ${lvl}`);
  check('AI singer seats have no voice meter', (await H.$$eval('.seat', els => els.filter(e => e.querySelector('.aib') && e.dataset.tok).length)) === 0);

  // Sing, then the friend votes on the 90s question
  const L = await H.$eval('#t-action .chipletter', e => e.textContent.trim());
  const latin = (lead.match(/\(type ([A-Z])\)/) || [])[1] || 'A';
  await H.type('#in-song', `${latin}aaj Ki Raat`);
  await H.keyboard.press('Enter');
  await wait(600);
  const q = await F.$eval('.verify p', e => e.innerText).catch(() => '');
  check('the vote question follows the 90s theme', q.includes('90s'), q.slice(0, 70));
  const tut = await H.evaluate(() => localStorage.getItem('ak-tut'));
  check('the how-to is not shown again after the first song', tut === 'seen');

  // Offline: a plain message; back online: it clears
  await F.setOfflineMode(true);
  await wait(1500);
  const off = await F.$eval('#netbar', e => e.hidden ? '' : e.textContent);
  check('going offline shows a clear message', off.includes('offline'), off);
  await F.screenshot({ path: OUT + '22-offline.png' });
  await F.setOfflineMode(false);
  let back = false;
  for (let i = 0; i < 20 && !back; i++) { await wait(500); back = await F.$eval('#netbar', e => e.hidden); }
  check('back online, the message clears by itself', back);

  // Offline start: the app shell opens from the saved copy
  const O = await make('O');
  await O.goto(URL + '/', { waitUntil: 'networkidle0' });
  await wait(1500);
  await O.reload({ waitUntil: 'networkidle0' });
  await wait(500);
  await O.setOfflineMode(true);
  await O.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await wait(800);
  const shell = await O.$eval('.brand .hi', e => e.textContent).catch(() => '');
  check('with no internet, Mehfil still opens (saved copy)', shell.includes('मेहफ़िल'), shell);

  // Open tables show the language; link-only tables are hidden
  const V = await make('V');
  await signUp(V, 'Vidya');
  await V.waitForSelector('#screen-lobby:not([hidden])');
  await wait(500);
  // Home shows one open table; all of them are in the See all pop-up.
  const allTables = async P => {
    if (await P.$('[data-act=all-tables]')) { await P.$eval('[data-act=all-tables]', e => e.click()); await wait(300); const t = await P.$$eval('#modal-root .tcard', els => els.map(e => e.innerText).join(' || ')); await P.$eval('#modal-root [data-act=close]', e => e.click()); return t; }
    return P.$$eval('#lobby-tables .tcard', els => els.map(e => e.innerText).join(' || '));
  };
  const row = await allTables(V);
  check('open tables show their letters\' language', row.includes('हिन्दी'), row.slice(0, 90));
  await H.$eval('[data-act=sheet][data-arg=settings]', e => e.click());
  await wait(300);
  await H.$eval('[data-act=toggle-private]', e => e.click());
  await wait(600);
  const row2 = await allTables(V);
  check('a link-only table disappears from Open tables', !row2.includes(code) && !row2.includes('Hema'), row2.slice(0, 90));

  check('no page errors', errors.length === 0, errors.join(' || '));
  console.log(results.join('\n'));
  await browser.close();
})().catch(e => { console.log(results.join('\n')); console.error('WALK FAILED:', e.message); process.exit(1); });
