import { KAYAKO_SELECTORS } from '@/generated/selectors.ts';

const HIDE_MESSENGER_STYLE_ID = 'kh-hide-messenger-style';
const KEY_HIDE_MESSENGER = 'hideMessenger';

function isExtensionContextValid(): boolean {
    try {
        // chrome.runtime.id is undefined when the extension context is invalidated
        return !!(chrome?.runtime?.id);
    } catch {
        return false;
    }
}

function safeGetHideSetting(apply: (hide: boolean) => void): void {
    if (!isExtensionContextValid() || !chrome?.storage?.sync) {
        try { console.debug('[KH][HideMessenger] Skipping storage.get – context unavailable'); } catch {}
        return;
    }
    try {
        chrome.storage.sync.get([KEY_HIDE_MESSENGER] as const, res => {
            try {
                const hide = !!res[KEY_HIDE_MESSENGER];
                apply(hide);
            } catch (e) {
                try { console.warn('[KH][HideMessenger] storage.get callback failed:', e); } catch {}
            }
        });
    } catch (e) {
        // Ignore known teardown error
        const msg = String(e || '');
        if (msg.includes('Extension context invalidated')) return;
        try { console.warn('[KH][HideMessenger] storage.get threw:', e); } catch {}
    }
}

function ensureHideMessengerStyle(): HTMLStyleElement {
    let style = document.getElementById(HIDE_MESSENGER_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = HIDE_MESSENGER_STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
    }
    return style;
}

function applyHideMessenger(hide: boolean): void {
    try {
        const style = ensureHideMessengerStyle();
        const messengerSel = (KAYAKO_SELECTORS as any).messenger || "#kayako-messenger, [id='kayako-messenger'], [class*='kayako-messenger']";
        style.textContent = hide ? `${messengerSel}{ display:none !important; }` : '';
        document.querySelectorAll<HTMLElement>(messengerSel).forEach(el => {
            el.style.setProperty('display', hide ? 'none' : '');
        });
        try { console.debug('[KH] Hide messenger applied:', { hide }); } catch {}
    } catch (e) {
        try { console.warn('[KH] Failed to apply hideMessenger:', e); } catch {}
    }
}

export function initHideMessenger(): void {
    try {
        safeGetHideSetting(applyHideMessenger);

        try {
            chrome.storage.onChanged.addListener((changes, area) => {
                try {
                    if (!isExtensionContextValid()) return;
                    if (area !== 'sync') return;
                    if (!(KEY_HIDE_MESSENGER in changes)) return;
                    const hide = !!changes[KEY_HIDE_MESSENGER]!.newValue;
                    applyHideMessenger(hide);
                } catch (e) {
                    try { console.warn('[KH][HideMessenger] onChanged handler failed:', e); } catch {}
                }
            });
        } catch (e) {
            const msg = String(e || '');
            if (!msg.includes('Extension context invalidated')) {
                try { console.warn('[KH][HideMessenger] Failed to bind onChanged listener:', e); } catch {}
            }
        }

        const obs = new MutationObserver(muts => {
            let needApply = false;
            muts.forEach(m => {
                if (m.type !== 'childList') return;
                const nodes = Array.from(m.addedNodes);
                if (nodes.some(n => n instanceof HTMLElement)) needApply = true;
            });
            if (!needApply) return;
            safeGetHideSetting(hide => { if (hide) applyHideMessenger(true); });
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
}
