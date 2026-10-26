import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 8898;
const server = spawn('./node_modules/.bin/netlify', ['dev', '--offline', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs += chunk.toString(); });
server.stderr.on('data', chunk => { logs += chunk.toString(); });
const root = `http://127.0.0.1:${port}`;
async function request(body, expectedStatus = 200) {
  const response = await fetch(`${root}/api/game`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(data));
  return data;
}
const act = (session, kind, cell) => request({ op: 'action', ...session, kind, cell, actionId: randomUUID() });
const answers = [[1, 3, 0, 2], [0, 3, 1, 4, 2], [4, 1, 5, 3, 0, 2]];

try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error(`Netlify Dev exited: ${logs}`);
    try { if ((await fetch(root)).ok) { ready = true; break; } } catch { /* Starting. */ }
    await delay(1000);
  }
  if (!ready) throw new Error(`Netlify Dev did not start: ${logs}`);
  const first = await request({ op: 'create', name: 'Alice' });
  const a = { code: first.room.code, playerId: first.playerId, token: first.token };
  await request({ op: 'join', code: 'ZZZZZZ', name: 'Nobody' }, 404);
  const second = await request({ op: 'join', code: a.code, name: 'Bob' });
  const b = { code: a.code, playerId: second.playerId, token: second.token };
  await request({ op: 'state', ...a, token: 'a'.repeat(64) }, 403);
  let state = (await act(a, 'start')).room;
  assert.equal(state.players.length, 2);
  const race = await Promise.allSettled([act(a, 'place', 1), act(a, 'place', 11)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  state = (await request({ op: 'state', ...b })).room;
  assert.equal(state.placed.length, 1); assert.equal(state.score, 10);
  // Complete the first round regardless of which of the simultaneous valid cells won.
  for (let round = 0; round < 3; round++) {
    const size = answers[round].length;
    for (let row = 0; row < size; row++) {
      const cell = row * size + answers[round][row];
      if (state.placed.includes(cell)) continue;
      state = (await act(state.activeId === a.playerId ? a : b, 'place', cell)).room;
    }
    if (round < 2) state = (await act(state.hostId === a.playerId ? a : b, 'next')).room;
  }
  assert.equal(state.phase, 'finished'); assert.equal(state.score, 400);
  const reconnected = (await request({ op: 'state', ...b })).room;
  assert.equal(reconnected.score, 400);
  console.log(`PASS: Netlify Dev HTTP integration: two independent player tokens, join, simultaneous moves, reconnect/state read, three rounds, score 400 (room ${a.code}).`);
} catch (error) {
  console.error('FAIL:', error);
  console.error(logs.slice(-5000));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
}
