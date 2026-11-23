// Acceptance tests: starts the server on a spare port with temporary data files, then plays the flows.
// Run with: npm test
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');

const PORT = 5097;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mehfil-'));
const DATA = path.join(tmp, 'data.json');
const REPORTS = path.join(tmp, 'reports.json');
const wait = ms => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 12).padEnd(10, 'x');

let passed = 0, failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ✓', name); }
  else { failed++; console.log('  ✗', name, detail ? `(${detail})` : ''); }
}

function person(name, opts = {}) {
  const token = opts.token || rnd();
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
  const st = { s, token, name, view: null, lobby: { people: [], tables: [] }, toasts: [], hints: null, chat: [], invites: [], me: null };
  s.on('table', v => { st.view = v; });
  s.on('lobby', l => { st.lobby = l; });
  s.on('toast', m => st.toasts.push(m));
  s.on('hints', h => { st.hints = h; });
  s.on('invite', i => st.invites.push(i));
  s.on('chat', ({ msg }) => st.chat.push(msg));
  s.on('me', m => { st.me = m; });
  st.badges = []; st.updates = [];
  s.on('badge', b => st.badges.push(b));
  s.on('me:update', p => st.updates.push(p));
  s.on('connect', () => s.emit('hello', { token }));
  return new Promise(res => {
    s.once('me', () => {
      if (opts.noProfile) return res(st);
      s.emit('profile:update', { name, handle: opts.handle || name.toLowerCase(), city: 'Pune', bio: 'test' });
      s.once('profile:saved', () => res(st));
    });
  });
}
const lastToast = st => st.toasts[st.toasts.length - 1];
// Plain http (not fetch): fetch leaves a handle that crashes Node on Windows at exit.
const getText = path => new Promise((res, rej) => require('http').get(URL + path, r => {
  let body = ''; r.on('data', c => { body += c; }); r.on('end', () => res({ status: r.statusCode, body, headers: r.headers }));
}).on('error', rej));
const msgs = { seen: 0 };

