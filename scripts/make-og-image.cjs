// Makes public/og-image.png (1200x630): the picture shown when the Mehfil link is shared.
// Needs puppeteer-core and Chrome installed on this computer; run with: node scripts/make-og-image.cjs
const path = require('path');
const puppeteer = require(process.env.PUPPETEER_CORE || 'puppeteer-core');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{font-family:Poppins,system-ui,sans-serif;color:#fff6e9;position:relative;
    background:radial-gradient(900px 500px at 15% 0%,#4a1466 0%,transparent 60%),
               radial-gradient(800px 500px at 100% 100%,#5b1a3a 0%,transparent 60%),#12061f}
  .ring{position:absolute;right:-120px;top:-120px;width:620px;height:620px;border-radius:50%;
    border:46px solid #ffc145;opacity:.9;box-shadow:0 0 80px rgba(255,193,69,.35)}
  .ring::after{content:"";position:absolute;inset:70px;border-radius:50%;background:radial-gradient(circle,#3a145c,#1b0830);border:3px dashed rgba(255,193,69,.4)}
  .letter{position:absolute;right:186px;top:170px;font-family:"Yatra One",serif;font-size:190px;color:#ffc145;text-shadow:0 0 40px rgba(255,193,69,.6);z-index:2;line-height:1}
  .copy{position:absolute;left:80px;top:90px;width:700px;z-index:2}
  .hi{font-family:"Yatra One",serif;font-size:56px;color:#ff8a1f;margin-bottom:6px}
  h1{font-family:"Yatra One",serif;font-weight:400;font-size:132px;line-height:1;margin:0 0 18px;
    background:linear-gradient(90deg,#ffc145,#ff8a1f,#ff4f9a);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{font-size:38px;line-height:1.35;margin:0 0 34px;color:#fff6e9}
  .chips{display:flex;gap:14px;flex-wrap:wrap}
  .chip{padding:12px 22px;border-radius:999px;border:2px solid rgba(255,193,69,.6);font-size:26px;color:#ffc145;font-weight:600}
  .foot{position:absolute;left:80px;bottom:50px;font-size:24px;letter-spacing:.2em;text-transform:uppercase;color:#c3b2d6;z-index:2}
</style></head><body>
  <div class="ring"></div>
  <div class="letter">K</div>
  <div class="copy">
    <div class="hi">मेहफ़िल</div>
    <h1>Mehfil</h1>
    <p>Play Antakshari online with friends. Sing, pass the letter, keep the mehfil going.</p>
    <div class="chips"><span class="chip">Free</span><span class="chip">No download</span><span class="chip">Share on WhatsApp</span></div>
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
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const out = path.join(__dirname, '..', 'public', 'og-image.png');
  await page.screenshot({ path: out, type: 'png' });
  await browser.close();
  console.log('written', out);
})().catch(e => { console.error(e); process.exit(1); });
