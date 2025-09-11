// scripts/package-extension.mjs
// Creates a minimal, shareable extension bundle without node_modules.
// - Copies manifest.json, icons/, images/, and dist/ (excluding .map files)
// - Writes output to release/extension/
// - Produces release/kayako-helper.zip

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const paths = {
    root: ROOT,
    manifest: path.join(ROOT, 'manifest.json'),
    dist: path.join(ROOT, 'dist'),
    icons: path.join(ROOT, 'icons'),
    images: path.join(ROOT, 'images'),
    releaseDir: path.join(ROOT, 'release', 'extension'),
    releaseRoot: path.join(ROOT, 'release'),
    zipPath: path.join(ROOT, 'release', 'kayako-helper.zip'),
};

function log(msg) {
    // Abundant logs to aid debugging if packaging fails
    console.log(`[package-extension] ${msg}`);
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function copyFileSync(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function copyDirSync(srcDir, destDir, opts = {}) {
    const { filter } = opts; // filter(filePathRelativeFromSrc) => boolean
    if (!fs.existsSync(srcDir)) return;
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const rel = path.relative(srcDir, srcPath);
        if (filter && !filter(rel)) continue;
        const destPath = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath, { filter: (subRel) => (filter ? filter(path.join(entry.name, subRel)) : true) });
        } else if (entry.isFile()) {
            ensureDir(path.dirname(destPath));
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function rimrafSync(target) {
    if (!fs.existsSync(target)) return;
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(target)) {
            rimrafSync(path.join(target, entry));
        }
        fs.rmdirSync(target);
    } else {
        fs.unlinkSync(target);
    }
}

async function zipDirToFile(srcDir, zipFilePath) {
    const zip = new JSZip();

    function addDirToZip(currentDir, zipFolder) {
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                const sub = zipFolder.folder(entry.name);
                addDirToZip(fullPath, sub);
            } else if (entry.isFile()) {
                const data = fs.readFileSync(fullPath);
                zipFolder.file(entry.name, data);
            }
        }
    }

    addDirToZip(srcDir, zip.folder(''));
    const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    ensureDir(path.dirname(zipFilePath));
    fs.writeFileSync(zipFilePath, content);
}

async function main() {
    log('Starting packaging');

    // Preconditions
    if (!fs.existsSync(paths.manifest)) {
        console.error('manifest.json not found. Aborting.');
        process.exitCode = 1;
        return;
    }
    if (!fs.existsSync(paths.dist)) {
        console.error('dist/ not found. Build first. Aborting.');
        process.exitCode = 1;
        return;
    }

    // Clean release dir and zip
    if (fs.existsSync(paths.releaseDir)) {
        log('Cleaning previous release directory');
        rimrafSync(paths.releaseDir);
    }
    ensureDir(paths.releaseDir);

    if (fs.existsSync(paths.zipPath)) {
        log('Removing previous zip');
        fs.unlinkSync(paths.zipPath);
    }

    // Copy manifest
    log('Copying manifest.json');
    copyFileSync(paths.manifest, path.join(paths.releaseDir, 'manifest.json'));

    // Copy icons
    if (fs.existsSync(paths.icons)) {
        log('Copying icons/');
        copyDirSync(paths.icons, path.join(paths.releaseDir, 'icons'));
    } else {
        log('icons/ not found, skipping');
    }

    // Copy images (if present / referenced via web_accessible_resources)
    if (fs.existsSync(paths.images)) {
        log('Copying images/');
        copyDirSync(paths.images, path.join(paths.releaseDir, 'images'));
    } else {
        log('images/ not found, skipping');
    }

    // Copy dist without source maps to keep the bundle small
    log('Copying dist/ (excluding .map files)');
    copyDirSync(paths.dist, path.join(paths.releaseDir, 'dist'), {
        filter: (rel) => !rel.endsWith('.map'),
    });

    // Create zip
    log('Creating zip archive');
    await zipDirToFile(paths.releaseDir, paths.zipPath);
    const distSize = folderSize(paths.releaseDir);
    const zipSize = fs.statSync(paths.zipPath).size;
    log(`Done. Release folder size: ${formatBytes(distSize)}; Zip size: ${formatBytes(zipSize)}`);
}

function folderSize(dir) {
    let total = 0;
    if (!fs.existsSync(dir)) return total;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += folderSize(full);
        else total += fs.statSync(full).size;
    }
    return total;
}

function formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

main().catch((err) => {
    console.error('[package-extension] Failed:', err);
    process.exitCode = 1;
});


