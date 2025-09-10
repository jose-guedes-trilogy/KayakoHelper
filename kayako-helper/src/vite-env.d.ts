/* vite-env.d.ts */

declare module '*.scss?inline' {
    const css: string;
    export default css;
}

// Allow importing raw text/HTML via Vite's ?raw suffix
declare module '*?raw' {
    const src: string;
    export default src;
}