// Load test: N simulated singers (default 1000) use Mehfil at once against a local server with temporary data.
// Each one says hello, makes a profile, then: some open tables and others join them, some play with AI singers,
// everyone chats and reacts, and finally everyone leaves. Measures how long the server takes to answer.
// Run with: node tests/load-test.js [users]      (not part of npm test: it takes a minute or two)
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { io } = require('socket.io-client');

const N = Number(process.argv[2]) || 1000;
const PORT = 5098;
const URL = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mehfil-load-'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 12).padEnd(10, 'x');
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(ok ? '  ✓' : '  ✗', name, detail ? `(${detail})` : '');
}

function user(i) {
  const token = rnd();
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false, timeout: 60000 });
  const u = { i, s, token, view: null, lobbies: 0, errors: 0, chats: 0 };
  s.on('table', v => { u.view = v; });
  s.on('lobby', () => { u.lobbies++; });
  s.on('chat', () => { u.chats++; });
  s.on('connect_error', () => { u.errors++; });
  return new Promise(res => {
    const t0 = Date.now();
    s.on('connect', () => s.emit('hello', { token }));
    s.once('me', () => {
      s.emit('profile:update', { name: `Singer ${i}`, handle: `singer${i}`, city: 'Pune', bio: 'load test' });
      s.once('profile:saved', () => { u.joinMs = Date.now() - t0; res(u); });
    });
    setTimeout(() => res(u), 60000);
  });
}

// How long a round trip takes while the server is busy: a Find a friend search (answered straight back).
async function ping(u) {
  const t0 = Date.now();
  return new Promise(res => {
    u.s.emit('find', { q: 'singer 1' }, () => res(Date.now() - t0));
    setTimeout(() => res(NaN), 30000);
  });
}

async function main() {
  console.log(`Load test: ${N} singers on ${URL}`);
  const server = spawn(process.execPath, ['--expose-gc', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_FILE: path.join(tmp, 'data.json'), REPORTS_FILE: path.join(tmp, 'reports.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  await wait(1200);
  const users = [];
  try {
    // 1. Everyone arrives, 50 at a time.
    const t0 = Date.now();
    for (let i = 0; i < N; i += 50) {
      users.push(...await Promise.all(Array.from({ length: Math.min(50, N - i) }, (_, k) => user(i + k))));
    }
    const arrived = users.filter(u => u.joinMs !== undefined);
    const arriveSec = (Date.now() - t0) / 1000;
    console.log(`\n1. ${arrived.length}/${N} signed up in ${arriveSec.toFixed(1)} s; sign-up p50 ${pct(arrived.map(u => u.joinMs), 0.5)} ms, p95 ${pct(arrived.map(u => u.joinMs), 0.95)} ms`);
    check('every singer could sign up', arrived.length === N, `${N - arrived.length} missing`);
    check('sign-up stays under 2 s for 95% of singers', pct(arrived.map(u => u.joinMs), 0.95) < 2000);

    // 2. Tables: every 4th person hosts a game; the next three join it. Every 10th host plays with AI instead.
    const t1 = Date.now();
    const hosts = users.filter(u => u.i % 4 === 0);
    for (const h of hosts) h.s.emit(h.i % 40 === 0 ? 'table:quick' : 'table:create', { type: 'game' });
    await wait(3000);
    for (const u of users.filter(x => x.i % 4 !== 0)) {
      const host = users[u.i - (u.i % 4)];
      if (host?.view?.code && host.i % 40 !== 0) u.s.emit('table:join', { code: host.view.code });
      else u.s.emit('table:quick', {});
    }
    await wait(4000);
    const seated = users.filter(u => u.view?.code).length;
    console.log(`\n2. ${seated}/${N} seated at a table after ${((Date.now() - t1) / 1000).toFixed(1)} s (${hosts.length} hosts)`);
    check('everyone got a seat', seated >= N * 0.99, `${N - seated} without a table`);

    // 3. Busy table life: every host starts, everyone chats twice and reacts.
    for (const h of hosts) h.s.emit('table:start');
    for (const u of users) { u.s.emit('chat', { text: `Wah ${u.i}` }); u.s.emit('react', { emoji: '👏' }); }
    await wait(500);
    for (const u of users) u.s.emit('chat', { text: `Ek aur ${u.i}` });
    const pings = await Promise.all(hosts.slice(0, 50).map(ping));
    console.log(`\n3. Server answer time while busy: p50 ${pct(pings, 0.5)} ms, p95 ${pct(pings, 0.95)} ms, max ${Math.max(...pings)} ms`);
    check('the server answers in under 1 s while everyone plays', pct(pings, 0.95) < 1000, `p95 ${pct(pings, 0.95)} ms`);
    await wait(1500);
    const gotChat = users.filter(u => u.chats > 0).length;
    check('chat reaches the table', gotChat >= N * 0.95, `${gotChat}/${N} saw chat`);

    // 4. Lobby updates: how many each person received (each one is a full list of everyone).
    const lob = users.map(u => u.lobbies);
    console.log(`\n4. Lobby updates per person: p50 ${pct(lob, 0.5)}, max ${Math.max(...lob)}`);

    // 5. Everyone leaves.
    const t4 = Date.now();
    for (const u of users) u.s.emit('table:leave');
    await wait(2000);
    const late = await ping(users[0]);
    console.log(`\n5. Everyone left; server answer afterwards ${late} ms (leave burst ${((Date.now() - t4) / 1000).toFixed(1)} s)`);
    check('no connection errors', users.every(u => !u.errors), `${users.filter(u => u.errors).length} with errors`);
    check('the server did not crash', server.exitCode === null && !/Error|at .*server\.js/.test(log), log.slice(-300));
  } catch (err) {
    failed++;
    console.log('  ✗ load test crashed:', err.message);
  } finally {
    users.forEach(u => u.s.close());
    server.kill();
  }
  console.log(`\n${failed ? failed + ' check(s) failed' : 'all load checks passed'}`);
  process.exit(failed ? 1 : 0);
}
main();
