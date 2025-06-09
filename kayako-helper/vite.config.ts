// vite.config.ts
import { defineConfig, UserConfig } from 'vite';
import path from 'path';

const config: UserConfig = {
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                content: path.resolve(__dirname, 'src/contentScript.ts'),
                // any other entrypoints…
            },
            output: {
                // always name entry files `content.js`
                entryFileNames: (chunk: { name: string }) =>
                    chunk.name === 'content' ? 'content.js' : '[name].js',
                // leave any dynamic chunks un-hashed
                chunkFileNames: '[name].js',
                assetFileNames: '[name][extname]',
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
};

export default defineConfig(config);
