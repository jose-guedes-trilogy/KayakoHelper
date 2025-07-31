/*  src/modules/kayako/buttons/modalButton.ts

Generic “tab-button with detachable modal” helper
    -------------------------------------------------
    • Creates a <button> under registerTabButton’s tab-strip
    • Builds the modal ONCE, appends it to <body>
    • Handles open/close, outside-click dismissal, positioning,
      resize / scroll re-position, and lazy first-open callback.
---------------------------------------------------------------- */

import { registerButton } from './buttonManager.ts';


export interface ModalButtonConfig {
    id: string;
    label: (() => string);
    routeTest?: () => boolean;
    groupId?: string;        // NEW – optional, defaults to "default"
    groupOrder?: number;     // NEW – optional, let caller override slot order
    buildModal: () => HTMLElement;
    onFirstOpen?: (modal: HTMLElement) => void | Promise<void>;
}



export function registerModalButton(cfg: ModalButtonConfig): void {
    let modal: HTMLElement | null = null;
    let assetsLoaded = false;
    let lastBtn: HTMLElement | null = null;

    const closeModal = () => modal?.classList.remove('open');

    /* outside-click dismissal */
    document.addEventListener('click', e => {
        if (!modal?.classList.contains('open')) return;
        if ((e.target as HTMLElement).closest(`#${cfg.id}`) ||
            (e.target as HTMLElement).closest(`[data-modal-id="${cfg.id}"]`)) return;
        closeModal();
    }, true); // capture phase

    /* auto re-position */
    const placeModal = () => {
        if (!modal || !lastBtn) return;
        const r = lastBtn.getBoundingClientRect();
        modal.style.position = 'absolute';
        modal.style.zIndex   = '9999';
        modal.style.top      = `${r.bottom + window.scrollY}px`;
        modal.style.left     = `${r.left   + window.scrollX}px`;
    };
    window.addEventListener('scroll',  placeModal);
    window.addEventListener('resize',  placeModal);

    registerButton({
        id       : cfg.id,
        label    : cfg.label,
        routeTest: cfg.routeTest,
        groupId  : cfg.groupId ?? "kh-tools",

        onClick(btn)  {
            /* stop tab-strip’s own closer */
            (globalThis as any).event?.stopPropagation();

            (async () => {
            lastBtn ??= btn;      // remember for positioning

            /* build modal once */
            if (!modal) {
                modal = cfg.buildModal();
                modal.setAttribute('data-modal-id', cfg.id);  // for outside-click
                document.body.appendChild(modal);
                modal.addEventListener('click', ev => ev.stopPropagation());
            }

            /* toggle */
            const willOpen = !modal.classList.contains('open');
            if (willOpen) {
                placeModal();
                modal.classList.add('open');

                if (!assetsLoaded && cfg.onFirstOpen) {
                    await cfg.onFirstOpen(modal);
                    assetsLoaded = true;
                }
            } else {
                closeModal();
            }
            })().catch(console.error);

            const willOpen = !modal?.classList.contains('open');

            if (!willOpen) closeModal();
        },
    });
}
