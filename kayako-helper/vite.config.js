// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        emptyOutDir: true,          // wipe previous outputs
        outDir: 'dist',

        rollupOptions: {
            /* 1️⃣  main entry = your content script */
            input: 'src/contentScript.js',

            /* 2️⃣  JS output – one file, IIFE format */
            output: {
                format: 'iife',
                entryFileNames: 'content.js'
            }
        }
    }
});
