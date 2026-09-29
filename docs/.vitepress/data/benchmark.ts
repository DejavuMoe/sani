// The latest `make load` and `make bench` results. This is the one place the
// numbers live: the home page and the performance page render them, and the
// sync check requires both READMEs to quote the same figures.
//
// After a new run, update this file and the README tables together.

export interface LoadRun {
  id: 'hit' | 'limited' | 'missing';
  path: string;
  rps: number;
  p50: number; // ms
  p99: number; // ms
}

export const benchmark = {
  date: '2026-09-29',
  cpu: 'Intel Core Ultra 7 255H',
  cores: 8,
  environment: 'WSL2',
  tool: 'bombardier',
  connections: 128,
  duration: '15s',
  runs: [
    { id: 'hit', path: '/hot', rps: 131075, p50: 0.8, p99: 3.43 },
    { id: 'limited', path: '/limited', rps: 129448, p50: 0.81, p99: 3.44 },
    { id: 'missing', path: '/nope', rps: 83746, p50: 1.24, p99: 5.29 },
  ] satisfies LoadRun[],
  clicks: { served: 1965880, counted: 1965880 },
  // go test -bench, per operation.
  micro: { redirectNs: 424.8, cacheHitNs: 72.66, recordClickNs: 70.03 },
  imageMB: 24.4,
};
