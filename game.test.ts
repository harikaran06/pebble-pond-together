import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PUZZLES, solve, validatePuzzle } from '../shared/puzzles.ts';
import { applyCommand, createRoom, joinRoom, reconcile, RuleError, type Player, type Room } from '../shared/engine.ts';
import { updateWithCAS, type RoomStore } from '../shared/cas.ts';

const at = 1_000_000;
const answers = [[1, 3, 0, 2], [0, 3, 1, 4, 2], [4, 1, 5, 3, 0, 2]];
const player = (id: string): Player => ({ id, name: id, tokenHash: id, joinedAt: at, lastSeen: at });
const command = (kind: 'start' | 'next' | 'place' | 'remove' | 'heartbeat', cell?: number) => ({ kind, cell, actionId: randomUUID() }) as Parameters<typeof applyCommand>[2];
function started(): Room {
  let room = createRoom('POND24', player('a'), at);
  room = joinRoom(room, player('b'));
  return applyCommand(room, 'a', command('start'), at);
}

test('all boards have connected regions and exactly one complete solution', () => {
  for (const [index, puzzle] of PUZZLES.entries()) {
    assert.deepEqual(validatePuzzle(puzzle), [], puzzle.name);
    assert.deepEqual(solve(puzzle), [answers[index]]);
    for (let row = 0; row < puzzle.size; row++) {
      const partial = answers[index].slice(0, row + 1).map((col, r) => r * puzzle.size + col);
      assert.equal(solve(puzzle, partial).length, 1);
    }
  }
});

test('every possible wrong placement is rejected, without changing turn or score', () => {
  const room = started();
  const puzzle = PUZZLES[0];
  for (let cell = 0; cell < puzzle.size * puzzle.size; cell++) {
    if (answers[0].some((col, row) => row * puzzle.size + col === cell)) continue;
    assert.throws(() => applyCommand(room, 'a', command('place', cell), at), RuleError);
  }
  assert.equal(room.score, 0); assert.equal(room.activeId, 'a');
});

test('three rounds advance in order and cap score at 400', () => {
  let room = started();
  for (let round = 0; round < 3; round++) {
    assert.equal(room.round, round);
    for (let row = 0; row < PUZZLES[round].size; row++) {
      const actor = room.activeId;
      room = applyCommand(room, actor, command('place', row * PUZZLES[round].size + answers[round][row]), at);
    }
    assert.equal(room.score, [90, 190, 400][round]);
    if (round < 2) {
      assert.equal(room.phase, 'intermission');
      room = applyCommand(room, room.hostId, command('next'), at);
      assert.equal(room.phase, 'playing'); assert.deepEqual(room.placed, []);
    }
  }
  assert.equal(room.phase, 'finished');
  assert.equal(room.finalBonus, true);
  assert.deepEqual(room.bonuses, [0, 1, 2]);
  assert.throws(() => applyCommand(room, room.activeId, command('place', 0), at), RuleError);
});

test('removal is authorized for current player and replacement never farms points', () => {
  let room = started();
  const cell = answers[0][0];
  room = applyCommand(room, 'a', command('place', cell), at);
  assert.throws(() => applyCommand(room, 'a', command('remove', cell), at), RuleError);
  room = applyCommand(room, 'b', command('remove', cell), at);
  assert.equal(room.score, 10); assert.deepEqual(room.placed, []);
  room = applyCommand(room, 'a', command('place', cell), at);
  assert.equal(room.score, 10);
  assert.deepEqual(room.placed, [cell]);
});

test('duplicate action IDs are idempotent', () => {
  const room = started(), move = command('place', answers[0][0]);
  const result = applyCommand(room, 'a', move, at);
  assert.equal(applyCommand(result, 'a', move, at), result);
  assert.equal(result.score, 10);
});

test('capacity, reconnect heartbeat, disconnected turn skip and host transfer', () => {
  let room = createRoom('POND24', player('a'), at);
  for (const id of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) room = joinRoom(room, player(id));
  assert.throws(() => joinRoom(room, player('ninth')), /full/);
  room = applyCommand(room, 'a', command('start'), at);
  const now = at + 31_000;
  room = applyCommand(room, 'b', command('heartbeat'), now);
  assert.equal(room.hostId, 'b'); assert.equal(room.activeId, 'b');
  assert.equal(reconcile(room, now).activeId, 'b');
  room = applyCommand(room, 'a', command('heartbeat'), now);
  assert.equal(room.players[0].lastSeen, now);
});

test('CAS serializes two simultaneous moves without a lost update', async () => {
  let value = started(), revision = 1;
  const memory: RoomStore = {
    async getWithMetadata() { return { data: structuredClone(value), etag: String(revision) }; },
    async setJSON(_key, updated, { onlyIfMatch }) {
      await new Promise(resolve => setTimeout(resolve, 2));
      if (onlyIfMatch !== String(revision)) return { modified: false };
      value = structuredClone(updated); revision++; return { modified: true };
    }
  };
  const moves = [0, 1].map(row => updateWithCAS(memory, 'POND24', current =>
    applyCommand(current, 'a', command('place', row * 4 + answers[0][row]), at), () => at));
  const results = await Promise.allSettled(moves);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(value.placed.length, 1); assert.equal(value.score, 10); assert.equal(value.activeId, 'b');
});
