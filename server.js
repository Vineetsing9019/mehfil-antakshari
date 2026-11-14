// Antakshari Mehfil: lobby, shareable table links, game and jam tables, voting, chat, persistence.
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const selfsigned = require('selfsigned');
const { Server } = require('socket.io');
const { makeBots, SONGS } = require('./bots');
const { librarySongsFor } = require('./songlib');

const PORT = Number(process.env.PORT) || 5090; // localhost:5090, or the host's port
const SECURE_PORT = 5443;                      // https for phones on this Wi-Fi (local only)
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const REPORTS_FILE = process.env.REPORTS_FILE || path.join(__dirname, 'reports.json');
const GRACE_MS = 60000;   // a dropped connection keeps its seat this long
const INVITE_MS = 20000;
const VOTE_MS = 6000;
const HINT_COST = 5;
const GAME_MAX = 6, JAM_MAX = 8, LISTENER_MAX = 10;
const START_LETTERS = 'ABCDEGHJKMNPRST'.split('');
const REACTIONS = ['👏', '🔥', '🎶', '😂', '❤️', '🙌', '🥹', '🤩'];
const QUICK_CHAT = ['Wah wah! 👏', 'Ek aur! 🎶', 'Sur perfect 🎤', 'Haha 😂', 'Bahut khoob 🙌'];
const THEMES = {
  classic: { label: 'Classic', turnSec: 60, rule: 'Start with the letter in the middle.' },
  rapid:   { label: 'Rapid Fire', turnSec: 20, rule: 'Only 20 seconds a turn. Think fast!' },
  dhun:    { label: 'Dhun round', turnSec: 45, rule: 'Sing a tune you know well; the table judges it.' },
  decade:  { label: 'Decade: 90s only', turnSec: 60, rule: 'Only songs from the 1990s.' },
  actor:   { label: 'Actor round', turnSec: 60, rule: 'Only songs by the actor the singer names first.' },
};
const TURN_OPTIONS = [20, 30, 60, 90];
const LANGS = ['en', 'hi', 'mr'];
const DEVA = { A: 'अ', B: 'ब', C: 'च', D: 'द', E: 'ए', F: 'फ', G: 'ग', H: 'ह', I: 'इ', J: 'ज', K: 'क', L: 'ल', M: 'म', N: 'न', O: 'ओ', P: 'प', Q: 'क', R: 'र', S: 'स', T: 'त', U: 'उ', V: 'व', W: 'व', X: 'क्स', Y: 'य', Z: 'झ' };
const DEFAULT_SEEDS = ['Mehfil', 'Sargam', 'Taal', 'Raag', 'Dhun', 'Geet', 'Sur', 'Lehar', 'Jhankaar', 'Tarana', 'Ghazal', 'Qawwali'];
const MAX_POSTS = 9;
const MAX_IMG_CHARS = 1.3e6;
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Voice relay for phones on mobile data: set ICE_SERVERS on the host as a JSON list of TURN servers.
// Without your own TURN servers, a free public relay is used so voices also work on mobile data.
// Replace it with your own TURN service (set ICE_SERVERS on the host) before a public launch.
const DEFAULT_TURN = [{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }];
const EXTRA_ICE = (() => { try { return process.env.ICE_SERVERS ? JSON.parse(process.env.ICE_SERVERS) : DEFAULT_TURN; } catch { return DEFAULT_TURN; } })();
app.get('/config', (req, res) => res.json({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, ...EXTRA_ICE] }));

const httpServer = http.createServer(app);
const pems = selfsigned.generate([{ name: 'commonName', value: 'antakshari.local' }], { days: 365, keySize: 2048 });
const httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, app);
const io = new Server({ maxHttpBufferSize: 8e6 });
io.attach(httpServer);
io.attach(httpsServer);

/* ---------- state ---------- */
const people = new Map();   // token -> person (people who used the app; saved to data.json)
const bots = new Map();     // id -> bot person (not saved)
const live = new Map();     // token -> socket id, for people connected right now
const tables = new Map();   // code -> table
const personTable = new Map(); // token -> table code
const invites = new Map();  // `${from}>${to}` -> timeout

makeBots().forEach(b => bots.set(b.id, { ...b, token: b.id, bot: true }));

function loadData() {
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    (d.people || []).forEach(p => people.set(p.token, p));
  } catch { /* first run */ }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify({ people: [...people.values()] }), () => {}), 400);
}
loadData();

