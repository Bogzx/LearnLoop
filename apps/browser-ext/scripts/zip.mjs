// Packs dist/ into learnloop-browser-ext-<version>.zip, the file a GitHub
// release carries and Chrome's "Load unpacked" (after extracting) or the Web
// Store accepts. No dependencies: zip's format is small enough to write by
// hand with node:zlib (deflate + crc32, Node >= 22.2).
//
//   npm --workspace=@trailhead/browser-ext run package
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const out = process.argv[2] ?? join(root, `learnloop-browser-ext-${version}.zip`);

const walk = (dir) => readdirSync(dir).sort().flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
// Fixed DOS timestamp (1980-01-01), so the same dist/ always zips to the same bytes.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const locals = [];
const centrals = [];
let offset = 0;
for (const file of walk(dist)) {
  const name = Buffer.from(relative(dist, file).split('\\').join('/'));
  const data = readFileSync(file);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const common = [u16(20), u16(0), u16(8), u16(DOS_TIME), u16(DOS_DATE), u32(crc), u32(packed.length), u32(data.length), u16(name.length), u16(0)];
  const local = Buffer.concat([u32(0x04034b50), ...common, name, packed]);
  centrals.push(Buffer.concat([u32(0x02014b50), u16(20), ...common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
  locals.push(local);
  offset += local.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(central.length), u32(offset), u16(0)]);
writeFileSync(out, Buffer.concat([...locals, central, end]));
console.log(`wrote ${relative(process.cwd(), out)} (${centrals.length} files)`);
