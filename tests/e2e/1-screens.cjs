// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/1-screens.cjs      (or npm run e2e for all of them)
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
const puppeteer = require('./quiet.cjs');
const OUT = OUT_DIR;
const URL = BASE;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const make = async (name, w = 390, h = 844) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_CERT|net::/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    return page;
  };
  const noOverflow = async (p, label) => {
    const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
    check(`${label}: no sideways scroll`, r.sw <= r.w, `${r.sw}/${r.w}`);
  };
  const visiblePrimaries = p => p.$$eval('.btn-primary', els => els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));

  // 1. First visit: name only
  const A = await make('A');
  await A.goto(URL + '/', { waitUntil: 'networkidle0' });
  await A.waitForSelector('#screen-join:not([hidden])');
  const fields = await A.$$eval('#form-join input, #form-join textarea', els => els.length);
  check('first screen asks only for a name', fields === 1, `${fields} fields`);
  const focused = await A.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.f);
  check('name box is focused', focused === 'name', String(focused));
  check('wrong "mic only on your turn" note is gone', !(await A.$eval('body', b => b.innerText.includes('Mic opens only on your turn'))));
  const d1 = await A.$eval('#demo-card', e => e.innerText.replace(/\s+/g, ' '));
  await wait(2400);
  const d2 = await A.$eval('#demo-card', e => e.innerText.replace(/\s+/g, ' '));
  check('first screen shows the letter-passing demo, and it moves', d1.includes('sings') && d1 !== d2, `${d1} → ${d2}`);
  const jh = await A.evaluate(() => document.documentElement.scrollHeight);
  check('first screen fits one phone screen', jh <= 844, `${jh}px`);
  await A.screenshot({ path: OUT + '1-join.png' });
  await noOverflow(A, 'join');
  const before = await A.$eval('[data-preview]', i => i.src);
  await A.type('#form-join [data-f=name]', 'Asha Sharma');
  const after = await A.$eval('[data-preview]', i => i.src);
  check('avatar initials update while typing', before !== after && after.startsWith('data:image/svg'));
  await A.keyboard.press('Enter');
  await A.waitForSelector('#screen-lobby:not([hidden])');
  await wait(800);

  // 2. Lobby
  const toasts = await A.$eval('#toasts', t => t.innerText);
  check('no "Profile saved" toast on first visit', !toasts.includes('Profile saved'), toasts);
  check('greets by first name', (await A.$eval('#hello', e => e.textContent)) === 'Namaste, Asha 👋');
  const prim = await visiblePrimaries(A);
  check('lobby has exactly one primary button', prim.length === 1, prim.join(' | '));
  check('Open tables box only when there are tables', await A.evaluate(() => document.querySelector('#tables-card').hidden === !document.querySelector('#lobby-tables').children.length));
  check('code box is behind "Have a table code?"', await A.$eval('#code-form', e => e.hidden));
  const ai = await A.$$eval('#ai-people .story', els => els.filter(e => e.querySelector('.aib')).length);
  check('singers are one row of round avatars, AI singers marked AI', ai === 20, `${ai} AI`);
  const h = await A.evaluate(() => document.documentElement.scrollHeight);
  check('home fits one phone screen (no long scroll)', h <= 844, `${h}px tall`);
  await A.$eval('#ai-people .story:has(.aib)', e => e.click());
  await wait(300);
  const sing = await A.$eval('#modal-root', e => e.innerText).catch(() => '');
  check('tapping an AI singer offers "Sing with …"', /Sing with \w+/.test(sing), sing.split('\n').find(l => l.startsWith('Sing with')) || '');
  await A.$eval('#modal-root [data-act=close]', e => e.click());
  await wait(200);
  await A.$eval('[data-act=howto]', e => e.click());
  await wait(200);
  check('How to play opens as a small pop-up', (await A.$eval('#modal-root', e => e.innerText)).includes('big letter'));
  await A.$eval('#modal-root [data-act=close]', e => e.click());
  const ext = await A.$$eval('img', els => els.map(e => e.src).filter(s => /dicebear/.test(s)).length);
  check('no avatars loaded from an outside site', ext === 0, `${ext}`);
  await A.screenshot({ path: OUT + '2-lobby.png', fullPage: true });
  await noOverflow(A, 'lobby');

  // 3. Play now
  await A.$eval('[data-act=quick-play]', e => e.click());
  await A.waitForSelector('#screen-table:not([hidden])');
  await wait(1200);
  const seats = await A.$$eval('.seat', els => els.length);
  const aiSeats = await A.$$eval('.seat .aib', els => els.length);
  check('Play now: game on with 3 seats, 2 marked AI', seats === 3 && aiSeats === 2, `${seats} seats, ${aiSeats} AI`);
  check('Start button hidden while playing', await A.$eval('#t-start', e => e.hidden));
  await A.screenshot({ path: OUT + '3-table-start.png' });
  await noOverflow(A, 'table');

  // 4. My turn (host goes first): type only the title; the last word fills itself in
  const mine = await A.$('#in-song');
  if (mine) {
    const L = await A.$eval('.letter', e => e.textContent.trim());
    await A.type('#in-song', `${L}aana Mera Dil`);
    check('no "last word" box to fill in', !(await A.$('#in-last')));
    const auto = await A.$eval('#next-hint .nl', e => e.textContent);
    check('next letter comes from the song name by itself', auto === 'L', auto);
    const passPos = await A.evaluate(() => { const r = document.querySelector('[data-act=pass]').getBoundingClientRect(); return { inRow: !!document.querySelector('.turnrow [data-act=pass]'), bottom: r.bottom, dock: document.querySelector('.dock').getBoundingClientRect().top }; });
    check('Pass is visible, in the row with Done', passPos.inRow && passPos.bottom < passPos.dock, JSON.stringify(passPos));
    await A.$eval('[data-act=pick-letter]', e => e.click());
    await wait(250);
    const az = await A.$$eval('#modal-root .az [data-act=set-letter]', b => b.map(x => x.textContent).join(''));
    check('"Choose a letter" opens A to Z', az === 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', az);
    await A.screenshot({ path: OUT + '4b-pick-letter.png' });
    await A.$eval('#modal-root [data-act=set-letter][data-arg=M]', e => e.click());
    await wait(200);
    const picked = await A.$eval('#next-hint', e => e.innerText.replace(/\s+/g, ' '));
    check('the picked letter shows as the next letter', picked.includes('M') && picked.includes('your pick'), picked);
    check('the song name is kept after picking', (await A.$eval('#in-song', e => e.value)).endsWith('aana Mera Dil'));
    const p2 = await visiblePrimaries(A);
    check('my turn has exactly one primary (Done)', p2.length === 1 && p2[0].startsWith('Done'), p2.join(' | '));
    const pos = await A.evaluate(() => ({ done: document.querySelector('[data-act=song-done]').getBoundingClientRect().bottom, dock: document.querySelector('.dock').getBoundingClientRect().top }));
    check('Done button is in view above the bottom bar', pos.done < pos.dock, `${Math.round(pos.done)} < ${Math.round(pos.dock)}`);
    await A.screenshot({ path: OUT + '4-my-turn.png' });
    await A.keyboard.press('Enter');
  } else check('host had the first turn', false, 'no song box');

  // 5. Bot's turn: lyrics shown in their own box
  let lyric = false;
  for (let i = 0; i < 20 && !lyric; i++) { await wait(500); lyric = !!(await A.$('#t-stage .lyric span')); }
  check('bot turn shows its lyrics', lyric);
  const botLetter = await A.$eval('.letter', e => e.textContent.trim());
  check('the next singer got the letter I picked (M)', botLetter === 'M', botLetter);
  const lt = await A.$eval('.lyric-title', e => e.textContent).catch(() => '');
  check('lyric box is titled with the song', lt.startsWith('🎵 ') && lt.length > 3, lt);
  const centerText = await A.$eval('.center', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  check('circle text is short (no song title squeezed inside)', !centerText.includes('“'), centerText);
  await wait(2500);
  const lit = await A.$$eval('#t-stage .lyric span.on', els => els.length);
  check('a lyric line lights up as it is sung (needs speech in this browser)', lit === 1, `${lit} lit`);
  await A.screenshot({ path: OUT + '5-bot-sings.png' });

  // 6. Settings and leaving mid-game
  await A.$eval('[data-act=sheet][data-arg=settings]', e => e.click());
  await wait(400);
  check('Settings has the AI voice switch', !!(await A.$('[data-act=ai-voice]')));
  await A.screenshot({ path: OUT + '6-settings.png' });
  await A.$eval('[data-act=sheet-close]', e => e.click());
  await wait(200);
  await A.$eval('.t-btns [data-act=leave]', e => e.click());
  await wait(300);
  const ask = await A.$eval('#modal-root', e => e.innerText).catch(() => '');
  check('leaving mid-game asks first', ask.includes('Leave the game?'), ask.slice(0, 40));
  await A.screenshot({ path: OUT + '7-leave-ask.png' });
  await A.$eval('#modal-root [data-act=close]', e => e.click());
  await wait(200);
  check('"Keep singing" keeps you at the table', !(await A.$eval('#screen-table', e => e.hidden)));

  // 7. Waiting room (Play with friends)
  const B = await make('B');
  await B.goto(URL + '/', { waitUntil: 'networkidle0' });
  await B.waitForSelector('#screen-join:not([hidden])');
  await B.type('#form-join [data-f=name]', 'Bobby');
  await B.$eval('[data-act=save-profile]', e => e.click());
  await B.waitForSelector('#screen-lobby:not([hidden])');
  await B.$eval('[data-act=start-game]', e => e.click());
  await B.waitForSelector('#screen-table:not([hidden])');
  await wait(800);
  const wp = await visiblePrimaries(B);
  check('alone: the one primary is the invite button', wp.length === 1 && /^Invite (friends|on WhatsApp)$/.test(wp[0]), wp.join(' | '));
  check('alone: no disabled Start button', await B.$eval('#t-start', e => e.hidden));
  check('no repeated "Table ready" toast', !(await B.$eval('#toasts', t => t.innerText)).includes('Table ready'));
  await B.screenshot({ path: OUT + '8-waiting-alone.png' });
  await B.$eval('[data-act=add-bot]', e => e.click());
  await wait(600);
  const wp2 = await visiblePrimaries(B);
  check('with an AI singer: Start game becomes the one primary', wp2.length === 1 && wp2[0] === 'Start game', wp2.join(' | '));
  await B.screenshot({ path: OUT + '9-waiting-ready.png' });
  const code = await B.$eval('#t-code', e => e.textContent.trim());

  // 8. Arriving from a WhatsApp link
  const C = await make('C');
  await C.goto(`${URL}/?t=${code}`, { waitUntil: 'networkidle0' });
  await C.waitForSelector('#screen-join:not([hidden])');
  const note = await C.$eval('#join-invite', e => e.hidden ? '' : e.textContent);
  check('invite link says which table you are joining', note.includes(code), note);
  await C.screenshot({ path: OUT + '10-invited.png' });
  await C.type('#form-join [data-f=name]', 'Chhaya');
  await C.keyboard.press('Enter');
  await C.waitForSelector('#screen-table:not([hidden])', { timeout: 5000 });
  check('invited person lands straight at the table', true);

  // 9. Desktop lobby
  const D = await make('D', 1280, 900);
  await D.goto(URL + '/', { waitUntil: 'networkidle0' });
  await D.waitForSelector('#screen-join:not([hidden])');
  await D.type('#form-join [data-f=name]', 'Dev');
  await D.keyboard.press('Enter');
  await D.waitForSelector('#screen-lobby:not([hidden])');
  await wait(600);
  await D.screenshot({ path: OUT + '11-lobby-desktop.png', fullPage: true });
  await noOverflow(D, 'desktop lobby');

  check('no page errors', errors.length === 0, errors.join(' || '));
  console.log(results.join('\n'));
  await browser.close();
})().catch(e => { console.log(results.join('\n')); console.error('WALK FAILED:', e.message); process.exit(1); });
