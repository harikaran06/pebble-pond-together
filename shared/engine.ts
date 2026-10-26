import { PUZZLES, solve } from './puzzles.ts';

export type Player = { id: string; name: string; tokenHash: string; joinedAt: number; lastSeen: number };
export type Phase = 'lobby' | 'playing' | 'intermission' | 'finished';
export type Room = {
  code: string; version: number; createdAt: number; expiresAt: number; phase: Phase;
  players: Player[]; hostId: string; activeId: string; round: number;
  placed: number[]; score: number; awarded: string[]; bonuses: number[];
  finalBonus: boolean; recentActions: string[];
};
export type Command =
  | { kind: 'start' | 'next'; actionId: string }
  | { kind: 'place' | 'remove'; cell: number; actionId: string }
  | { kind: 'heartbeat'; actionId: string };

export class RuleError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
export const GRACE_MS = 30_000;
export const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function createRoom(code: string, creator: Player, now: number): Room {
  return { code, version: 0, createdAt: now, expiresAt: now + ROOM_LIFETIME_MS,
    phase: 'lobby', players: [creator], hostId: creator.id, activeId: creator.id,
    round: 0, placed: [], score: 0, awarded: [], bonuses: [], finalBonus: false, recentActions: [] };
}

export function joinRoom(room: Room, player: Player): Room {
  if (room.phase !== 'lobby') throw new RuleError('This game has already started.');
  if (room.players.length >= 8) throw new RuleError('This room is full.');
  if (room.players.some(p => p.id === player.id)) throw new RuleError('Please reconnect to your existing seat.');
  return { ...room, version: room.version + 1, players: [...room.players, player] };
}

function nextActive(players: Player[], currentId: string, now: number): string {
  const current = players.findIndex(p => p.id === currentId);
  for (let offset = 1; offset <= players.length; offset++) {
    const p = players[(current + offset + players.length) % players.length];
    if (now - p.lastSeen <= GRACE_MS) return p.id;
  }
  return currentId;
}

export function reconcile(room: Room, now: number): Room {
  const online = (id: string) => room.players.some(p => p.id === id && now - p.lastSeen <= GRACE_MS);
  const hostId = online(room.hostId) ? room.hostId : (room.players.find(p => online(p.id))?.id ?? room.hostId);
  const activeId = room.phase === 'playing' && !online(room.activeId)
    ? nextActive(room.players, room.activeId, now) : room.activeId;
  return hostId === room.hostId && activeId === room.activeId ? room : { ...room, hostId, activeId };
}

export function applyCommand(room: Room, actorId: string, command: Command, now: number): Room {
  if (now >= room.expiresAt) throw new RuleError('This room has expired.', 410);
  if (!room.players.some(p => p.id === actorId)) throw new RuleError('You are not in this room.', 403);
  if (room.recentActions.includes(command.actionId)) return room;
  let next = reconcile(room, now);
  if (command.kind === 'heartbeat') {
    next = { ...next, players: next.players.map(p => p.id === actorId ? { ...p, lastSeen: now } : p) };
    // Reconnecting players become eligible on their next turn; refresh host if needed.
    next = reconcile(next, now);
  } else if (command.kind === 'start') {
    if (next.phase !== 'lobby' || actorId !== next.hostId || next.players.length < 2)
      throw new RuleError('The host can start once at least two players have joined.');
    next = { ...next, phase: 'playing', activeId: next.players[0].id };
  } else if (command.kind === 'next') {
    if (next.phase !== 'intermission' || actorId !== next.hostId) throw new RuleError('Only the host can start the next round.');
    next = { ...next, phase: 'playing', round: next.round + 1, placed: [],
      activeId: nextActive(next.players, next.activeId, now) };
  } else {
    if (next.phase !== 'playing' || actorId !== next.activeId) throw new RuleError('Wait for your turn.');
    const puzzle = PUZZLES[next.round];
    const cell = 'cell' in command ? command.cell : -1;
    if (!Number.isInteger(cell) || cell < 0 || cell >= puzzle.size * puzzle.size) throw new RuleError('Choose a cell on the board.');
    if (command.kind === 'place') {
      if (next.placed.includes(cell)) throw new RuleError('That cell already has a pebble.');
      const proposed = [...next.placed, cell];
      if (solve(puzzle, proposed).length === 0) throw new RuleError('That spot would block the pond. Try another cell.');
      const pointKey = `${next.round}:${cell}`;
      const firstCredit = !next.awarded.includes(pointKey);
      next = { ...next, placed: proposed, awarded: firstCredit ? [...next.awarded, pointKey] : next.awarded,
        score: next.score + (firstCredit ? 10 : 0) };
      if (proposed.length === puzzle.size) {
        next = { ...next, bonuses: [...next.bonuses, next.round], score: next.score + 50,
          phase: next.round === PUZZLES.length - 1 ? 'finished' : 'intermission' };
        if (next.phase === 'finished') next = { ...next, finalBonus: true, score: next.score + 100 };
      }
    } else {
      if (!next.placed.includes(cell)) throw new RuleError('There is no pebble to remove there.');
      next = { ...next, placed: next.placed.filter(i => i !== cell) };
    }
    if (next.phase === 'playing') next = { ...next, activeId: nextActive(next.players, actorId, now) };
  }
  return { ...next, version: room.version + 1,
    recentActions: command.kind === 'heartbeat' ? room.recentActions : [...room.recentActions, command.actionId] };
}

export function publicRoom(room: Room, now: number) {
  return { code: room.code, version: room.version, phase: room.phase, hostId: room.hostId,
    activeId: room.activeId, round: room.round, placed: room.placed, score: room.score,
    maxScore: 400, expiresAt: room.expiresAt,
    players: room.players.map(({ id, name, lastSeen }) => ({ id, name, online: now - lastSeen <= GRACE_MS })) };
}
