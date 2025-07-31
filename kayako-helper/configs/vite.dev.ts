// vite.dev.ts – dev-server just for the popup
import { defineConfig } from 'vite'
import path from 'path'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
    plugins: [],

    css: {
        preprocessorOptions: {
            scss: {
                additionalData: `@use "@/styles/variables" as *;`,
                quietDeps: true,
            },
        },
    },

    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },

    // Tell the dev server which HTML to open
    root: '.',                    // default, but explicit is clear
    server: {
        open: '/src/popup/popup.html', // opens popup in browser tab for HMR
    },
})
