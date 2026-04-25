// Bundles src/extension.ts into dist/extension.js for VS Code to load.
// VS Code can't import bare-spec workspace packages — esbuild inlines them.
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const config = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',                // VS Code loads the extension as CommonJS
  platform: 'node',
  target: 'node20',
  external: ['vscode'],         // provided by VS Code at runtime
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
} else {
  await esbuild.build(config);
}
