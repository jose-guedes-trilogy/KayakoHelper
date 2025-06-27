/* modules/copy-chat/copyChatButton.ts
   ──────────────────────────────────────────────────────────
   Adds a “Copy chat” button on conversation pages.
   Now uses an explicit UI-state machine so the tabButtonManager’s
   re-labels never overwrite our “⏳ / ✅ / ❌” feedback. */

import { EXTENSION_SELECTORS }   from '@/generated/selectors.ts';
import { fetchTranscript }       from '@/utils/api.js';
import { isConvPage, currentConvId } from '@/utils/location.js';
import { registerTabButton }     from '@/utils/tabButtonManager.ts';

/* ------------------------------------------------------------------ */
/* Constants & Types                                                  */
/* ------------------------------------------------------------------ */

const BTN_ID = EXTENSION_SELECTORS.copyChatButton.replace(/^#/, '');

const ICON = { idle: '📄', work: '⏳', ok: '✅', err: '❌' } as const;
type UiState = keyof typeof ICON;

const RESET_MS = 2_000;               // reset back to idle after success / error
const DEFAULT_LIMIT = 100;            // messages to fetch when not overridden

/* ------------------------------------------------------------------ */
/* Boot function                                                      */
/* ------------------------------------------------------------------ */

export function bootCopyChatButton(): void {
    /* ---------- Runtime state ---------- */
    let currentLimit = DEFAULT_LIMIT;
    let currentConv  : string | null = null;
    let uiState: UiState = 'idle';    // <-- single source of truth!

    /* ---------- Helpers ---------- */
    const buildLabel = (): string => {
        switch (uiState) {
            case 'idle':
                return `${ICON.idle} Copy chat${currentLimit !== DEFAULT_LIMIT
                    ? ` (${currentLimit} messages)` : ''}`;
            case 'work':
                return `${ICON.work} Copying…`;
            case 'ok':
                return `${ICON.ok} Copied!`;
            case 'err':
                return `${ICON.err} Failed`;
        }
    };

    const setState = (state: UiState, btn?: HTMLButtonElement): void => {
        uiState = state;
        // `btn` is passed when we already have it; otherwise grab it fresh.
        const target = btn ?? (document.getElementById(BTN_ID) as HTMLButtonElement | null);
        if (target) target.textContent = buildLabel();
    };

    /* ---------- Feature wiring ---------- */
    registerTabButton({
        id: BTN_ID,
        label: buildLabel,
        routeTest: isConvPage,
        onClick: exportChat,
        onContextMenu: (_ev, _btn) => {
            const v = prompt('Fetch how many posts?', String(currentLimit));
            if (v) {
                const n = parseInt(v, 10);
                if (n > 0) {
                    currentLimit = n;
                    setState('idle');          // refresh label immediately
                }
            }
        },
        onRouteChange(btn) {
            /* Reset per-ticket */
            if (!btn) return;                  // button hidden
            const id = currentConvId();
            if (id !== currentConv) {
                currentConv  = id;
                currentLimit = DEFAULT_LIMIT;
                setState('idle', btn);
            }
        },
    });

    /* ------------------------------------------------------------------ */
    /* Copy-chat logic                                                    */
    /* ------------------------------------------------------------------ */

    function exportChat(btn?: HTMLButtonElement): void {
        const el = btn ?? document.getElementById(BTN_ID) as HTMLButtonElement;
        if (!el) return;

        setState('work', el);

        fetchTranscript(currentLimit)
            .then(txt => navigator.clipboard.writeText(txt))
            .then(() => {
                setState('ok', el);
                setTimeout(() => setState('idle'), RESET_MS);
            })
            .catch(err => {
                console.error('[copyChat] export failed', err);
                setState('err', el);
                setTimeout(() => setState('idle'), RESET_MS);

                alert(`MAKE SURE TO WAIT BEFORE ALT-TABBING!\nExport failed: ${err.message}`);
            });
    }
}
