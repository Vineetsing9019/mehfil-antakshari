/* Mehfil: browser app. Talks to server.js over Socket.IO; voices are WebRTC with the table. */
(() => {
'use strict';

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEFAULT_SEEDS = ['Mehfil', 'Sargam', 'Taal', 'Raag', 'Dhun', 'Geet', 'Sur', 'Lehar', 'Jhankaar', 'Tarana', 'Ghazal', 'Qawwali'];
// Classic default avatar: the person's initials on a soft background (no cartoon faces).
const dice = seed => `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,ffd5dc,ffdfbf,d1d4f9&fontWeight=600`;
const THEMES = [['classic', 'Classic'], ['rapid', 'Rapid Fire'], ['dhun', 'Dhun round'], ['decade', 'Decade 90s'], ['actor', 'Actor round']];
const TURNS = [20, 30, 60, 90];
const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']];
const REACTIONS = ['👏', '🔥', '🎶', '😂', '❤️', '🙌', '🥹', '🤩'];
const MAX_POSTS = 9;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const S = {
  token: null, me: null, named: false, ice: [{ urls: 'stun:stun.l.google.com:19302' }],
  lobby: { people: [], tables: [] }, board: [], sent: new Set(), invites: [],
  table: null, lastTurnKey: '', offset: 0, hints: null, draft: {}, overShown: '',
  peers: new Map(), local: null, micPromise: null, micDenied: false, micOn: false,
  actx: null, amb: null, analysers: new Map(), form: null, modalDismiss: true,
  pendingCode: null, pendingHandle: null, sheet: null, unread: 0,
};

const params = new URLSearchParams(location.search);
S.pendingCode = (params.get('t') || '').toUpperCase() || null;
S.pendingHandle = params.get('u') || null;

function makeToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
S.token = store.get('ak-token');
if (!S.token) { S.token = makeToken(); store.set('ak-token', S.token); }

/* ---------- audio ---------- */
function audioCtx() {
  if (!S.actx) S.actx = new (window.AudioContext || window.webkitAudioContext)();
  if (S.actx.state === 'suspended') S.actx.resume();
  return S.actx;
}
function chime(freqs) {
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
  ['join', 'lobby', 'table'].forEach(s => { $('#screen-' + s).hidden = s !== id; });
  $('#mechip').hidden = !S.named;
  window.scrollTo(0, 0);
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
const socket = io({ transports: ['websocket', 'polling'] });
socket.on('connect', () => socket.emit('hello', { token: S.token }));
socket.on('disconnect', () => toast('Connection lost. Reconnecting…'));
socket.on('me', m => {
  S.me = m.profile; S.named = m.named;
  renderMe();
  if (!S.named) { showJoin(); return; }
  if (!S.table) showLobby();
  if (S.pendingCode) { socket.emit('table:join', { code: S.pendingCode }); S.pendingCode = null; history.replaceState({}, '', '/'); }
  if (S.pendingHandle) { const h = S.pendingHandle; S.pendingHandle = null; history.replaceState({}, '', '/'); openProfileByHandle(h); }
});
socket.on('profile:saved', m => {
  S.me = m.profile; S.named = true; renderMe(); closeModal();
  toast('Profile saved ✓');
  if (!S.table) showLobby();
  if (S.pendingCode) { socket.emit('table:join', { code: S.pendingCode }); S.pendingCode = null; history.replaceState({}, '', '/'); }
});
socket.on('profile:deleted', () => {
  S.named = false; S.me = null; S.table = null; renderMe(); closeModal();
  toast('Your profile was deleted');
  showJoin();
});
socket.on('lobby', d => { S.lobby = d; if (!S.table) renderLobby(); });
socket.on('table', v => {
  if (!v) { leaveLocal(); return; }
  S.table = v;
  S.offset = v.now - Date.now();
  // Call-style tables (Sing together, or "Everyone talks") start with the mic on.
  const callMode = v.type === 'jam' || v.settings.voice === 'call';
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
function showJoin() {
  show('join');
  renderProfileForm('#form-join', { mode: 'create' });
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
  stopAmbience();
  if (S.local) { S.local.getTracks().forEach(t => t.stop()); S.local = null; S.micPromise = null; }
  closeModal();
  if (S.named) showLobby(); else showJoin();
}
function loadBoard() {
  fetch('/leaderboard').then(r => r.json()).then(j => { S.board = j.rows; renderBoard(); }).catch(() => {});
}
setInterval(() => { if (!S.table && S.named) loadBoard(); }, 60000);

/* ---------- lobby ---------- */
function statusText(p) {
  if (p.status === 'playing') return 'Singing in a game';
  if (p.status === 'jam') return 'In a jam';
  if (p.status === 'room') return 'At a table';
  return 'Free to sing';
}
function renderLobby() {
  if (S.table) return;
  const q = ($('#search')?.value || '').trim().toLowerCase();
  const list = S.lobby.people.filter(p => (p.name + ' ' + p.handle).toLowerCase().includes(q));
  $('#lobby-tables').innerHTML = S.lobby.tables.length
    ? S.lobby.tables.map(t => `<div class="tcard"><div><b>${t.type === 'jam' ? '🎶 Jam table' : '🎤 Game table'}</b><small>Host: ${esc(t.host)} · ${t.count}/${t.max}${t.theme ? ' · ' + esc(t.theme) : ''}${t.state === 'playing' ? ' · in a game (join as listener)' : ''}</small></div><button class="btn btn-primary btn-sm" data-act="join-tap" data-arg="${esc(t.code)}">Join</button></div>`).join('')
    : '<div class="empty">No open tables yet. Start one and share the link!</div>';
  $('#online-count').textContent = S.lobby.people.length ? `· ${S.lobby.people.length}` : '';
  $('#stories').innerHTML = S.lobby.people.filter(p => p.status === 'free').slice(0, 20).map(p =>
    `<button class="story" data-act="profile" data-arg="${esc(p.token)}" aria-label="${esc(p.name)}"><span class="ringed">${av(p)}</span><small>${esc(p.handle)}</small></button>`).join('');
  $('#people').innerHTML = list.length
    ? list.map(p => `<div class="icard">${av(p)}<div class="who"><div class="nm">${esc(p.name)}${p.verified ? '<span class="tick">✓</span>' : ''}</div><div class="hd">@${esc(p.handle)}${p.city ? ' · ' + esc(p.city) : ''}</div><div class="st ${p.status === 'free' ? '' : 'busy'}">${statusText(p)}</div></div>
        <div class="col">${p.status === 'free' && !S.sent.has(p.token)
          ? `<button class="btn btn-primary btn-sm" data-act="req" data-arg="${esc(p.token)}">Request</button>`
          : `<button class="btn btn-line btn-sm" data-act="profile" data-arg="${esc(p.token)}" ${p.status !== 'free' ? '' : 'disabled'}>${S.sent.has(p.token) ? 'Requested' : 'Busy'}</button>`}</div></div>`).join('')
    : `<div class="empty">${S.lobby.people.length ? 'No singer matches your search' : 'No one else is online yet. Share your table link with friends, or wait: singers appear here as they join.'}</div>`;
  renderBoard();
}
function renderBoard() {
  $('#board').innerHTML = S.board.length
    ? S.board.map((r, i) => `<li><span>${i + 1}.</span><b>${esc(r.name)}</b><span class="muted">@${esc(r.handle)}</span><b>${r.points}</b></li>`).join('')
    : '<li class="muted">Sing a song this week to get on the board!</li>';
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
  box.innerHTML = `
    <div class="photopick">
      <span class="ringed">${`<span class="av"><img src="${esc(preview)}" alt=""></span>`}</span>
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
  modal(`<div class="av" style="width:96px;height:96px;margin:0 auto 10px">${`<img src="${esc(p.photo || dice(p.defaultSeed || 'Mehfil'))}" alt="" style="width:100%;height:100%;object-fit:cover">`}</div>
    <h3>${esc(p.name)}${p.verified ? '<span class="tick">✓</span>' : ''}</h3>
    <p class="muted">@${esc(p.handle)}${p.city ? ' · 📍 ' + esc(p.city) : ''}</p>
    ${p.bio ? `<p>${esc(p.bio)}</p>` : ''}
    <div class="pstats"><div><b>${p.sung ?? 0}</b><span>songs</span></div><div><b>${p.wins ?? 0}</b><span>wins</span></div><div><b>${p.followers ?? 0}</b><span>followers</span></div></div>
    ${p.badges?.length ? `<div class="badges">${p.badges.map(b => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    ${p.posts?.length ? `<div class="pgrid">${p.posts.map(u => `<div class="tile"><img src="${esc(u)}" alt="Photo" data-act="lightbox" data-arg="${esc(u)}"></div>`).join('')}</div>` : `<p class="muted">${isMe ? 'Add photos so friends can see you 📸' : 'No photos yet'}</p>`}
    <div class="row">
      ${isMe ? `<button class="btn btn-primary" data-act="edit-profile">Edit profile</button><button class="btn btn-line" data-act="copy-profile">Copy my link</button>`
        : `${!busy && !S.sent.has(token) && !S.table ? `<button class="btn btn-primary" data-act="req" data-arg="${esc(token)}">Request to sing</button>` : ''}
           <button class="btn btn-line" data-act="follow" data-arg="${esc(token)}">${followed ? 'Following ✓' : 'Follow'}</button>`}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn btn-text btn-sm" data-act="close">Close</button>
      ${isMe ? '' : `<button class="btn btn-text btn-sm" data-act="block" data-arg="${esc(token)}">Block</button><button class="btn btn-text btn-sm" data-act="report" data-arg="${esc(token)}">Report</button>`}
    </div>`);
}

/* ---------- table ---------- */
const callModeOf = v => v.type === 'jam' || v.settings.voice === 'call';
const turnName = v => v.members.find(m => m.token === v.turn)?.name || '';
const myMember = v => v.members.find(m => m.token === S.token);

function renderTable() {
  const v = S.table;
  if (!v) return;
  $('#t-type').textContent = v.type === 'jam' ? '🎶 Sing together' : '🎤 Antakshari';
  $('#t-code').textContent = v.code;
  $('#t-tap').hidden = !S.audioBlocked;
  const st = $('#t-start');
  st.hidden = !(v.isHost && v.type === 'game' && v.state !== 'playing');
  st.disabled = v.members.length < 2;
  st.textContent = v.state === 'over' ? 'Play again' : 'Start game';
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
    if (v.turn === S.token) { chime([523, 659, 784]); navigator.vibrate?.(200); }
    if (v.botSong && v.members.find(m => m.token === v.turn)?.bot) hum(v.botSong);
  }
  if (S.amb) S.amb.master.gain.value = v.turn ? .15 : .5;
  applyMic();
  applyMuting();
  updateVoiceStatus();
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
    return `<div class="seat ${isTurn ? 'turn' : ''} ${out ? 'out' : ''}" style="left:${x}%;top:${y}%" title="${esc(m.name)}">
      <div class="seatav">${av(m)}${m.isHost ? '<span class="crown">👑</span>' : ''}${isTurn || onStage ? '<span class="micb">🎤</span>' : ''}</div>
      <div class="nm">${esc(m.name)}${m.role === 'listener' ? ' · listening' : ''}</div>${hearts}
      ${v.type === 'game' ? `<div class="meta">${m.score} pts${teams && m.team ? ' · ' + m.team : ''}</div>` : ''}</div>`;
  }).join('');
  const verify = v.verifying ? `<div class="verify">
      <p>Did <b>${esc(v.members.find(m => m.token === v.verifying.singer)?.name || 'the singer')}</b> sing <b>“${esc(v.verifying.song)}”</b>? Next letter: <b>${esc(v.verifying.next)}</b></p>
      ${v.verifying.canVote && !v.verifying.myVote ? `<div class="row"><button class="btn btn-line btn-sm" data-act="vote" data-arg="up">👍 Yes</button><button class="btn btn-line btn-sm" data-act="vote" data-arg="down">👎 No</button></div>` : `<p class="muted">${v.verifying.canVote ? 'Thanks, your vote is in' : 'Waiting for the table to vote…'}</p>`}
      <div class="counts">👍 ${v.verifying.up} · 👎 ${v.verifying.down}</div></div>` : '';
  let center;
  if (v.type === 'jam') {
    center = `<div><div class="letterlabel">Sing together</div><div class="letter" style="font-size:44px">🎶</div>
      <div class="secs">${v.stage ? `On stage: ${esc(v.members.find(m => m.token === v.stage)?.name || '')}` : 'Take the stage to lead a song'}</div></div>`;
  } else if (v.state === 'playing') {
    center = `<div><div class="letterlabel">Start with</div>
      <div class="letter">${esc(v.letter)}</div><div class="secs">${esc(v.deva || '')}</div>
      <div class="secs" id="secs"></div>
      <div class="eq" id="eq">${'<i></i>'.repeat(16)}</div>
      <div class="secs">${v.turn === S.token ? 'You are singing' : esc(turnName(v)) + ' is singing'}${v.botSong ? ` · 🎵 “${esc(v.botSong)}”` : ''}</div>
      <div class="clapbar"><i style="width:${Math.min(100, v.claps * 12)}%"></i></div></div>`;
  } else {
    const winner = v.winnerTeam ? (v.winnerTeam === 'tie' ? 'A tie!' : `Team ${v.winnerTeam} wins`) : `${v.members.find(m => m.token === v.winnerToken)?.name || 'Someone'} wins`;
    center = `<div class="waitmsg"><div class="letterlabel">${v.state === 'over' ? 'Game over' : 'Waiting room'}</div>
      <div class="secs" style="font-size:15px;color:var(--text)">${v.state === 'over' ? `🏆 ${esc(winner)}` : `${v.members.length} in · ${v.members.length < 2 ? 'waiting for more' : 'ready'}`}</div></div>`;
  }
  const teamLine = teams && v.teamTotals ? `<div class="teams"><span>Team A <b>${v.teamTotals.A}</b></span><span>Team B <b>${v.teamTotals.B}</b></span></div>` : '';
  const crowd = v.crowdFav ? `<div class="secs" style="text-align:center;margin-top:6px">🎉 Crowd favourite: ${esc(v.members.find(m => m.token === v.crowdFav)?.name || '')}</div>` : '';
  const ring = v.state === 'playing' && v.type === 'game' ? `<svg class="ring" id="ring" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="ringgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc145"/><stop offset="1" stop-color="#ff4f9a"/></linearGradient></defs><circle class="track" cx="50" cy="50" r="47"/><circle class="prog" id="ring-prog" cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/></svg>` : '';
  $('#t-stage').innerHTML = `<div class="stage" id="stage"><div class="rug"></div>${ring}<div class="center">${center}</div>${seats}${verify}</div>${teamLine}${crowd}`;
  if (v.state === 'playing' && v.type === 'game') tickOnce();
}

function tickOnce() {
  const v = S.table;
  if (!v || !v.turnEndsAt) return;
  const left = Math.max(0, v.turnEndsAt - (Date.now() + S.offset));
  const p = $('#ring-prog'); if (p) p.style.strokeDashoffset = String(100 - 100 * left / v.turnMs);
  $('#ring')?.classList.toggle('low', left < 10000);
  const s = $('#secs'); if (s) s.textContent = Math.ceil(left / 1000) + 's left';
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
  const keep = { song: $('#in-song')?.value ?? S.draft.song ?? '', last: $('#in-last')?.value ?? S.draft.last ?? '' };
  box.classList.remove('yourturn');
  if (v.type === 'jam') {
    const onStage = v.stage && v.members.find(m => m.token === v.stage);
    box.innerHTML = `<div class="act-title">${onStage ? `🎤 On stage: <b>${esc(onStage.name)}</b>` : 'Nobody is on stage yet'}</div>
      ${v.nowPlaying ? `<div class="nowplay">♪ Now singing: <b>${esc(v.nowPlaying.title)}</b> <span class="muted">by ${esc(v.nowPlaying.name)}</span></div>` : ''}
      <form class="queue-row" data-form="queue"><input id="q-in" maxlength="80" placeholder="Add a song to the queue" autocomplete="off" aria-label="Song title"><button class="btn btn-line btn-sm" type="submit">Add</button></form>
      <div class="queue">${v.queue.length ? v.queue.map(q => `<div class="q"><span>${esc(q.title)}</span><small>${esc(q.name)}</small></div>`).join('') : '<div class="muted">The queue is empty</div>'}</div>
      <div class="row"><button class="btn btn-primary btn-sm" data-act="stage">${v.stage === S.token ? 'Step down' : '🎤 Take the stage'}</button><button class="btn btn-line btn-sm" data-act="queue-next">Next song ▶</button></div>`;
    return;
  }
  if (v.state === 'playing') {
    if (v.turn === S.token && !v.verifying) {
      box.classList.add('yourturn');
      const hint = S.hints && S.hints.letter === v.letter ? `<div class="hints">${S.hints.titles.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : '';
      box.innerHTML = `<div class="act-title">Your turn 🎤</div>
        <p class="lead">Start with <span class="chipletter">${esc(v.letter)}</span> ${esc(v.deva || '')}. ${esc(v.themeRule || '')}</p>
        <input class="song-in" id="in-song" maxlength="80" placeholder="Song title starting with ${esc(v.letter)}" autocomplete="off" value="${esc(keep.song)}">
        <input class="song-in" id="in-last" maxlength="30" placeholder="Last word you sang, e.g. pyaar" autocomplete="off" value="${esc(keep.last)}" style="margin-top:8px">
        <div class="hint" id="next-hint">The last word's sound sets the next letter.</div>
        ${hint}
        <div class="row">
          <button class="btn btn-primary" data-act="song-done">Done ✓</button>
          <button class="btn btn-line btn-sm" data-act="hint">💡 Hint −5</button>
          <button class="btn btn-line btn-sm" data-act="pass">Pass −1 ❤</button>
        </div>`;
      const check = () => {
        const s = ($('#in-song')?.value || '').trim(), f = (s.match(/[a-z]/i) || [''])[0].toUpperCase();
        S.draft = { song: $('#in-song')?.value || '', last: $('#in-last')?.value || '' };
        const hintEl = $('#next-hint');
        if (!hintEl) return;
        const lastVal = $('#in-last')?.value || '';
        const l = (lastVal.match(/[a-z](?=[^a-z]*$)/i) || [''])[0];
        hintEl.className = 'hint' + (s && f !== v.letter ? ' warn' : '');
        hintEl.innerHTML = s && f !== v.letter ? `Has to start with <b>${esc(v.letter)}</b>` : l ? `Next singer gets <b>${esc(nextLetterClient(lastVal))}</b>` : "The last word's sound sets the next letter.";
      };
      $('#in-song').oninput = check; $('#in-last').oninput = check; check();
      $('#in-last').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act=song-done]')?.click(); } };
      if (!keep.song) $('#in-song').focus();
      return;
    }
    if (v.verifying) {
      box.innerHTML = `<div class="act-title">${v.verifying.singer === S.token ? 'The table is voting on your song…' : 'Vote on the song above'}</div>`;
      return;
    }
    const listener = myMember(v)?.role === 'listener';
    box.innerHTML = `<div class="act-title">${esc(turnName(v))} is singing</div>
      <p class="lead">${listener ? 'You are listening. You can sing in the next round.' : 'Listen, react, and think of a song for the letter they end on.'}</p>`;
    return;
  }
  if (v.state === 'over') {
    box.innerHTML = `<div class="act-title">Game over</div><p class="lead">${v.isHost ? 'Press Play again at the top to start another round.' : 'Waiting for the host to start another round.'}</p>`;
    return;
  }
  box.innerHTML = `<div class="act-title">Waiting for singers</div>
    <p class="lead">${v.isHost ? 'Share the link with friends. When everyone is in, press Start game at the top.' : 'Waiting for the host to start. Say hello in chat!'}</p>`;
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
        ${m.token !== S.token && !m.bot ? `<button class="ico" data-act="follow" data-arg="${esc(m.token)}" aria-label="${m.followed ? 'Unfollow' : 'Follow'} ${esc(m.name)}">${m.followed ? '★' : '☆'}</button>` : ''}
        ${v.isHost && m.token !== S.token ? `<button class="ico" data-act="kick" data-arg="${esc(m.token)}" aria-label="Remove ${esc(m.name)}">✕</button>` : ''}
        ${m.token !== S.token && !m.bot ? `<button class="ico" data-act="profile" data-arg="${esc(m.token)}" aria-label="Open profile">👤</button>` : ''}
      </div></div>`;
  }).join('');
}

function settingsHtml(v) {
  if (v.type === 'jam') return '<p class="muted">Sing together has no game settings. Everyone talks, and the queue is on the main screen.</p>';
  const s = v.settings;
  if (!v.isHost || v.state === 'playing') {
    return `<p class="muted">Game: ${esc(v.themeLabel)} · ${s.turnSec}s a turn · ${s.lives} ❤ · ${s.voice === 'call' ? 'everyone talks' : 'take turns'}${s.teams ? ' · teams' : ''}</p>
      <p class="muted">Only the host can change these before a game.</p>`;
  }
  return `<span class="lbl">Theme</span><div class="chips">${THEMES.map(([k, l]) => `<button class="chip ${s.theme === k ? 'on' : ''}" data-act="set" data-arg="theme=${k}">${l}</button>`).join('')}</div>
    <span class="lbl">Time per turn</span><div class="chips">${TURNS.map(t => `<button class="chip ${s.turnSec === t ? 'on' : ''}" data-act="set" data-arg="turnSec=${t}">${t}s</button>`).join('')}</div>
    <span class="lbl">Lives</span><div class="chips">${[1, 2, 3, 4, 5].map(n => `<button class="chip ${s.lives === n ? 'on' : ''}" data-act="set" data-arg="lives=${n}">${n} ❤</button>`).join('')}</div>
    <span class="lbl">Voice</span><div class="chips"><button class="chip ${s.voice !== 'call' ? 'on' : ''}" data-act="set" data-arg="voice=turns">Take turns</button><button class="chip ${s.voice === 'call' ? 'on' : ''}" data-act="set" data-arg="voice=call">Everyone talks</button></div>
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
    body.innerHTML = `<div class="sechead"><span class="muted" id="voice-status"></span></div><div class="members">${membersHtml(v)}</div>`;
    updateVoiceStatus();
    return;
  }
  title.textContent = '⚙ Settings';
  body.innerHTML = `<div class="set-share">
      <button class="btn btn-line btn-sm" data-act="share-wa">Share on WhatsApp</button>
      <button class="btn btn-line btn-sm" data-act="copy">Copy link</button>
      <button class="btn btn-line btn-sm" data-act="mic-test">🎙 Mic check</button>
      <button class="btn btn-line btn-sm" data-act="music">${S.amb ? '🔇 Music off' : '🎵 Music on'}</button>
    </div>
    ${settingsHtml(v)}
    <button class="btn btn-text btn-block" data-act="leave" style="margin-top:14px">Leave table</button>`;
}

function renderChatLog() {
  const v = S.table, box = $('#t-chatlog');
  if (!v || !box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = v.chat.length ? v.chat.map(m => m.from
    ? `<div class="msg"><b>${esc(m.name)}</b>${esc(m.text)}</div>`
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
    <p>${v.trail.filter(t => !t.system).length} songs sung</p>
    ${v.crowdFav ? `<p>🎉 Crowd favourite: <b>${esc(v.members.find(m => m.token === v.crowdFav)?.name || '')}</b></p>` : ''}
    <div class="board">${ranked.map((p, i) => `<div class="${p.token === v.winnerToken ? 'win' : ''}"><span>${i + 1}.</span>${av(p)}<span class="n">${esc(p.name)}${p.team ? ' · ' + p.team : ''}</span><b>${p.score}</b></div>`).join('')}</div>
    <div class="row">${v.isHost ? '<button class="btn btn-primary" data-act="start">Play again</button><button class="btn btn-line" data-act="close">Back to table</button>' : '<button class="btn btn-primary" data-act="close">Back to table</button>'}</div>`);
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
    const callMode = v.type === 'jam' || v.settings.voice === 'call';
    track.enabled = callMode ? S.micOn : (v.state === 'playing' && v.turn === S.token && !v.verifying);
  }
  if (S.micTesting && track) track.enabled = true;
}
function applyMuting() {
  const v = S.table;
  S.peers.forEach((p, tok) => {
    // Take-turns games: only the singer is heard. Call-style tables: everyone is heard.
    p.audio.muted = !!v && v.type === 'game' && v.state === 'playing' && v.settings.voice !== 'call' && v.turn !== tok;
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
  const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const track = S.local?.getAudioTracks()[0];
  if (track) tr.sender.replaceTrack(track).catch(() => {});
  // Higher quality audio for singing: up to 128 kbps (the browser default is much lower).
  try {
    const sp = tr.sender.getParameters();
    sp.encodings = sp.encodings?.length ? sp.encodings : [{}];
    sp.encodings[0].maxBitrate = 128000;
    tr.sender.setParameters(sp).catch(() => {});
  } catch { /* older browsers: keep the default */ }
  const audio = new Audio();
  audio.autoplay = true; audio.playsInline = true;
  document.body.appendChild(audio);
  const p = { pc, tr, audio, stream: null, queue: [] };
  pc.ontrack = e => {
    p.stream = e.streams[0] || new MediaStream([e.track]);
    audio.srcObject = p.stream;
    applyMuting();
    audio.play().catch(() => { S.audioBlocked = true; renderTable(); });
  };
  pc.onicecandidate = e => { if (e.candidate) socket.emit('rtc', { to: tok, data: { candidate: e.candidate } }); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') closePeer(tok);
    updateVoiceStatus();
  };
  S.peers.set(tok, p);
  if (initiator) pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('rtc', { to: tok, data: { sdp: pc.localDescription } })).catch(() => {});
  return p;
}
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
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('rtc', { to: from, data: { sdp: pc.localDescription } });
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
  socket.emit('table:join', { code: c });
}
const ACT = {
  'start-game': () => socket.emit('table:create', { type: 'game' }),
  'start-jam': () => socket.emit('table:create', { type: 'jam' }),
  'join-tap': arg => joinCode(arg),
  req: arg => { socket.emit('invite', { token: arg }); S.sent.add(arg); if (!S.table) renderLobby(); toast('Request sent'); },
  profile: arg => openProfile(arg),
  'profile-me': () => openProfile(S.token),
  'edit-profile': () => openEditProfile(),
  'copy-profile': () => copy(`${location.origin}/?u=${S.me.handle}`, 'Profile link copied'),
  'save-profile': () => saveProfile(),
  'delete-profile': () => modal(`<h3>Delete your profile?</h3><p>Your name, username, photos and stats are removed from Mehfil. This can't be undone.</p><div class="row"><button class="btn btn-primary" data-act="close">Keep it</button><button class="btn btn-line" data-act="delete-yes">Delete</button></div>`),
  'delete-yes': () => { socket.emit('profile:delete'); },
  close: () => closeModal(),
  seed: arg => { if (S.form) { S.form.draft.defaultSeed = arg; renderProfileForm(S.form.sel, { mode: S.form.mode, draft: S.form.draft }); } },
  'no-photo': () => { if (S.form) { S.form.draft.photo = null; S.form.draft.photoChanged = true; renderProfileForm(S.form.sel, { mode: S.form.mode, draft: S.form.draft }); } },
  'rm-post': arg => { if (S.form) { S.form.draft.posts.splice(Number(arg), 1); S.form.draft.postsChanged = true; renderProfileForm(S.form.sel, { mode: S.form.mode, draft: S.form.draft }); } },
  lightbox: arg => modal(`<div class="lightbox"><img src="${esc(arg)}" alt=""></div>`),
  follow: arg => socket.emit('follow', { token: arg }),
  block: arg => { socket.emit('block', { token: arg }); closeModal(); },
  report: arg => modal(`<h3>Report this singer</h3><p>What's wrong?</p><div class="chips">${['Rude or abusive', 'Inappropriate photo', 'Spam or fake', 'Other'].map(r => `<button class="chip" data-act="report-send" data-arg="${esc(arg)}|${r}">${r}</button>`).join('')}</div><div class="row"><button class="btn btn-text" data-act="close">Cancel</button></div>`),
  'report-send': arg => { const [tok, reason] = arg.split('|'); socket.emit('report', { token: tok, reason }); closeModal(); },
  privacy: () => modal(`<h3>Privacy</h3><p>Mehfil stores your name, username, city, bio, photos, singing stats and reports. Others can see your name, username, city, bio, photos and stats. Use "Delete my profile" on your profile to remove them.</p><div class="row"><button class="btn btn-primary" data-act="close">OK</button></div>`),
  'invite-yes': arg => { socket.emit('invite:respond', { fromToken: arg, accept: true }); S.invites.shift(); closeModal(); if (S.invites.length) renderInvite(); },
  'invite-no': arg => { socket.emit('invite:respond', { fromToken: arg, accept: false }); S.invites.shift(); closeModal(); if (S.invites.length) renderInvite(); },
  leave: () => { socket.emit('table:leave'); leaveLocal(); },
  start: () => socket.emit('table:start'),
  set: arg => {
    const [k, raw] = arg.split('=');
    const val = ['theme', 'lang', 'voice'].includes(k) ? raw : Number(raw);
    socket.emit('table:settings', { settings: { [k]: val } });
  },
  'toggle-teams': () => socket.emit('table:settings', { settings: { teams: !S.table.settings.teams } }),
  kick: arg => { if (confirm('Remove this singer from the table?')) socket.emit('table:kick', { token: arg }); },
  'song-done': () => {
    socket.emit('turn:done', { song: $('#in-song')?.value || '', lastWord: $('#in-last')?.value || '' });
    S.draft = {};
  },
  pass: () => socket.emit('turn:pass'),
  hint: () => socket.emit('turn:hint'),
  vote: arg => socket.emit('vote', { vote: arg }),
  quick: arg => socket.emit('chat', { text: arg }),
  react: arg => { socket.emit('react', { emoji: arg }); const t = $('#react-tray'); if (t) t.hidden = true; },
  'react-tray': () => toggleTray(),
  'mic-dock': () => { const v = S.table; if (v && callModeOf(v)) ACT.mic(); else toast("In turns mode only the singer's mic is on"); },
  sheet: arg => openSheet(arg),
  'sheet-close': () => closeSheet(),
  mic: () => { S.micOn = !S.micOn; ensureMic().then(applyMic); renderAction(); renderDock(); },
  'mic-retry': () => { retryMic().then(() => { applyMic(); renderTable(); }); },
  hear: () => { S.audioBlocked = false; S.peers.forEach(p => p.audio.play().catch(() => {})); renderTable(); },
  stage: () => socket.emit('stage:take'),
  'queue-next': () => socket.emit('queue:next'),
  'mic-test': () => micTest(),
  music: () => {
    if (S.amb) stopAmbience(); else startAmbience();
    store.set('ak-music', S.amb ? 'on' : 'off');
    if (S.table) renderTable();
  },
  'share-wa': () => {
    const v = S.table; if (!v) return;
    const link = `${location.origin}/?t=${v.code}`;
    const msg = v.type === 'jam'
      ? `Come sing with me on Mehfil! 🎶 Jam table ${v.code}. Tap to join: ${link}`
      : `Let's play Antakshari on Mehfil! 🎤 Table ${v.code}. Tap to join: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  },
  copy: () => { if (S.table) copy(`${location.origin}/?t=${S.table.code}`, 'Table link copied'); },
};
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
  socket.emit('profile:update', payload);
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
    if (text) socket.emit('chat', { text });
    $('#chat-in').value = '';
  }
  if (form === 'queue') {
    const title = $('#q-in').value.trim();
    if (title) socket.emit('queue:add', { title });
    $('#q-in').value = '';
  }
});
$('#search')?.addEventListener('input', () => renderLobby());

/* ---------- ambient loop, music preference and boot ---------- */
(function tick() { tickOnce(); requestAnimationFrame(tick); })();
(() => {
  const L = $('.lights');
  if (L) L.innerHTML = '<i style="background:var(--gold);box-shadow:0 0 12px var(--gold)"></i><i style="background:var(--pink);box-shadow:0 0 12px var(--pink)"></i><i style="background:var(--teal);box-shadow:0 0 12px var(--teal)"></i><i style="background:var(--saffron);box-shadow:0 0 12px var(--saffron)"></i>'.repeat(Math.max(3, Math.floor(innerWidth / 60)));
})();
S.iceReady = fetch('/config').then(r => r.json()).then(c => { S.ice = c.iceServers; }).catch(() => {});
show('join');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
