import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor');
const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');
const pretendard = path.join(root, 'node_modules', 'pretendard', 'dist');
const fontTarget = path.join(vendor, 'pretendard');

await mkdir(fontTarget, { recursive: true });
await Promise.all([
  ...['cmaps', 'iccs', 'standard_fonts', 'wasm', 'LICENSE'].map((name) =>
    cp(path.join(pdfjs, name), path.join(vendor, name), { recursive: true })),
  ...['pdf.mjs', 'pdf.worker.mjs'].map((name) =>
    cp(path.join(pdfjs, 'build', name), path.join(vendor, name))),
  cp(path.join(pretendard, 'LICENSE.txt'), path.join(fontTarget, 'LICENSE.txt')),
  cp(path.join(pretendard, 'web', 'variable', 'woff2', 'PretendardVariable.woff2'),
    path.join(fontTarget, 'PretendardVariable.woff2')),
]);
