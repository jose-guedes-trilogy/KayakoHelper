// configs/vite.promptInserter.ts
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
            input: path.resolve(
                root,
                'src/modules/kayako/buttons/export-chat/promptInserter.ts'
            ),
            output: {
                entryFileNames: 'promptInserter.js',
                inlineDynamicImports: true,          // 👉 one-file bundle
                format: 'es',
            },
            manualChunks: undefined,
            preserveEntrySignatures: 'exports-only', // keep any exports just in case
        },
    },
    resolve: { alias: { '@': path.resolve(root, 'src') } },
})
