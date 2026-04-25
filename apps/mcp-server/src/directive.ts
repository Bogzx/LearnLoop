// Loads the canonical coaching directive once and exports the text + URI.
// Kept in its own module so the harness, init script, and server can all
// import without triggering the server's main() side effect.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const COACHING_DIRECTIVE_TEXT: string = readFileSync(
  resolve(__dirname, 'coaching-directive.md'),
  'utf8',
);

export const COACHING_DIRECTIVE_URI = 'trailhead://coaching-directive';
