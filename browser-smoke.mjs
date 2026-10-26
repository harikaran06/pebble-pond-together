// Local two-context smoke test. Run with: node tests/browser-smoke.mjs
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
const port = 8899;
const server = spawn('./node_modules/.bin/netlify', ['dev', '--offline', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
server.stdout.on('data', chunk => { logs += chunk.toString(); });
server.stderr.on('data', chunk => { logs += chunk.toString(); });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null) throw new Error(`Netlify Dev exited: ${logs}`);
    try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { ready = true; break; } } catch { /* Still starting. */ }
    await delay(1000);
  }
  if (!ready) throw new Error(`Netlify Dev did not start: ${logs}`);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const creator = await browser.newContext();
  const joiner = await browser.newContext();
  const a = await creator.newPage(), b = await joiner.newPage();
  await a.goto(`http://127.0.0.1:${port}/`);
  await a.getByPlaceholder('What should your team call you?').fill('Alice');
  await a.getByRole('button', { name: 'Create a pond' }).click();
  await a.getByText('Welcome to the pond.').waitFor({ timeout: 20_000 });
  const code = new URL(a.url()).searchParams.get('room');
  if (!code) throw new Error('Creator did not receive a room code.');
  await b.goto(`http://127.0.0.1:${port}/?room=${code}`);
  await b.getByPlaceholder('What should your team call you?').fill('Bob');
  await b.getByRole('button', { name: 'Join room' }).click();
  await b.getByText('Welcome to the pond.').waitFor({ timeout: 20_000 });
  await a.getByText('Bob').waitFor({ timeout: 15_000 });
  await a.getByRole('button', { name: 'Start the game' }).click();
  await b.getByText('Little Pond').waitFor({ timeout: 15_000 });
  await a.getByRole('gridcell', { name: /Row 1, column 2/ }).click();
  await a.getByRole('button', { name: 'Confirm place' }).click();
  await b.getByText('1 of 4 pebbles placed').waitFor({ timeout: 15_000 });
  await b.getByRole('gridcell', { name: /Row 2, column 4/ }).click();
  await b.getByRole('button', { name: 'Confirm place' }).click();
  await a.getByText('2 of 4 pebbles placed').waitFor({ timeout: 15_000 });
  await b.reload();
  await b.getByText('2 of 4 pebbles placed').waitFor({ timeout: 15_000 });
  console.log(`PASS: two independent browser contexts joined ${code}, synchronized two turns, and reconnected after refresh.`);
} catch (error) {
  console.error('FAIL:', error.message);
  console.error(logs.slice(-4000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
