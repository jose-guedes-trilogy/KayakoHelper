/* modules/copy-chat/copyChatButton.ts
   ──────────────────────────────────────────────────────────
   Adds “Copy chat” when on a conversation page – using
   the generic tabButtonManager for easy future scalability. */

import {
    EXTENSION_SELECTORS,
} from '@/generated/selectors';

import { fetchTranscript }        from '@/api.js';
import { isConvPage, currentConvId } from '@/utils/location.js';
import { registerTabButton }       from '@/utils/tabButtonManager';

const BTN_ID  = EXTENSION_SELECTORS.copyChatButton.replace(/^#/, '');

/* ------------ UI text & timings ------------ */
const ICON     = { idle: '📄', work: '⏳', ok: '✅', err: '❌' } as const;
const RESET_MS = 2000;

export function bootCopyChatButton(): void {
    /* ------------- State ------------- */
    let currentLimit = 100;
    let currentConv:  string | null = null;

    /* ------------- Helpers ------------- */
    const label = () =>
        `${ICON.idle} Copy chat${currentLimit !== 100 ? ` (${currentLimit} messages)` : ''}`;

    const setIdle = (el: HTMLButtonElement) => void (el.textContent = label());
    const setWork = (el: HTMLButtonElement) => void (el.textContent = `${ICON.work} Copying…`);
    const setOk   = (el: HTMLButtonElement) => void (el.textContent = `${ICON.ok} Copied!`);
    const setErr  = (el: HTMLButtonElement) => void (el.textContent = `${ICON.err} Failed`);

    /* ------------- Feature ------------- */
    registerTabButton({
        id: BTN_ID,
        label,
        routeTest : isConvPage,
        onClick   : exportChat,
        onContextMenu: (_ev, _btn) => {
            const v = prompt('Fetch how many posts?', String(currentLimit));
            if (v) {
                const n = parseInt(v, 10);
                if (n > 0) currentLimit = n;
            }
        },
        onRouteChange(btn) {
            /* Reset per-ticket */
            if (!btn) return; // hidden
            const id = currentConvId();
            if (id !== currentConv) {
                currentConv = id;
                currentLimit = 100;
                setIdle(btn);
            }
        },
    });

    function exportChat(btn?: HTMLButtonElement): void {
        /* `btn` comes from onClick, but we fall back just in case. */
        const el = btn ?? document.getElementById(BTN_ID) as HTMLButtonElement;
        if (!el) return;

        setWork(el);
        fetchTranscript(currentLimit)
            .then(txt => navigator.clipboard.writeText(txt))
            .then(() => {
                setOk(el);
                setTimeout(() => setIdle(el), RESET_MS);
            })
            .catch(err => {
                console.error(err);
                setErr(el);
                setTimeout(() => setIdle(el), RESET_MS);
                alert(`MAKE SURE TO WAIT BEFORE ALT TABBING! Export failed: ${err.message}`);
            });
    }
}
