// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/3-more-features.cjs      (or npm run e2e for all of them)
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
// Browser checks for items 58-75, invite by name, and "leaving stops the AI singer".
const puppeteer = require('./quiet.cjs');
const OUT = OUT_DIR;
const URL = BASE;
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const make = async name => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('dialog', d => d.dismiss());
    // Record speech so we can see when it starts and stops, and record shares.
    await page.evaluateOnNewDocument(() => {
      window.__spoken = []; window.__shared = [];
      const real = window.speechSynthesis;
      if (real) {
        const speak = real.speak.bind(real), cancel = real.cancel.bind(real);
        real.speak = u => { window.__spoken.push(u.text); return speak(u); };
        real.cancel = () => { window.__cancelled = (window.__cancelled || 0) + 1; return cancel(); };
      }
      navigator.share = d => { window.__shared.push(d); return Promise.resolve(); };
    });
    return page;
  };
  const signUp = async (p, name, path = '/') => {
    await p.goto(URL + path, { waitUntil: 'networkidle0' });
    await p.waitForSelector('#screen-join:not([hidden])');
    await p.type('#form-join [data-f=name]', name);
    await p.keyboard.press('Enter');
  };

  // Home: daily challenge
  const A = await make('A');
  await signUp(A, 'Kavya Iyer');
  await A.waitForSelector('#screen-lobby:not([hidden])');
  await wait(400);
  const daily = await A.$eval('#home-extra', e => e.innerText).catch(() => '');
  check('home shows the daily challenge', /Daily challenge: sing a [A-Z] song/.test(daily), daily);
  const h = await A.evaluate(() => document.documentElement.scrollHeight);
  check('home still fits one phone screen', h <= 844, `${h}px`);
  await A.screenshot({ path: OUT + '30-home-daily.png' });

  // Daily challenge game: my first turn, suggestions while typing, the 🎤 button
  await A.$eval('[data-act=daily]', e => e.click());
  await A.waitForSelector('#screen-table:not([hidden])');
  await wait(1000);
  const L = await A.$eval('.letter', e => e.textContent.trim());
  check('the daily game starts on the daily letter', daily.includes(` ${L} `), L);
  check('🎤 "say the song name" button is there (Chrome)', !!(await A.$('[data-act=say-title]')));
  await A.type('#in-song', L.toLowerCase());
  await wait(150);
  let opts = await A.$$eval('#song-list option', o => o.length);
  check('no suggestions after only 1 letter (no free answers)', opts === 0, String(opts));
  // The second letter must be one that songs in this table start with (not every pair exists,
  // e.g. no "Ea…" songs), so try the alphabet in turn until suggestions appear.
  let second = '', shown = [];
  for (const v of 'abcdefghijklmnopqrstuvwxyz') {
    await A.$eval('#in-song', e => { e.value = ''; });
    await A.type('#in-song', L.toLowerCase() + v);
    await wait(150);
    shown = await A.$$eval('#song-list option', o => o.map(x => x.value));
    if (shown.length > 0) { second = v; break; }
  }
  check('suggestions appear after 2 letters', shown.length > 0 && shown.every(t => t.toLowerCase().startsWith(L.toLowerCase() + second)), shown.slice(0, 3).join(', '));
  await A.$eval('#in-song', e => { e.value = ''; });
  await A.type('#in-song', `${L}aana Mera Dil`);
  await A.screenshot({ path: OUT + '31-my-turn.png' });
  await A.keyboard.press('Enter');

  // +points pop-up and badge pop-up
  let pts = '';
  for (let i = 0; i < 20 && !pts; i++) { await wait(100); pts = await A.$eval('.points', e => e.textContent).catch(() => ''); }
  check('"+points" pops up when my song is accepted', /^\+1[05]/.test(pts), pts);
  let badge = '';
  for (let i = 0; i < 20 && !badge; i++) { await wait(100); badge = await A.$eval('.badgepop', e => e.innerText).catch(() => ''); }
  check('badge pop-up for my first song', badge.includes('First song'), badge.replace(/\n/g, ' '));
  await A.screenshot({ path: OUT + '32-points-badge.png' });

  // AI singer's turn: music bed, Skip for the host
  let botTurn = false;
  for (let i = 0; i < 30 && !botTurn; i++) { await wait(200); botTurn = !!(await A.$('#t-stage .lyric')); }
  check('AI singer starts singing', botTurn);
  await wait(1500);
  const spokenBefore = await A.evaluate(() => window.__spoken.length);
  check('its lines are spoken', spokenBefore >= 1, String(spokenBefore));
  check('host sees Skip ⏭', !!(await A.$('[data-act=skip-bot]')));
  const ambOn = await A.evaluate(() => [...document.querySelectorAll('*')].length > 0); // page alive
  await A.$eval('[data-act=skip-bot]', e => e.click());
  await wait(1500);
  const spokenAfter = await A.evaluate(() => window.__spoken.length);
  const speaking = await A.evaluate(() => window.speechSynthesis.speaking);
  check('Skip stops the AI singer at once', !speaking && spokenAfter <= spokenBefore + 1, `spoken ${spokenBefore}→${spokenAfter}, speaking ${speaking}`);

  // Settings: AI level, sounds, QR
  await A.$eval('[data-act=sheet][data-arg=settings]', e => e.click());
  await wait(300);
  check('Settings has AI singer level (Easy / Normal / Hard)', (await A.$$eval('[data-act=set][data-arg^=botLevel]', e => e.length)) === 3);
  check('Settings has a Sounds switch', !!(await A.$('[data-act=sfx]')));
  await A.$eval('[data-act=set][data-arg="botLevel=easy"]', e => e.click());
  await wait(300);
  check('AI level can be changed mid-game', await A.$eval('[data-act=set][data-arg="botLevel=easy"]', e => e.classList.contains('on')));
  await A.$eval('[data-act=qr]', e => e.click());
  await wait(800);
  const qrOk = await A.$eval('#modal-root img.qr', i => i.complete && i.naturalWidth > 0).catch(() => false);
  check('QR code to join shows', qrOk);
  await A.screenshot({ path: OUT + '33-qr.png' });
  await A.$eval('#modal-root [data-act=close]', e => e.click());

  // Invite by name and mute one person
  const B = await make('B');
  await signUp(B, 'Bhavesh Rao');
  await B.waitForSelector('#screen-lobby:not([hidden])');
  await wait(500);
  await A.$eval('[data-act=sheet][data-arg=singers]', e => e.click());
  await wait(300);
  await A.type('#inv-q', 'bhav');
  await wait(300);
  const found = await A.$$eval('#inv-list .mrow', rows => rows.map(r => r.innerText.replace(/\s+/g, ' ')));
  check('Invite by name finds a friend', found.some(t => t.includes('Bhavesh')), found.join(' | '));
  check('typing is kept while the table updates', (await A.$eval('#inv-q', i => i.value)) === 'bhav');
  await A.screenshot({ path: OUT + '34-invite-name.png' });
  await A.$eval('#inv-list [data-act=req]', e => e.click());
  await wait(600);
  const inv = await B.$eval('#modal-root', e => e.innerText).catch(() => '');
  check('the friend gets the invite', inv.includes('Kavya') && inv.includes('Accept'), inv.slice(0, 40));
  await B.$eval('#modal-root [data-act=invite-yes]', e => e.click());
  await B.waitForSelector('#screen-table:not([hidden])');
  await wait(800);
  await A.$eval('[data-act=sheet][data-arg=singers]', e => e.click());
  await wait(300);
  const muteBtn = await A.$('.members [data-act=mute]');
  check('each real person has a mute button', !!muteBtn);
  if (muteBtn) {
    await A.$eval('.members [data-act=mute]', e => e.click());
    await wait(300);
    const toast = await A.$eval('#toasts', t => t.innerText);
    check('mute is only for me, and says so', toast.includes('muted for you only'), toast.split('\n').pop());
  }
  await A.$eval('[data-act=sheet-close]', e => e.click()).catch(() => {});

  // Leave while an AI singer is singing: everything stops at once
  let singing = false;
  for (let i = 0; i < 120 && !singing; i++) { await wait(250); singing = !!(await A.$('#t-stage .lyric')) && await A.evaluate(() => window.speechSynthesis.speaking); }
  await A.$eval('.t-btns [data-act=leave]', e => e.click());
  await wait(200);
  if (await A.$('#modal-root [data-act=leave-yes]')) await A.$eval('#modal-root [data-act=leave-yes]', e => e.click());
  await wait(1200);
  const after = await A.evaluate(() => ({ speaking: window.speechSynthesis.speaking, pending: window.speechSynthesis.pending, lobby: !document.querySelector('#screen-lobby').hidden }));
  const spokenAt = await A.evaluate(() => window.__spoken.length);
  await wait(3000);
  const spokenLater = await A.evaluate(() => window.__spoken.length);
  check('after Leave, the AI singer stops at once', after.lobby && !after.speaking && !after.pending && spokenLater === spokenAt, JSON.stringify(after) + ` lines ${spokenAt}→${spokenLater}`);

  // Game over: recap, rematch for a non-host, share sheet
  const H = await make('H');
  await signUp(H, 'Hasan');
  await H.waitForSelector('#screen-lobby:not([hidden])');
  await H.$eval('[data-act=start-game]', e => e.click());
  await H.waitForSelector('#screen-table:not([hidden])');
  await wait(400);
  await H.$eval('[data-act=sheet][data-arg=settings]', e => e.click());
  await wait(200);
  await H.$eval('[data-act=set][data-arg="lives=1"]', e => e.click());
  await wait(200);
  await H.$eval('[data-act=sheet-close]', e => e.click());
  await H.$eval('[data-act=add-bot]', e => e.click());
  await wait(400);
  const code = await H.$eval('#t-code', e => e.textContent.trim());
  const G = await make('G');
  await signUp(G, 'Gauri', `/?t=${code}`);
  await G.waitForSelector('#screen-table:not([hidden])');
  await wait(400);
  await H.$eval('#t-start', e => e.click());
  await wait(800);
  // Hasan sings one song, then the friends pass until the game ends
  for (let r = 0; r < 12; r++) {
    const st = await H.evaluate(() => document.querySelector('.trophy') ? 'over' : 'on');
    if (st === 'over') break;
    for (const P of [H, G]) {
      if (await P.$('#in-song')) {
        const l = await P.$eval('.letter', e => e.textContent.trim());
        if (P === H && r === 0) { await P.type('#in-song', `${l}aana Hasan Ka`); await P.keyboard.press('Enter'); }
        else await P.$eval('[data-act=pass]', e => e.click());
      }
      if (await P.$('.verify [data-act=vote]')) await P.$eval('.verify [data-act=vote][data-arg=up]', e => e.click());
    }
    await wait(1500);
    if (await H.$('[data-act=skip-bot]')) await H.$eval('[data-act=skip-bot]', e => e.click());
  }
  await wait(800);
  const overG = await G.$eval('#modal-root', e => e.innerText).catch(() => '');
  check('Game over shows the songs sung', overG.includes('🎵'), overG.split('\n').filter(l => l.includes('🎵')).slice(0, 2).join(' | '));
  check('a non-host gets "Ask for a rematch"', overG.includes('Ask for a rematch'));
  await G.screenshot({ path: OUT + '35-game-over.png' });
  if (overG.includes('Ask for a rematch')) {
    await G.$eval('#modal-root [data-act=rematch]', e => e.click());
    await wait(500);
    const hostToast = await H.$eval('#toasts', t => t.innerText);
    check('the host is told about the rematch', hostToast.includes('wants a rematch'), hostToast.split('\n').pop());
  }
  await H.$eval('#modal-root [data-act=share-result]', e => e.click()).catch(() => {});
  await wait(300);
  const shared = await H.evaluate(() => window.__shared[0]);
  check('Share uses the phone\'s share sheet (picture or link)', !!shared && (String(shared.url || '') + ' ' + shared.text).includes(`/?t=${code}`), shared ? shared.text.slice(0, 40) : '');

  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
