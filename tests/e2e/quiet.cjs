// Starts the test browser silently: Chrome is muted (chimes, music, call audio), and the AI singers' voices
// (spoken by the operating system, which Chrome's mute doesn't cover) are set to zero volume. They still "sing",
// so the checks stay the same. Every page is silenced before it loads anything.
const puppeteer = require('puppeteer-core');

const SILENCE = () => {
  const s = window.speechSynthesis;
  if (s) { const speak = s.speak.bind(s); s.speak = u => { u.volume = 0; return speak(u); }; }
};

const quietPages = owner => {
  const newPage = owner.newPage.bind(owner);
  owner.newPage = async (...a) => { const page = await newPage(...a); await page.evaluateOnNewDocument(SILENCE); return page; };
  return owner;
};

async function launch(opts = {}) {
  const browser = await puppeteer.launch({ ...opts, args: [...(opts.args || []), '--mute-audio'] });
  quietPages(browser);
  const createContext = browser.createBrowserContext.bind(browser);
  browser.createBrowserContext = async (...a) => quietPages(await createContext(...a));
  return browser;
}

module.exports = { launch };
