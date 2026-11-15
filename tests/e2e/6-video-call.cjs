// End-to-end check in a real browser (headless Chrome, phone size). Start the server first (npm start), then run:
//   node tests/e2e/6-video-call.cjs      (or npm run e2e for all of them)
// Two people at a link-only table turn their cameras on: each sees the other, and the voice call keeps working.
// Settings: URL (default http://localhost:5090), CHROME (path to Chrome).
const OUT_DIR = require('path').join(__dirname, 'out') + '/';
require('fs').mkdirSync(OUT_DIR, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.URL || 'http://localhost:5090';
const puppeteer = require('puppeteer-core');
const wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const make = async name => {
    const page = await (await browser.createBrowserContext()).newPage();
    await page.setViewport({ width: 390, height: 844 });
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    // Headless Chrome's fake camera ends at once, so each browser gets a synthetic camera: an animated canvas at 15 fps.
    // Everything after the camera (call setup, sending, receiving, decoding) is the app's real code.
    await page.evaluateOnNewDocument(() => {
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async c => {
        if (!c || !c.video) return real(c);
        const cv = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
        const g = cv.getContext('2d'); let n = 0;
        setInterval(() => { g.fillStyle = `hsl(${(n += 7) % 360} 70% 50%)`; g.fillRect(0, 0, 320, 240); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(String(n), 20, 130); }, 66);
        return cv.captureStream(15);
      };
    });
    return page;
  };
  const signUp = async (p, name, path = '/') => {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#screen-join:not([hidden])');
    await p.type('#form-join [data-f=name]', name);
    await p.keyboard.press('Enter');
  };
  // Frames actually played by each tile (headless Chrome reports a fake 2x2 size, so size is no proof; frames are).
const tiles = p => p.$$eval('#vids .vtile', els => els.map(e => { const v = e.querySelector('video'); const t = v.srcObject && v.srcObject.getVideoTracks()[0];
    return { who: e.querySelector('span').textContent, frames: v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().totalVideoFrames : 0, live: !!t && t.readyState === 'live' && !t.muted }; }));

  const A = await make('A'), B = await make('B');
  await signUp(A, 'Anjali');
  await A.waitForSelector('#screen-lobby:not([hidden])');
  await A.$eval('[data-act=start-jam]', e => e.click());
  await A.waitForSelector('#screen-table:not([hidden])');
  await wait(500);
  check('no Video button at an open table', await A.$eval('#dock-cam', e => e.hidden));
  await A.$eval('[data-act=sheet][data-arg=settings]', e => e.click()); await wait(200);
  await A.$eval('[data-act=toggle-private]', e => e.click()); await wait(400);
  await A.$eval('[data-act=sheet-close]', e => e.click()); await wait(200);
  check('Video button appears once the table is link-only', !(await A.$eval('#dock-cam', e => e.hidden)));
  const code = await A.$eval('#t-code', e => e.textContent.trim());
  await signUp(B, 'Bunty', `/?t=${code}`);
  await B.waitForSelector('#screen-table:not([hidden])');
  await wait(5000); // the voice call connects
  check('cameras are off until someone turns theirs on', (await tiles(A)).length === 0 && (await tiles(B)).length === 0);

  await A.$eval('#dock-cam', e => e.click());
  await B.$eval('#dock-cam', e => e.click());
  let a = [], b = [];
  for (let i = 0; i < 30; i++) {
    await wait(300);
    a = await tiles(A); b = await tiles(B);
    if (a.length === 2 && b.length === 2) break;
  }
  check('Anjali has 2 video tiles (herself and Bunty)', a.length === 2, a.map(t => t.who).join(', '));
  check('Bunty has 2 video tiles (himself and Anjali)', b.length === 2, b.map(t => t.who).join(', '));
  await A.screenshot({ path: OUT_DIR + 'video-call.png' });
  // the real proof: video bytes go out from each person and frames arrive at the other
  let sa = [], sb = [];
  for (let i = 0; i < 20; i++) {
    sa = await A.evaluate(() => window.mehfilCallStats()); sb = await B.evaluate(() => window.mehfilCallStats());
    if (sa[0]?.videoFramesDecoded > 10 && sb[0]?.videoFramesDecoded > 10) break;
    await wait(300);
  }
  check('video flows from Bunty to Anjali (frames decoded)', sa[0]?.videoFramesDecoded > 10 && sb[0]?.videoSentBytes > 0, JSON.stringify(sa[0]));
  check('video flows from Anjali to Bunty (frames decoded)', sb[0]?.videoFramesDecoded > 10 && sa[0]?.videoSentBytes > 0, JSON.stringify(sb[0]));

  // the voice call still works with video on
  for (const [n, p] of [['Anjali', A], ['Bunty', B]]) {
    await p.$eval('[data-act=sheet][data-arg=singers]', e => e.click()); await wait(400);
    const voice = await p.$eval('#voice-status', e => e.textContent).catch(() => '');
    const audio = await p.evaluate(() => [...document.querySelectorAll('audio')].some(x => x.srcObject && !x.paused));
    check(`${n}: voice still connected with video on`, voice.includes('1 of 1') && audio, voice);
    await p.$eval('[data-act=sheet-close]', e => e.click()); await wait(200);
  }

  await B.$eval('#dock-cam', e => e.click());
  for (let i = 0; i < 20 && (await tiles(A)).length !== 1; i++) await wait(200);
  check('turning a camera off removes its tile for everyone', (await tiles(A)).length === 1 && (await tiles(B)).length === 1);

  // making the table public turns every camera off
  await A.$eval('[data-act=sheet][data-arg=settings]', e => e.click()); await wait(200);
  await A.$eval('[data-act=toggle-private]', e => e.click()); await wait(600);
  await A.$eval('[data-act=sheet-close]', e => e.click()).catch(() => {});
  const camLive = await A.evaluate(() => [...document.querySelectorAll('#vids video')].length);
  check('making the table public turns cameras off and hides Video', camLive === 0 && await A.$eval('#dock-cam', e => e.hidden));

  check('no page errors', errors.length === 0, errors.join(' || '));
  await browser.close();
})().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
