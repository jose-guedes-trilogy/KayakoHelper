/* src/setUpUI.ts
   ──────────────────────────────────────────────────────────
   Creates (once) the extension’s custom button container.
   If the header strip isn’t in the DOM yet, we watch until
   it appears, then insert the container and disconnect.   */

import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/selectors';

export function setUpUI(): void {
    // Abort if we already added the area.
    if (document.querySelector(EXTENSION_SELECTORS.tabStripCustomButtonArea)) return;

    const AREA_ID = EXTENSION_SELECTORS.tabStripCustomButtonArea.replace(/^#/, '');

    /* Attempt immediate insertion.
       Returns true if successful, false if header unavailable. */
    const tryInsert = (): boolean => {
        const strip = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.tabStrip);
        if (!strip) return false;

        const area = document.createElement('div');
        area.id = AREA_ID;
        area.style.cssText =
            'padding:6px 0;display:flex;align-items:center;gap:10px;';
        strip.insertBefore(area, strip.lastElementChild);
        return true;
    };

    // If header is ready, we’re done.
    if (tryInsert()) return;

    // Otherwise, observe until the header shows up, then insert & disconnect.
    const obs = new MutationObserver(() => {
        if (tryInsert()) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
}
