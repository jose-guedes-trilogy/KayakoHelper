/* modules/copyChatButton.ts
   ──────────────────────────────────────────────────────────
   Adds “Copy chat” when on a conversation page. */

import { EXTENSION_SELECTORS } from '@/selectors.js';
import { fetchTranscript } from '@/api.js';
import { isConvPage, currentConvId } from '@/utils/location.js';

const BTN_ID = EXTENSION_SELECTORS.copyChatButton;

/* ------------ UI text & timings ------------ */
const ICON = { idle: '📄', work: '⏳', ok: '✅', err: '❌' } as const;
const RESET_MS = 2000;

/* ------------- State ------------- */
let currentLimit = 100;
let currentConv: string | null = null;
let btnEl: HTMLButtonElement | null = null;

/* ------------- Helpers ------------- */
const label = (i: string) =>
    `${i} Copy chat${currentLimit !== 100 ? ` (${currentLimit} messages)` : ''}`;

const setIdle = () => void (btnEl && (btnEl.textContent = label(ICON.idle)));
const setWork = () => void (btnEl && (btnEl.textContent = `${ICON.work} Copying…`));
const setOk   = () => void (btnEl && (btnEl.textContent = `${ICON.ok} Copied!`));
const setErr  = () => void (btnEl && (btnEl.textContent = `${ICON.err} Failed`));

function exportChat(): void {
    setWork();
    fetchTranscript(currentLimit)
        .then(txt => navigator.clipboard.writeText(txt))
        .then(() => {
            setOk();
            setTimeout(setIdle, RESET_MS);
        })
        .catch(err => {
            console.error(err);
            setErr();
            setTimeout(setIdle, RESET_MS);
            alert(`MAKE SURE TO WAIT BEFORE ALT TABBING! Export failed: ${err.message}`);
        });
}

function createButton(): void {
    const container = document.querySelector<HTMLElement>(
        EXTENSION_SELECTORS.tabStripCustomButtonArea
    );
    if (!container) return; // header not ready yet; try again on next mutation

    btnEl = document.createElement('button');
    btnEl.id = BTN_ID.replace(/^#/, '');
    btnEl.className = EXTENSION_SELECTORS.tabStripButtonClass.replace(/^./, '');

    setIdle();
    container.appendChild(btnEl);

    btnEl.addEventListener('click', exportChat);
    btnEl.addEventListener('contextmenu', e => {
        e.preventDefault();
        const v = prompt('Fetch how many posts?', String(currentLimit));
        if (v) {
            const n = parseInt(v, 10);
            if (n > 0) {
                currentLimit = n;
                setIdle();
            }
        }
    });
}

function removeButton(): void {
    btnEl?.remove();
    btnEl = null;
    currentLimit = 100;
}

function handleRouteChange(): void {
    const onConv = isConvPage();

    if (onConv && !btnEl) createButton();
    else if (!onConv && btnEl) removeButton();

    if (onConv) {
        const id = currentConvId();
        if (id !== currentConv) {
            currentConv = id;
            currentLimit = 100;
            setIdle();
        }
    } else currentConv = null;
}

export function bootCopyChatButton(): void {
    const obs = new MutationObserver(handleRouteChange);
    obs.observe(document.body, { childList: true, subtree: true });
    handleRouteChange(); // initial run
}
