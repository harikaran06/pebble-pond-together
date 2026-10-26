export type Puzzle = { name: string; size: number; regions: string[] };

// Every same-letter region is orthogonally connected. The answer is derived by the server-side solver.
export const PUZZLES: Puzzle[] = [
  { name: 'Little Pond', size: 4, regions: ['BCDD', 'BCCD', 'BBDD', 'AAAA'] },
  { name: 'Lily Garden', size: 5, regions: ['EEEED', 'EBDDD', 'EBBBD', 'BBACC', 'BAACC'] },
  { name: 'Moonlight Pond', size: 6, regions: ['BBBFFF', 'BBBFFF', 'BEEFFA', 'CCEEAA', 'CCDAAA', 'DDDAAA'] }
];

export function solve(p: Puzzle, placed: number[] = []): number[][] {
  const answers: number[][] = [];
  const usedColumns = new Set<number>();
  const usedRegions = new Set<string>();
  const selected = Array<number>(p.size).fill(-1);
  const fixed = new Map<number, number>();
  for (const cell of placed) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= p.size * p.size) return [];
    const row = Math.floor(cell / p.size), col = cell % p.size;
    if (fixed.has(row) && fixed.get(row) !== col) return [];
    fixed.set(row, col);
  }
  function visit(row: number) {
    if (row === p.size) { answers.push([...selected]); return; }
    for (let col = 0; col < p.size; col++) {
      if (fixed.has(row) && fixed.get(row) !== col) continue;
      const region = p.regions[row][col];
      if (usedColumns.has(col) || usedRegions.has(region)) continue;
      if (row > 0 && Math.abs(selected[row - 1] - col) <= 1) continue;
      selected[row] = col; usedColumns.add(col); usedRegions.add(region);
      visit(row + 1);
      usedColumns.delete(col); usedRegions.delete(region);
    }
  }
  visit(0);
  return answers;
}

export function validatePuzzle(p: Puzzle): string[] {
  const errors: string[] = [];
  const n = p.size;
  if (p.regions.length !== n || p.regions.some(row => row.length !== n)) return ['Board dimensions are invalid'];
  const labels = new Set(p.regions.join(''));
  if (labels.size !== n) errors.push(`Expected ${n} regions, found ${labels.size}`);
  for (const label of labels) {
    const cells = Array.from({ length: n * n }, (_, i) => i).filter(i => p.regions[Math.floor(i / n)][i % n] === label);
    const reached = new Set<number>([cells[0]]), queue = [cells[0]];
    while (queue.length) {
      const i = queue.shift()!, r = Math.floor(i / n), c = i % n;
      for (const [rr, cc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
        const j = rr * n + cc;
        if (rr >= 0 && rr < n && cc >= 0 && cc < n && p.regions[rr][cc] === label && !reached.has(j)) { reached.add(j); queue.push(j); }
      }
    }
    if (reached.size !== cells.length) errors.push(`Region ${label} is disconnected`);
  }
  const solutions = solve(p);
  if (solutions.length !== 1) errors.push(`Expected one solution, found ${solutions.length}`);
  return errors;
}
