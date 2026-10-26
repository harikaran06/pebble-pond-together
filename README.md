# Pebble Pond: Together

A cooperative, turn-based puzzle game for 2–8 players on separate devices. Create a six-character room code, share the link, and solve three ponds together.

## Rules

- Place exactly one pebble in each row, column, and lettered colored region.
- Pebbles in adjacent rows cannot touch diagonally (their columns must differ by at least two).
- The active player drafts a placement or removal. Undo clears the draft. Confirm sends it to the server; only an accepted action advances the turn.
- A placement is accepted only if the board remains solvable. Invalid attempts do not change the board, turn, or score. A hint points to one available cell without a penalty.
- Correct cells earn 10 points **once per cell**. Completing each round earns 50. Completing all three earns another 100. Maximum: **400**.

Boards are 4×4 Little Pond, 5×5 Lily Garden, and 6×6 Moonlight Pond. All lettered regions are connected. `npm test` exhaustively verifies one solution for each board. Board definitions live in `shared/puzzles.ts`.

## Architecture

- React, TypeScript, Vite, Tailwind CSS frontend, deployed as Netlify static files.
- One Netlify Function at `/api/game` for create, join, state, hint, and authorized actions.
- One **site-wide** Netlify Blobs record per room. Every read is strongly consistent. Mutations compare the read ETag with `onlyIfMatch`; a losing writer reloads and revalidates. Creation uses `onlyIfNew`.
- Client polls every 1.5 seconds and sends an eight-second heartbeat. After a 30-second absence, a heartbeat from another player can skip an inactive turn and transfer host duties. Browser background throttling or poor networks can delay updates.
- Each player has a private 256-bit reconnect token stored in that browser's local storage. The room code alone does not grant permission to mutate game state. Server responses omit token hashes.
- Room access expires after 24 hours. Expired blobs are not automatically deleted; clean old records manually if storage growth matters for your deployment.

There is no continuously running backend or external database. Netlify Functions and Blobs are invoked on demand. Netlify Dev's local Blobs sandbox omits ETags on some reads, so the Function falls back to an exact-key listing for the version; the conditional write still rejects a stale version. Run the deployed concurrency check before sharing the public URL.

## Run locally

Requires Node.js 20.19+ (Node.js 24 recommended).

```bash
npm ci
npm test
npx netlify dev --offline
```

Open `http://localhost:8888`. Use **Netlify Dev**, rather than plain `npm run dev`, to serve both the frontend and Function.

## Verification

```bash
npm run build
npm test
npm run test:api
npx playwright install chromium
npm run test:browser
```

`test:api` starts Netlify Dev and exercises two independent player credentials, room join, simultaneous moves, score, and all three rounds. `test:browser` uses two independent Chromium contexts and checks visible synchronization and refresh recovery. Browser installation is required separately. These local tests use a sandboxed Blobs store. Repeat the two-device flow on the deployed URL, particularly simultaneous turns and reconnect.

## Deploy on Netlify

1. Extract the ZIP. Connect the source directory through a Git repository in Netlify, or run `npx netlify login` and `npx netlify deploy --build --prod` from that directory. Netlify reads `netlify.toml`: build command `npm run build`, publish directory `dist`, Functions directory `netlify/functions`. Dragging the source ZIP onto Netlify Drop does not build its Function.
2. No API keys or external service setup are required. Keep the room store site-wide so active rooms survive deploys.
3. Visit the live HTTPS URL from two separate devices. Create, join, play all three rounds, refresh one device, and verify the shared 400-point victory. Only report the mission as deployed once the URL and this test succeed.

This project has not been published to a public URL by the source package alone.
