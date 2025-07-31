import { defineConfig } from 'vite'
import path from 'path'
const root = path.resolve(__dirname, '..')

export default defineConfig({
    root,
    build: {
        emptyOutDir: false,
        outDir: 'dist',
        sourcemap: true,
        rollupOptions: {
            input: path.resolve(root, 'src/modules/shared/activeTabButton.ts'),
            preserveEntrySignatures: 'exports-only',
            output: {
                entryFileNames: 'activeTabButton.js',
                inlineDynamicImports: true,
                format: 'es',
            },
            manualChunks: undefined,
        },
    },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
})
