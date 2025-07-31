import { defineConfig, UserConfig } from 'vite';
import path from 'path';

const root = path.resolve(__dirname, '..');

export default defineConfig({
    root,
    plugins: [],
    esbuild: {
        charset: 'ascii',
        keepNames: true,
        minifyIdentifiers: false,
    },
    css: {
        preprocessorOptions: {
            scss: {
                additionalData: `@use "@/styles/variables" as *;`,
                quietDeps: true,
            },
        },
    },
    build: {
        emptyOutDir: false,
        minify: false,
        sourcemap: true,
        outDir: 'dist',
        cssCodeSplit: false,
        rollupOptions: {
            input: path.resolve(root, 'src/backgroundScript.ts'),
            preserveEntrySignatures: 'exports-only',
            manualChunks: () => undefined,
            output: {
                entryFileNames: 'background.js',
                inlineDynamicImports: true,
                chunkFileNames: '[name].js',
                assetFileNames: i =>
                    i.name?.endsWith('.css') ? 'content.css' : '[name][extname]',
                format: 'es',
            },
        },
    },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
} as UserConfig);