/* ---------- helpers ---------- */
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const firstLetter = s => (String(s).match(/[a-z]/i) || [''])[0].toUpperCase();
const VOWELS = 'aeiouy';
// The next letter by sound: skip trailing vowels, so "hai" gives H and "pyaar" gives R.
function nextLetter(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  let i = w.length - 1;
  while (i > 0 && VOWELS.includes(w[i])) i--;
  return (w[i] || '').toUpperCase();
}
const today = () => new Date().toISOString().slice(0, 10);
const weekKey = () => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${Math.ceil(((d - y0) / 86400000 + 1) / 7)}`;
};
const isHuman = token => !bots.has(token);
const personOf = token => bots.get(token) || people.get(token);
const isOnline = token => bots.has(token) || live.has(token);
const blockedEither = (a, b) => (people.get(a)?.blocks || []).includes(b) || (people.get(b)?.blocks || []).includes(a);
const followersOf = token => [...people.values()].filter(p => p.follows.includes(token)).length;

function uniqueHandle(want, token) {
  const base = clean(want, 24).toLowerCase().replace(/[^a-z0-9._]+/g, '').replace(/^[._]+|[._]+$/g, '') || 'singer';
  const taken = h => [...people.values()].some(p => p.token !== token && p.handle === h) || [...bots.values()].some(b => b.handle === h);
  let h = base, n = 1;
  while (taken(h)) h = `${base}${++n}`;
  return h;
}

function parseImage(s) {
  return typeof s === 'string' && s.length <= MAX_IMG_CHARS && IMG_RE.test(s) ? s : null;
}

// Applies the profile the browser sent. Keeps the old photo if none is sent.
function applyProfile(person, p) {
  person.name = clean(p.name, 20);
  person.handle = uniqueHandle(p.handle || person.name, person.token);
  person.city = clean(p.city, 30);
  person.bio = clean(p.bio, 120);
  person.defaultSeed = person.name || 'Singer'; // the classic default avatar is the person's initials
  if (p.photo !== undefined) person.photo = parseImage(p.photo);
  if (Array.isArray(p.posts)) person.posts = p.posts.slice(0, MAX_POSTS).map(parseImage).filter(Boolean);
  person.ver = (person.ver || 0) + 1;
  save();
}

function newPerson(token) {
  return { token, name: '', handle: '', city: '', bio: '', photo: null, defaultSeed: DEFAULT_SEEDS[0], posts: [],
    sung: 0, wins: 0, passes: 0, follows: [], blocks: [], weekly: {}, days: [], ver: 0, createdAt: Date.now() };
}

// The public view of a person, as seen by `viewer`.
function publicPerson(token) {
  const p = personOf(token);
  if (!p) return null;
  const t = tables.get(personTable.get(token));
  const status = !t ? 'free' : t.state === 'playing' ? 'playing' : t.type === 'jam' ? 'jam' : 'room';
  const badges = [];
  if (p.sung >= 1) badges.push('First song 🎤');
  if (p.sung >= 10) badges.push('Ten songs 🔟');
  if (p.wins >= 1) badges.push('Winner 🏆');
  if (p.sung >= 3 && p.passes === 0) badges.push('Never passed ✨');
  if ((p.days || []).length >= 5) badges.push('Regular 📅');
  const bot = bots.has(token);
  return {
    token, bot, name: p.name, handle: p.handle, city: p.city || '', bio: p.bio || (bot ? '' : 'Singing on Antakshari 🎶'),
    verified: !!p.verified, defaultSeed: p.defaultSeed,
    photo: bot ? p.photo : p.photo ? `/p/${token}/photo?v=${p.ver}` : null,
    posts: bot ? [] : (p.posts || []).map((_, i) => `/p/${token}/post/${i}?v=${p.ver}`),
    sung: p.sung || 0, wins: p.wins || 0, followers: followersOf(token), badges, status,
    online: isOnline(token), tableCode: t ? t.code : null,
  };
}

/* ---------- photo routes ---------- */
function sendDataUrl(res, s) {
  if (!s) return res.sendStatus(404);
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(s);
  res.type(m[1]).set('Cache-Control', 'max-age=86400').send(Buffer.from(m[2], 'base64'));
}
app.get('/p/:token/photo', (req, res) => sendDataUrl(res, people.get(req.params.token)?.photo));
app.get('/p/:token/post/:i', (req, res) => sendDataUrl(res, people.get(req.params.token)?.posts?.[Number(req.params.i)]));

app.get('/leaderboard', (req, res) => {
  const wk = weekKey();
  const rows = [...people.values()]
    .map(p => ({ token: p.token, name: p.name, handle: p.handle, points: p.weekly?.[wk] || 0 }))
    .filter(r => r.points > 0 && r.name)
    .sort((a, b) => b.points - a.points).slice(0, 10);
  res.json({ week: wk, rows });
});

/* ---------- lobby broadcasts (filtered per viewer) ---------- */
function peopleFor(viewer) {
  const me = people.get(viewer);
  const list = [...bots.keys()].concat([...live.keys()].filter(t => people.get(t)?.name))
    .filter(t => t !== viewer && !blockedEither(viewer, t))
    .map(publicPerson).filter(Boolean);
  const follows = me?.follows || [];
  list.forEach(x => { x.followed = follows.includes(x.token); });
  return list.sort((a, b) => (follows.includes(b.token) ? 1 : 0) - (follows.includes(a.token) ? 1 : 0) ||
    (a.status === 'free' ? 0 : 1) - (b.status === 'free' ? 0 : 1));
}
function tablesFor(viewer) {
  return [...tables.values()]
    .filter(t => t.state !== 'hidden' && [...t.members.keys()].some(isHuman) && t.members.size < capacity(t))
    .filter(t => ![...t.members.keys()].some(m => blockedEither(viewer, m)))
    .map(t => ({ code: t.code, type: t.type, host: personOf(t.hostToken)?.name || 'Host',
      count: t.members.size, max: capacity(t), state: t.state, theme: THEMES[t.settings.theme]?.label || '' }));
}
function pushLobby() {
  for (const [token, sid] of live) {
    io.to(sid).emit('lobby', { people: peopleFor(token), tables: tablesFor(token) });
  }
}
function capacity(t) { return t.type === 'jam' ? JAM_MAX : GAME_MAX + LISTENER_MAX; }

/* ---------- tables ---------- */
function newCode() {
  let c;
  do { c = Array.from({ length: 6 }, () => CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)]).join(''); }
  while (tables.has(c));
  return c;
}
function createTable(type, hostToken, settings = {}) {
  const t = {
    code: newCode(), type, hostToken, members: new Map(), order: [],
    state: type === 'jam' ? 'jam' : 'lobby',
    settings: { theme: 'classic', turnSec: 60, lives: 3, teams: false, lang: 'en', voice: 'call', ...pick(settings) },
    letter: null, turnIdx: 0, turnEndsAt: null, timer: null, botTimer: null, verifyTimer: null, verifying: null,
    trail: [], chat: [], claps: 0, clapTotals: new Map(), winnerToken: null, winnerTeam: null, crowdFav: null,
    queue: [], nowPlaying: null, stage: null, botSong: null, botSing: null, createdAt: Date.now(),
  };
  tables.set(t.code, t);
  return t;
}
function pick(s) {
  const out = {};
  if (THEMES[s.theme]) { out.theme = s.theme; out.turnSec = THEMES[s.theme].turnSec; }
  if (TURN_OPTIONS.includes(Number(s.turnSec))) out.turnSec = Number(s.turnSec);
  if (Number.isInteger(Number(s.lives)) && s.lives >= 1 && s.lives <= 5) out.lives = Number(s.lives);
  if (typeof s.teams === 'boolean') out.teams = s.teams;
  if (['turns', 'call'].includes(s.voice)) out.voice = s.voice;
  if (LANGS.includes(s.lang)) out.lang = s.lang;
  return out;
}
const turnMs = t => (t.settings.turnSec || 60) * 1000;
const currentToken = t => t.order[t.turnIdx];
const memberOf = (t, token) => t.members.get(token);
const singersIn = t => [...t.members.values()].filter(m => m.role === 'singer');

// Returns an error message, or null when `token` may join `t`.
function joinable(t, token) {
  if ([...t.members.keys()].some(m => blockedEither(token, m))) return "That table isn't available for you";
  if (t.members.size >= capacity(t)) return t.type === 'jam' ? `This jam is full (${JAM_MAX} people)` : 'This table is full';
  if (t.type === 'game' && t.state === 'playing' && t.members.size >= GAME_MAX + LISTENER_MAX) return 'Too many listeners right now';
  if (t.type === 'game' && t.state !== 'playing' && singersIn(t).length >= GAME_MAX) return `This table is full (${GAME_MAX} singers)`;
  return null;
}

function joinTable(t, token, opts = {}) {
  if (personTable.has(token)) {
    if (personTable.get(token) === t.code) return;
    leaveTable(token);
  }
  const role = t.type === 'game' && t.state === 'playing' ? 'listener' : 'singer';
  t.members.set(token, { token, role, online: true, lives: t.settings.lives, score: 0, team: null, graceTimer: null });
  personTable.set(token, t.code);
  if (isHuman(token)) { const p = people.get(token); if (p && p.name) addChat(t, null, `${p.name} joined the table`); }
  if (opts.silent !== true) pushTable(t);
  pushLobby();
}

function leaveTable(token, why = 'left') {
  const code = personTable.get(token);
  const t = code && tables.get(code);
  if (!t) return;
  const sid = live.get(token);
  if (sid) io.to(sid).emit('table', null);
  personTable.delete(token);
  const m = t.members.get(token);
  if (m?.graceTimer) clearTimeout(m.graceTimer);
  const idx = t.order.indexOf(token);
  t.members.delete(token);
  t.order = t.order.filter(x => x !== token);
  t.clapTotals.delete(token);
  if (t.stage === token) t.stage = null;
  if (t.verifying?.token === token) { t.verifying = null; clearTimeout(t.verifyTimer); }
  const name = personOf(token)?.name || 'Someone';
  if (!t.members.size || ![...t.members.keys()].some(isHuman)) {
    [...t.members.keys()].forEach(x => personTable.delete(x));
    clearTimeout(t.timer); clearTimeout(t.botTimer); clearTimeout(t.verifyTimer);
    tables.delete(t.code);
    pushLobby();
    return;
  }
  if (t.hostToken === token) t.hostToken = [...t.members.keys()].find(isHuman);
  if (why === 'kicked') addChat(t, null, `${name} was removed by the host`);
  else if (why === 'timeout') addChat(t, null, `${name} lost connection`);
  else addChat(t, null, `${name} left the table`);
  if (t.type === 'game' && t.state === 'playing') {
    if (idx !== -1 && idx < t.turnIdx) t.turnIdx--;
    if (idx !== -1 && idx === t.turnIdx) {
      // the singer left: pass the letter on
      t.turnIdx = (t.turnIdx - 1 + t.order.length) % Math.max(1, t.order.length);
      clearTimeout(t.timer); clearTimeout(t.botTimer);
      if (!checkOver(t)) nextTurn(t);
    } else if (!checkOver(t)) pushTable(t);
  } else pushTable(t);
  pushLobby();
}

// Replace the table's chat with the new message, keeping the last 80.
function addChat(t, from, text, extra = {}) {
  const msg = { id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, from, name: from ? personOf(from)?.name : 'Table', text, at: Date.now(), ...extra };
  t.chat.push(msg);
  if (t.chat.length > 80) t.chat.shift();
  for (const m of t.members.keys()) {
    if (!isHuman(m) || !live.has(m) || (from && blockedEither(m, from))) continue;
    io.to(live.get(m)).emit('chat', { table: t.code, msg });
  }
}

function viewFor(t, token) {
  const members = [...t.members.values()].map(m => {
    const pub = publicPerson(m.token) || {};
    return { token: m.token, name: pub.name || 'Singer', handle: pub.handle || '', photo: pub.photo || null,
      defaultSeed: pub.defaultSeed, bot: !!pub.bot, online: m.online, role: m.role, lives: m.lives, score: m.score,
      team: m.team, passes: personOf(m.token)?.passes || 0, claps: t.clapTotals.get(m.token) || 0,
      isHost: m.token === t.hostToken, isStage: t.stage === m.token, followed: (people.get(token)?.follows || []).includes(m.token) };
  });
  const v = t.verifying;
  const teamTotals = t.settings.teams ? { A: 0, B: 0 } : null;
  if (teamTotals) for (const m of t.members.values()) if (m.team) teamTotals[m.team] += m.score;
  return {
    code: t.code, type: t.type, state: t.state, isHost: t.hostToken === token, hostToken: t.hostToken,
    settings: t.settings, themeLabel: THEMES[t.settings.theme]?.label, themeRule: THEMES[t.settings.theme]?.rule,
    letter: t.letter, deva: t.letter ? DEVA[t.letter] : null,
    turn: t.state === 'playing' ? currentToken(t) : null, turnEndsAt: t.turnEndsAt, now: Date.now(), turnMs: turnMs(t),
    botSong: t.botSong, botSing: t.botSing, members, trail: t.trail.slice(-40),
    chat: t.chat.filter(msg => !(msg.from && blockedEither(token, msg.from))).slice(-80),
    claps: t.claps, teamTotals,
    verifying: v ? { singer: v.token, song: v.song, lastWord: v.lastWord, next: v.next, ends: v.ends,
      up: [...v.votes.values()].filter(x => x === 'up').length, down: [...v.votes.values()].filter(x => x === 'down').length,
      myVote: v.votes.get(token) || null, canVote: v.eligible.has(token) } : null,
    queue: t.queue, nowPlaying: t.nowPlaying, stage: t.stage,
    winnerToken: t.winnerToken, winnerTeam: t.winnerTeam, crowdFav: t.crowdFav,
    quickChat: QUICK_CHAT, reactions: REACTIONS,
  };
}
function pushTable(t) {
  for (const m of t.members.keys()) {
    if (isHuman(m) && live.has(m)) io.to(live.get(m)).emit('table', viewFor(t, m));
  }
}
function broadcast(t, ev, data) {
  for (const m of t.members.keys()) if (isHuman(m) && live.has(m)) io.to(live.get(m)).emit(ev, data);
}

/* ---------- game flow ---------- */
function startGame(t) {
  const singers = singersIn(t).map(m => m.token);
  // All members become singers for a new game (listeners join in).
  t.members.forEach(m => { m.role = 'singer'; m.lives = t.settings.lives; m.score = 0; m.team = null; });
  if (t.settings.teams && singers.length >= 2) {
    const A = singers.filter((_, i) => i % 2 === 0), B = singers.filter((_, i) => i % 2 === 1);
    A.forEach(x => memberOf(t, x).team = 'A');
    B.forEach(x => memberOf(t, x).team = 'B');
    t.order = A.flatMap((x, i) => [x, B[i]]).filter(Boolean);
  } else t.order = singers;
  t.state = 'playing';
  t.winnerToken = null; t.winnerTeam = null; t.crowdFav = null; t.clapTotals = new Map();
  t.trail = [];
  t.letter = START_LETTERS[Math.floor(Math.random() * START_LETTERS.length)];
  t.turnIdx = 0;
  addChat(t, null, `Game on! Letter ${t.letter} · ${DEVA[t.letter]}. ${THEMES[t.settings.theme].rule}`);
  t.trail.push({ system: true, text: `Game on! First letter is ${t.letter} · ${DEVA[t.letter]}` });
  startTurn(t);
  pushLobby();
}

function startTurn(t) {
  clearTimeout(t.timer); clearTimeout(t.botTimer); clearTimeout(t.verifyTimer);
  t.verifying = null; t.botSong = null; t.botSing = null; t.claps = 0;
  const tok = currentToken(t);
  t.turnEndsAt = Date.now() + turnMs(t);
  t.timer = setTimeout(() => loseLife(t, tok, 'ran out of time'), turnMs(t));
  if (bots.has(tok)) botTurn(t, tok);
  pushTable(t);
}

// A bot chooses a real song for the letter (sometimes it gets stuck), then sings for a few seconds.
function botTurn(t, id) {
  const used = [...t.trail.filter(x => x.song).map(x => x.song)];
  // A bot sings a library song (lyrics shown and spoken) whenever one is free for this letter.
  const libOptions = librarySongsFor(t.letter, used);
  let song = null, sing = null;
  if (libOptions.length) {
    sing = libOptions[Math.floor(Math.random() * libOptions.length)];
    song = sing.title;
  } else {
    const usedLower = used.map(s => s.toLowerCase());
    const options = (SONGS[t.letter] || []).filter(s => !usedLower.includes(s.toLowerCase()));
    song = options.length && Math.random() < 0.9 ? options[Math.floor(Math.random() * options.length)] : null;
  }
  t.botSong = song;
  t.botSing = sing ? { id: sing.id, title: sing.title, lang: sing.lang, lines: sing.lines } : null;
  const ms = sing ? 2000 + sing.lines.length * 2600 : song ? 5000 + Math.random() * 6000 : 6000 + Math.random() * 4000;
  t.botTimer = setTimeout(() => {
    if (t.state !== 'playing' || currentToken(t) !== id || t.verifying) return;
    if (song) {
      const err = submitAttempt(t, id, song, song.split(' ').pop());
      if (err) loseLife(t, id, "couldn't think of a song");
    } else loseLife(t, id, "couldn't think of a song");
  }, ms);
}

// A singer submits a song. Other people vote before it counts (or bots only: it counts at once).
function submitAttempt(t, token, song, lastWord) {
  if (t.state !== 'playing' || t.verifying || currentToken(t) !== token) return 'Wait for your turn';
  song = clean(song, 80);
  lastWord = clean(lastWord, 30);
  if (song.length < 2) return 'Type the song you sang';
  if (firstLetter(song) !== t.letter) return `The song has to start with "${t.letter}"`;
  if (t.trail.some(x => x.song && x.song.toLowerCase() === song.toLowerCase())) return 'That song has already been sung, pick another';
  const next = nextLetter(lastWord);
  if (!next) return 'Type the last word you sang';
  const fast = t.turnEndsAt - Date.now() > turnMs(t) * 2 / 3;
  const eligible = new Set([...t.members.keys()].filter(m => m !== token && (bots.has(m) || live.has(m))));
  t.verifying = { token, song, lastWord, next, fast, votes: new Map(), eligible, ends: Date.now() + VOTE_MS };
  clearTimeout(t.timer); clearTimeout(t.botTimer);
  eligible.forEach(m => { if (bots.has(m)) t.verifying.votes.set(m, 'up'); });
  if (t.verifying.votes.size === eligible.size) resolveVerify(t);
  else { t.verifyTimer = setTimeout(() => resolveVerify(t), VOTE_MS); pushTable(t); }
  return null;
}

function castVote(t, token, vote) {
  const v = t.verifying;
  if (!v || !v.eligible.has(token) || !['up', 'down'].includes(vote)) return;
  v.votes.set(token, vote);
  if (v.votes.size === v.eligible.size) resolveVerify(t);
  else pushTable(t);
}

function resolveVerify(t) {
  const v = t.verifying;
  if (!v) return;
  clearTimeout(t.verifyTimer);
  t.verifying = null;
  const ups = [...v.votes.values()].filter(x => x === 'up').length;
  const downs = [...v.votes.values()].filter(x => x === 'down').length;
  if (!t.members.has(v.token)) return nextTurn(t);
  if (downs > ups) {
    const m = memberOf(t, v.token);
    m.lives = Math.max(0, m.lives - 1);
    t.trail.push({ system: true, by: v.token, text: `"${v.song}" was rejected by the table and ${personOf(v.token)?.name} lost a ❤` });
    return nextTurn(t);
  }
  const points = 10 + (v.fast ? 5 : 0);
  const singer = memberOf(t, v.token);
  singer.score += points;
  const p = people.get(v.token);
  if (p) {
    p.sung++;
    const wk = weekKey();
    p.weekly = p.weekly || {};
    p.weekly[wk] = (p.weekly[wk] || 0) + points;
    save();
  }
  t.trail.push({ by: v.token, song: v.song, lastWord: v.lastWord, from: t.letter, next: v.next, points, deva: DEVA[v.next] });
  t.letter = v.next;
  nextTurn(t);
}

function nextTurn(t) {
  if (checkOver(t)) return;
  let i = t.turnIdx;
  for (let k = 0; k < t.order.length; k++) {
    i = (i + 1) % t.order.length;
    if (memberOf(t, t.order[i])?.lives > 0) break;
  }
  t.turnIdx = i;
  startTurn(t);
}

function loseLife(t, token, why, { passed = false } = {}) {
  if (t.state !== 'playing' || currentToken(t) !== token || t.verifying) return;
  const m = memberOf(t, token);
  if (!m) return;
  m.lives = Math.max(0, m.lives - 1);
  if (passed && people.get(token)) { people.get(token).passes++; save(); }
  t.trail.push({ system: true, by: token, text: `${personOf(token)?.name} ${why} and lost a ❤${m.lives === 0 ? ' — out of the game' : ''}` });
  nextTurn(t);
}

function checkOver(t) {
  const alive = t.order.filter(tok => memberOf(t, tok)?.lives > 0);
  const humansAlive = alive.filter(isHuman).length;
  const enough = t.settings.teams
    ? new Set(alive.map(tok => memberOf(t, tok).team)).size >= 2
    : alive.length >= 2;
  if (enough && humansAlive > 0) return false;
  clearTimeout(t.timer); clearTimeout(t.botTimer); clearTimeout(t.verifyTimer);
  t.verifying = null; t.botSong = null; t.botSing = null;
  t.state = 'over';
  t.turnEndsAt = null;
  if (t.settings.teams) {
    const totals = { A: 0, B: 0 };
    t.members.forEach(m => { if (m.team) totals[m.team] += m.score; });
    t.winnerTeam = totals.A === totals.B ? 'tie' : totals.A > totals.B ? 'A' : 'B';
    t.winnerToken = [...t.members.values()].filter(m => m.team === t.winnerTeam).sort((a, b) => b.score - a.score)[0]?.token || null;
    if (t.winnerTeam !== 'tie') t.members.forEach(m => { if (m.team === t.winnerTeam && isHuman(m.token) && people.get(m.token)) people.get(m.token).wins++; });
  } else {
    t.winnerToken = alive[0] && alive.length === 1 ? alive[0] : [...t.members.values()].sort((a, b) => b.score - a.score)[0]?.token || null;
    if (t.winnerToken && isHuman(t.winnerToken) && people.get(t.winnerToken)) people.get(t.winnerToken).wins++;
  }
  let best = null, bestN = 0;
  t.clapTotals.forEach((n, tok) => { if (n > bestN) { best = tok; bestN = n; } });
  t.crowdFav = best;
  save();
  addChat(t, null, `Game over! ${t.winnerTeam ? (t.winnerTeam === 'tie' ? 'It is a tie' : `Team ${t.winnerTeam} wins`) : `${personOf(t.winnerToken)?.name || 'Someone'} wins`}`);
  pushTable(t);
  pushLobby();
  return true;
}

/* ---------- presence and invites ---------- */
function goOnline(token) {
  for (const p of people.values()) {
    if (p.follows.includes(token) && live.has(p.token)) {
      io.to(live.get(p.token)).emit('toast', `🎶 ${people.get(token)?.name} is online now`);
    }
  }
}

function sendInvite(fromToken, toToken) {
  const from = people.get(fromToken), to = personOf(toToken);
  if (!from || !to) return 'That singer is not available';
  if (fromToken === toToken) return null;
  if (blockedEither(fromToken, toToken)) return 'That singer is not available';
  if (!isOnline(toToken)) return `${to.name} is offline right now`;
  if (personTable.has(toToken)) return `${to.name} is already at a table`;
  const mine = tables.get(personTable.get(fromToken));
  if (mine && mine.state === 'playing') return 'Finish this game before inviting';
  if (mine && mine.type === 'game' && singersIn(mine).length >= GAME_MAX) return 'Your table is full';
  const key = `${fromToken}>${toToken}`;
  if (invites.has(key)) return `Already waiting for ${to.name}`;
  invites.set(key, setTimeout(() => {
    invites.delete(key);
    emitTo(fromToken, 'invite:gone', { fromToken, toToken });
    emitTo(toToken, 'invite:gone', { fromToken, toToken });
    emitTo(fromToken, 'toast', `${to.name} didn't answer`);
  }, INVITE_MS));
  emitTo(toToken, 'invite', { fromToken, name: from.name, avatar: null, photo: publicPerson(fromToken)?.photo, defaultSeed: from.defaultSeed, ms: INVITE_MS, table: mine?.code || null });
  emitTo(fromToken, 'invite:sent', { toToken });
  emitTo(fromToken, 'toast', `Request sent to ${to.name}`);
  if (bots.has(toToken)) setTimeout(() => respondInvite(fromToken, toToken, true), 1000 + Math.random() * 1500);
  return null;
}

