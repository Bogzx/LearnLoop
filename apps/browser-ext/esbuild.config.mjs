// Bundles src/content.ts into dist/content.js as a single IIFE the browser
// loads as the only content script. Mirrors apps/vscode-ext/esbuild.config.mjs
// in style; differences are platform=browser, format=iife, and a tiny manifest
// copy step so `dist/` is the directory you load unpacked into Chrome.
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const distDir = resolve(__dirname, 'dist');
await mkdir(distDir, { recursive: true });

const config = {
  entryPoints: [resolve(__dirname, 'src/content.ts')],
  bundle: true,
  outfile: resolve(distDir, 'content.js'),
  format: 'iife',                 // content scripts are not ESM
  platform: 'browser',
  target: ['chrome120'],          // pinned demo Chrome (spec §19)
  sourcemap: !production ? 'inline' : false,
  minify: production,
  legalComments: 'none',
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
};

async function copyManifest() {
  await copyFile(
    resolve(__dirname, 'manifest.json'),
    resolve(distDir, 'manifest.json'),
  );
}

await copyManifest();

if (watch) {
  const ctx = await esbuild.context({
    ...config,
    plugins: [
      {
        name: 'manifest-copy',
        setup(build) {
          build.onEnd(() => copyManifest().catch(() => {}));
        },
      },
    ],
  });
  await ctx.watch();
} else {
  await esbuild.build(config);
}
