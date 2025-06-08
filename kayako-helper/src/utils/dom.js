/* utils/dom.js
   – Tiny DOM helpers                                                 */

export const $  = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/**
 * Event delegation   (`on(document,'click','a', handler)`).
 */
export function on (root, type, selector, handler) {
    root.addEventListener(type, e => {
        const t = e.target.closest(selector);
        if (t && root.contains(t)) handler(e, t);
    });
}

/**
 * Promise that resolves when an element matching `selector`
 * appears in the DOM (times out after 10 s by default).
 */
export function waitForElement (selector, { timeout = 10_000 } = {}) {
    return new Promise((res, rej) => {
        const ready = document.querySelector(selector);
        if (ready) return res(ready);

        const obs = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) { obs.disconnect(); res(el); }
        });
        obs.observe(document.body, { childList: true, subtree: true });

        if (timeout) {
            setTimeout(() => { obs.disconnect(); rej(
                new Error(`waitForElement: “${selector}” not found after ${timeout} ms`)
            ); }, timeout);
        }
    });
}
