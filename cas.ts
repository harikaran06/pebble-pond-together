import type { Room } from './engine.ts';
import { RuleError } from './engine.ts';

export type RoomStore = {
  getWithMetadata(key: string, options: { type: 'json'; consistency: 'strong' }): Promise<{ data: Room | null; etag: string } | null>;
  setJSON(key: string, room: Room, options: { onlyIfMatch: string }): Promise<{ modified: boolean }>;
};

export async function updateWithCAS(store: RoomStore, code: string, transform: (room: Room) => Room,
  now = () => Date.now()): Promise<Room> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const entry = await store.getWithMetadata(code, { type: 'json', consistency: 'strong' });
    if (!entry?.data) throw new RuleError('Room not found. Check the code.', 404);
    if (now() >= entry.data.expiresAt) throw new RuleError('This room has expired.', 410);
    const changed = transform(entry.data);
    if (changed === entry.data) return entry.data;
    if ((await store.setJSON(code, changed, { onlyIfMatch: entry.etag })).modified) return changed;
  }
  throw new RuleError('The room is busy. Refresh and try again.', 409);
}
