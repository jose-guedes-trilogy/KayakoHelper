// scripts/copy-public.mjs
// Copies selected public assets into dist so manifest references stay valid.
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest) {
    if (!fs.existsSync(src)) return false;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    console.log(`[copy-public] ${path.basename(src)} -> ${path.relative(root, dest)}`);
    return true;
}

ensureDir(distDir);

const filesToCopy = [
    'clerkTokenBridge.js',
    'tagCleanerInjector.js',
];

let copied = 0;
for (const name of filesToCopy) {
    const src = path.join(publicDir, name);
    const dest = path.join(distDir, name);
    if (copyIfExists(src, dest)) copied += 1;
}

if (copied === 0) {
    console.log('[copy-public] No public assets copied (none found).');
}


