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
    build: {
        emptyOutDir: false,
        minify: false,
        sourcemap: true,
        outDir: 'dist',
        cssCodeSplit: false,
        rollupOptions: {
            input: path.resolve(root, 'src/features/aihorizons/captureRoleFromLocalStorage.ts'),
            preserveEntrySignatures: 'exports-only',
            manualChunks: () => undefined,
            output: {
                entryFileNames: 'captureAihRole.js',
                inlineDynamicImports: true,
                chunkFileNames: '[name].js',
                assetFileNames: '[name][extname]',
                format: 'es',
            },
        },
    },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
} as UserConfig);


