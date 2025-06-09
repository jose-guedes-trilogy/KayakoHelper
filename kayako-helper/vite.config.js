// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [dts()],
    build: {
        emptyOutDir: true,          // wipe previous outputs
        outDir: 'dist',

        rollupOptions: {
            /* 1️⃣  main entry = your content script */
            input: 'src/contentScript.ts',

            /* 2️⃣  JS output – one file, IIFE format */
            output: {
                format: 'iife',
                entryFileNames: 'content.js'
            }
        }
    }
});
