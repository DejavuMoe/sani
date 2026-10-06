// Build-time facts for the status page: the sync check's results, counts
// taken from the source tree, and the pinned toolchain. In `vitepress dev`
// the page updates as soon as a watched file changes.

import { runChecks, type Check } from '../sync/check.ts';
import { latestVersion, stats, versions, type Stats, type Versions } from '../sync/source.ts';

export interface Status {
  checks: Check[];
  stats: Stats;
  versions: Versions;
  builtAt: string;
  latestVersion: string;
}

declare const data: Status;
export { data };

export default {
  watch: [
    '../../../internal/**/*.go',
    '../../../cmd/**/*.go',
    '../../../web/src/**/*',
    '../../../web/e2e/**/*.ts',
    '../../../web/public/favicon.svg',
    '../../../README*.md',
    '../../../compose.yaml',
    '../../../deploy/*',
    '../../../mise.toml',
    '../../../go.mod',
    '../../../pnpm-workspace.yaml',
    '../../../*/package.json',
    '../../**/*.md',
  ],
  load(): Status {
    return { checks: runChecks(), stats: stats(), versions: versions(), builtAt: new Date().toISOString(), latestVersion: latestVersion() };
  },
};
