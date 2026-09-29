import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Go binary embeds this directory. It keeps a committed .gitkeep so
// the Go build works before the frontend has ever been built.
const outDir = fileURLToPath(new URL('../internal/webui/dist', import.meta.url));

function embedOutput(): Plugin {
  const compressible = /\.(js|css|html|svg|json|webmanifest|txt)$/;
  const walk = (dir: string, fn: (path: string) => void) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, fn);
      else fn(path);
    }
  };
  return {
    name: 'sani-embed-output',
    apply: 'build',
    buildStart() {
      mkdirSync(outDir, { recursive: true });
      for (const name of readdirSync(outDir)) {
        if (name !== '.gitkeep') rmSync(join(outDir, name), { recursive: true, force: true });
      }
    },
    closeBundle() {
      // Precompress once at build time; the server picks the variant per request.
      walk(outDir, (path) => {
        if (!compressible.test(path)) return;
        const data = readFileSync(path);
        if (data.length < 1024) return;
        writeFileSync(`${path}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${path}.gz`, gzipSync(data, { level: 9 }));
      });
    },
  };
}

export default defineConfig({
  base: '/admin/',
  plugins: [svelte(), embedOutput()],
  build: {
    outDir,
    emptyOutDir: false,
    target: 'es2022',
    assetsInlineLimit: 0,
    reportCompressedSize: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
});
