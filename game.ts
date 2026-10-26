import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PUZZLES, solve } from '../../shared/puzzles.ts';
import { applyCommand, createRoom, joinRoom, publicRoom, RuleError, type Command, type Player, type Room } from '../../shared/engine.ts';
import { updateWithCAS } from '../../shared/cas.ts';

const store = () => getStore({ name: 'pebble-pond-rooms', consistency: 'strong' });
// Netlify Dev's local sandbox can omit ETag from a GET even though the deployed API returns it.
// Listing the exact key provides its ETag in that case; a stale ETag simply fails the CAS write.
async function getVersioned(roomCode: string) {
  const blobs = store();
  const entry = await blobs.getWithMetadata(roomCode, { type: 'json', consistency: 'strong' });
  if (!entry) return null;
  if (entry.etag) return { data: entry.data as Room, etag: entry.etag };
  const listing = await blobs.list({ prefix: roomCode });
  const etag = listing.blobs.find(item => item.key === roomCode)?.etag;
  if (!etag) throw new Error('Room version could not be read');
  return { data: entry.data as Room, etag };
}
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern = /^[A-HJ-NP-Z2-9]{6}$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const code = () => Array.from(randomBytes(6), b => alphabet[b % alphabet.length]).join('');
const respond = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { 'Cache-Control': 'no-store, max-age=0', 'Pragma': 'no-cache' } });

type Input = { op?: string; code?: string; name?: string; playerId?: string; token?: string;
  actionId?: string; kind?: Command['kind']; cell?: number };

function newPlayer(name: string, now: number) {
  const trimmed = name.trim().slice(0, 24);
  if (trimmed.length < 1) throw new RuleError('Enter your name to play.');
  const token = randomBytes(32).toString('hex');
  const player: Player = { id: randomUUID(), name: trimmed, tokenHash: hash(token), joinedAt: now, lastSeen: now };
  return { player, token };
}

async function readRoom(roomCode: string): Promise<{ room: Room; etag: string }> {
  if (!codePattern.test(roomCode)) throw new RuleError('Enter a valid six-character room code.');
  const entry = await getVersioned(roomCode);
  if (!entry?.data) throw new RuleError('Room not found. Check the code.', 404);
  if (!entry.etag) throw new Error('Room read did not include an ETag');
  const room = entry.data as Room;
  if (Date.now() >= room.expiresAt) throw new RuleError('This room has expired.', 410);
  return { room, etag: entry.etag };
}

function authorize(room: Room, input: Input): Player {
  const player = room.players.find(p => p.id === input.playerId);
  if (!player || typeof input.token !== 'string' || input.token.length !== 64 || player.tokenHash !== hash(input.token))
    throw new RuleError('Your session is no longer valid. Rejoin with your original browser.', 403);
  return player;
}

async function update(roomCode: string, transform: (room: Room) => Room): Promise<Room> {
  const blobs = store();
  return updateWithCAS({ getWithMetadata: getVersioned, setJSON: (key, room, options) => blobs.setJSON(key, room, options) }, roomCode, transform);
}

export default async function handler(request: Request) {
  try {
    if (request.method !== 'POST') return respond({ error: 'Use POST.' }, 405);
    if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new RuleError('Request is too large.', 413);
    const input = await request.json() as Input;
    const now = Date.now();
    if (input.op === 'create') {
      const { player, token } = newPlayer(String(input.name ?? ''), now);
      for (let attempt = 0; attempt < 16; attempt++) {
        const room = createRoom(code(), player, now);
        const result = await store().setJSON(room.code, room, { onlyIfNew: true });
        if (result.modified) return respond({ room: publicRoom(room, now), playerId: player.id, token });
      }
      throw new RuleError('Could not reserve a room code. Try again.', 503);
    }
    const roomCode = String(input.code ?? '').toUpperCase();
    if (input.op === 'join') {
      const { player, token } = newPlayer(String(input.name ?? ''), now);
      const room = await update(roomCode, current => joinRoom(current, player));
      return respond({ room: publicRoom(room, now), playerId: player.id, token });
    }
    if (input.op === 'state' || input.op === 'hint') {
      const { room } = await readRoom(roomCode);
      const actor = authorize(room, input);
      if (input.op === 'hint') {
        if (room.phase !== 'playing' || room.activeId !== actor.id) throw new RuleError('Hints are available on your turn.');
        const puzzle = PUZZLES[room.round];
        const candidate = solve(puzzle, room.placed)[0]?.map((col, row) => row * puzzle.size + col).find(i => !room.placed.includes(i));
        return respond({ cell: candidate ?? null });
      }
      return respond({ room: publicRoom(room, now) });
    }
    if (input.op === 'action') {
      if (typeof input.actionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.actionId)) throw new RuleError('Invalid action identifier.');
      if (!['start', 'next', 'place', 'remove', 'heartbeat'].includes(String(input.kind))) throw new RuleError('Unknown action.');
      const command = { kind: input.kind, cell: input.cell, actionId: input.actionId } as Command;
      const room = await update(roomCode, current => {
        const actor = authorize(current, input);
        return applyCommand(current, actor.id, command, Date.now());
      });
      return respond({ room: publicRoom(room, Date.now()) });
    }
    throw new RuleError('Unknown request.');
  } catch (error) {
    if (error instanceof RuleError) return respond({ error: error.message }, error.status);
    console.error('Game request failed', error);
    return respond({ error: 'The pond is temporarily unavailable. Please try again.' }, 500);
  }
}
