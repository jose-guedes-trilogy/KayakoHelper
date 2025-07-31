/*  Assets-inspector – glue code (registers the button, wires everything)  */

import { EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { isConvPage } from '@/utils/location.ts';
import { registerModalButton } from '../modalButton.ts';
import { buildModal, renderPane, wireModal } from './assetsInspectorModal.ts';
import { loadAssets, getState, PAGE_LIMIT } from './assetsInspectorData.ts';

const BTN_ID = EXTENSION_SELECTORS.assetsButton.replace('#', '');

export function bootAssetsInspector(): void {
    if ((window as any).__assetsInspectorBooted) return;
    (window as any).__assetsInspectorBooted = true;

    /* register a detachable-modal tab button */
    registerModalButton({
        id       : BTN_ID,
        label    : () => 'Ticket assets ▼',
        routeTest: isConvPage,

        buildModal: () => {
            const modal = buildModal();
            wireModal(
                modal,
                async () => { await loadAssets(Math.min(getState().fetched + PAGE_LIMIT, getState().totalPosts)); renderPane(modal, 'links'); },
                async () => { await loadAssets(getState().totalPosts); renderPane(modal, 'links'); },
            );
            return modal;
        },

        onFirstOpen: async (modal) => {
            await loadAssets(PAGE_LIMIT);
            renderPane(modal, 'links');
        },
    });
}
