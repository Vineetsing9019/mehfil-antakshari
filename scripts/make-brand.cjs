// Renders Mehfil's app icons (favicon, home-screen and maskable icons) from one design, with headless Chrome.
// Run: PUPPETEER_CORE=<path to puppeteer-core> node scripts/make-brand.cjs
const path = require('path');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');

// The mark: Devanagari "म" (for Mehfil) inside the gold stage ring, with a pink music note.
// maskable: no rounded corners and a safe zone, as Android crops it into its own shape.
const iconHtml = (size, maskable) => `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Yatra+One&display=block" rel="stylesheet">
<style>
  html,body{margin:0;background:transparent}
  .i{position:relative;width:${size}px;height:${size}px;overflow:hidden;border-radius:${maskable ? 0 : size * 0.22}px;
     background:radial-gradient(circle at 30% 22%,#6a2596 0%,#2a0d44 48%,#12061f 100%)}
  .ring{position:absolute;inset:${size * (maskable ? 0.2 : 0.12)}px;border-radius:50%;padding:${size * 0.045}px;
     background:conic-gradient(from 210deg,#ffc145,#ff8a1f,#ff4f9a,#8b5cf6,#ffc145);
     box-shadow:0 0 ${size * 0.12}px rgba(255,193,69,.45)}
  .in{width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 35%,#3a145c,#1b0830)}
  .m{position:absolute;inset:0;display:grid;place-items:center;font-family:"Yatra One",serif;
     font-size:${size * (maskable ? 0.36 : 0.44)}px;line-height:1;padding-bottom:${size * 0.03}px;
     background:linear-gradient(160deg,#ffe08a,#ffc145 40%,#ff8a1f);-webkit-background-clip:text;background-clip:text;color:transparent;
     filter:drop-shadow(0 0 ${size * 0.03}px rgba(255,193,69,.6))}
  .note{position:absolute;right:${size * (maskable ? 0.2 : 0.13)}px;top:${size * (maskable ? 0.18 : 0.1)}px;font-size:${size * 0.17}px;color:#ff4f9a;
     font-family:Arial,sans-serif;text-shadow:0 0 ${size * 0.04}px rgba(255,79,154,.7);transform:rotate(12deg)}
</style></head><body><div class="i"><div class="ring"><div class="in"></div></div><div class="m">म</div><div class="note">♪</div></div></body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const out = f => path.join(__dirname, '..', 'public', f);
  const jobs = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true],
    ['apple-touch-icon.png', 180, true], ['favicon-32.png', 32, false], ['logo-mark.png', 256, false]];
  for (const [file, size, maskable] of jobs) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(iconHtml(size, maskable), { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.load('40px "Yatra One"', 'म').then(() => document.fonts.ready));
    const el = await page.$('.i');
    await el.screenshot({ path: out(file), omitBackground: !maskable });
    console.log('written', file);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
