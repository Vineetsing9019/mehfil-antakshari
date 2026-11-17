// Starts the test browser silently: Chrome is muted (chimes, music, call audio), and the AI singers' voices
// (spoken by the operating system, which Chrome's mute doesn't cover) are set to zero volume. They still "sing",
// so the checks stay the same. Every page is silenced before it loads anything.
// The 16+ question is answered "yes" for these test people (the 16+ check has its own test, 10-age-check.cjs,
// which passes { askAge: true } to see the question).
const puppeteer = require('puppeteer-core');

const SILENCE = () => {
  const s = window.speechSynthesis;
  if (s) { const speak = s.speak.bind(s); s.speak = u => { u.volume = 0; return speak(u); }; }
};
const AGE_YES = () => { try { sessionStorage.setItem('ak-age-ok', 'yes'); } catch { /* ignore */ } };

const quietPages = (owner, askAge) => {
  const newPage = owner.newPage.bind(owner);
  owner.newPage = async (...a) => {
    const page = await newPage(...a);
    await page.evaluateOnNewDocument(SILENCE);
    if (!askAge) await page.evaluateOnNewDocument(AGE_YES);
    return page;
  };
  return owner;
};

async function launch(opts = {}) {
  const { askAge = false, ...rest } = opts;
  const browser = await puppeteer.launch({ ...rest, args: [...(rest.args || []), '--mute-audio'] });
  quietPages(browser, askAge);
  const createContext = browser.createBrowserContext.bind(browser);
  browser.createBrowserContext = async (...a) => quietPages(await createContext(...a), askAge);
  return browser;
}

module.exports = { launch };
