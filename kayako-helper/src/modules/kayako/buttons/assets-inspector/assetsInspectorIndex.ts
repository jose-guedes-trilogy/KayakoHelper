/*  Assets-inspector – glue code (registers the button, wires everything)  */

import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { isConvPage, onRouteChange, currentConvId } from '@/utils/location.ts';
import { registerModalButton } from '../modalButton.ts';
import { buildModal, renderPane, wireModal } from './assetsInspectorModal.ts';
import { loadAssets, getState, PAGE_LIMIT, hasCacheForCurrentTicket, resetStateForCurrentTicket } from './assetsInspectorData.ts';

const BTN_ID = EXTENSION_SELECTORS.assetsButton.replace('#', '');
const CHEVRON_CLS= EXTENSION_SELECTORS.twoPartBtnChevron.replace(/^./, '')

export function bootAssetsInspector(): void {
    if ((window as any).__assetsInspectorBooted) return;
    (window as any).__assetsInspectorBooted = true;
    try { console.info('[AssetsInspector][boot] initializing'); } catch {}

    // Global URL change watcher: hide modal if open and prefetch new ticket assets (uses cache if present)
    onRouteChange(async () => {
        try { console.debug('[AssetsInspector][boot] route change detected'); } catch {}
        // Immediately hide any visible modal to avoid cross-ticket confusion
        try {
            const sel = EXTENSION_SELECTORS.assetsModal;
            const el = document.querySelector<HTMLElement>(sel);
            if (el) el.classList.remove('open');
        } catch {}
        if (!hasCacheForCurrentTicket()) {
            try { console.info('[AssetsInspector][boot] preloading assets for new ticket'); } catch {}
            try { await loadAssets(PAGE_LIMIT); } catch (err) { try { console.warn('[AssetsInspector][boot] preload failed', err); } catch {} }
        } else {
            try { console.info('[AssetsInspector][boot] cache present for ticket; skipping fetch'); } catch {}
        }
    }, { immediate: false });

    /* register a detachable-modal tab button */
    registerModalButton({
        id       : BTN_ID,

        /*  ▼▼▼ — LABEL NOW RETURNS MARK-UP WITH A WRAPPED CHEVRON — ▼▼▼  */
        label    : () =>
            `<span>Ticket assets</span>`, //<div class="${CHEVRON_CLS}">▼</div>

        routeTest: isConvPage,

        buildModal: () => {
            try { console.debug('[AssetsInspector][boot] buildModal called'); } catch {}
            const modal = buildModal();
            wireModal(
                modal,
                async () => {
                    try { console.debug('[AssetsInspector][boot] fetchNext'); } catch {}
                    await loadAssets(getState().totalPosts);
                    renderPane(modal, 'links');
                },
                async () => {
                    try { console.debug('[AssetsInspector][boot] fetchAll'); } catch {}
                    await loadAssets(getState().totalPosts);
                    renderPane(modal, 'links');
                },
                async () => {
                    try { console.info('[AssetsInspector][boot] manual refresh'); } catch {}
                    await loadAssets(PAGE_LIMIT, { force: true });
                    renderPane(modal, 'links');
                }
            );
            return modal;
        },

        onFirstOpen: async (modal) => {
            try { console.info('[AssetsInspector][boot] first open: load + render'); } catch {}
            await loadAssets(getState().totalPosts || PAGE_LIMIT);
            renderPane(modal, 'links');
        },
    });
}
