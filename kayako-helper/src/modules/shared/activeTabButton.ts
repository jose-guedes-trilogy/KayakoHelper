// src/modules/shared/activeTabButton.ts

export async function initMakeTabActiveButton(
    shouldInit: () => boolean = () => true,
): Promise<void> {
    if (!shouldInit()) return;

    const BTN_ID = "kh-make-tab-active-btn";

    if (document.getElementById(BTN_ID)) return;   // already present

    const btn = document.createElement('button');
    btn.id        = BTN_ID;
    btn.textContent = 'Make Active';

    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'exportChat.setActiveTab' },
            () => (btn.textContent = 'Active ✔'));
    });

    document.body.appendChild(btn);
}