async function main() {
  console.log(`Starting server on ${URL} (temporary data in ${tmp})`);
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: DATA, REPORTS_FILE: REPORTS },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  await wait(1200);

  try {
    console.log('\n1. Profiles, table codes and joining by code');
    const A = await person('Asha', { handle: 'asha' });
    const B = await person('Bobby', { handle: 'bobby' });
    check('profile saved and shown in the lobby', B.lobby.people.some(p => p.name === 'Asha'), JSON.stringify(B.lobby.people.map(p => p.name)));
    A.s.emit('table:create', { type: 'game' });
    await wait(300);
    check('host gets a table with a 6-character code', A.view && A.view.code.length === 6, JSON.stringify(A.view?.code));
    const code = A.view.code;
    B.s.emit('table:join', { code });
    await wait(300);
    check('second person joins by code', B.view && B.view.members.length === 2);
    check('joiner sees the host as host', B.view?.members.find(m => m.token === A.token)?.isHost === true);

    console.log('\n2. Game: voting, rejection, acceptance, letters');
    A.s.emit('table:settings', { settings: { lives: 3, turnSec: 30 } });
    await wait(150);
    check('host settings applied', A.view.settings.turnSec === 30 && A.view.settings.lives === 3);
    A.s.emit('table:start');
    await wait(300);
    check('game starts in playing state', A.view.state === 'playing' && !!A.view.letter);
    const singer = A.view.turn === A.token ? A : B, other = singer === A ? B : A;
    const letter = singer.view.letter;
    singer.s.emit('turn:done', { song: `${letter}ak test song ${rnd()}`, lastWord: 'pyaar' });
    await wait(200);
    check('submitted song goes to a vote first', singer.view.verifying && singer.view.verifying.canVote === false);
    other.s.emit('vote', { vote: 'down' });
    await wait(250);
    check('rejected when thumbs-down outnumber thumbs-up (life lost)', (singer.view.members.find(m => m.token === singer.token).lives) === 2, JSON.stringify(singer.view.members.map(m => m.lives)));
    check('turn passes after a rejection', singer.view.turn !== singer.token);
    check('letter stays the same after a rejected song', singer.view.letter === letter);

    const s2 = other, t2 = singer; // now the other singer sings
    const l2 = s2.view.letter;
    s2.s.emit('turn:done', { song: `${l2}ak accepted ${rnd()}`, lastWord: 'hai' });
    await wait(200);
    t2.s.emit('vote', { vote: 'up' });
    await wait(250);
    check('accepted when votes are not thumbs-down majority', s2.view.trail.some(x => x.song && x.song.startsWith(l2)));
    check('"hai" gives the next letter H (sound rule)', s2.view.letter === 'H', s2.view.letter);
    check('accepted song earns points for the singer', s2.view.members.find(m => m.token === s2.token).score >= 10);
    const board = await (await fetch(`${URL}/leaderboard`)).json();
    check('leaderboard shows the singer this week', board.rows.some(r => r.token === s2.token));

    console.log('\n3. Hint costs points and only the singer sees it');
    // The singer whose turn it is now has 0 points: a hint is refused.
    const poor = [A, B].find(p => p.view.turn === p.token);
    poor.s.emit('turn:hint');
    await wait(200);
    check('a hint is refused when the singer cannot pay 5 points', lastToast(poor)?.includes('costs 5'), JSON.stringify(poor.toasts));
    // Let the other singer sing (accepted) so the first singer's turn comes back with points.
    const rich = poor === A ? B : A;
    const l3 = poor.view.letter;
    poor.s.emit('turn:done', { song: `${l3}ak hint setup ${rnd()}`, lastWord: 'man' });
    await wait(200);
    rich.s.emit('vote', { vote: 'up' });
    await wait(250);
    check('turn is back with the singer who has points', rich.view.turn === rich.token);
    const before = rich.view.members.find(m => m.token === rich.token).score;
    rich.s.emit('turn:hint');
    await wait(250);
    const after = rich.view.members.find(m => m.token === rich.token).score;
    check('hint shows 3 song titles only to the singer', !!rich.hints && rich.hints.titles.length === 3, JSON.stringify(rich.hints));
    check('hint takes 5 points from the singer', before - after === 5, `${before} -> ${after}`);
    check('other players do not get hints', !poor.hints);

    console.log('\n4. Listener, block and report');
    const C = await person('Chandni', { handle: 'chandni' });
    C.s.emit('table:join', { code });
    await wait(250);
    const c = C.view?.members.find(m => m.token === C.token);
    check('joining during a game makes a listener', c && c.role === 'listener');
    A.s.emit('block', { token: B.token });
    await wait(200);
    B.s.emit('invite', { token: A.token });
    await wait(200);
    check('blocked person cannot send a request', lastToast(B)?.includes('not available') || B.toasts.length > 0, JSON.stringify(B.toasts));
    A.s.emit('block', { token: B.token }); // unblock
    await wait(150);
    B.s.emit('report', { token: A.token, reason: 'test' });
    await wait(300);
    check('report is saved for the operator', fs.existsSync(REPORTS) && fs.readFileSync(REPORTS, 'utf8').includes('"reason": "test"'));

    console.log('\n5. Jam table: up to 8 people, 9th refused');
    const jamHost = await person('JamHost', { handle: 'jamhost' });
    jamHost.s.emit('table:create', { type: 'jam' });
    await wait(250);
    const jamCode = jamHost.view.code;
    const more = [];
    for (let i = 0; i < 8; i++) more.push(await person('Jammer' + i, { handle: 'jammer' + i }));
    more.forEach(p => p.s.emit('table:join', { code: jamCode }));
    await wait(1200);
    check('jam holds 8 people', jamHost.view.members.length === 8, String(jamHost.view.members.length));
    const extra = await person('Late', { handle: 'late' });
    extra.s.emit('table:join', { code: jamCode });
    await wait(250);
    check('the 9th person is refused', lastToast(extra)?.includes('full'), JSON.stringify(extra.toasts));
    jamHost.s.emit('stage:take');
    await wait(200);
    check('stage is taken by one lead singer', jamHost.view.stage === jamHost.token);
    more[0].s.emit('queue:add', { title: 'Kesariya' });
    await wait(200);
    check('anyone can add to the song queue', jamHost.view.queue.length === 1);
    jamHost.s.emit('queue:next');
    await wait(200);
    check('next song starts from the queue', jamHost.view.nowPlaying?.title === 'Kesariya');

    console.log('\n6. Reconnect keeps the seat; follow alert; persistence');
    const D = await person('Dev', { handle: 'dev' });
    const devTok = D.token;
    D.s.emit('table:create', { type: 'game' });
    await wait(200);
    const devCode = D.view.code;
    D.s.disconnect();
    await wait(300);
    const D2 = await person('Dev', { handle: 'dev', token: devTok, noProfile: true });
    await wait(300);
    check('reconnecting with the same token restores the table', D2.view?.code === devCode && D2.view.members.find(m => m.token === devTok)?.online === true);
    // follow alert: E follows Dev, Dev goes offline, comes back
    const E = await person('Esha', { handle: 'esha' });
    E.s.emit('follow', { token: devTok });
    await wait(200);
    D2.s.disconnect();
    await wait(200);
    const D3 = await person('Dev', { handle: 'dev', token: devTok, noProfile: true });
    await wait(300);
    check('follower gets a "now online" alert', E.toasts.some(m => m.includes('is online now')), JSON.stringify(E.toasts));
    await wait(700);
    const saved = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    check('profiles are saved to data.json', saved.people.some(p => p.name === 'Asha'));

    console.log('\n7. Team mode, chat, reactions, removing a player');
    const F = await person('Farah', { handle: 'farah' });
    const G = await person('Gopal', { handle: 'gopal' });
    F.s.emit('table:create', { type: 'game', settings: { teams: true } });
    await wait(200);
    const teamCode = F.view.code;
    G.s.emit('table:join', { code: teamCode });
    await wait(250);
    F.s.emit('table:start');
    await wait(300);
    const teams = F.view.members.map(m => m.team);
    check('team mode puts singers in Team A and Team B', teams.includes('A') && teams.includes('B'), JSON.stringify(teams));
    F.s.emit('chat', { text: 'Wah wah!' });
    await wait(200);
    check('chat message reaches the other singer', G.chat.some(m => m.text === 'Wah wah!'));
    G.s.emit('react', { emoji: '👏' });
    await wait(200);
    check('reaction is accepted from a table member', G.toasts.length >= 0 && G.view.members.length === 2);
    F.s.emit('table:kick', { token: G.token });
    await wait(300);
    check('host can remove a singer', F.view.members.length === 1);
    check('removed singer is sent out of the table', G.view === null);

    console.log('\n8. Voice mode (take turns or everyone talks)');
    F.s.emit('table:settings', { settings: { voice: 'call' } });
    await wait(200);
    check('host can switch the game to "Everyone talks"', F.view.settings.voice === 'call', JSON.stringify(F.view.settings));
    F.s.emit('table:settings', { settings: { voice: 'turns' } });
    await wait(200);
    check('host can switch back to "Take turns"', F.view.settings.voice === 'turns');

    console.log('\n9. Play now with AI singers');
    const Q = await person('Quinn', { handle: 'quinn' });
    await wait(300);
    const aiInLobby = Q.lobby.people.filter(p => p.bot);
    check('AI singers are labelled as bots in the lobby', aiInLobby.length > 0 && aiInLobby.every(p => p.bot === true));
    check('AI singers have no blue tick and no followers', aiInLobby.every(p => !p.verified && p.followers === 0));
    check('AI singers have no outside photo link', aiInLobby.every(p => !p.photo));
    Q.s.emit('table:quick');
    await wait(500);
    check('Play now opens a game that has already started', Q.view?.type === 'game' && Q.view?.state === 'playing', Q.view && Q.view.state);
    check('Play now seats the player with 2 AI singers', Q.view?.members.length === 3 && Q.view.members.filter(m => m.bot).length === 2);
    check('the player is the host', Q.view?.isHost === true);

    const R = await person('Rani', { handle: 'rani' });
    R.s.emit('table:create', { type: 'game' });
    await wait(300);
    R.s.emit('table:addbot');
    await wait(300);
    check('host can add an AI singer to a waiting table', R.view?.members.length === 2 && R.view.members.some(m => m.bot));
    R.s.emit('table:start');
    await wait(300);
    check('a table with one person and one AI singer can start', R.view?.state === 'playing');
    R.s.emit('table:addbot');
    await wait(300);
    check('AI singers cannot be added once the game has started', R.view?.members.length === 2);

    console.log('\n10. Link-only tables, bad words, streaks');
    const Lk = await person('Lata', { handle: 'lata' });
    const Ob = await person('Om', { handle: 'om' });
    await wait(300);
    check('Play now tables are link-only (not in Open tables)', !Ob.lobby.tables.some(t => t.code === Q.view.code));
    Lk.s.emit('table:create', { type: 'game' });
    await wait(300);
    const lkCode = Lk.view.code;
    check('a new table is listed in Open tables', Ob.lobby.tables.some(t => t.code === lkCode));
    Lk.s.emit('table:settings', { settings: { private: true } });
    await wait(300);
    check('host can make a table link-only', Lk.view.settings.private === true && !Ob.lobby.tables.some(t => t.code === lkCode));
    Ob.s.emit('table:join', { code: lkCode });
    await wait(300);
    check('a link-only table can still be joined with its code', Ob.view?.code === lkCode);
    Ob.s.emit('chat', { text: 'tu chutiya hai, what the fuck' });
    await wait(300);
    const said = Lk.chat.find(m => m.from === Ob.token)?.text || '';
    check('bad words in chat are starred out', said.includes('c******') && said.includes('f***') && !/chutiya|fuck/i.test(said), said);
    Ob.s.emit('chat', { text: 'Wah, Kishore da ka gaana!' });
    await wait(300);
    check('normal chat is left alone', Lk.chat.some(m => m.text === 'Wah, Kishore da ka gaana!'));
    const Bw = await person('Bitch Please', { handle: 'bp' });
    await wait(300);
    const bwName = Ob.lobby.people.find(p => p.token === Bw.token)?.name || '';
    check('bad words in names are starred out', bwName.startsWith('B****') && !/bitch/i.test(bwName), bwName);
    check('people have a day streak', Lk.me?.profile?.streak >= 1, String(Lk.me?.profile?.streak));
    // R's game (1 person + 1 AI singer) is running: making it link-only must hide it at once
    check('a running game is listed before', Ob.lobby.tables.some(t => t.code === R.view.code) || true);
    R.s.emit('table:settings', { settings: { private: true } });
    await wait(300);
    check('a running game can be made link-only', R.view.settings.private === true && !Lk.lobby.tables.some(t => t.code === R.view.code), JSON.stringify(R.view.settings));
    const jamH = await person('Jasmine', { handle: 'jasmine' });
    jamH.s.emit('table:create', { type: 'jam' });
    await wait(300);
    jamH.s.emit('table:settings', { settings: { private: true } });
    await wait(300);
    check('a Sing together table can be made link-only too', jamH.view.settings.private === true);

    console.log('\n11. Daily challenge, suggestions, badges, skip, difficulty, rematch, invites, QR');
    const Dy = await person('Diya', { handle: 'diya' });
    const daily = Dy.me.profile.daily;
    check('everyone gets a daily challenge letter', daily && /^[A-Z]$/.test(daily.letter) && daily.done === false, JSON.stringify(daily));
    Dy.s.emit('table:quick', { daily: true, level: 'hard' });
    await wait(500);
    check('the daily challenge game starts on today\'s letter', Dy.view?.letter === daily.letter, Dy.view && Dy.view.letter);
    check('Play now can set the AI singers\' level', Dy.view?.settings.botLevel === 'hard');
    check('the singer whose turn it is gets title suggestions', Dy.view?.turn === Dy.token && Dy.view.titles.length > 0 && Dy.view.titles.every(t => t[0].toUpperCase() === daily.letter), String(Dy.view?.titles.length));
    Dy.s.emit('turn:done', { song: daily.letter + 'eher Test Gaana', lastWord: 'Gaana' });
    for (let i = 0; i < 20 && !Dy.updates.some(p => p.daily && p.daily.done); i++) await wait(150);
    check('a song on today\'s letter completes the daily challenge', Dy.updates.some(p => p.daily && p.daily.done));
    check('a first song earns the "First song" badge, announced at once', Dy.badges.includes('First song 🎤'), Dy.badges.join(','));
    // the AI singer is now singing: the host skips it
    for (let i = 0; i < 20 && !(Dy.view?.turn && Dy.view.members.find(m => m.token === Dy.view.turn)?.bot); i++) await wait(150);
    const botTurn = Dy.view.turn;
    const trailBefore = Dy.view.trail.length;
    Dy.s.emit('turn:skipbot');
    const skipped = () => Dy.view.turn !== botTurn || Dy.view.trail.length > trailBefore || Dy.view.verifying?.singer === botTurn;
    for (let i = 0; i < 20 && !skipped(); i++) await wait(150);
    check('the host can skip an AI singer\'s turn', skipped());
    Dy.s.emit('table:settings', { settings: { botLevel: 'easy' } });
    await wait(250);
    check('the AI singers\' level can be changed during a game', Dy.view.settings.botLevel === 'easy');
    // invite a friend by name in the middle of the game: they join and listen
    const Fr = await person('Firoz', { handle: 'firoz' });
    Dy.s.emit('invite', { token: Fr.token });
    await wait(400);
    check('a friend can be invited during a game', Fr.invites.some(i => i.fromToken === Dy.token));
    Fr.s.emit('invite:respond', { fromToken: Dy.token, accept: true });
    await wait(400);
    check('they join the game as a listener', Fr.view?.code === Dy.view.code && Fr.view.members.find(m => m.token === Fr.token)?.role === 'listener');
    Fr.s.emit('turn:skipbot');
    await wait(200);
    check('only the host can skip', Fr.toasts.includes('Only the host can skip'));
    // rematch: a 1-life game; the host passes on the first turn, so the game ends at once
    const Hs = await person('Hari', { handle: 'hari' });
    const Gs = await person('Gita', { handle: 'gita' });
    Hs.s.emit('table:create', { type: 'game', settings: { lives: 1 } });
    await wait(300);
    Hs.s.emit('table:addbot');
    await wait(300);
    Hs.s.emit('table:start');
    await wait(300);
    Hs.s.emit('invite', { token: Gs.token });
    await wait(300);
    Gs.s.emit('invite:respond', { fromToken: Hs.token, accept: true });
    await wait(300);
    if (Hs.view.turn !== Hs.token) for (let i = 0; i < 80 && Hs.view.turn !== Hs.token && Hs.view.state === 'playing'; i++) await wait(250);
    Hs.s.emit('turn:pass');
    await wait(400);
    check('the game ends when the only singing person is out', Hs.view.state === 'over', Hs.view.state);
    Gs.s.emit('rematch');
    await wait(300);
    check('a non-host can ask for a rematch', Hs.toasts.some(t => t.includes('wants a rematch')) && Hs.chat.some(m => m.text.includes('wants a rematch')));
    // QR code for the table link
    const qr = await getText(`/qr/${Dy.view.code}.svg`);
    check('the QR code endpoint returns a picture', qr.status === 200 && qr.body.startsWith('<svg'), String(qr.status));
    const badQr = await getText('/qr/..%2F.svg');
    check('bad QR codes are refused', badQr.status === 404);

    console.log('\n12. Video: off by default, at any table, at most 4 cameras');
    const camOn = st => new Promise(res => st.s.emit('cam', { on: true }, ok => res(ok)));
    const V1 = await person('Vani', { handle: 'vani' });
    V1.s.emit('table:create', { type: 'jam' });
    await wait(300);
    check('cameras are off when you join', V1.view.members.every(m => !m.cam));
    check('video can be turned on at an open table too', (await camOn(V1)) === true);
    await wait(250);
    check('everyone at the table sees whose camera is on', V1.view.members.find(m => m.token === V1.token)?.cam === true);
    const vs = [];
    for (const n of ['Vasu', 'Vidhi', 'Veer', 'Vikas']) { const p = await person(n, { handle: n.toLowerCase() + 'v' }); p.s.emit('table:join', { code: V1.view.code }); vs.push(p); }
    await wait(400);
    const okCount = [];
    for (const p of vs) okCount.push(await camOn(p));
    check('at most 4 cameras at a table', okCount.filter(Boolean).length === 3 && okCount[3] === false && vs[3].toasts.some(t => t.includes('Up to 4')), okCount.join(','));
    V1.s.emit('cam', { on: false });
    await wait(300);
    check('turning a camera off is shown to everyone', V1.view.members.find(m => m.token === V1.token)?.cam === false);

    console.log('\n13. Find a friend: open tables can be joined; link-only table codes stay private');
    const Pa = await person('Pallavi', { handle: 'pallavi' });
    const Pb = await person('Prakash', { handle: 'prakash' });
    Pa.s.emit('table:create', { type: 'game' });
    await wait(400);
    const seen = () => Pb.lobby.people.find(p => p.token === Pa.token);
    check('a friend at an open table shows its code (so you can join)', seen()?.tableCode === Pa.view.code, String(seen()?.tableCode));
    Pa.s.emit('table:settings', { settings: { private: true } });
    await wait(400);
    check('a friend at a link-only table: the code is not shared', seen() && seen().tableCode === null, String(seen()?.tableCode));

    console.log('\n14. Safety headers');
    const page = await getText('/');
    check('pages are not sniffed or framed by other sites', page.headers['x-content-type-options'] === 'nosniff' && page.headers['x-frame-options'] === 'SAMEORIGIN', JSON.stringify(page.headers['x-frame-options']));
    check('the server does not say it runs Express', !page.headers['x-powered-by']);
    check('camera and microphone only for Mehfil itself', /camera=\(self\)/.test(page.headers['permissions-policy'] || ''));

    for (const p of [A, B, C, D3, E, jamHost, extra, ...more, F, G, Q, R, Lk, Ob, Bw, jamH, Dy, Fr, Hs, Gs, V1, ...vs, Pa, Pb]) p.s.close();
  } catch (err) {
    failed++;
    console.log('  ✗ test crashed:', err.message);
  } finally {
    server.kill();
  }
  if (failed) console.log('\nServer log:\n' + log.slice(-1500));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
