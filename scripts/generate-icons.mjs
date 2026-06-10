/**
 * Generates PWA icons from the original 2015 app icon.
 *
 *   node scripts/generate-icons.mjs
 */
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE = new URL('../app/public/images/AppIcon_circle2.png', import.meta.url).pathname;
const OUT_DIR = new URL('../app/public/icons/', import.meta.url).pathname;
const BACKGROUND = '#194650';

await mkdir(OUT_DIR, { recursive: true });

for (const size of [192, 512]) {
  await sharp(SOURCE)
    .resize(size, size, { fit: 'contain', background: BACKGROUND })
    .flatten({ background: BACKGROUND })
    .png()
    .toFile(`${OUT_DIR}icon-${size}.png`);
}

// Maskable: logo at 70% inside a brand-colored safe zone.
const inner = Math.round(512 * 0.7);
const logo = await sharp(SOURCE)
  .resize(inner, inner, { fit: 'contain', background: BACKGROUND })
  .png()
  .toBuffer();
await sharp({
  create: { width: 512, height: 512, channels: 4, background: BACKGROUND },
})
  .composite([{ input: logo, gravity: 'center' }])
  .png()
  .toFile(`${OUT_DIR}icon-512-maskable.png`);

console.log('icons written to app/public/icons/');
