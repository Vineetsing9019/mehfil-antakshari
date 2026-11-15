/* Mehfil: browser app. Talks to server.js over Socket.IO; voices are WebRTC with the table. */
(() => {
'use strict';

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_SEEDS = ['Mehfil', 'Sargam', 'Taal', 'Raag', 'Dhun', 'Geet', 'Sur', 'Lehar', 'Jhankaar', 'Tarana', 'Ghazal', 'Qawwali'];
// Classic default avatar: the person's initials on a rich colour, drawn here in the browser.
// Nothing is loaded from another site, so names are never sent anywhere.
const AV_COLORS = ['#7c3aed', '#db2777', '#ea580c', '#0d9488', '#2563eb', '#c026d3', '#b45309', '#4f46e5'];
const dice = seed => {
  const s = String(seed || 'Mehfil');
  const words = s.trim().split(/\s+/).filter(Boolean);
  const ini = ((words[0]?.[0] || 'M') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
  const h = [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${AV_COLORS[h % AV_COLORS.length]}"/>`
    + `<text x="50" y="50" dy=".36em" text-anchor="middle" font-family="Poppins,Segoe UI,Arial,sans-serif" font-size="40" font-weight="600" fill="#fff">${esc(ini)}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
};
const THEMES = [['classic', 'Classic'], ['rapid', 'Rapid Fire'], ['dhun', 'Dhun round'], ['decade', 'Decade 90s'], ['actor', 'Actor round']];
const TURNS = [20, 30, 60, 90];
const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']];
const REACTIONS = ['👏', '🔥', '🎶', '😂', '❤️', '🙌', '🥹', '🤩'];
const MAX_POSTS = 9;
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const S = {
  token: null, me: null, named: false, ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  lobby: { people: [], tables: [] }, board: [], sent: new Set(), invites: [],
  table: null, singId: 0, utter: null, lastTurnKey: '', offset: 0, hints: null, draft: {}, overShown: '',
  peers: new Map(), local: null, micPromise: null, micDenied: false, micOn: false,
  actx: null, amb: null, analysers: new Map(), form: null, modalDismiss: true,
  pendingCode: null, pendingHandle: null, sheet: null, unread: 0,
  aiVoice: true, lyricIdx: -1, pickedLetter: null, saidTurn: '',
};
S.aiVoice = store.get('ak-aivoice') !== 'off';
S.sfx = store.get('ak-sfx') !== 'off';
S.muted = new Set();

const params = new URLSearchParams(location.search);
S.pendingCode = (params.get('t') || '').toUpperCase() || null;
S.pendingHandle = params.get('u') || null;

function makeToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
S.token = store.get('ak-token');
const firstVisit = !S.token;
if (!S.token) { S.token = makeToken(); store.set('ak-token', S.token); }
// The last profile and AI singers seen, so a returning singer's home shows before the server answers.
const cached = (() => { try { return JSON.parse(store.get('ak-me') || 'null'); } catch { return null; } })();
const remember = () => { if (S.me && S.named) store.set('ak-me', JSON.stringify({ me: S.me, ai: S.lobby.people.filter(p => p.bot) })); };

/* ---------- audio ---------- */
function audioCtx() {
  if (!S.actx) S.actx = new (window.AudioContext || window.webkitAudioContext)();
  if (S.actx.state === 'suspended') S.actx.resume();
  return S.actx;
}
function chime(freqs) {
  if (!S.sfx) return;
  try {
    const ctx = audioCtx();
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * .12;
      o.frequency.value = f; o.connect(g).connect(ctx.destination);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.15, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .5);
      o.start(t); o.stop(t + .55);
    });
  } catch { /* no audio */ }
}
// A short made-up tune for a bot singer (not a recording).
function hum(seed) {
  if (!S.sfx) return;
  try {
    const ctx = audioCtx(), notes = [261.6, 293.7, 329.6, 392, 440, 523.3];
    let i = 0;
    for (let k = 0; k < 8; k++) {
      i = (i + (String(seed).charCodeAt(k % String(seed).length) % 3) + 1) % notes.length;
      const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + k * .32;
      o.type = 'triangle'; o.frequency.value = notes[i]; o.connect(g).connect(ctx.destination);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + .03); g.gain.exponentialRampToValueAtTime(.001, t + .3);
      o.start(t); o.stop(t + .32);
    }
  } catch { /* no audio */ }
}
// 20 AI singer voices, one per singer (the server sends the number). Each is a pitch, a speed and which of
// the device's own voices to use, so it costs nothing. Female singers sit higher, male singers lower.
const VOICES = [
  { p: 1.22, r: 0.92, n: 0 }, { p: 0.78, r: 0.90, n: 0 }, { p: 1.10, r: 0.96, n: 1 }, { p: 0.88, r: 0.94, n: 1 },
  { p: 1.32, r: 0.88, n: 2 }, { p: 0.70, r: 0.86, n: 2 }, { p: 1.16, r: 0.84, n: 3 }, { p: 0.95, r: 0.98, n: 3 },
  { p: 1.28, r: 0.95, n: 1 }, { p: 0.82, r: 0.97, n: 4 }, { p: 1.05, r: 0.90, n: 4 }, { p: 0.74, r: 0.92, n: 1 },
  { p: 1.38, r: 0.93, n: 0 }, { p: 0.90, r: 0.85, n: 2 }, { p: 1.14, r: 1.00, n: 2 }, { p: 0.66, r: 0.95, n: 3 },
  { p: 1.25, r: 0.86, n: 3 }, { p: 0.86, r: 1.00, n: 0 }, { p: 1.08, r: 0.94, n: 4 }, { p: 0.80, r: 0.88, n: 4 },
];
const FEMALE_VOICE = /female|woman|zira|heera|kalpana|swara|neerja|aditi|veena|lekha|kajal|samantha|susan|hazel|libby|sonia|google हिन्दी|google us english|google uk english female/i;
const MALE_VOICE = /\bmale\b|\bman\b|ravi|hemant|madhur|prabhat|rishi|david|mark|george|daniel|ryan|guy|google uk english male/i;
// Picks one of the device's voices for the song's language, the singer's gender first.
function pickVoice(lang, g, n) {
  const langs = lang === 'en' ? ['en-in', 'en-gb', 'en-us', 'en'] : ['hi-in', 'mr-in', 'en-in', 'en-gb', 'en-us'];
  const rank = v => { const i = langs.findIndex(l => v.lang.replace('_', '-').toLowerCase().startsWith(l)); return i < 0 ? 99 : i; };
  const pool = (window.speechSynthesis?.getVoices() || []).filter(v => rank(v) < 99).sort((a, b) => rank(a) - rank(b));
  const isF = v => FEMALE_VOICE.test(v.name), isM = v => !isF(v) && MALE_VOICE.test(v.name);
  const same = pool.filter(g === 'm' ? isM : isF);
  const list = same.length ? same : pool;
  return list.length ? list[n % list.length] : null;
}
// A bot "sings" its lyrics in its own voice. Each line moves up or down a little, so it sounds sung, not read.
function speakSong(song, botToken) {
  const synth = window.speechSynthesis;
  if (!synth || !window.SpeechSynthesisUtterance) return hum(botToken);
  const h = [...String(botToken)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const vp = VOICES[(Number.isInteger(song.voice) ? song.voice : h) % VOICES.length];
  const voice = pickVoice(song.lang, song.g || (h % 2 ? 'm' : 'f'), vp.n);
  const tune = [1, 1.07, 0.97, 1.04];
  // Speak one line at a time, starting the next only when the last one ends. Queuing every line at once
  // makes some voices buzz or click between lines.
  const id = ++S.singId;
  const lines = [...(song.sing || song.lines)];
  let k = 0;
  const sayNext = () => {
    if (id !== S.singId || !lines.length) return;
    const idx = k++;
    const u = new SpeechSynthesisUtterance(lines.shift());
    // Karaoke: light up the line being sung.
    u.onstart = () => { if (id === S.singId) { S.lyricIdx = idx; highlightLyric(); } };
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.pitch = Math.max(0.1, Math.min(2, vp.p * tune[idx % tune.length]));
    u.rate = vp.r;
    u.volume = 1;
    S.utter = u;   // keep a reference so the browser does not drop it mid-line
    u.onend = () => setTimeout(sayNext, 300);
    u.onerror = () => setTimeout(sayNext, 300);
    synth.speak(u);
  };
  sayNext();
}
// Browsers load their voice list late; ask early so the first song already has the right voice.
window.speechSynthesis?.getVoices();
window.speechSynthesis?.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
// The lyric box shows the 4 lines being sung now (verse, then chorus), with the current line lit.
function lyricBox(v) {
  const all = v.botSing.sing || v.botSing.lines;
  const pos = Math.max(0, S.lyricIdx);
  const start = Math.floor(pos / 4) * 4;
  const part = start === 0 ? '' : start === 4 ? 'Chorus' : 'Chorus again';
  return '<div class="lyric-title">🎵 ' + esc(v.botSing.title) + (part ? ' · ' + part : '') + '</div>'
    + all.slice(start, start + 4).map((l, i) => '<span class="' + (start + i === S.lyricIdx ? 'on' : '') + '">' + esc(l) + '</span>').join('');
}
function highlightLyric() {
  const box = $('#t-stage .lyric');
  if (box && S.table?.botSing) box.innerHTML = lyricBox(S.table);
}
// 58. Soft tanpura and dholak under an AI singer's voice, only while it sings (and only with sounds on).
function musicBed(on) {
  if (on && S.sfx && !S.amb) { startAmbience(); S.bedOn = true; }
  else if (!on && S.bedOn) { S.bedOn = false; if (store.get('ak-music') !== 'on') stopAmbience(); }
}
// 62. A short tick for the last 5 seconds of your turn.
function tickSound() {
  if (!S.sfx) return;
  try {
    const ctx = audioCtx(), o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.value = 1250; o.connect(g).connect(ctx.destination);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.start(t); o.stop(t + 0.07);
  } catch { /* no audio */ }
}
// 61. "+10" (or "+15 ⚡ fast") rises from the stage when your song is accepted.
function popPoints(n) {
  const stage = $('#stage'); if (!stage) return;
  const el = document.createElement('div');
  el.className = 'points';
  el.textContent = `+${n}${n > 10 ? ' ⚡ fast' : ''}`;
  stage.appendChild(el);
  chime([784, 988, 1175]);
  setTimeout(() => el.remove(), 1700);
}
// Tanpura drone and a soft dholak beat for between turns.
function startAmbience() {
  if (S.amb) return;
  const ctx = audioCtx(), master = ctx.createGain();
  master.gain.value = .5; master.connect(ctx.destination);
  const drone = [130.8, 196].map(f => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; g.gain.value = .025;
    o.connect(g).connect(master); o.start(); return o;
  });
  const beat = setInterval(() => {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * .12), ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * .02));
    const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = buf; f.type = 'bandpass'; f.frequency.value = 700; g.gain.value = .25;
    n.connect(f).connect(g).connect(master); n.start();
  }, 600);
  S.amb = { master, drone, beat };
}
function stopAmbience() {
  if (!S.amb) return;
  clearInterval(S.amb.beat);
  S.amb.drone.forEach(o => { try { o.stop(); } catch { /* already stopped */ } });
  S.amb = null;
}
function analyserFor(token) {
  const stream = token === S.token ? S.local : S.peers.get(token)?.stream;
  if (!stream) return null;
  if (S.analysers.has(stream.id)) return S.analysers.get(stream.id);
  try {
    const an = audioCtx().createAnalyser();
    an.fftSize = 64;
    an._buf = new Uint8Array(an.frequencyBinCount);
    audioCtx().createMediaStreamSource(stream).connect(an);
    S.analysers.set(stream.id, an);
    return an;
  } catch { return null; }
}

/* ---------- toasts and modal ---------- */
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3400);
}
function modal(html, { dismiss = true } = {}) {
  S.modalDismiss = dismiss;
  $('#modal-root').innerHTML = `<div class="scrim" data-scrim><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
}
function closeModal() {
  if (S.micTesting) { S.micTesting = false; applyMic(); }
  $('#modal-root').innerHTML = '';
  S.form = null;
}

/* ---------- screens ---------- */
function show(id) {
  const was = ['boot', 'join', 'lobby', 'table'].find(s => !$('#screen-' + s).hidden);
  const apply = () => {
    ['boot', 'join', 'lobby', 'table'].forEach(s => { $('#screen-' + s).hidden = s !== id; });
    document.body.classList.toggle('on-table', id === 'table');
    $('#mechip').hidden = !S.named || id === 'boot';
    if (was !== id) window.scrollTo(0, 0);
  };
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (was && was !== id && was !== 'boot' && document.startViewTransition && !calm) {
    // The browser snapshots the old screen, then runs apply() and cross-fades to the new one.
    // A second screen change can cancel this fade; that is fine (the screen still changes), so ignore it.
    const vt = document.startViewTransition(apply);
    [vt.ready, vt.finished, vt.updateCallbackDone].forEach(p => p?.catch(() => {}));
  } else apply();
}
function renderMe() {
  const btn = $('#mechip');
  if (!S.me || !S.named) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.innerHTML = `${av(S.me)}<span>${esc(S.me.name)}</span>`;
}

function av(p, extra = '') {
  const seed = p?.name || p?.defaultSeed || 'Mehfil';
  const src = p?.photo || dice(seed);
  return `<span class="av ${extra}"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${dice(seed)}'"></span>`;
}

/* ---------- socket ---------- */
// Opened with no internet, the live-connection library may not load: use a stand-in so the page still works.
const socket = typeof io === 'function' ? io({ transports: ['websocket', 'polling'] }) : { on() {}, emit() {}, connected: false };
if (!navigator.onLine || typeof io !== 'function') {
  $('#netbar').textContent = "You're offline. Mehfil will reconnect when you're back.";
  $('#netbar').hidden = false;
}
if (typeof io !== 'function') window.addEventListener('online', () => location.reload());
// Actions wait here until the server has answered "hello" (it needs to know who is asking first).
S.ready = false; S.outbox = [];
function send(...args) {
  if (S.ready) socket.emit(...args);
  else S.outbox.push(args);
}
function flushOutbox() {
  S.ready = true;
  const queued = S.outbox.splice(0);
  queued.forEach(args => socket.emit(...args));
}
socket.on('connect', () => { $('#netbar').hidden = true; socket.emit('hello', { token: S.token }); });
socket.on('disconnect', () => { S.ready = false; $('#netbar').hidden = false; });
socket.on('me', m => {
  setTimeout(flushOutbox, 0);
  S.me = m.profile; S.named = m.named;
  if (!S.named) store.set('ak-me', '');
  remember();
  renderMe();
  if (!S.named) { showJoin(); return; }
  if (!S.table) showLobby();
  if (S.pendingCode) { send('table:join', { code: S.pendingCode }); S.pendingCode = null; history.replaceState({}, '', '/'); }
  if (S.pendingHandle) { const h = S.pendingHandle; S.pendingHandle = null; history.replaceState({}, '', '/'); openProfileByHandle(h); }
});
socket.on('profile:saved', m => {
  const editing = S.form?.mode === 'edit';
  S.me = m.profile; S.named = true; renderMe(); closeModal();
  if (editing) toast('Profile saved ✓');
  if (!S.table) showLobby();
  if (S.pendingCode) { send('table:join', { code: S.pendingCode }); S.pendingCode = null; history.replaceState({}, '', '/'); }
});
socket.on('profile:deleted', () => {
  S.named = false; S.me = null; S.table = null; renderMe(); closeModal();
  toast('Your profile was deleted');
  showJoin();
});
socket.on('lobby', d => { S.lobby = d; remember(); if (!S.table) renderLobby(); else if (S.sheet === 'singers') renderInviteList(); });
socket.on('table', v => {
  if (!v) { leaveLocal(); return; }
  S.table = v;
  S.offset = v.now - Date.now();
  // Call-style tables (Sing together, or "Everyone talks") start with the mic on.
  const callMode = true; // everyone talks, like a call
  if (S.lastCode !== v.code || S.lastCallMode !== callMode) S.micOn = callMode;
  S.lastCode = v.code; S.lastCallMode = callMode;
  show('table');
  renderTable();
  Promise.all([ensureMic(), S.iceReady]).then(syncPeers);
});
socket.on('chat', ({ table, msg }) => {
  if (!S.table || S.table.code !== table) return;
  if (!S.table.chat.some(m => m.id === msg.id)) S.table.chat.push(msg);
  if (S.sheet !== 'chat' && msg.from !== S.token) S.unread++;
  renderChatLog();
  renderDock();
});
socket.on('react', ({ from, emoji }) => floatEmoji(emoji, from));
socket.on('me:update', p => { S.me = p; remember(); renderMe(); if (!S.table) renderLobby(); });
socket.on('badge', b => {
  const el = document.createElement('div');
  el.className = 'badgepop';
  el.innerHTML = `<span>🏅</span><b>New badge</b><small>${esc(b)}</small>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
  confetti();
  chime([659, 784, 988, 1319]);
});
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; });
socket.on('toast', toast);
socket.on('invite', inv => {
  S.invites.push(inv);
  if (S.invites.length === 1) renderInvite();
  chime([660, 880]);
});
socket.on('invite:sent', ({ toToken }) => { S.sent.add(toToken); if (!S.table) renderLobby(); });
socket.on('invite:gone', ({ fromToken, toToken }) => {
  S.invites = S.invites.filter(i => i.fromToken !== fromToken);
  S.sent.delete(toToken);
  if ($('#modal-root .invite-sheet')) closeModal();
  if (S.invites.length) renderInvite();
  if (!S.table) renderLobby();
});
socket.on('hints', h => { S.hints = h; renderAction(); toast('Hints are shown below. They cost 5 points.'); });
socket.on('kicked', () => { toast('You were removed by the host'); leaveLocal(); });
socket.on('rtc', ({ from, data }) => handleRtc(from, data));

/* ---------- navigation ---------- */
// Each song starts with the letter the last one ended on (and the chain loops back to the start).
const DEMO = [['Riya Sharma', 'Raat Suhani', 'N'], ['Aarav Mehta', 'Nadiya Kinare', 'R'], ['Sneha Iyer', 'Rang Rang', 'G'],
  ['Kabir Malhotra', 'Gunguna Do', 'D'], ['Meera Kapoor', 'Dhoop Ki Chadar', 'R']];
let demoI = 0;
function demoStep() {
  const el = $('#demo-card');
  if (!el || $('#screen-join').hidden) return;
  const [who, song, next] = DEMO[demoI++ % DEMO.length];
  el.classList.remove('in');
  void el.offsetWidth; // restart the animation
  el.innerHTML = `${av({ name: who })}<div class="dc-text"><small>${esc(who.split(' ')[0])} sings</small><b><span class="first">${esc(song[0])}</span>${esc(song.slice(1))}</b></div>
    <div class="dc-next"><small>next</small><span>${next}</span></div>`;
  el.classList.add('in');
}
setInterval(demoStep, 2200);

function showJoin() {
  const already = !$('#screen-join').hidden && S.form?.mode === 'create';
  show('join');
  const note = $('#join-invite');
  note.hidden = !S.pendingCode;
  if (S.pendingCode) note.textContent = `🎤 You're invited to table ${S.pendingCode}. Type your name to join.`;
  if (already) return;
  demoStep();
  renderProfileForm('#form-join', { mode: 'create' });
  setTimeout(() => $('#form-join [data-f=name]')?.focus(), 50);
}
function showLobby() {
  show('lobby');
  renderLobby();
  loadBoard();
}
function leaveLocal() {
  S.table = null;
  S.lastCode = null;
  closeAllPeers();
  if (S.camOn) camOff(false);
  syncVideos();
  S.singId++; window.speechSynthesis?.cancel(); S.lyricIdx = -1;
  S.bedOn = false;
  stopAmbience();
  S.seenTrail = undefined;
  if (S.local) { S.local.getTracks().forEach(t => t.stop()); S.local = null; S.micPromise = null; }
  closeModal();
  if (S.named) showLobby(); else showJoin();
}
function loadBoard() {
  fetch('/leaderboard').then(r => r.json()).then(j => { S.board = j.rows; renderBoard(); }).catch(() => {});
}
setInterval(() => { if (!S.table && S.named) loadBoard(); }, 60000);

/* ---------- lobby ---------- */
// One round avatar in a row, like Instagram stories. Tap it to open the profile (Invite is there).
function storyHtml(p) {
  const name = p.bot ? p.name.split(' ')[0] : p.handle;
  return `<button class="story" data-act="profile" data-arg="${esc(p.token)}" aria-label="${esc(p.name)}">
    <span class="ringed ${p.status === 'free' ? '' : 'busy'}">${av(p)}</span>
    <small>${p.bot ? '<span class="aib">AI</span>' : ''}${esc(name)}</small></button>`;
}
// One open table: type, host, seats, language, and Join.
function tableCard(t) {
  return `<div class="tcard"><div><b>${t.type === 'jam' ? '🎶 Sing together' : '🎤 Antakshari'}</b><small>${esc(t.host)} · ${t.count}/${t.max}${t.lang ? ' · ' + esc(t.lang) : ''}${t.state === 'playing' ? ' · game on' : ''}</small></div><button class="btn btn-line btn-sm" data-act="join-tap" data-arg="${esc(t.code)}">Join</button></div>`;
}
function renderLobby() {
  if (S.table) return;
  const first = (S.me?.name || '').split(' ')[0];
  const streak = S.me?.streak || 0;
  $('#hello').innerHTML = first ? esc(`Namaste, ${first} 👋`) + (streak >= 2 ? ` <span class="streak">🔥 ${streak} days</span>` : '') : '';
  const d = S.me?.daily, extra = [];
  if (d) extra.push(d.done ? '<div class="daily done">🎯 Daily challenge done ✓ · new letter tomorrow</div>'
    : `<button class="daily" data-act="daily">🎯 Daily challenge: sing a <b>${esc(d.letter)}</b> song</button>`);
  if ((S.me?.sung || 0) >= 1 && !S.me?.photo && store.get('ak-photo-nudge') !== 'off')
    extra.push('<div class="nudge">📸 Add a photo so friends know you <button class="btn btn-text btn-sm" data-act="edit-profile">Add</button><button class="ico" data-act="nudge-off" aria-label="Not now">✕</button></div>');
  $('#home-extra').innerHTML = extra.join('');
  // Open tables: only shown when there are some.
  $('#tables-card').hidden = !S.lobby.tables.length;
  $('#lobby-tables').innerHTML = S.lobby.tables.slice(0, 1).map(tableCard).join('')
    + (S.lobby.tables.length > 1 ? `<button class="btn btn-text btn-sm" data-act="all-tables">See all ${S.lobby.tables.length} tables</button>` : '');
  // Real people and AI singers are always in separate rows.
  const humans = S.lobby.people.filter(p => !p.bot), ais = S.lobby.people.filter(p => p.bot);
  // One row: friends who are online first (green ring), then the AI singers.
  $('#friends-card').hidden = true;
  $('#singers-title').innerHTML = humans.length ? `<span class="dot"></span>Singers online <span class="muted">· ${humans.length + ais.length}</span>` : 'Singers';
  $('#online-count').textContent = humans.length ? `· ${humans.length}` : '';
  $('#stories').innerHTML = humans.slice(0, 30).map(storyHtml).join('');
  $('#ai-people').innerHTML = [...humans, ...ais].map(storyHtml).join('');
  renderFindList();
}
// Find a friend on home: people online whose name or @username matches. Free: Invite. At an open table: Join.
function renderFindList() {
  const box = $('#find-list'); if (!box || $('#find').hidden) return;
  const q = ($('#find-q')?.value || '').trim().toLowerCase().replace(/^@/, '');
  const list = S.lobby.people
    .filter(p => !q || (p.name + ' ' + p.handle).toLowerCase().includes(q))
    .sort((a, b) => (a.bot ? 1 : 0) - (b.bot ? 1 : 0))
    .slice(0, q ? 8 : 5);
  box.innerHTML = list.length ? list.map(p => {
    let act;
    if (p.status === 'free') act = S.sent.has(p.token) ? '<span class="pstate">Invited</span>' : `<button class="btn btn-line btn-sm" data-act="req" data-arg="${esc(p.token)}">Invite</button>`;
    else if (p.tableCode) act = `<button class="btn btn-line btn-sm" data-act="join-tap" data-arg="${esc(p.tableCode)}">Join</button>`;
    else act = '<span class="pstate">Busy</span>';
    const where = p.status === 'free' ? 'Free to sing' : p.tableCode ? (p.tableType === 'jam' ? 'Singing together' : p.status === 'playing' ? 'In a game · join to listen' : 'At a table') : 'At a private table';
    return `<div class="mrow">${av(p)}<div class="who"><div class="nm">${esc(p.name)}${p.bot ? '<span class="aib">AI</span>' : ''}</div><div class="role">${p.bot ? 'AI singer' : '@' + esc(p.handle) + ' · ' + where}</div></div>${act}</div>`;
  }).join('') : `<div class="muted inv-empty">${q ? 'No one online with that name. Share your table link so they can join.' : 'No one online yet.'}</div>`;
}
document.addEventListener('input', e => { if (e.target.id === 'find-q') renderFindList(); });

function boardHtml() {
  return S.board.length
    ? S.board.map((r, i) => `<li class="${i === 0 ? 'top' : ''}"><span>${i === 0 ? '👑' : i + 1 + '.'}</span><b>${esc(r.name)}</b><b>${r.points}</b></li>`).join('')
    : '<li class="board-empty">No scores yet this week. Win a song to be first.</li>';
}
function renderBoard() {
  const list = $('#modal-root .board-list');
  if (list) list.innerHTML = boardHtml();
}

/* ---------- profile form (create and edit) ---------- */
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9._]+/g, '.').replace(/^\.+|\.+$/g, ''); }
function toDataUrl(file, size) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight), out = Math.min(size, s);
      const c = document.createElement('canvas'); c.width = c.height = out;
      c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, out, out);
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', .82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}
function urlToDataUrl(url) {
  return fetch(url).then(r => r.blob()).then(b => new Promise(res => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b);
  })).catch(() => null);
}
// mode: 'create' (first profile) or 'edit' (opened from the menu, prefilled)
async function openEditProfile() {
  const me = S.me;
  const draft = { name: me.name, handle: me.handle, city: me.city, bio: me.bio === 'Singing on Antakshari 🎶' ? '' : me.bio,
    defaultSeed: me.defaultSeed, photo: me.photo ? await urlToDataUrl(me.photo) : null, photoChanged: false,
    posts: (await Promise.all((me.posts || []).map(urlToDataUrl))).filter(Boolean), postsChanged: false };
  modal(`<h3>Edit profile</h3><div id="form-edit"></div>`, { dismiss: false });
  renderProfileForm('#form-edit', { mode: 'edit', draft });
}
function renderProfileForm(sel, opts) {
  const mode = opts.mode;
  const draft = opts.draft || { name: '', handle: '', city: '', bio: '', defaultSeed: DEFAULT_SEEDS[Math.floor(Math.random() * DEFAULT_SEEDS.length)], photo: null, photoChanged: false, posts: [], postsChanged: false };
  S.form = { mode, draft, sel, handleTouched: !!draft.handle, edit: mode === 'edit' };
  const box = $(sel);
  const preview = draft.photo || (mode === 'edit' && !draft.photoChanged ? S.me?.photo : null) || dice(draft.name || 'Mehfil');
  if (mode === 'create') {
    // First visit: only a name. Photo, username, city and bio can be added later in Edit profile.
    box.innerHTML = `
      <div class="join-form">
        <span class="ringed"><span class="av av-lg"><img data-preview src="${esc(preview)}" alt=""></span></span>
        <label class="field"><span>What should we call you?</span>
          <input data-f="name" maxlength="20" placeholder="Your name" autocomplete="given-name" enterkeyhint="go" value="${esc(draft.name)}"></label>
        <button class="btn btn-primary btn-block btn-lg" data-act="save-profile">Let's sing →</button>
        <p class="fine">You can add a photo and more later from your profile.</p>
      </div>`;
    const nameIn = $(sel + ' [data-f=name]');
    nameIn.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveProfile(); } };
    return;
  }
  box.innerHTML = `
    <div class="photopick">
      <span class="ringed"><span class="av"><img data-preview src="${esc(preview)}" alt=""></span></span>
      <div class="pickrow">
        <label class="btn btn-line btn-sm">📷 Upload photo<input type="file" accept="image/*" hidden data-pick="photo"></label>
        <label class="btn btn-line btn-sm">🤳 Selfie<input type="file" accept="image/*" capture="user" hidden data-pick="photo"></label>
        ${draft.photo ? '<button class="btn btn-text btn-sm" data-act="no-photo">Use an avatar</button>' : ''}
      </div>
    </div>
    <label class="field"><span>Name *</span><input data-f="name" maxlength="20" placeholder="Your name" autocomplete="off" value="${esc(draft.name)}"></label>
    <label class="field"><span>Username</span><input data-f="handle" maxlength="24" placeholder="Filled in from your name" autocomplete="off" value="${esc(draft.handle)}"></label>
    <label class="field"><span>City</span><input data-f="city" maxlength="30" placeholder="Your city" autocomplete="off" value="${esc(draft.city)}"></label>
    <label class="field"><span>Bio</span><textarea data-f="bio" maxlength="120" rows="2" placeholder="A line about you (optional)">${esc(draft.bio)}</textarea></label>
    <span class="lbl">Your photos (optional, up to ${MAX_POSTS})</span>
    <div class="pgrid">${draft.posts.map((p, i) => `<div class="tile"><img src="${esc(p)}" alt=""><button type="button" class="rm" data-act="rm-post" data-arg="${i}" aria-label="Remove photo">✕</button></div>`).join('')}
      ${draft.posts.length < MAX_POSTS ? '<label class="tile add">＋ Add<input type="file" accept="image/*" multiple hidden data-pick="post"></label>' : ''}</div>
    <button class="btn btn-primary btn-block" data-act="save-profile">${mode === 'edit' ? 'Save profile' : 'Create profile & enter →'}</button>
    ${mode === 'edit' ? `<div class="row" style="margin-top:12px"><button class="btn btn-text btn-sm" data-act="close">Cancel</button><button class="btn btn-text btn-sm" data-act="delete-profile">Delete my profile</button></div>` : ''}
    <p class="fine">Usernames and photos are public. Don't share phone numbers or addresses here.</p>`;
}
document.addEventListener('input', e => {
  const f = e.target.dataset.f;
  if (!f || !S.form) return;
  const d = S.form.draft;
  d[f] = e.target.value;
  if (f === 'handle') S.form.handleTouched = true;
  if (f === 'name' && !S.form.handleTouched && !S.form.edit) {
    d.handle = slug(e.target.value);
    const h = $(S.form.sel + ' [data-f=handle]'); if (h) h.value = d.handle;
  }
  // The avatar shows the initials of the name as it is typed.
  if (f === 'name' && !d.photo) { const img = $(S.form.sel + ' [data-preview]'); if (img) img.src = dice(e.target.value || 'Mehfil'); }
});
document.addEventListener('change', async e => {
  const kind = e.target.dataset.pick;
  if (!kind || !S.form) return;
  const files = [...e.target.files];
  if (!files.length) return;
  const d = S.form.draft;
  try {
    if (kind === 'photo') { d.photo = await toDataUrl(files[0], 320); d.photoChanged = true; }
    else { d.posts = d.posts.concat(await Promise.all(files.slice(0, MAX_POSTS - d.posts.length).map(f => toDataUrl(f, 720)))); d.postsChanged = true; }
  } catch { toast("Couldn't read that picture, try another one"); }
  renderProfileForm(S.form.sel, { mode: S.form.mode, draft: d });
});

