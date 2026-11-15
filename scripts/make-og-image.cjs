// Makes public/og-image.png (1200x630): the picture shown when the Mehfil link is shared (WhatsApp, Google…).
// Needs puppeteer-core and Chrome; run with: node scripts/make-og-image.cjs
const path = require('path');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');

// The Mehfil logo (the app icon), embedded so the picture needs no other files.
const LOGO = 'data:image/png;base64,' + require('fs').readFileSync(path.join(__dirname, '..', 'public', 'icon-192.png')).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Yatra+One&display=block" rel="stylesheet">
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{font-family:Poppins,system-ui,sans-serif;color:#fff6e9;position:relative;
    background:radial-gradient(900px 500px at 15% 0%,#4a1466 0%,transparent 60%),
               radial-gradient(800px 500px at 100% 100%,#5b1a3a 0%,transparent 60%),#12061f}
  /* the Mehfil logo: the gold-to-pink stage ring with म and a music note (same as the app icon) */
  .ring{position:absolute;right:40px;top:95px;width:440px;height:440px;border-radius:50%;padding:26px;
    background:conic-gradient(from 210deg,#ffc145,#ff8a1f,#ff4f9a,#8b5cf6,#ffc145);box-shadow:0 0 90px rgba(255,193,69,.35)}
  .ring i{display:block;width:100%;height:100%;border-radius:50%;background:radial-gradient(circle at 50% 35%,#3a145c,#1b0830)}
  .mark{position:absolute;right:40px;top:95px;width:492px;height:492px;display:grid;place-items:center;z-index:2;
    font-family:"Yatra One",serif;font-size:230px;line-height:1;padding-bottom:20px;
    background:linear-gradient(160deg,#ffe08a,#ffc145 40%,#ff8a1f);-webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 0 22px rgba(255,193,69,.55))}
  .note{position:absolute;right:32px;top:70px;font-size:96px;color:#ff4f9a;transform:rotate(12deg);text-shadow:0 0 24px rgba(255,79,154,.7);z-index:3;font-family:Arial,sans-serif}
  .copy{position:absolute;left:80px;top:80px;width:560px;z-index:2}
  .hi{font-family:"Yatra One",serif;font-size:60px;color:#ff8a1f;display:flex;align-items:center;gap:18px}
  .logo{width:78px;height:78px;border-radius:18px;box-shadow:0 0 24px rgba(255,193,69,.35)}
  .mark.v{font-family:"Yatra One",serif;font-size:250px;padding-bottom:0}
  h1{font-family:"Yatra One",serif;font-weight:400;font-size:128px;line-height:1.05;margin:0 0 16px;
    background:linear-gradient(90deg,#ffc145,#ff8a1f,#ff4f9a);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{font-size:32px;line-height:1.35;margin:0 0 28px;color:#fff6e9}
  .chips{display:flex;gap:12px;flex-wrap:wrap}
  .chips{flex-wrap:nowrap}
  .chip{padding:9px 16px;border-radius:999px;border:2px solid rgba(255,193,69,.6);font-size:21px;color:#ffc145;font-weight:600;white-space:nowrap}
  .foot{position:absolute;left:80px;bottom:44px;font-size:22px;letter-spacing:.2em;text-transform:uppercase;color:#c3b2d6;z-index:2}
</style></head><body>
  <div class="ring"><i></i></div><div class="mark v">V</div><div class="note">♪</div>
  <div class="copy">
    <div class="hi"><img class="logo" src="${LOGO}" alt="">मेहफ़िल</div>
    <h1>Mehfil</h1>
    <p>Play Antakshari online with friends, or with 20 AI singers.</p>
    <div class="chips"><span class="chip">Free</span><span class="chip">No download</span><span class="chip">Join from WhatsApp</span></div>
  </div>
  <div class="foot">antakshari · online · mehfil</div>
</body></html>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
  // wait for the real fonts, so the picture never falls back to a plain system font
  await page.evaluate(() => Promise.all([document.fonts.load('100px "Yatra One"', 'मेहफ़िल Mehfil'), document.fonts.load('600 30px Poppins')]).then(() => document.fonts.ready));
  const out = path.join(__dirname, '..', 'public', 'og-image.png');
  await page.screenshot({ path: out, type: 'png' });
  await browser.close();
  console.log('written', out);
})().catch(e => { console.error(e); process.exit(1); });