function respondInvite(fromToken, toToken, accept) {
  const key = `${fromToken}>${toToken}`;
  if (!invites.has(key)) return emitTo(toToken, 'toast', 'That invite has expired');
  clearTimeout(invites.get(key));
  invites.delete(key);
  emitTo(fromToken, 'invite:gone', { fromToken, toToken });
  emitTo(toToken, 'invite:gone', { fromToken, toToken });
  const to = personOf(toToken);
  if (!accept) return emitTo(fromToken, 'toast', `${to?.name} said not now`);
  if (!isOnline(fromToken) || !to) return emitTo(toToken, 'toast', 'That singer has gone offline');
  let t = tables.get(personTable.get(fromToken));
  if (!t) { t = createTable('game', fromToken); joinTable(t, fromToken); }
  const err = joinable(t, toToken);
  if (err) return emitTo(toToken, 'toast', err);
  joinTable(t, toToken);
  emitTo(fromToken, 'toast', `${to.name} joined your table`);
}

function emitTo(token, ev, data) {
  const sid = live.get(token);
  if (sid) io.to(sid).emit(ev, data);
}

/* ---------- socket handlers ---------- */
io.on('connection', socket => {
  let token = null;
  const toast = msg => socket.emit('toast', msg);
  const myTable = () => tables.get(personTable.get(token));

  socket.on('hello', (p = {}) => {
    const wanted = typeof p.token === 'string' && TOKEN_RE.test(p.token) ? p.token : null;
    token = wanted || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    socket.data.token = token;
    const firstTime = !live.has(token);
    live.set(token, socket.id);
    const person = people.get(token) || newPerson(token);
    people.set(token, person);
    if (p.profile && clean(p.profile.name, 20)) applyProfile(person, p.profile);
    const d = today();
    if (!person.days.includes(d)) { person.days.push(d); person.days = person.days.slice(-400); save(); }
    socket.emit('me', { token, profile: publicPerson(token), named: !!person.name });
    const code = personTable.get(token);
    const t = code && tables.get(code);
    if (t) {
      const m = memberOf(t, token);
      if (m) { clearTimeout(m.graceTimer); m.graceTimer = null; m.online = true; }
      pushTable(t);
    }
    if (firstTime) goOnline(token);
    pushLobby();
  });

  socket.on('profile:update', (p = {}) => {
    if (!token) return;
    const person = people.get(token);
    if (!person || !clean(p.name, 20)) return toast('Your name can’t be empty');
    applyProfile(person, p);
    socket.emit('profile:saved', { handle: person.handle, profile: publicPerson(token) });
    const t = myTable();
    if (t) pushTable(t);
    pushLobby();
  });

  socket.on('table:create', (p = {}) => {
    if (!token || !people.get(token)?.name) return toast('Create your profile first');
    const type = p.type === 'jam' ? 'jam' : 'game';
    leaveTable(token);
    const t = createTable(type, token, p.settings || {});
    joinTable(t, token);
    socket.emit('toast', type === 'jam' ? 'Jam table ready. Share the link!' : 'Table ready. Share the link, then start when everyone is in.');
  });

  socket.on('table:join', (p = {}) => {
    if (!token) return;
    const t = tables.get(clean(p.code, 6).toUpperCase());
    if (!t) return toast('No table with that code');
    if (personTable.get(token) === t.code) return pushTable(t);
    const err = joinable(t, token);
    if (err) return toast(err);
    joinTable(t, token);
  });

  socket.on('table:leave', () => {
    if (!token) return;
    leaveTable(token);
  });

  socket.on('table:settings', (p = {}) => {
    const t = myTable();
    if (!t || t.hostToken !== token || t.state === 'playing' || t.type !== 'game') return;
    const next = pick({ ...t.settings, ...p.settings, theme: p.settings?.theme ?? t.settings.theme, turnSec: p.settings?.turnSec ?? t.settings.turnSec });
    if (p.settings?.theme && p.settings.turnSec === undefined) next.turnSec = THEMES[p.settings.theme].turnSec;
    t.settings = { ...t.settings, ...next };
    if (typeof p.settings?.teams === 'boolean') t.settings.teams = p.settings.teams;
    pushTable(t);
  });

  socket.on('table:start', () => {
    const t = myTable();
    if (!t || t.hostToken !== token || t.state === 'playing' || t.type !== 'game') return;
    if (t.members.size < 2) return toast('You need at least 2 singers');
    startGame(t);
  });

  socket.on('table:kick', (p = {}) => {
    const t = myTable();
    if (!t || t.hostToken !== token || p.token === token || !t.members.has(p.token)) return;
    const sid = live.get(p.token);
    leaveTable(p.token, 'kicked');
    if (sid) io.to(sid).emit('kicked', { code: t.code });
  });

  socket.on('turn:done', (p = {}) => {
    const t = myTable();
    if (!t) return;
    const err = submitAttempt(t, token, p.song, p.lastWord);
    if (err) toast(err);
  });

  socket.on('turn:pass', () => {
    const t = myTable();
    if (t) loseLife(t, token, 'passed', { passed: true });
  });

  socket.on('turn:hint', () => {
    const t = myTable();
    if (!t || t.state !== 'playing' || currentToken(t) !== token || t.verifying) return;
    const m = memberOf(t, token);
    const used = new Set(t.trail.filter(x => x.song).map(x => x.song.toLowerCase()));
    const titles = (SONGS[t.letter] || []).filter(s => !used.has(s.toLowerCase())).sort(() => Math.random() - 0.5).slice(0, 3);
    if (!titles.length) return toast('No hints left for this letter');
    if (m.score < HINT_COST) return toast(`A hint costs ${HINT_COST} points`);
    m.score -= HINT_COST;
    socket.emit('hints', { letter: t.letter, titles });
    pushTable(t);
  });

  socket.on('vote', (p = {}) => {
    const t = myTable();
    if (t) castVote(t, token, p.vote);
  });

  socket.on('chat', (p = {}) => {
    const t = myTable();
    const text = clean(p.text, 200);
    if (t && text && memberOf(t, token)) addChat(t, token, text);
  });

  socket.on('react', (p = {}) => {
    const t = myTable();
    if (!t || !REACTIONS.includes(p.emoji) || !memberOf(t, token)) return;
    if (t.state === 'playing' && currentToken(t) !== token && !t.verifying) {
      t.claps++;
      if (currentToken(t)) t.clapTotals.set(currentToken(t), (t.clapTotals.get(currentToken(t)) || 0) + 1);
    }
    for (const m of t.members.keys()) {
      if (isHuman(m) && live.has(m) && !blockedEither(m, token)) io.to(live.get(m)).emit('react', { from: token, emoji: p.emoji });
    }
    pushTable(t);
  });

  // jam table: stage and queue
  socket.on('stage:take', () => {
    const t = myTable();
    if (!t || t.type !== 'jam') return;
    if (t.stage === token) t.stage = null;
    else if (!t.stage || !t.members.has(t.stage)) {
      t.stage = token;
      addChat(t, null, `${personOf(token).name} took the stage 🎤`);
    } else return toast('Someone is already on the stage');
    pushTable(t);
  });
  socket.on('queue:add', (p = {}) => {
    const t = myTable();
    const title = clean(p.title, 80);
    if (!t || t.type !== 'jam' || !title) return;
    t.queue.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title, by: token, name: personOf(token).name });
    pushTable(t);
  });
  socket.on('queue:next', () => {
    const t = myTable();
    if (!t || t.type !== 'jam') return;
    t.nowPlaying = t.queue.shift() || null;
    if (t.nowPlaying) addChat(t, null, `Now singing: ${t.nowPlaying.title}`);
    pushTable(t);
  });

  socket.on('invite', (p = {}) => {
    if (!token) return;
    const err = sendInvite(token, p.token);
    if (err) toast(err);
  });
  socket.on('invite:respond', (p = {}) => respondInvite(p.fromToken, token, !!p.accept));

  socket.on('profile:delete', () => {
    if (!token || !people.has(token)) return;
    leaveTable(token);
    people.delete(token);
    for (const p of people.values()) p.follows = p.follows.filter(x => x !== token);
    save();
    socket.emit('profile:deleted');
    pushLobby();
  });

  socket.on('follow', (p = {}) => {
    const me = people.get(token);
    if (!me || p.token === token || !personOf(p.token)) return;
    me.follows = me.follows.includes(p.token) ? me.follows.filter(x => x !== p.token) : [...me.follows, p.token];
    save();
    pushLobby();
    const t = myTable(); if (t) pushTable(t);
  });

  socket.on('block', (p = {}) => {
    const me = people.get(token);
    if (!me || p.token === token) return;
    me.blocks = me.blocks.includes(p.token) ? me.blocks.filter(x => x !== p.token) : [...me.blocks, p.token];
    save();
    pushLobby();
    const t = myTable(); if (t) pushTable(t);
    toast(me.blocks.includes(p.token) ? 'Blocked. You will not see each other.' : 'Unblocked');
  });

  socket.on('report', (p = {}) => {
    if (!token || !personOf(p.token)) return;
    let list = [];
    try { list = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch { /* none yet */ }
    list.push({ at: new Date().toISOString(), by: token, of: p.token, reason: clean(p.reason, 200) });
    fs.writeFile(REPORTS_FILE, JSON.stringify(list, null, 2), () => {});
    toast('Thank you. We will look into it.');
  });

  socket.on('rtc', (p = {}) => {
    const t = myTable();
    if (!t || !memberOf(t, p.to) || !live.has(p.to)) return;
    io.to(live.get(p.to)).emit('rtc', { from: token, data: p.data });
  });

  socket.on('disconnect', () => {
    if (!token || live.get(token) !== socket.id) return;
    live.delete(token);
    const code = personTable.get(token);
    const t = code && tables.get(code);
    if (t) {
      const m = memberOf(t, token);
      if (m) {
        m.online = false;
        m.graceTimer = setTimeout(() => leaveTable(token, 'timeout'), GRACE_MS);
        pushTable(t);
      }
    }
    pushLobby();
  });
});

// Lobby invites are answered by bots automatically (see sendInvite).
const lanIps = Object.values(os.networkInterfaces()).flat()
  .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

// On a hosting service the host gives the port and https, so only the plain server runs there.
module.exports = { app, io, tables, people, bots, live, sendInvite, respondInvite, createTable, joinTable, leaveTable, startGame, submitAttempt, castVote, loseLife, pushLobby, publicPerson, viewFor, DEVA, nextLetter, emitTo };

if (require.main === module) {
  if (process.env.PORT) {
    httpServer.listen(PORT, () => console.log(`🎤 Antakshari is live on port ${PORT}`));
  } else {
    httpServer.listen(PORT, () => {
      httpsServer.listen(SECURE_PORT, () => {
        console.log(`\n🎤 Antakshari is live`);
        console.log(`   This computer:   http://localhost:${PORT}`);
        lanIps.forEach(ip => console.log(`   Same Wi-Fi:      https://${ip}:${SECURE_PORT}  (accept the certificate warning)`));
        console.log('');
      });
    });
  }
}