/* ---------- invites ---------- */
function renderInvite() {
  const inv = S.invites[0];
  if (!inv) return closeModal();
  modal(`<div class="invite-sheet"><div class="av" style="width:84px;height:84px;margin:0 auto 10px">${`<img src="${esc(inv.photo || dice(inv.defaultSeed || 'Mehfil'))}" alt="" style="width:100%;height:100%;object-fit:cover">`}</div>
    <h3>${esc(inv.name)} wants to sing with you!</h3>
    <p>${inv.table ? 'They have a table open. You will join it.' : 'Start a table together.'}</p>
    <div class="row"><button class="btn btn-line" data-act="invite-no" data-arg="${esc(inv.fromToken)}">Not now</button><button class="btn btn-primary" data-act="invite-yes" data-arg="${esc(inv.fromToken)}">Accept & sing</button></div>
    <div class="countdown"><i style="animation-duration:${inv.ms}ms"></i></div></div>`, { dismiss: false });
}

/* ---------- profile sheet ---------- */
function openProfileByHandle(h) {
  const p = S.lobby.people.find(x => x.handle === h);
  if (p) openProfile(p.token);
  else toast(`@${h} is not online right now`);
}
function openProfile(token) {
  const isMe = token === S.token;
  const p = isMe ? S.me : (S.lobby.people.find(x => x.token === token) || S.table?.members.find(m => m.token === token));
  if (!p) return toast('That singer is not around right now');
  const followed = !!p.followed;
  const busy = p.status && p.status !== 'free';
  if (p.bot) {
    const first = esc(p.name.split(' ')[0]);
    return modal(`<div class="av" style="width:96px;height:96px;margin:0 auto 10px"><img src="${esc(p.photo || dice(p.name))}" alt="" style="width:100%;height:100%;object-fit:cover"></div>
      <h3>${esc(p.name)}<span class="aib">AI</span></h3>
      <p class="muted">AI singer${p.city ? ' · 📍 ' + esc(p.city) : ''}</p>
      ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
      <p class="muted">Sings original Mehfil songs out loud, with the lyrics on screen.</p>
      <div class="row">${!busy && !S.sent.has(token) && !S.table ? `<button class="btn btn-primary" data-act="req" data-arg="${esc(token)}">Sing with ${first}</button>` : ''}
        <button class="btn btn-text" data-act="close">Close</button></div>`);
  }
  modal(`<div class="av" style="width:96px;height:96px;margin:0 auto 10px">${`<img src="${esc(p.photo || dice(p.defaultSeed || 'Mehfil'))}" alt="" style="width:100%;height:100%;object-fit:cover">`}</div>
    <h3>${esc(p.name)}${p.verified ? '<span class="tick">✓</span>' : ''}</h3>
    <p class="muted">@${esc(p.handle)}${p.city ? ' · 📍 ' + esc(p.city) : ''}</p>
    ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
    <div class="pstats"><div><b>${p.sung ?? 0}</b><span>songs</span></div><div><b>${p.wins ?? 0}</b><span>wins</span></div><div><b>${p.followers ?? 0}</b><span>followers</span></div></div>
    ${p.badges?.length ? `<div class="badges">${p.badges.map(b => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    ${p.posts?.length ? `<div class="pgrid">${p.posts.map(u => `<div class="tile"><img src="${esc(u)}" alt="Photo" data-act="lightbox" data-arg="${esc(u)}"></div>`).join('')}</div>` : `<p class="muted">${isMe ? 'Add photos so friends can see you 📸' : 'No photos yet'}</p>`}
    <div class="row">
      ${isMe ? `<button class="btn btn-primary" data-act="edit-profile">Edit profile</button><button class="btn btn-line" data-act="copy-profile">Copy my link</button>`
        : `${!busy && !S.sent.has(token) && !S.table ? `<button class="btn btn-primary" data-act="req" data-arg="${esc(token)}">Invite to sing</button>` : ''}
           <button class="btn btn-line" data-act="follow" data-arg="${esc(token)}">${followed ? 'Following ✓' : 'Follow'}</button>`}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn btn-text btn-sm" data-act="close">Close</button>
      ${isMe ? '' : `<button class="btn btn-text btn-sm" data-act="block" data-arg="${esc(token)}">Block</button><button class="btn btn-text btn-sm" data-act="report" data-arg="${esc(token)}">Report</button>`}
    </div>`);
}

/* ---------- table ---------- */
const callModeOf = () => true; // everyone talks, like a call
const turnName = v => v.members.find(m => m.token === v.turn)?.name || '';
const myMember = v => v.members.find(m => m.token === S.token);

function renderTable() {
  const v = S.table;
  if (!v) return;
  $('#t-type').textContent = v.type === 'jam' ? '🎶 Sing together' : '🎤 Antakshari';
  $('#t-code').textContent = v.code;
  $('#t-tap').hidden = !S.audioBlocked;
  // Start shows only when it can be pressed; alone, the box below explains how to get a second singer.
  const st = $('#t-start');
  st.hidden = !(v.isHost && v.type === 'game' && v.state !== 'playing' && v.members.length >= 2);
  st.textContent = v.state === 'over' ? 'Play again' : 'Start game';
  // A new turn of mine starts with empty boxes (nothing left over from an earlier turn).
  if (v.type === 'game' && v.state === 'playing' && v.turn === S.token && v.turn + ':' + v.trail.length !== S.lastTurnKey) {
    S.draft = {}; S.pickedLetter = null;
  }
  renderStage();
  renderAction();
  renderSheet();
  renderDock();
  if (v.state === 'over' && S.overShown !== v.code + ':' + v.trail.length) {
    S.overShown = v.code + ':' + v.trail.length;
    showOver();
  }
  const key = v.turn + ':' + v.trail.length;
  if (v.type === 'game' && v.state === 'playing' && key !== S.lastTurnKey) {
    S.lastTurnKey = key;
    if (v.turn === S.token) {
      chime([523, 659, 784]); navigator.vibrate?.(200);
      S.pickedLetter = null;
      $('#sr').textContent = `Your turn. Sing a song starting with ${v.letter}.`;
      // Bring the song box and the Done button into view, clear of the bottom bar.
      setTimeout(() => $('#t-action')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
    }
    // Someone else's turn: back to the top, so the stage and the top bar (code, Leave) are in view.
    if (v.turn !== S.token && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    const botNow = v.members.find(m => m.token === v.turn)?.bot;
    S.singId++;   // stop any line that is still waiting to be spoken
    S.lyricIdx = -1;
    window.speechSynthesis?.cancel();
    musicBed(!!(botNow && v.botSing && S.aiVoice));
    if (botNow && v.botSing && S.aiVoice) speakSong(v.botSing, v.turn);
    else if (v.botSong && botNow && S.aiVoice) hum(v.botSong);
  }
  if (v.verifying && v.members.find(m => m.token === v.verifying.singer)?.bot && S.bedOn) {
    musicBed(false); S.singId++; window.speechSynthesis?.cancel();
  }
  // 61. My song was just accepted: show the points.
  if (S.seenTrail !== undefined && v.trail.length > S.seenTrail) {
    const last = v.trail[v.trail.length - 1];
    if (last && last.song && last.by === S.token) popPoints(last.points);
  }
  S.seenTrail = v.trail.length;
  if (S.amb) S.amb.master.gain.value = v.turn ? .15 : .5;
  applyMic();
  applyMuting();
  updateVoiceStatus();
  if (S.camOn && !S.camPending && myMember(v) && !myMember(v).cam) camOff(false);
  syncVideos();
}

function renderStage() {
  const v = S.table;
  const n = v.members.length, teams = v.settings.teams;
  const seats = v.members.map((m, i) => {
    const ang = (2 * Math.PI * i / Math.max(n, 1)) - Math.PI / 2, R = 44;
    const x = 50 + R * Math.cos(ang), y = 50 + R * Math.sin(ang);
    const isTurn = v.state === 'playing' && m.token === v.turn;
    const out = v.type === 'game' && v.state === 'playing' && m.role === 'singer' && m.lives <= 0;
    const hearts = v.type === 'game' ? `<div class="hearts">${'❤'.repeat(Math.max(0, m.lives))}<span style="opacity:.25">${'❤'.repeat(Math.max(0, v.settings.lives - m.lives))}</span></div>` : '';
    const onStage = v.type === 'jam' && m.isStage;
    return `<div class="seat ${isTurn ? 'turn' : ''} ${out ? 'out' : ''}" style="left:${x}%;top:${y}%" title="${esc(m.name)}"${m.bot ? '' : ` data-tok="${esc(m.token)}"`}>
      <div class="seatav">${av(m)}${m.isHost ? '<span class="crown">👑</span>' : ''}${isTurn || onStage ? '<span class="micb">🎤</span>' : ''}</div>
      <div class="nm">${m.bot ? '<span class="aib">AI</span>' : ''}${esc(m.name.split(' ')[0])}${m.role === 'listener' ? ' · listening' : ''}</div>${hearts}
      ${v.type === 'game' ? `<div class="meta">${m.score} pts${teams && m.team ? ' · ' + m.team : ''}</div>` : ''}</div>`;
  }).join('');
  const verify = v.verifying ? `<div class="verify">
      <p>${voteQuestion(v)} Next letter: <b>${esc(v.verifying.next)}</b></p>
      ${v.verifying.canVote && !v.verifying.myVote ? `<div class="row"><button class="btn btn-line btn-sm" data-act="vote" data-arg="up">👍 Yes</button><button class="btn btn-line btn-sm" data-act="vote" data-arg="down">👎 No</button></div>` : `<p class="muted">${v.verifying.canVote ? 'Thanks, your vote is in' : 'Waiting for the table to vote…'}</p>`}
      <div class="counts">👍 ${v.verifying.up} · 👎 ${v.verifying.down}</div></div>` : '';
  let center;
  if (v.type === 'jam') {
    center = `<div><div class="letterlabel">Sing together</div><div class="letter" style="font-size:44px">🎶</div>
      <div class="secs">${v.stage ? `On stage: ${esc(v.members.find(m => m.token === v.stage)?.name || '')}` : 'Take the stage to lead a song'}</div></div>`;
  } else if (v.state === 'playing') {
    const dv = v.settings.lang !== 'en' && v.deva;
    center = `<div><div class="letterlabel">Start with</div>
      <div class="letter">${esc(dv ? v.deva : v.letter)}</div><div class="secs">${esc(dv ? v.letter : (v.deva || ''))}</div>
      <div class="secs" id="secs"></div>
      <div class="eq" id="eq">${'<i></i>'.repeat(16)}</div>
      <div class="secs">${v.turn === S.token ? 'Your turn' : esc(turnName(v).split(' ')[0]) + ' is singing'}</div>
      <div class="clapbar"><i style="width:${Math.min(100, v.claps * 12)}%"></i></div></div>`;
  } else {
    const winner = v.winnerTeam ? (v.winnerTeam === 'tie' ? 'A tie!' : `Team ${v.winnerTeam} wins`) : `${v.members.find(m => m.token === v.winnerToken)?.name || 'Someone'} wins`;
    center = `<div class="waitmsg"><div class="letterlabel">${v.state === 'over' ? 'Game over' : 'Waiting room'}</div>
      <div class="secs" style="font-size:15px;color:var(--text)">${v.state === 'over' ? `🏆 ${esc(winner)}` : `${v.members.length} in · ${v.members.length < 2 ? 'waiting for more' : 'ready'}`}</div></div>`;
  }
  const teamLine = teams && v.teamTotals ? `<div class="teams"><span>Team A <b>${v.teamTotals.A}</b></span><span>Team B <b>${v.teamTotals.B}</b></span></div>` : '';
  const crowd = v.crowdFav ? `<div class="secs" style="text-align:center;margin-top:6px">🎉 Crowd favourite: ${esc(v.members.find(m => m.token === v.crowdFav)?.name || '')}</div>` : '';
  const ring = v.state === 'playing' && v.type === 'game' ? `<svg class="ring" id="ring" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc145"/><stop offset="1" stop-color="#ff4f9a"/></linearGradient></defs><circle class="track" cx="50" cy="50" r="47"/><circle class="prog" id="ring-prog" cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>` : '';
  // A bot's lyrics sit under the stage, one line lit at a time (karaoke).
  // Under the circle: what the bot is singing (title and lyrics), or the last song sung.
  const lyric = v.state === 'playing' && v.botSing
    ? `<div class="lyric" aria-label="Lyrics">${lyricBox(v)}</div>`
    : v.state === 'playing' && v.botSong && v.members.find(m => m.token === v.turn)?.bot ? `<div class="lastsong">🎵 Singing “${esc(v.botSong)}”</div>`
    : v.state === 'playing' ? lastSongLine(v) : '';
  $('#t-stage').innerHTML = `<div class="stage" id="stage"><div class="rug"></div>${ring}<div class="center">${center}</div>${seats}${verify}</div>${lyric}${teamLine}${crowd}`;
  if (v.state === 'playing' && v.type === 'game') tickOnce();
}
// The vote question follows the game's theme, so the table judges the right thing.
function voteQuestion(v) {
  const who = `<b>${esc(v.members.find(m => m.token === v.verifying.singer)?.name.split(' ')[0] || 'the singer')}</b>`;
  const song = `<b>“${esc(v.verifying.song)}”</b>`;
  if (v.settings.theme === 'decade') return `Did ${who} sing ${song}, and is it from the 90s?`;
  if (v.settings.theme === 'actor') return `Did ${who} sing ${song}, a song of the actor they named?`;
  if (v.settings.theme === 'dhun') return `Did ${who} get the tune of ${song} right?`;
  return `Did ${who} sing ${song}?`;
}
// The line under "Your turn": the letter in the table's script, and a short how-to the first time.
function turnLead(v) {
  const dv = v.settings.lang !== 'en' && v.deva;
  const chip = `<span class="chipletter">${esc(dv ? v.deva : v.letter)}</span> ${esc(dv ? '(type ' + v.letter + ')' : v.deva || '')}`;
  const rule = v.settings.theme !== 'classic' ? ` ${esc(v.themeRule || '')}` : '';
  if (store.get('ak-tut')) return `Sing a song starting with ${chip}.${rule}`;
  return `First time? Sing out loud any song starting with ${chip}, then type its name and press Done. Its last word sets the next letter.${rule}`;
}
// "Last: song by name" under the letter, so the next singer has context.
function lastSongLine(v) {
  const last = [...v.trail].reverse().find(x => x.song);
  if (!last) return '';
  const who = v.members.find(m => m.token === last.by)?.name.split(' ')[0] || 'Someone';
  return `<div class="lastsong">Last: “${esc(last.song)}” · ${esc(who)}</div>`;
}

function tickOnce() {
  const v = S.table;
  if (!v || !v.turnEndsAt) return;
  const left = Math.max(0, v.turnEndsAt - (Date.now() + S.offset));
  const p = $('#ring-prog'); if (p) p.style.strokeDashoffset = String(100 - 100 * left / v.turnMs);
  $('#ring')?.classList.toggle('low', left < 10000);
  const s = $('#secs'); if (s) s.textContent = Math.ceil(left / 1000) + 's left';
  const sec = Math.ceil(left / 1000);
  if (v.turn === S.token && !v.verifying && left > 0 && sec <= 5 && sec !== S.tickSec) { S.tickSec = sec; tickSound(); navigator.vibrate?.(40); }
  animateEq(v);
}
// Equaliser bars follow the singer's real voice; a bot's bars move to its hummed tune.
function animateEq(v) {
  const bars = $$('#eq i');
  if (!bars.length) return;
  const singer = v.members.find(m => m.token === v.turn);
  const botSinging = !!(v.botSong && singer?.bot);
  const an = botSinging ? null : analyserFor(v.turn);
  if (an) an.getByteFrequencyData(an._buf);
  const t = performance.now() / 1000;
  bars.forEach((b, i) => {
    const x = botSinging ? Math.abs(Math.sin(t * 6 + i * .7) * Math.sin(t * 2.3 + i * .3)) * .9 : an ? an._buf[i + 1] / 255 : 0;
    b.style.height = (4 + x * 26) + 'px';
  });
}

function floatEmoji(emoji, from) {
  const stage = $('#stage'); if (!stage) return;
  const name = S.table?.members.find(m => m.token === from)?.name;
  const seat = $$('.seat', stage).find(el => el.title === name);
  const el = document.createElement('span');
  el.className = 'float'; el.textContent = emoji;
  el.style.left = seat ? seat.style.left : (30 + Math.random() * 40) + '%';
  el.style.top = seat ? seat.style.top : '50%';
  stage.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// The one box under the stage: says what to do now, nothing more.
function renderAction() {
  const v = S.table, box = $('#t-action');
  if (!v) return;
  const keep = { song: $('#in-song')?.value ?? S.draft.song ?? '' };
  box.classList.remove('yourturn');
  if (v.type === 'jam') {
    const onStage = v.stage && v.members.find(m => m.token === v.stage);
    box.innerHTML = `<div class="act-title">${onStage ? `🎤 On stage: <b>${esc(onStage.name)}</b>` : 'Nobody is on stage yet'}</div>
      ${v.nowPlaying ? `<div class="nowplay">♪ Now singing: <b>${esc(v.nowPlaying.title)}</b> <span class="muted">by ${esc(v.nowPlaying.name)}</span></div>` : ''}
      <form class="queue-row" data-form="queue"><input id="q-in" maxlength="80" placeholder="Add a song to the queue" autocomplete="off" aria-label="Song title"><button class="btn btn-line btn-sm" type="submit">Add</button></form>
      <div class="queue">${v.queue.length ? v.queue.map(q => `<div class="q"><span>${esc(q.title)}</span><small>${esc(q.name)}</small></div>`).join('') : '<div class="muted">The queue is empty</div>'}</div>
      <div class="row"><button class="btn btn-primary btn-sm" data-act="stage">${v.stage === S.token ? 'Step down' : '🎤 Take the stage'}</button><button class="btn btn-line btn-sm" data-act="queue-next">Next song ▶</button></div>
      ${v.members.length < 2 ? '<div class="row"><button class="btn btn-line btn-sm" data-act="share-wa">' + inviteLabel() + '</button><button class="btn btn-text btn-sm" data-act="copy">Copy link</button></div>' : ''}`;
    return;
  }
  if (v.state === 'playing') {
    if (v.turn === S.token && !v.verifying) {
      box.classList.add('yourturn');
      const hint = S.hints && S.hints.letter === v.letter ? `<div class="hints">${S.hints.titles.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '';
      box.innerHTML = `<div class="act-title">Your turn 🎤</div>
        <p class="lead">${turnLead(v)}</p>
        <div class="songrow"><input class="song-in" id="in-song" list="song-list" maxlength="80" placeholder="Song you sang, starting with ${esc(v.letter)}" autocomplete="off" enterkeyhint="done" value="${esc(keep.song)}">
          ${SpeechRec ? '<button class="ico micsay" data-act="say-title" aria-label="Say the song name" title="Say the song name">🎤</button>' : ''}</div>
        <datalist id="song-list"></datalist>
        <div class="nextline" id="next-hint"></div>
        ${hint}
        <div class="row turnrow">
          <button class="btn btn-primary" data-act="song-done">Done ✓</button>
          <button class="btn btn-line btn-sm" data-act="hint">💡 Hint −5</button>
          <button class="btn btn-line btn-sm" data-act="pass">Pass −1 ❤</button>
        </div>`;
      const check = () => {
        const s = ($('#in-song')?.value || '').trim(), f = (s.match(/[a-z]/i) || [''])[0].toUpperCase();
        // Suggestions only after 2 letters, so they help with spelling but don't give the answer away.
        const dl = $('#song-list');
        if (dl) dl.innerHTML = s.length >= 2 ? (v.titles || []).filter(t => t.toLowerCase().startsWith(s.toLowerCase()) && t.toLowerCase() !== s.toLowerCase()).slice(0, 6).map(t => `<option value="${esc(t)}"></option>`).join('') : '';
        S.draft = { song: $('#in-song')?.value || '' };
        const hintEl = $('#next-hint');
        if (!hintEl) return;
        // The next letter: the one the singer picked, or the sound of the song's last word.
        const next = S.pickedLetter || nextLetterClient(s.split(/\s+/).pop() || '');
        hintEl.className = 'nextline' + (s && f !== v.letter ? ' warn' : '');
        hintEl.innerHTML = s && f !== v.letter ? `Has to start with <b>${esc(v.letter)}</b>`
          : `Next singer gets <b class="nl">${next ? esc(next) : '…'}</b>${S.pickedLetter ? ' <span class="muted">(your pick)</span>' : ''}
            <button class="btn btn-text btn-sm" data-act="pick-letter">${S.pickedLetter ? 'Change' : 'Choose a letter'}</button>`;
      };
      $('#in-song').oninput = check;
      check();
      $('#in-song').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act=song-done]')?.click(); } };
      if (!keep.song) $('#in-song').focus({ preventScroll: true });
      return;
    }
    if (v.verifying) {
      box.innerHTML = `<div class="act-title">${v.verifying.singer === S.token ? 'The table is voting on your song…' : 'Vote on the song above'}</div>`;
      return;
    }
    const listener = myMember(v)?.role === 'listener';
    const botSinging = v.members.find(m => m.token === v.turn)?.bot;
    box.innerHTML = `<div class="act-title">${listener ? 'Listening 🎧 · you sing next round' : 'Listen and cheer 👏'}</div>
      ${botSinging && v.isHost ? '<button class="btn btn-line btn-sm" data-act="skip-bot">Skip ⏭</button>' : ''}`;
    return;
  }
  if (v.state === 'over') {
    box.innerHTML = `<div class="act-title">${v.isHost ? 'Game over. Play again ↑' : 'Game over'}</div>
      ${v.isHost ? '' : '<button class="btn btn-line btn-sm" data-act="rematch">Ask for a rematch 🔁</button>'}`;
    return;
  }
  if (!v.isHost) {
    box.innerHTML = `<div class="act-title">Waiting for the host to start</div>`;
    return;
  }
  // Waiting room for the host. Alone: sharing is the one primary action.
  // With 2 or more: Start game (at the top) is the primary, so these become secondary.
  const alone = v.members.length < 2;
  box.innerHTML = `<div class="act-title">${alone ? 'Who is singing?' : `${v.members.length} in. Press Start ↑`}</div>
    <div class="row">
      <button class="btn ${alone ? 'btn-primary' : 'btn-line'}" data-act="share-wa">${inviteLabel()}</button>
      <button class="btn btn-line btn-sm" data-act="add-bot">🤖 Add AI singer</button>
    </div>
    <div class="row"><button class="btn btn-text btn-sm" data-act="invite-name">Invite by name</button><button class="btn btn-text btn-sm" data-act="copy">Copy link</button></div>`;
}
function nextLetterClient(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  let i = w.length - 1;
  while (i > 0 && 'aeiouy'.includes(w[i])) i--;
  return (w[i] || '').toUpperCase();
}

// Bottom bar: mic, chat, reactions, singers, settings.
function renderDock() {
  const v = S.table;
  if (!v) return;
  const callMode = callModeOf(v);
  const live = callMode ? S.micOn : (v.state === 'playing' && v.turn === S.token && !v.verifying);
  const mic = $('#dock-mic');
  if (mic) {
    mic.classList.toggle('on', !!live);
    mic.querySelector('span').textContent = S.micDenied ? 'No mic' : live ? 'Mic on' : callMode ? 'Mic off' : 'Muted';
  }
  const cam = $('#dock-cam');
  if (cam) {
    cam.hidden = false;
    cam.classList.toggle('on', !!S.camOn);
    cam.querySelector('span').textContent = S.camOn ? 'Video on' : 'Video';
  }
  const badge = $('#dock-badge');
  if (badge) { badge.hidden = !S.unread; badge.textContent = S.unread; }
}

function membersHtml(v) {
  return v.members.map(m => {
    const role = m.isHost ? 'Host' : m.isStage ? 'On stage' : m.role === 'listener' ? 'Listening' : m.bot ? 'Bot singer' : 'Singer';
    const hearts = v.type === 'game' && v.state !== 'lobby' ? '❤'.repeat(Math.max(0, m.lives)) : '';
    return `<div class="mrow ${!m.online ? 'off' : ''} ${v.type === 'game' && m.lives <= 0 && m.role === 'singer' ? 'out' : ''}">
      ${av(m)}<div class="who"><div class="nm">${esc(m.name)}${m.token === S.token ? ' (you)' : ''}</div><div class="role">${role}${m.online ? '' : ' · reconnecting…'}</div></div>
      <div class="score">${v.type === 'game' ? `${hearts} ${m.score}` : ''}${m.claps ? ' · 👏' + m.claps : ''}</div>
      <div class="actions">
        ${m.token !== S.token && !m.bot ? `<button class="ico" data-act="mute" data-arg="${esc(m.token)}" aria-label="${S.muted.has(m.token) ? 'Unmute' : 'Mute'} ${esc(m.name)} for me" title="${S.muted.has(m.token) ? 'Unmute' : 'Mute for me'}">${S.muted.has(m.token) ? '🔇' : '🔊'}</button>` : ''}
        ${m.token !== S.token && !m.bot ? `<button class="ico" data-act="follow" data-arg="${esc(m.token)}" aria-label="${m.followed ? 'Unfollow' : 'Follow'} ${esc(m.name)}">${m.followed ? '★' : '☆'}</button>` : ''}
        ${v.isHost && m.token !== S.token ? `<button class="ico" data-act="kick" data-arg="${esc(m.token)}" aria-label="Remove ${esc(m.name)}">✕</button>` : ''}
        ${m.token !== S.token && !m.bot ? `<button class="ico" data-act="profile" data-arg="${esc(m.token)}" aria-label="Open profile">👤</button>` : ''}
      </div></div>`;
  }).join('');
}

function settingsHtml(v) {
  const s = v.settings;
  const privacy = (v.isHost ? `<label class="switch">Link only (hide from Open tables) <input type="checkbox" ${s.private ? 'checked' : ''} data-act="toggle-private" aria-label="Link only"></label><p class="muted setnote">${s.private ? '📷 Link only: only people you invited can join and see video.' : '📷 Open table: anyone who joins can see video. Turn on Link only for family and friends.'}</p>` : '')
    + (v.isHost && v.type === 'game' ? `<span class="lbl">AI singers</span><div class="chips">${[['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']].map(([k, l]) => `<button class="chip ${(s.botLevel || 'normal') === k ? 'on' : ''}" data-act="set" data-arg="botLevel=${k}">${l}</button>`).join('')}</div>` : '');
  if (v.type === 'jam') return privacy + '<p class="muted">Sing together has no game settings. Everyone talks, and the queue is on the main screen.</p>';
  if (!v.isHost || v.state === 'playing') {
    return privacy + `<p class="muted">Game: ${esc(v.themeLabel)} · ${s.turnSec}s a turn · ${s.lives} ❤ · everyone talks${s.teams ? ' · teams' : ''}</p>
      <p class="muted">Only the host can change these before a game.</p>`;
  }
  return privacy + `<span class="lbl">Theme</span><div class="chips">${THEMES.map(([k, l]) => `<button class="chip ${s.theme === k ? 'on' : ''}" data-act="set" data-arg="theme=${k}">${l}</button>`).join('')}</div>
    <span class="lbl">Time per turn</span><div class="chips">${TURNS.map(t => `<button class="chip ${s.turnSec === t ? 'on' : ''}" data-act="set" data-arg="turnSec=${t}">${t}s</button>`).join('')}</div>
    <span class="lbl">Lives</span><div class="chips">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${s.lives === n ? 'on' : ''}" data-act="set" data-arg="lives=${n}">${n} ❤</button>`).join('')}</div>
    <span class="lbl">Letters</span><div class="chips">${LANGS.map(([k, l]) => `<button class="chip ${s.lang === k ? 'on' : ''}" data-act="set" data-arg="lang=${k}">${l}</button>`).join('')}</div>
    <label class="switch">Team A vs Team B <input type="checkbox" ${s.teams ? 'checked' : ''} data-act="toggle-teams" aria-label="Teams"></label>
    <p class="muted">Press Start game at the top when everyone is in.</p>`;
}

// Chat, singers and settings open here, as small sheets over the table.
function openSheet(name) {
  S.sheet = name;
  if (name === 'chat') S.unread = 0;
  $('#sheet-root').innerHTML = `<div class="sheet-scrim" data-sheet-scrim><div class="sheet-panel" role="dialog" aria-modal="true">
    <div class="sheet-head"><b id="sheet-title"></b><button class="sheet-x" data-act="sheet-close" aria-label="Close">✕</button></div>
    <div id="sheet-body"></div></div></div>`;
  renderSheet();
  renderDock();
  if (name === 'chat') setTimeout(() => { const l = $('#t-chatlog'); if (l) l.scrollTop = l.scrollHeight; }, 0);
}
function closeSheet() {
  S.sheet = null;
  $('#sheet-root').innerHTML = '';
  renderDock();
}
function renderSheet() {
  const v = S.table, body = $('#sheet-body');
  if (!S.sheet || !v || !body) return;
  const title = $('#sheet-title');
  if (S.sheet === 'chat') {
    title.textContent = '💬 Table chat';
    const typed = $('#chat-in')?.value ?? '';
    body.innerHTML = `<div class="chatlog" id="t-chatlog"></div>
      <div class="quick">${v.quickChat.map(q => `<button data-act="quick" data-arg="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <form class="chat-row" data-form="chat"><input id="chat-in" maxlength="200" placeholder="Say something…" autocomplete="off" aria-label="Chat message" value="${esc(typed)}"><button class="btn btn-primary btn-sm" type="submit">Send</button></form>`;
    renderChatLog();
    return;
  }
  if (S.sheet === 'singers') {
    title.textContent = `👥 Singers ${v.members.length}/${v.type === 'jam' ? 8 : 6}`;
    const q = $('#inv-q')?.value ?? '', typing = document.activeElement?.id === 'inv-q';
    body.innerHTML = `<div class="invite-name"><input id="inv-q" placeholder="Invite by name" autocomplete="off" aria-label="Invite by name" value="${esc(q)}"><div id="inv-list"></div></div>
      <div class="sechead"><span class="muted" id="voice-status"></span></div><div class="members">${membersHtml(v)}</div>`;
    renderInviteList();
    if (typing) { const i = $('#inv-q'); i.focus(); i.setSelectionRange(q.length, q.length); }
    updateVoiceStatus();
    return;
  }
  title.textContent = '⚙ Settings';
  body.innerHTML = `<div class="set-share">
      <button class="btn btn-line btn-sm" data-act="share-wa">${navigator.share ? 'Share link' : 'Share on WhatsApp'}</button>
      <button class="btn btn-line btn-sm" data-act="copy">Copy link</button>
      <button class="btn btn-line btn-sm" data-act="qr">QR code</button>
      <button class="btn btn-line btn-sm" data-act="mic-test">🎙 Mic check</button>
      <button class="btn btn-line btn-sm" data-act="music">${S.amb ? '🔇 Music off' : '🎵 Music on'}</button>
    </div>
    <label class="switch">AI singers sing out loud <input type="checkbox" ${S.aiVoice ? 'checked' : ''} data-act="ai-voice" aria-label="AI voice"></label>
    <label class="switch">Sounds <input type="checkbox" ${S.sfx ? 'checked' : ''} data-act="sfx" aria-label="Sounds"></label>
    ${settingsHtml(v)}
    <button class="btn btn-text btn-block" data-act="leave" style="margin-top:14px">Leave table</button>`;
}

// People you can invite from the table: free singers whose name matches, real people first.
function renderInviteList() {
  const box = $('#inv-list'); if (!box) return;
  const q = ($('#inv-q')?.value || '').trim().toLowerCase();
  const here = new Set((S.table?.members || []).map(m => m.token));
  const list = S.lobby.people
    .filter(p => p.status === 'free' && !here.has(p.token) && (!q || (p.name + ' ' + p.handle).toLowerCase().includes(q)))
    .sort((a, b) => (a.bot ? 1 : 0) - (b.bot ? 1 : 0))
    .slice(0, q ? 8 : 4);
  box.innerHTML = list.length ? list.map(p => `<div class="mrow">${av(p)}<div class="who"><div class="nm">${esc(p.name)}${p.bot ? '<span class="aib">AI</span>' : ''}</div><div class="role">${p.bot ? 'AI singer' : '@' + esc(p.handle)}</div></div>
      ${S.sent.has(p.token) ? '<span class="pstate">Invited</span>' : `<button class="btn btn-line btn-sm" data-act="req" data-arg="${esc(p.token)}">Invite</button>`}</div>`).join('')
    : `<div class="muted inv-empty">${q ? 'No free singer with that name' : 'No one free right now'}</div>`;
}
document.addEventListener('input', e => { if (e.target.id === 'inv-q') renderInviteList(); });

function renderChatLog() {
  const v = S.table, box = $('#t-chatlog');
  if (!v || !box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = v.chat.length ? v.chat.map(m => m.from
    ? `<div class="msg">${m.from === S.token ? `<b>${esc(m.name)}</b>` : `<b class="who-link" data-act="chat-profile" data-arg="${esc(m.from)}" role="button" tabindex="0">${esc(m.name)}</b>`}${esc(m.text)}</div>`
    : `<div class="msg sys">${esc(m.text)}</div>`).join('') : '<div class="msg sys">Say hello to the table 👋</div>';
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function toggleTray() {
  const t = $('#react-tray');
  t.hidden = !t.hidden;
  if (!t.hidden) t.innerHTML = REACTIONS.map(e => `<button data-act="react" data-arg="${e}" aria-label="React ${e}">${e}</button>`).join('');
}

function showOver() {
  const v = S.table;
  const ranked = [...v.members].sort((a, b) => b.score - a.score);
  const winnerName = v.winnerTeam ? (v.winnerTeam === 'tie' ? 'A tie!' : `Team ${v.winnerTeam} wins!`) : `${v.members.find(m => m.token === v.winnerToken)?.name || 'Someone'} wins!`;
  const mine = v.winnerToken === S.token;
  modal(`<div class="trophy">🏆</div><h3>${mine ? 'You won the mehfil!' : esc(winnerName)}</h3>
    <p>${v.trail.filter(t => t.song).length} song${v.trail.filter(t => t.song).length === 1 ? '' : 's'} sung</p>
    ${v.trail.some(t => t.song) ? `<ol class="recap">${v.trail.filter(t => t.song).slice(-12).map(t => `<li>🎵 ${esc(t.song)} <span class="muted">· ${esc(v.members.find(m => m.token === t.by)?.name.split(' ')[0] || '')}</span></li>`).join('')}</ol>` : ''}
    ${v.crowdFav ? `<p>🎉 Crowd favourite: <b>${esc(v.members.find(m => m.token === v.crowdFav)?.name || '')}</b></p>` : ''}
    <div class="board">${ranked.map((p, i) => `<div class="${p.token === v.winnerToken ? 'win' : ''}"><span>${i + 1}.</span>${av(p)}<span class="n">${esc(p.name)}${p.team ? ' · ' + p.team : ''}</span><b>${p.score}</b></div>`).join('')}</div>
    <div class="row">${v.isHost ? '<button class="btn btn-primary" data-act="start">Play again</button>' : '<button class="btn btn-primary" data-act="rematch">Ask for a rematch 🔁</button>'}
      <button class="btn btn-line" data-act="share-result">Share</button></div>
    <div class="row"><button class="btn btn-text btn-sm" data-act="close">Back to table</button>
      ${S.installPrompt && store.get('ak-install') !== 'off' ? '<button class="btn btn-text btn-sm" data-act="install">📲 Add to home screen</button>' : ''}</div>`);
  confetti();
}
function confetti() {
  const colors = ['#ffc145', '#ff4f9a', '#2ee6c5', '#8b5cf6', '#ff8a1f'];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length];
    c.style.animationDuration = (2 + Math.random() * 2) + 's'; c.style.animationDelay = Math.random() * .6 + 's';
    document.body.appendChild(c); setTimeout(() => c.remove(), 4500);
  }
}

/* ---------- microphone and voices ---------- */
function ensureMic() {
  if (!S.micPromise) {
    S.micPromise = navigator.mediaDevices?.getUserMedia
      // Singing sounds best without the speech filters: noise suppression and auto-gain
      // distort or cut off voices. Echo cancellation stays on so speakers don't echo back.
      ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 } })
        .then(s => { S.local = s; S.micDenied = false; s.getAudioTracks().forEach(t => { t.enabled = false; }); attachMicToPeers(); applyMic(); updateMicLine(); return s; })
        .catch(err => {
          S.micDenied = true; S.micError = err?.name || 'error';
          toast(S.micError === 'NotAllowedError' ? 'Mic is blocked. Allow the mic (lock icon in the address bar), then tap "Try mic again".' : 'No microphone found on this device.');
          updateMicLine(); return null;
        })
      : Promise.resolve(null).then(() => { S.micDenied = true; S.micError = 'https'; toast('Open Mehfil over https (or localhost) to use the mic'); updateMicLine(); return null; });
  }
  return S.micPromise;
}
// Asks for the microphone again (after the user allowed it in the browser).
function retryMic() {
  S.micPromise = null; S.micDenied = false; S.micError = null;
  return ensureMic().then(s => { if (s) syncPeers(); return s; });
}
// Puts the microphone track on every connection. Each connection has a sender ready from the start,
// so the mic can be added later without renegotiating.
function attachMicToPeers() {
  const track = S.local?.getAudioTracks()[0];
  if (!track) return;
  S.peers.forEach(p => { p.tr?.sender.replaceTrack(track).catch(() => {}); });
}
function updateMicLine() {
  const box = $('#micstate'); if (box && S.micDenied) box.innerHTML = `<span class="led"></span>Mic not available. ${S.micError === 'NotAllowedError' ? 'Allow the mic in your browser, then' : ''} <button class="btn btn-line btn-sm" data-act="mic-retry">Try mic again</button>`;
}
// Shows how many people you can hear, so problems are visible.
function updateVoiceStatus() {
  const el = $('#voice-status'); const v = S.table; if (!el || !v) return;
  const others = v.members.filter(m => m.token !== S.token && !m.bot);
  const up = others.filter(m => S.peers.get(m.token)?.pc.connectionState === 'connected').length;
  el.textContent = others.length ? `Voice: ${up} of ${others.length} connected` : '';
}
function applyMic() {
  const v = S.table, track = S.local?.getAudioTracks()[0];
  if (track && v) {
    const callMode = true; // everyone talks, like a call
    track.enabled = S.micOn;
  }
  if (S.micTesting && track) track.enabled = true;
}
function applyMuting() {
  const v = S.table;
  S.peers.forEach((p, tok) => {
    // Take-turns games: only the singer is heard. Call-style tables: everyone is heard.
    p.audio.muted = S.muted.has(tok);
  });
}
function syncPeers() {
  const v = S.table;
  if (!v) return closeAllPeers();
  const want = new Set(v.members.filter(m => m.token !== S.token && !m.bot && m.online).map(m => m.token));
  for (const tok of [...S.peers.keys()]) if (!want.has(tok)) closePeer(tok);
  for (const tok of want) if (!S.peers.has(tok) && S.token < tok) makePeer(tok, true);
  applyMuting();
}
function makePeer(tok, initiator) {
  const pc = new RTCPeerConnection({ iceServers: S.ice });
  // Only the person who starts the call adds the audio slot. The other side uses the slot from the offer.
  const tr = initiator ? pc.addTransceiver('audio', { direction: 'sendrecv' }) : null;
  if (tr) { const track = S.local?.getAudioTracks()[0]; if (track) tr.sender.replaceTrack(track).catch(() => {}); }
  // Higher quality audio for singing: up to 128 kbps (the browser default is much lower).
  if (tr) try {
    const sp = tr.sender.getParameters();
    sp.encodings = sp.encodings?.length ? sp.encodings : [{}];
    sp.encodings[0].maxBitrate = 128000;
    tr.sender.setParameters(sp).catch(() => {});
  } catch { /* older browsers: keep the default */ }
  // Video slot: empty until someone turns their camera on (link-only tables only).
  const vtr = initiator ? pc.addTransceiver('video', { direction: 'sendrecv' }) : null;
  if (vtr) { if (S.camTrack) vtr.sender.replaceTrack(S.camTrack).catch(() => {}); capVideo(vtr); }
  const audio = new Audio();
  audio.autoplay = true; audio.playsInline = true;
  document.body.appendChild(audio);
  const p = { pc, tr, vtr, audio, stream: null, vstream: null, queue: [] };
  pc.ontrack = e => {
    if (e.track.kind === 'video') { p.vstream = new MediaStream([e.track]); syncVideos(); return; }
    p.stream = e.streams[0] || new MediaStream([e.track]);
    audio.srcObject = p.stream;
    applyMuting();
    audio.play().catch(() => { S.audioBlocked = true; renderTable(); });
  };
  pc.onicecandidate = e => { if (e.candidate) send('rtc', { to: tok, data: { candidate: e.candidate } }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') closePeer(tok);
    updateVoiceStatus();
  };
  S.peers.set(tok, p);
  if (initiator) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => send('rtc', { to: tok, data: { sdp: pc.localDescription } })).catch(() => {});
  return p;
}
// Small, smooth video that phones can carry: about 320x240 at 15 frames a second.
function capVideo(tr) {
  try {
    const sp = tr.sender.getParameters();
    sp.encodings = sp.encodings?.length ? sp.encodings : [{}];
    sp.encodings[0].maxBitrate = 300000; sp.encodings[0].maxFramerate = 15;
    tr.sender.setParameters(sp).catch(() => {});
  } catch { /* keep the browser default */ }
}
async function camOn() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' } });
    S.camTrack = s.getVideoTracks()[0];
    S.camStream = new MediaStream([S.camTrack]);
  } catch { toast('The camera is blocked or missing. Allow it in your browser to use video.'); return; }
  S.camOn = true; S.camPending = true;
  S.peers.forEach(p => p.vtr?.sender.replaceTrack(S.camTrack).catch(() => {}));
  send('cam', { on: true }, ok => {
    S.camPending = false;
    if (ok) toast(S.table?.settings.private ? 'Your camera is on. Only people you invited can see you.' : 'Your camera is on. People at this table can see you.');
    else camOff(false);
  });
  syncVideos(); renderDock();
}
function camOff(tell = true) {
  S.camTrack?.stop();
  S.camTrack = null; S.camStream = null; S.camOn = false; S.camPending = false;
  S.peers.forEach(p => p.vtr?.sender.replaceTrack(null).catch(() => {}));
  if (tell) send('cam', { on: false });
  syncVideos(); renderDock();
}
// Video tiles above the stage, one per person whose camera is on. Tiles are kept (not redrawn) so video never flickers.
function syncVideos() {
  const box = $('#vids'); if (!box) return;
  const v = S.table;
  const on = v ? v.members.filter(m => m.cam && !m.bot) : [];
  box.hidden = !on.length;
  box.dataset.n = on.length;
  const want = new Set(on.map(m => m.token));
  $$('.vtile', box).forEach(el => { if (!want.has(el.dataset.tok)) el.remove(); });
  on.forEach(m => {
    let el = [...box.children].find(x => x.dataset.tok === m.token);
    if (!el) {
      el = document.createElement('div');
      el.className = 'vtile' + (m.token === S.token ? ' me' : '');
      el.dataset.tok = m.token;
      el.innerHTML = `<video autoplay playsinline muted></video><span>${esc(m.token === S.token ? 'You' : m.name.split(' ')[0])}</span>`;
      box.appendChild(el);
    }
    const stream = m.token === S.token ? S.camStream : S.peers.get(m.token)?.vstream;
    const vid = el.querySelector('video');
    if (stream && vid.srcObject !== stream) { vid.srcObject = stream; vid.play().catch(() => {}); }
    el.classList.toggle('waiting', !stream);
  });
}
// Read-only call numbers for checking calls (used by the end-to-end tests; harmless to anyone else).
window.mehfilCallStats = async () => Promise.all([...S.peers].map(async ([tok, p]) => {
  const out = { peer: S.table?.members.find(m => m.token === tok)?.name || tok, state: p.pc.connectionState, audioIn: 0, videoSentBytes: 0, videoFramesDecoded: 0,
    slots: p.pc.getTransceivers().map(t => `${t.mid}:${t.receiver.track?.kind}:${t.direction}/${t.currentDirection}:${t.sender.track ? 'track' : 'none'}${t === p.vtr ? ':vtr' : ''}`).join(' ') };
  (await p.pc.getStats()).forEach(r => {
    if (r.type === 'inbound-rtp' && r.kind === 'audio') out.audioIn += r.bytesReceived || 0;
    if (r.type === 'outbound-rtp' && r.kind === 'video') out.videoSentBytes += r.bytesSent || 0;
    if (r.type === 'inbound-rtp' && r.kind === 'video') out.videoFramesDecoded += r.framesDecoded || 0;
  });
  return out;
}));
function closePeer(tok) {
  const p = S.peers.get(tok); if (!p) return;
  try { p.pc.close(); } catch { /* already closed */ }
  p.audio.srcObject = null; S.peers.delete(tok);
}
function closeAllPeers() { [...S.peers.keys()].forEach(closePeer); }
async function handleRtc(from, data) {
  await (S.micPromise || Promise.resolve());
  const p = S.peers.get(from) || makePeer(from, false);
  const pc = p.pc;
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      if (data.sdp.type === 'offer') {
        p.tr = pc.getTransceivers().find(t => t.receiver.track?.kind === 'audio') || null;
        if (p.tr) { p.tr.direction = 'sendrecv'; const tk = S.local?.getAudioTracks()[0]; if (tk) p.tr.sender.replaceTrack(tk).catch(() => {}); }
        p.vtr = pc.getTransceivers().find(t => t.receiver.track?.kind === 'video') || null;
        if (p.vtr) { p.vtr.direction = 'sendrecv'; if (S.camTrack) p.vtr.sender.replaceTrack(S.camTrack).catch(() => {}); capVideo(p.vtr); }
        await pc.setLocalDescription(await pc.createAnswer());
        send('rtc', { to: from, data: { sdp: pc.localDescription } });
      }
      for (const c of p.queue.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else p.queue.push(data.candidate);
    }
  } catch (err) { console.warn('voice link', err); }
}

/* ---------- actions ---------- */
function joinCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return toast('Type the table code first');
  send('table:join', { code: c });
}
const ACT = {
  'quick-play': () => send('table:quick'),
  'start-game': () => send('table:create', { type: 'game' }),
  'start-jam': () => send('table:create', { type: 'jam' }),
  'add-bot': () => send('table:addbot'),
  'toggle-private': () => send('table:settings', { settings: { private: !S.table.settings.private } }),
  'chat-profile': arg => { closeSheet(); openProfile(arg); },
  board: () => modal('<h3>🏆 This week</h3><ol class="board-list">' + boardHtml() + '</ol><div class="row"><button class="btn btn-primary" data-act="close">OK</button></div>'),
  howto: () => modal('<h3>How to play</h3><ol class="howto"><li>Sing a song that starts with the big letter.</li><li>Type its name. Its last letter goes to the next singer.</li><li>Everyone votes. Last singer standing wins.</li></ol><div class="row"><button class="btn btn-primary" data-act="close">Got it</button></div>'),
  'show-code': () => { $('#code-form').hidden = false; $('#show-code').hidden = true; $('#code-in').focus(); },
  'join-tap': arg => { closeModal(); joinCode(arg); },
  'find-friend': () => {
    const f = $('#find'); f.hidden = !f.hidden;
    $('#find-btn').textContent = f.hidden ? '🔍 Find a friend' : 'Close';
    if (!f.hidden) { renderFindList(); $('#find-q').focus(); }
  },
  'all-tables': () => modal(`<h3>Open tables</h3><div class="tlist">${S.lobby.tables.map(tableCard).join('')}</div><div class="row"><button class="btn btn-text btn-sm" data-act="close">Close</button></div>`),
  req: arg => { send('invite', { token: arg }); S.sent.add(arg); closeModal(); if (!S.table) renderLobby(); else renderInviteList(); },
  'pick-letter': () => modal(`<h3>Next letter</h3><p>Pick the letter the next singer starts with.</p>
    <div class="az">${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `<button class="chip ${S.pickedLetter === l ? 'on' : ''}" data-act="set-letter" data-arg="${l}">${l}</button>`).join('')}</div>
    <div class="row"><button class="btn btn-text btn-sm" data-act="set-letter" data-arg="">Use the song's last letter</button></div>`),
  'set-letter': arg => { S.pickedLetter = arg || null; closeModal(); renderAction(); $('#in-song')?.focus({ preventScroll: true }); },
  cam: () => {
    if (S.camOn) return camOff();
    if (S.table && !S.table.settings.private) {
      return modal(`<h3>Turn on video?</h3><p>This table is open, so anyone who joins can see you. For family and friends only, turn on "Link only" in Settings.</p>
        <div class="row"><button class="btn btn-primary" data-act="cam-yes">Turn on video</button><button class="btn btn-text" data-act="close">Not now</button></div>`);
    }
    camOn();
  },
  'cam-yes': () => { closeModal(); camOn(); },
  'skip-bot': () => { S.singId++; window.speechSynthesis?.cancel(); musicBed(false); send('turn:skipbot'); },
  rematch: () => { send('rematch'); closeModal(); },
  daily: () => send('table:quick', { daily: true }),
  'nudge-off': () => { store.set('ak-photo-nudge', 'off'); renderLobby(); },
  install: () => { const p = S.installPrompt; S.installPrompt = null; store.set('ak-install', 'off'); closeModal(); p?.prompt(); },
  mute: arg => {
    const name = S.table?.members.find(m => m.token === arg)?.name || 'them';
    if (S.muted.has(arg)) { S.muted.delete(arg); toast(`You can hear ${name} again`); } else { S.muted.add(arg); toast(`${name} is muted for you only`); }
    applyMuting(); renderSheet();
  },
  sfx: () => { S.sfx = !S.sfx; store.set('ak-sfx', S.sfx ? 'on' : 'off'); if (!S.sfx) musicBed(false); },
  qr: () => {
    const c = S.table?.code; if (!c) return;
    closeSheet();
    modal(`<h3>Scan to join</h3><img class="qr" src="/qr/${c}.svg" alt="QR code to join table ${c}" width="220" height="220"><p class="bigcode">${c}</p>
      <div class="row"><button class="btn btn-primary" data-act="close">Done</button></div>`);
  },
  'invite-name': () => { openSheet('singers'); setTimeout(() => $('#inv-q')?.focus(), 50); },
  'say-title': () => {
    const r = new SpeechRec();
    r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => {
      const said = e.results[0][0].transcript.trim().replace(/\b\w/g, c => c.toUpperCase());
      const i = $('#in-song'); if (i) { i.value = said; i.dispatchEvent(new Event('input')); }
    };
    r.onerror = () => toast("Couldn't hear the song name. Try again or type it.");
    try { r.start(); toast('Say the song name…'); } catch { /* already listening */ }
  },
  'ai-voice': () => {
    S.aiVoice = !S.aiVoice;
    store.set('ak-aivoice', S.aiVoice ? 'on' : 'off');
    if (!S.aiVoice) { S.singId++; window.speechSynthesis?.cancel(); }
  },
  'share-result': () => {
    const v = S.table; if (!v) return;
    const winner = v.winnerToken === S.token ? 'I won' : `${v.members.find(m => m.token === v.winnerToken)?.name || 'Someone'} won`;
    shareResult(v, `${winner} a round of Antakshari on Mehfil! 🎤 ${v.trail.filter(t => t.song).length} songs sung. Play with me:`, `${location.origin}/?t=${v.code}`);
  },
  profile: arg => openProfile(arg),
  'profile-me': () => openProfile(S.token),
  'edit-profile': () => openEditProfile(),
  'copy-profile': () => copy(`${location.origin}/?u=${S.me.handle}`, 'Profile link copied'),
  'save-profile': () => saveProfile(),
  'delete-profile': () => modal(`<h3>Delete your profile?</h3><p>Your name, username, photos and stats are removed from Mehfil. This can't be undone.</p><div class="row"><button class="btn btn-primary" data-act="close">Keep it</button><button class="btn btn-line" data-act="delete-yes">Delete</button></div>`),
  'delete-yes': () => { send('profile:delete'); },
  close: () => closeModal(),
  seed: arg => { if (S.form) { S.form.draft.defaultSeed = arg; renderProfileForm(S.form.sel, { mode: S.form.mode, draft: S.form.draft }); } },
  'no-photo': () => { if (S.form) { S.form.draft.photo = null; S.form.draft.photoChanged = true; renderProfileForm(S.form.sel, { mode: S.form.mode, draft: S.form.draft }); } },
  'rm-post': arg => { if (S.form) { S.form.draft.posts.splice(Number(arg), 1); S.form.draft.postsChanged = true; renderProfileForm(S.form.sel, { mode: S.form.mode, draft: S.form.draft }); } },
  lightbox: arg => modal(`<div class="lightbox"><img src="${esc(arg)}" alt=""></div>`),
  follow: arg => send('follow', { token: arg }),
  block: arg => { send('block', { token: arg }); closeModal(); },
  report: arg => modal(`<h3>Report this singer</h3><p>What's wrong?</p><div class="chips">${['Rude or abusive', 'Inappropriate photo', 'Spam or fake', 'Other'].map(r => `<button class="chip" data-act="report-send" data-arg="${esc(arg)}|${r}">${r}</button>`).join('')}</div><div class="row"><button class="btn btn-text" data-act="close">Cancel</button></div>`),
  'report-send': arg => { const [tok, reason] = arg.split('|'); send('report', { token: tok, reason }); closeModal(); },
  privacy: () => modal(`<h3>Privacy</h3><p>Mehfil stores your name, username, city, bio, photos, singing stats and reports. Others can see your name, username, city, bio, photos and stats. Use "Delete my profile" on your profile to remove them.</p><div class="row"><button class="btn btn-primary" data-act="close">OK</button></div>`),
  'invite-yes': arg => { send('invite:respond', { fromToken: arg, accept: true }); S.invites.shift(); closeModal(); if (S.invites.length) renderInvite(); },
  'invite-no': arg => { send('invite:respond', { fromToken: arg, accept: false }); S.invites.shift(); closeModal(); if (S.invites.length) renderInvite(); },
  leave: () => {
    // Leaving in the middle of a game loses your seat, so ask first.
    const v = S.table, me = v && myMember(v);
    if (v?.type === 'game' && v.state === 'playing' && me?.role === 'singer' && me.lives > 0) {
      closeSheet();
      return modal(`<h3>Leave the game?</h3><p>You'll lose your seat in this round.</p>
        <div class="row"><button class="btn btn-primary" data-act="close">Keep singing</button><button class="btn btn-line" data-act="leave-yes">Leave</button></div>`);
    }
    ACT['leave-yes']();
  },
  'leave-yes': () => { closeModal(); send('table:leave'); leaveLocal(); },
  start: () => send('table:start'),
  set: arg => {
    const [k, raw] = arg.split('=');
    const val = ['theme', 'lang', 'voice', 'botLevel'].includes(k) ? raw : Number(raw);
    send('table:settings', { settings: { [k]: val } });
  },
  'toggle-teams': () => send('table:settings', { settings: { teams: !S.table.settings.teams } }),
  kick: arg => { if (confirm('Remove this singer from the table?')) send('table:kick', { token: arg }); },
  'song-done': () => {
    const song = $('#in-song')?.value || '';
    send('turn:done', { song, lastWord: S.pickedLetter || song.trim().split(/\s+/).pop() || '' });
    S.draft = {}; S.pickedLetter = null;
    store.set('ak-tut', 'seen');
  },
  pass: () => send('turn:pass'),
  hint: () => send('turn:hint'),
  vote: arg => send('vote', { vote: arg }),
  quick: arg => send('chat', { text: arg }),
  react: arg => { send('react', { emoji: arg }); const t = $('#react-tray'); if (t) t.hidden = true; },
  'react-tray': () => toggleTray(),
  'mic-dock': () => { const v = S.table; if (v && callModeOf(v)) ACT.mic(); else toast("In turns mode only the singer's mic is on"); },
  sheet: arg => openSheet(arg),
  'sheet-close': () => closeSheet(),
  mic: () => { S.micOn = !S.micOn; ensureMic().then(applyMic); renderAction(); renderDock(); },
  'mic-retry': () => { retryMic().then(() => { applyMic(); renderTable(); }); },
  hear: () => { S.audioBlocked = false; S.peers.forEach(p => p.audio.play().catch(() => {})); renderTable(); },
  stage: () => send('stage:take'),
  'queue-next': () => send('queue:next'),
  'mic-test': () => micTest(),
  music: () => {
    if (S.amb) stopAmbience(); else startAmbience();
    store.set('ak-music', S.amb ? 'on' : 'off');
    if (S.table) renderTable();
  },
  'share-wa': () => {
    const v = S.table; if (!v) return;
    const link = `${location.origin}/?t=${v.code}`;
    shareLink(v.type === 'jam' ? `Come sing with me on Mehfil! 🎶 Table ${v.code}. Tap to join:` : `Let's play Antakshari on Mehfil! 🎤 Table ${v.code}. Tap to join:`, link);
  },
  copy: () => { if (S.table) copy(`${location.origin}/?t=${S.table.code}`, 'Table link copied'); },
};
// Phones with a share sheet get it (WhatsApp, Instagram, SMS…); others go straight to WhatsApp.
const inviteLabel = () => (navigator.share ? 'Invite friends' : 'Invite on WhatsApp');
// A picture of the result (1080x1350, the size Instagram and WhatsApp status use), drawn in the browser.
function loadImg(src) { return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }); }
async function resultCard(v) {
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(200, 100, 50, 540, 600, 1100);
  bg.addColorStop(0, '#4a1466'); bg.addColorStop(.55, '#1e0b33'); bg.addColorStop(1, '#12061f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const gold = g.createLinearGradient(0, 0, W, 0);
  gold.addColorStop(0, '#ffc145'); gold.addColorStop(.6, '#ff8a1f'); gold.addColorStop(1, '#ff4f9a');
  // header: logo and name
  const logo = await loadImg('/icon-192.png');
  if (logo) g.drawImage(logo, 80, 70, 110, 110);
  g.fillStyle = gold; g.font = '64px "Yatra One", serif'; g.textBaseline = 'middle';
  g.fillText('मेहफ़िल', 215, 128);
  // winner
  const winner = v.winnerTeam ? (v.winnerTeam === 'tie' ? 'A tie!' : `Team ${v.winnerTeam} wins!`) : `${v.members.find(m => m.token === v.winnerToken)?.name || 'Someone'} wins!`;
  g.textAlign = 'center';
  g.font = '150px serif'; g.fillText('🏆', W / 2, 330);
  g.fillStyle = '#fff6e9'; g.font = '700 74px Poppins, sans-serif';
  g.fillText(winner.length > 22 ? winner.slice(0, 21) + '…' : winner, W / 2, 470);
  const songs = v.trail.filter(t => t.song);
  g.fillStyle = '#c3b2d6'; g.font = '500 40px Poppins, sans-serif';
  g.fillText(`${songs.length} song${songs.length === 1 ? '' : 's'} sung · Antakshari`, W / 2, 545);
  // scores
  const ranked = [...v.members].sort((a, b) => b.score - a.score).slice(0, 4);
  g.textAlign = 'left';
  ranked.forEach((m, i) => {
    const y = 640 + i * 96;
    g.fillStyle = i === 0 ? 'rgba(255,193,69,.16)' : 'rgba(0,0,0,.28)';
    g.beginPath(); g.roundRect(140, y - 40, 800, 80, 22); g.fill();
    g.fillStyle = i === 0 ? '#ffc145' : '#fff6e9'; g.font = '600 40px Poppins, sans-serif';
    g.fillText(`${i === 0 ? '👑' : i + 1 + '.'}  ${m.name}${m.bot ? '  (AI)' : ''}`, 175, y + 2);
    g.textAlign = 'right'; g.fillText(String(m.score), 905, y + 2); g.textAlign = 'left';
  });
  // a few songs
  g.textAlign = 'center'; g.fillStyle = '#c3b2d6'; g.font = '400 34px Poppins, sans-serif';
  const songsTop = 640 + ranked.length * 96 + 50;
  songs.slice(-3).forEach((t, i) => g.fillText(`🎵 ${t.song}`, W / 2, songsTop + i * 52));
  // footer
  g.fillStyle = gold; g.font = '600 38px Poppins, sans-serif';
  g.fillText('Play with me on Mehfil', W / 2, 1255);
  g.fillStyle = '#c3b2d6'; g.font = '400 30px Poppins, sans-serif';
  g.fillText(location.host, W / 2, 1300);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
}
async function shareResult(v, text, url) {
  try {
    const blob = await resultCard(v);
    const file = blob && new File([blob], 'mehfil-result.jpg', { type: 'image/jpeg' });
    if (file && navigator.canShare?.({ files: [file] })) return await navigator.share({ files: [file], text: text + ' ' + url, title: 'Mehfil' });
    if (blob) { // no picture sharing here: save the picture, and share the link as usual
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'mehfil-result.jpg'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Result picture saved 📸');
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // the person closed the share sheet: do nothing more
    /* picture sharing not supported here: fall back to the link */
  }
  return shareLink(text, url);
}
function shareLink(text, url) {
  if (navigator.share) return navigator.share({ title: 'Mehfil', text, url }).catch(() => {});
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener');
}
function copy(text, ok) {
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(ok), () => prompt('Copy this link:', text));
  else prompt('Copy this link:', text);
}
function saveProfile() {
  const f = S.form; if (!f) return;
  const d = f.draft;
  const payload = { name: (d.name || '').trim(), handle: d.handle, city: d.city, bio: d.bio, defaultSeed: d.defaultSeed };
  if (!payload.name) { toast('Type your name first'); $(f.sel + ' [data-f=name]')?.focus(); return; }
  if (d.photoChanged) payload.photo = d.photo;
  if (d.postsChanged) payload.posts = d.posts;
  if (!S.ready) { const b = $(f.sel + ' [data-act=save-profile]'); if (b) b.textContent = 'Connecting…'; }
  send('profile:update', payload);
}
function micTest() {
  S.micTesting = true;
  ensureMic().then(s => {
    if (!s) return toast('Mic is blocked');
    applyMic();
    modal(`<h3>Mic check 🎙</h3><p>Say a line of your favourite song.</p>
      <div class="meter"><i id="lvl"></i></div><p id="mt-msg" class="muted">Listening…</p>
      <div class="row"><button class="btn btn-primary" data-act="close">Done</button></div>`);
    const an = analyserFor(S.token);
    const loop = () => {
      if (!$('#lvl') || !an) return;
      an.getByteFrequencyData(an._buf);
      const lvl = Math.max(...an._buf) / 255;
      $('#lvl').style.width = Math.min(100, lvl * 220) + '%';
      if (lvl > .08) $('#mt-msg').textContent = 'We can hear you ✓ (use headphones to avoid echo)';
      requestAnimationFrame(loop);
    };
    loop();
  });
}

document.addEventListener('click', e => {
  if (e.target.matches('[data-sheet-scrim]')) { closeSheet(); return; }
  const scrim = e.target.matches('[data-scrim]') ? e.target : null;
  if (scrim) { if (S.modalDismiss) closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.tagName === 'A') e.preventDefault();
  const fn = ACT[el.dataset.act];
  if (fn) fn(el.dataset.arg, el, e);
});
document.addEventListener('submit', e => {
  const form = e.target.dataset.form;
  if (!form) return;
  e.preventDefault();
  if (form === 'join-code') joinCode($('#code-in').value);
  if (form === 'chat') {
    const text = $('#chat-in').value.trim();
    if (text) send('chat', { text });
    $('#chat-in').value = '';
  }
  if (form === 'queue') {
    const title = $('#q-in').value.trim();
    if (title) send('queue:add', { title });
    $('#q-in').value = '';
  }
});


/* ---------- ambient loop, music preference and boot ---------- */
// Each person's seat glows teal with their voice, so you can see who is talking.
function seatLevels() {
  if (!S.table) return;
  $$('#t-stage .seat[data-tok]').forEach(el => {
    const an = analyserFor(el.dataset.tok);
    if (!an) return;
    an.getByteFrequencyData(an._buf);
    let peak = 0;
    for (let i = 1; i < an._buf.length; i++) if (an._buf[i] > peak) peak = an._buf[i];
    el.style.setProperty('--lvl', Math.min(1, peak / 200).toFixed(2));
  });
}
(function tick() { tickOnce(); seatLevels(); requestAnimationFrame(tick); })();
// 55. No internet: say so plainly; Socket.IO reconnects by itself when the connection is back.
window.addEventListener('offline', () => { $('#netbar').textContent = "You're offline. Mehfil will reconnect when you're back."; $('#netbar').hidden = false; });
window.addEventListener('online', () => { $('#netbar').textContent = 'Reconnecting…'; if (socket.connected) $('#netbar').hidden = true; });
(() => {
  const L = $('.lights');
  if (L) L.innerHTML = '<i style="background:var(--gold);box-shadow:0 0 12px var(--gold)"></i><i style="background:var(--pink);box-shadow:0 0 12px var(--pink)"></i><i style="background:var(--teal);box-shadow:0 0 12px var(--teal)"></i><i style="background:var(--saffron);box-shadow:0 0 12px var(--saffron)"></i>'.repeat(Math.max(3, Math.floor(innerWidth / 60)));
})();
S.iceReady = fetch('/config').then(r => r.json()).then(c => { S.ice = c.iceServers; }).catch(() => {});
// Keyboard: Enter or Space on a role="button" element (like the table code) acts like a tap.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-act]')) { e.preventDefault(); e.target.click(); }
});
if (firstVisit || !cached) showJoin();
else { S.me = cached.me; S.named = true; S.lobby = { people: cached.ai || [], tables: [] }; renderMe(); showLobby(); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
