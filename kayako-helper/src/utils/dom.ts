// src/utils/dom.ts
/**
 * Tiny DOM helpers
 */

export function $<T extends Element = Element>(
    sel: string,
    ctx: ParentNode = document
): T | null {
    return ctx.querySelector<T>(sel);
}

export function $$<T extends Element = Element>(
    sel: string,
    ctx: ParentNode = document
): T[] {
    return Array.from(ctx.querySelectorAll<T>(sel));
}

/**
 * Event delegation: listen on `root` for events of type `type`
 * and invoke `handler` when `selector` matches the target or its ancestor.
 */
export function on<
    K extends keyof HTMLElementEventMap,
    E extends Element = Element
>(
    root: Document | Element,
    type: K,
    selector: string,
    handler: (event: HTMLElementEventMap[K], target: E) => void
): void {
    root.addEventListener(type, (e: Event) => {
        const evt = e as HTMLElementEventMap[K];
        const t = (evt.target as Element).closest(selector) as E | null;
        if (t && root.contains(t)) {
            handler(evt, t);
        }
    });
}

/**
 * Resolves with the first element matching `selector` once it appears in the DOM,
 * or rejects after `timeout` milliseconds (default 10000).
 */
export function waitForElement<T extends Element = Element>(
    selector: string,
    options: { timeout?: number } = {}
): Promise<T> {
    const { timeout = 10_000 } = options;
    return new Promise<T>((resolve, reject) => {
        const existing = document.querySelector<T>(selector);
        if (existing) {
            return resolve(existing);
        }

        const obs = new MutationObserver(() => {
            const el = document.querySelector<T>(selector);
            if (el) {
                obs.disconnect();
                resolve(el);
            }
        });

        obs.observe(document.body, { childList: true, subtree: true });

        if (timeout > 0) {
            const timer = window.setTimeout(() => {
                obs.disconnect();
                reject(
                    new Error(
                        `waitForElement: "${selector}" not found after ${timeout} ms`
                    )
                );
            }, timeout);

            // clear timeout if element found early
            const originalResolve = resolve;
            resolve = (value: T) => {
                clearTimeout(timer);
                originalResolve(value);
            };
        }
    });
}


export function injectStyles(css, id): void {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
}