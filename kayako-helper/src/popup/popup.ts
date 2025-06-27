/* Kayako Helper – popup.ts
 * Two-tab UI + three toggles (training, styles, cursor) – now with strict typing
 */

import type { ToBackground } from '@/utils/messageTypes';

interface Prefs {
    trainingMode?:    boolean;
    allStyles?:       boolean;
    useCustomCursor?: boolean;
}

document.addEventListener('DOMContentLoaded', () => {
    /* ----- tab handling ----- */
    const tabLinks = Array.from(document.querySelectorAll<HTMLButtonElement>('nav .tab'));
    const panels   = Array.from(document.querySelectorAll<HTMLElement>('section'));

    tabLinks.forEach(btn =>
        btn.addEventListener('click', () => {
            tabLinks.forEach(b => b.classList.toggle('active', b === btn));
            panels.forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
        })
    );

    /* ----- controls ----- */
    const chkTraining = document.getElementById('trainingModeCheckbox') as HTMLInputElement;
    const chkStyles   = document.getElementById('allStylesCheckbox')    as HTMLInputElement;
    const chkCursor   = document.getElementById('customCursorCheckbox') as HTMLInputElement;

    chrome.storage.sync.get(
        ['trainingMode', 'allStyles', 'useCustomCursor'] as const,
        (res) => {
            const { trainingMode, allStyles, useCustomCursor } = res as Prefs;

            chkTraining.checked = !!trainingMode;
            chkStyles.checked   = allStyles       ?? true;
            chkCursor.checked   = useCustomCursor ?? true;
        }
    );

    /* training-mode */
    chkTraining.addEventListener('change', () => {
        const enabled = chkTraining.checked;
        chrome.runtime.sendMessage<ToBackground>({ action: 'setTrainingMode', enabled });
        chrome.storage.sync.set({ trainingMode: enabled });
    });

    /* master styles toggle */
    chkStyles.addEventListener('change', () => {
        const enabled = chkStyles.checked;
        chrome.runtime.sendMessage<ToBackground>({ action: 'setAllStylesEnabled', enabled });
        chrome.storage.sync.set({ allStyles: enabled });
    });

    /* custom cursor */
    chkCursor.addEventListener('change', () => {
        const enabled = chkCursor.checked;
        chrome.storage.sync.set({ useCustomCursor: enabled });
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'cursor.toggle', enabled });
        });
    });
});
