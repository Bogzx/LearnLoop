// Bundles src/content.ts → dist/content.js (the content script Chrome
// loads on claude.ai pages) and src/popup/popup.ts → dist/popup.js (the
// browser-action popup logic). Also copies manifest.json and popup.html
// straight into dist/ so `dist/` is the directory you load unpacked.
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const distDir = resolve(__dirname, 'dist');
await mkdir(distDir, { recursive: true });

const baseConfig = {
  bundle: true,
  format: 'iife',                 // content scripts and popup scripts are not ESM
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

const contentConfig = {
  ...baseConfig,
  entryPoints: [resolve(__dirname, 'src/content.ts')],
  outfile: resolve(distDir, 'content.js'),
};

const popupConfig = {
  ...baseConfig,
  entryPoints: [resolve(__dirname, 'src/popup/popup.ts')],
  outfile: resolve(distDir, 'popup.js'),
};

async function copyStaticAssets() {
  await copyFile(
    resolve(__dirname, 'manifest.json'),
    resolve(distDir, 'manifest.json'),
  );
  await copyFile(
    resolve(__dirname, 'src/popup/popup.html'),
    resolve(distDir, 'popup.html'),
  );
}

await copyStaticAssets();

if (watch) {
  const ctxContent = await esbuild.context({
    ...contentConfig,
    plugins: [
      {
        name: 'static-copy',
        setup(build) {
          build.onEnd(() => copyStaticAssets().catch(() => {}));
        },
      },
    ],
  });
  const ctxPopup = await esbuild.context(popupConfig);
  await ctxContent.watch();
  await ctxPopup.watch();
} else {
  await Promise.all([esbuild.build(contentConfig), esbuild.build(popupConfig)]);
}
