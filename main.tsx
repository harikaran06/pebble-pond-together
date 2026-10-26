import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PUZZLES } from '../shared/puzzles.ts';
import './style.css';

type PublicRoom = { code: string; version: number; phase: 'lobby' | 'playing' | 'intermission' | 'finished';
  hostId: string; activeId: string; round: number; placed: number[]; score: number; maxScore: number;
  players: { id: string; name: string; online: boolean }[]; expiresAt: number };
type Session = { code: string; playerId: string; token: string };
type Draft = { kind: 'place' | 'remove'; cell: number };
const SESSION_KEY = 'pebble-pond-session-v1';

async function api(payload: Record<string, unknown>) {
  const response = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    cache: 'no-store', body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Please try again.');
  return data;
}

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
  });
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(location.search).get('room')?.toUpperCase() || '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [hint, setHint] = useState<number | null>(null);
  const pendingId = useRef<string | null>(null);
  const lastRoom = useRef<PublicRoom | null>(null);

  function receive(next: PublicRoom) {
    setRoom(old => next.version >= (old?.version ?? -1) ? next : old);
    lastRoom.current = next.version >= (lastRoom.current?.version ?? -1) ? next : lastRoom.current;
  }

  useEffect(() => {
    if (!session) return;
    let stopped = false;
    async function poll() {
      try {
        const result = await api({ op: 'state', ...session });
        if (!stopped) { receive(result.room); setMessage(old => old === 'Connection lost. Retrying…' ? '' : old); }
      } catch (error) { if (!stopped) setMessage((error as Error).message === 'Failed to fetch' ? 'Connection lost. Retrying…' : (error as Error).message); }
    }
    async function heartbeat() {
      try {
        const result = await api({ op: 'action', ...session, kind: 'heartbeat', actionId: crypto.randomUUID() });
        if (!stopped) receive(result.room);
      } catch { /* Poll displays connection status. */ }
    }
    void heartbeat(); void poll();
    const polling = window.setInterval(poll, 1500);
    const beating = window.setInterval(heartbeat, 8000);
    return () => { stopped = true; clearInterval(polling); clearInterval(beating); };
  }, [session]);

  async function enter(op: 'create' | 'join') {
    setBusy(true); setMessage('');
    try {
      const result = await api({ op, name, ...(op === 'join' ? { code: joinCode.trim().toUpperCase() } : {}) });
      const next: Session = { code: result.room.code, playerId: result.playerId, token: result.token };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next)); setSession(next); receive(result.room);
      history.replaceState(null, '', `/?room=${next.code}`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function action(kind: 'start' | 'next' | 'place' | 'remove') {
    if (!session || busy) return;
    setBusy(true); setMessage('');
    const actionId = pendingId.current ?? crypto.randomUUID();
    pendingId.current = actionId;
    try {
      const result = await api({ op: 'action', ...session, kind, actionId,
        ...((kind === 'place' || kind === 'remove') ? { cell: draft?.cell } : {}) });
      receive(result.room); setDraft(null); setHint(null); pendingId.current = null;
    } catch (error) {
      setMessage((error as Error).message);
      if ((error as Error).message !== 'Failed to fetch') pendingId.current = null;
    } finally { setBusy(false); }
  }

  async function requestHint() {
    if (!session) return;
    try { const result = await api({ op: 'hint', ...session }); setHint(result.cell); setMessage('Try the highlighted cell. Hints have no score penalty.'); }
    catch (error) { setMessage((error as Error).message); }
  }

  function choose(cell: number) {
    if (!room || room.phase !== 'playing' || room.activeId !== session?.playerId || busy) return;
    setDraft({ kind: room.placed.includes(cell) ? 'remove' : 'place', cell });
    setHint(null); setMessage(''); pendingId.current = null;
  }

  function leave() {
    localStorage.removeItem(SESSION_KEY); setSession(null); setRoom(null); setDraft(null);
    setMessage(''); history.replaceState(null, '', '/');
  }

  const isHost = session?.playerId === room?.hostId;
  const myTurn = room?.phase === 'playing' && session?.playerId === room.activeId;
  const puzzle = room ? PUZZLES[room.round] : null;
  const activeName = room?.players.find(p => p.id === room.activeId)?.name || 'a teammate';
  return <div className="app-shell">
    <header className="topbar"><div className="brand-mark">●</div><div><strong>Pebble Pond</strong><span>Together</span></div><div className="topbar-right">A little puzzle, better together</div></header>
    <main>
      {!session ? <section className="welcome card">
        <div className="eyebrow">COOPERATIVE PUZZLE · 2–8 PLAYERS</div>
        <h1>Make room for<br/><em>every pebble.</em></h1>
        <p>Share a code, take turns, and solve three ponds as one team. You can play together from different devices.</p>
        <label>Your name<input maxLength={24} value={name} onChange={e => setName(e.target.value)} placeholder="What should your team call you?" /></label>
        <button disabled={busy || !name.trim()} onClick={() => void enter('create')}>Create a pond</button>
        <div className="divider"><span>or join your friends</span></div>
        <div className="join-row"><input aria-label="Six-character room code" maxLength={6} value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="ROOM CODE"/><button className="secondary" disabled={busy || !name.trim() || joinCode.length !== 6} onClick={() => void enter('join')}>Join room</button></div>
      </section> : !room ? <section className="card welcome"><h1>Finding your pond…</h1><button className="secondary" onClick={leave}>Use another room</button></section> : <>
        <div className="room-strip"><div><span className="eyebrow">YOUR ROOM</span><strong>{room.code}</strong></div><button className="text-button" onClick={() => { void navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`).then(() => setMessage('Invite link copied.')); }}>Copy invite link</button><button className="text-button" onClick={leave}>Leave this device</button></div>
        <div className="layout"><section className="game-column">
          {room.phase === 'lobby' ? <div className="card stage-card"><div className="eyebrow">THE TEAM IS GATHERING</div><h1>Welcome to the pond.</h1><p>Share <b>{room.code}</b> with friends. The host starts when at least two players are here.</p><div className="pond-preview">● <span>●</span> ●</div>{isHost ? <button disabled={busy || room.players.length < 2} onClick={() => void action('start')}>Start the game</button> : <p className="muted">Waiting for the host to start…</p>}</div> : room.phase === 'intermission' ? <div className="card stage-card"><div className="eyebrow">ROUND {room.round + 1} COMPLETE</div><h1>Lovely teamwork!</h1><p>You completed {puzzle?.name}. The team earned a 50-point round bonus.</p><div className="big-score">{room.score} <small>/ 400 points</small></div>{isHost ? <button disabled={busy} onClick={() => void action('next')}>Begin round {room.round + 2}</button> : <p className="muted">Waiting for the host to begin the next round…</p>}</div> : room.phase === 'finished' ? <div className="card stage-card"><div className="eyebrow">ALL THREE PONDS COMPLETE</div><h1>You did it, together.</h1><p>The final 100-point teamwork bonus is included. Every pebble found its place.</p><div className="big-score">{room.score} <small>/ 400 points</small></div><button className="secondary" onClick={leave}>Create another pond</button></div> : <div className="card board-card">
            <div className="round-heading"><div><span className="eyebrow">ROUND {room.round + 1} OF 3</span><h1>{puzzle?.name}</h1></div><div className="score"><small>TEAM SCORE</small><strong>{room.score}<span> / 400</span></strong></div></div>
            <p className="turn-callout">{myTurn ? 'Your turn — choose a cell, then confirm.' : `${activeName}'s turn — watch the pond grow.`}</p>
            <div className="board" role="grid" aria-label={`${puzzle?.name} puzzle`} style={{ gridTemplateColumns: `repeat(${puzzle?.size}, 1fr)`, maxWidth: puzzle?.size === 6 ? 500 : 450 }}>
              {puzzle && Array.from({ length: puzzle.size * puzzle.size }, (_, i) => {
                const row = Math.floor(i / puzzle.size), col = i % puzzle.size, region = puzzle.regions[row][col];
                const occupied = room.placed.includes(i), selected = draft?.cell === i;
                const borders = { borderTopWidth: row === 0 || puzzle.regions[row - 1][col] !== region ? 3 : 1,
                  borderLeftWidth: col === 0 || puzzle.regions[row][col - 1] !== region ? 3 : 1,
                  borderRightWidth: col === puzzle.size - 1 || puzzle.regions[row][col + 1] !== region ? 3 : 1,
                  borderBottomWidth: row === puzzle.size - 1 || puzzle.regions[row + 1][col] !== region ? 3 : 1 };
                return <button key={i} role="gridcell" className={`cell region-${region} ${selected ? 'selected' : ''} ${hint === i ? 'hint' : ''}`} style={borders} disabled={!myTurn || busy} onClick={() => choose(i)} aria-label={`Row ${row + 1}, column ${col + 1}, region ${region}${occupied ? ', pebble present' : ', empty'}${selected ? ', selected' : ''}`} aria-selected={selected}>
                  <span className="region-label">{region}</span><span className="pebble">{(selected ? !occupied : occupied) ? '●' : ''}</span>
                </button>;
              })}
            </div>
            <div className="board-footer"><span>{room.placed.length} of {puzzle?.size} pebbles placed</span><span>Each correct pebble +10</span></div>
            {myTurn && <div className="controls"><button disabled={!draft || busy} onClick={() => void action(draft!.kind)}>{draft ? `Confirm ${draft.kind}` : 'Choose a cell'}</button><button className="secondary" disabled={!draft || busy} onClick={() => { setDraft(null); pendingId.current = null; }}>Undo draft</button><button className="text-button" onClick={() => void requestHint()}>Gentle hint</button></div>}
          </div>}
        </section><aside className="sidebar"><section className="card"><div className="eyebrow">HOW TO PLAY</div><h2>One pond, one team.</h2><ol><li>Place exactly one pebble in every <b>row</b>, <b>column</b>, and <b>lettered color region</b>.</li><li>Pebbles in neighboring rows cannot touch diagonally.</li><li>Take turns. Select a cell, undo your draft if needed, then confirm. You can remove a pebble on your turn.</li><li>Finish all three ponds together. Invalid moves cost no points.</li></ol><p className="fine-print">+10 once per correct cell · +50 per completed round · +100 final bonus = 400 maximum.</p></section>
          <section className="card"><div className="eyebrow">YOUR TEAM · {room.players.length}/8</div><div className="player-list">{room.players.map(p => <div className="player" key={p.id}><span className={`presence ${p.online ? 'online' : ''}`}/><span>{p.name}{p.id === session.playerId ? ' (you)' : ''}</span>{p.id === room.hostId && <small>HOST</small>}{p.id === room.activeId && room.phase === 'playing' && <small>TURN</small>}</div>)}</div></section>
        </aside></div>
      </>}
      {message && <p className="notice" role="status">{message}</p>}
    </main><footer>Good things grow when we solve them together.</footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
