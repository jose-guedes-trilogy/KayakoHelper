/* vite.config.ts
   – Now with SCSS support + stable content.css
   – plus popup bundling + static-copy of popup.html
*/

import { defineConfig, UserConfig } from 'vite';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
    plugins: [
        // copy popup.html into dist so Chrome can find it
        viteStaticCopy({
            targets: [{ src: 'src/popup/popup.html', dest: '.' }],
        })
    ],

    esbuild: {
        charset: 'ascii',
    },

    /* SCSS setup (variables, mixins, etc.) */
    css: {
        preprocessorOptions: {
            scss: {
                additionalData: `@use "@/styles/variables" as *;`,
                quietDeps: true,
            },
        },
    },

    build: {
        outDir: 'dist',
        cssCodeSplit: false,  // single content.css

        rollupOptions: {
            // our three entry points
            input: {
                content:    path.resolve(__dirname, 'src/contentScript.ts'),
                background: path.resolve(__dirname, 'src/backgroundScript.ts'),
                popup:       path.resolve(__dirname, 'src/popup/popup.ts'),
            },
            output: {
                // content.js + other named JS, plus content.css
                entryFileNames: ({ name }) =>
                    name === 'content' ? 'content.js' : '[name].js',
                chunkFileNames: '[name].js',
                assetFileNames: (info) =>
                    info.name && info.name.endsWith('.css')
                        ? 'content.css'
                        : '[name][extname]',
            },
        },
    },

    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
} as UserConfig);
