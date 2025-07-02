/* Kayako Helper – popup.ts
 * Two-tab UI + three toggles (training, styles) – now with strict typing
 */

import type { ToBackground } from '@/utils/messageTypes';

interface Prefs {
    trainingMode?:    boolean;
    allStyles?:       boolean;
    sendChunksWPM?:   number;
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
    const inpWpm      = document.getElementById('wpmInput')             as HTMLInputElement;

    chrome.storage.sync.get(
        ['trainingMode', 'allStyles', 'sendChunksWPM'] as const,
        (res) => {
            const { trainingMode, allStyles, sendChunksWPM } = res as Prefs;

            chkTraining.checked = !!trainingMode;
            chkStyles.checked   = allStyles       ?? true;
            inpWpm.value        = (sendChunksWPM ?? 200).toString();
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

    /* WPM input */
    inpWpm.addEventListener('change', () => {
        const wpm = Math.max(50, Math.min(800, Number(inpWpm.value) || 200));
        inpWpm.value = wpm.toString();
        chrome.storage.sync.set({ sendChunksWPM: wpm });
    });

});
