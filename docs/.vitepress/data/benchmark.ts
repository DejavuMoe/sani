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
  date: '2026-10-06',
  cpu: 'Intel Core Ultra 7 255H',
  cores: 8,
  environment: 'WSL2',
  tool: 'bombardier',
  connections: 128,
  duration: '15s',
  runs: [
    { id: 'hit', path: '/hot', rps: 137958, p50: 0.77, p99: 3.06 },
    { id: 'limited', path: '/limited', rps: 141450, p50: 0.73, p99: 3.10 },
    { id: 'missing', path: '/nope', rps: 104176, p50: 1.00, p99: 4.05 },
  ] satisfies LoadRun[],
  clicks: { served: 2069251, counted: 2069251 },
  // go test -bench, per operation.
  micro: { redirectNs: 375.3, cacheHitNs: 76.42, recordClickNs: 76.33 },
  imageMB: 24.7,
};
