/* vite.config.ts
   – SCSS support + stable content.css
   – popup bundling + static-copy of popup.html
*/
import { defineConfig, UserConfig } from 'vite';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { execSync } from 'node:child_process';

execSync('node src/selectors/build-selectors.mjs', { stdio: 'inherit' });

export default defineConfig({
    plugins: [
        // copy popup.html into dist so Chrome can find it
        viteStaticCopy({
            targets: [{ src: 'src/popup/popup.html', dest: '.' }],
        }),
    ],

    esbuild: {
        charset: 'ascii',
        keepNames: true,           // ↳ functions & classes
        minifyIdentifiers: false,  // ↳ local variables
    },

    /* ─ SCSS setup ─ */
    css: {
        preprocessorOptions: {
            scss: {
                additionalData: `@use "@/styles/variables" as *;`,
                quietDeps: true,
            },
        },
    },

    build: {
        minify: false,             // a) stop mangling / compressing
        sourcemap: true,           // b) emit source-maps next to every js/css file
        outDir: 'dist',
        cssCodeSplit: false,       // single content.css

        rollupOptions: {
            /* entry points */
            input: {
                contentKayako:  path.resolve(__dirname, 'src/contentScriptKayako.ts'),
                contentChatGPT: path.resolve(__dirname, 'src/contentScriptChatGPT.ts'),
                contentGemini:  path.resolve(__dirname, 'src/contentScriptGemini.ts'),
                contentEphor:   path.resolve(__dirname, 'src/contentScriptEphor.ts'),
                background:     path.resolve(__dirname, 'src/backgroundScript.ts'),
                popup:          path.resolve(__dirname, 'src/popup/popup.ts'),
                promptInserter: path.resolve(__dirname, 'src/inject/promptInserter.ts'),
            },

            /* output */
            output: {
                entryFileNames: ({ name }) =>
                    name === 'contentKayako' ? 'contentKayako.js'
                        : name === 'contentGemini' ? 'contentGemini.js'
                            : name === 'background'   ? 'background.js'
                                :                           '[name].js',

                chunkFileNames: '[name].js',
                assetFileNames: (info) =>
                    info.name && info.name.endsWith('.css')
                        ? 'content.css'
                        : '[name][extname]'
            },
        },
    },

    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
} as UserConfig);
