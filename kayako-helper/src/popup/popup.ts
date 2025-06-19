// src/popup/popup.ts

import type { ToBackground } from '@/utils/messageTypes';

document.addEventListener('DOMContentLoaded', () => {
    const chkTraining  = document.getElementById('trainingModeCheckbox')  as HTMLInputElement;
    const chkMaster    = document.getElementById('allStylesCheckbox')     as HTMLInputElement;   // NEW

    /* ---- Load stored values ---- */
    chrome.storage.sync.get(['trainingMode', 'allStyles'], (res) => {
        const store = res as { trainingMode?: boolean; allStyles?: boolean };
        chkTraining.checked  = !!store.trainingMode;
        chkMaster.checked    = store.allStyles ?? true;                // default ON
    });

    /* ---- Training-mode ---- */
    chkTraining.addEventListener('change', () => {
        const enabled = chkTraining.checked;
        chrome.runtime.sendMessage<ToBackground>({ action: 'setTrainingMode', enabled });
        chrome.storage.sync.set({ trainingMode: enabled });
    });

    /* ---- Master toggle (all styles) ---- */
    chkMaster.addEventListener('change', () => {
        const enabled = chkMaster.checked;
        chrome.runtime.sendMessage<ToBackground>({
            action: 'setAllStylesEnabled',
            enabled
        });
        chrome.storage.sync.set({ allStyles: enabled });
    });
});
