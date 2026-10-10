import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

declare const data: Record<string, string>;
export { data };

export default {
  watch: ['../../public/screenshots/*.png'],
  load(): Record<string, string> {
    const directory = new URL('../../public/screenshots/', import.meta.url);
    return Object.fromEntries(readdirSync(directory).filter(name => name.endsWith('.png')).map(name => [
      name, createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex').slice(0, 12),
    ]));
  },
};
