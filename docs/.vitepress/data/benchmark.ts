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
  date: '2026-10-10',
  cpu: 'Intel Core Ultra 7 255H',
  cores: 8,
  environment: 'WSL2',
  tool: 'bombardier',
  connections: 128,
  duration: '15s',
  runs: [
    { id: 'hit', path: '/hot', rps: 141972, p50: 0.75, p99: 3.12 },
    { id: 'limited', path: '/limited', rps: 145048, p50: 0.73, p99: 3.00 },
    { id: 'missing', path: '/nope', rps: 103161, p50: 1.02, p99: 4.15 },
  ] satisfies LoadRun[],
  clicks: { served: 2129275, counted: 2129275 },
  // go test -bench, per operation.
  micro: { redirectNs: 608.0, cacheHitNs: 108.4, recordClickNs: 92.09 },
  imageMB: 25.6,
};
