// scripts/strip-maps.mjs
// Removes all .map files from dist to reduce size
import fs from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');

function removeMaps(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            removeMaps(full);
        } else if (entry.isFile() && entry.name.endsWith('.map')) {
            try {
                fs.unlinkSync(full);
                console.log(`[strip-maps] removed ${full}`);
            } catch (e) {
                console.error(`[strip-maps] failed to remove ${full}:`, e.message);
            }
        }
    }
}

removeMaps(distDir);


