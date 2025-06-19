/* src/modules/styleManager.ts – manages always-on + toggleable blocks */

import { injectStyles } from '@/utils/dom';
import compactCss from '@/styles/toggleableStyles.scss?inline';

const STYLE_REGISTRY = {
    toggleableStyles: { id: 'kh-toggleable-styles', css: compactCss },
} as const;
type StyleKey = keyof typeof STYLE_REGISTRY;

function toggleStyleBlock(key: StyleKey, enable: boolean) {
    const { id, css } = STYLE_REGISTRY[key];
    const el = document.getElementById(id);
    if (enable && !el) injectStyles(css, id);
    else if (!enable && el) el.remove();
}

function toggleAll(enable: boolean) {
    (Object.keys(STYLE_REGISTRY) as StyleKey[]).forEach((k) =>
        toggleStyleBlock(k, enable),
    );
}

/* ---- initial state on page-load ---- */
chrome.storage.sync.get('allStyles', (res) => {
    const all = res.allStyles ?? true; // default ON
    toggleAll(all);
});

/* ---- react to user changes live ---- */
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && 'allStyles' in changes) {
        const enabled = changes.allStyles.newValue ?? true;
        toggleAll(enabled);
    }
});
