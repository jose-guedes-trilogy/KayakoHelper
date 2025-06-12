import type { ToBackground, FromBackground } from '@/messageTypes';

document.addEventListener('DOMContentLoaded', async () => {
    const chk = document.getElementById('trainingModeCheckbox') as HTMLInputElement;
    const subjEl = document.getElementById('subject')!;
    const nameEl = document.getElementById('requesterName')!;
    const emailEl = document.getElementById('requesterEmail')!;
    const cntEl = document.getElementById('replyCount')!;

    // Load training mode
    chrome.runtime.sendMessage(<ToBackground>{ action: 'getTrainingMode' }, (res: FromBackground) => {
        if (res.action === 'trainingMode') chk.checked = res.enabled;
    });

    chk.addEventListener('change', () => {
        const val = chk.checked;
        chrome.runtime.sendMessage(<ToBackground>{ action: 'setTrainingMode', enabled: val });
        chrome.storage.sync.set({ trainingMode: val });
    });

    // Determine ticket ID from URL
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0].url || '';
    const m = url.match(/\/agent\/conversations\/(\d+)/);
    if (!m) return;
    const ticketId = m[1];

    // Fetch and display stats
    chrome.runtime.sendMessage(<ToBackground>{ action: 'getStats', ticketId }, (res: FromBackground) => {
        if (res.action === 'stats') {
            subjEl.textContent = res.subject;
            nameEl.textContent = res.name;
            emailEl.textContent = res.email;
            cntEl.textContent = res.count.toString();
        }
    });
});