// Every page goes up as a JPEG with its long edge at most 1600 px (A-6). Doing this here,
// on the desk's computer, keeps native image and PDF libraries out of Lambda.

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import sharp from 'sharp';

export const MAX_PAGES = 4;
const MAX_EDGE = 1600;

async function toJpeg(input: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(input)
    .rotate() // respect the camera's orientation
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function renderPdfPages(file: string): Promise<Uint8Array[]> {
  // mupdf is a WebAssembly build, loaded only when a PDF is uploaded.
  const mupdf = await import('mupdf');
  const document = mupdf.Document.openDocument(await readFile(file), 'application/pdf');
  const pages: Uint8Array[] = [];
  for (let i = 0; i < Math.min(document.countPages(), MAX_PAGES); i += 1) {
    const pixmap = document.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    pages.push(pixmap.asPNG());
  }
  return pages;
}

/** Turns one input file (JPEG, PNG or PDF) into one or more normalized JPEG pages. */
export async function normalizeFile(file: string): Promise<Buffer[]> {
  const ext = extname(file).toLowerCase();
  if (ext === '.pdf') return Promise.all((await renderPdfPages(file)).map(toJpeg));
  if (['.jpg', '.jpeg', '.png'].includes(ext)) return [await toJpeg(await readFile(file))];
  throw new Error(`${file}: only JPEG, PNG and PDF files are supported`);
}
