// Side-effect import: loads .env from cwd or repo root before any other
// module reads process.env. Other modules import this FIRST so DB/Gemini
// pools see the variables at module-init time.
//
// Railway injects vars natively; in that case neither file exists and this
// is a no-op.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

for (const candidate of ['.env', '../../.env', '../../../.env']) {
  const p = resolve(process.cwd(), candidate);
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}
