const BTN_ID = 'kh-make-tab-active-btn';

function providerKeyFromUrl(u: Location | URL): string {
    const h = (u instanceof URL ? u.hostname : u.hostname).replace(/^www\./, '');
    const p = h.split('.');
    return p.length >= 2 ? p.slice(-2).join('.') : h;
}

export function initMakeTabActiveButton(
    shouldInit: () => boolean = () => true,
    provider: string = providerKeyFromUrl(location),
): void {
    if (!shouldInit()) return;
    if (document.getElementById(BTN_ID)) return;

    const btn = Object.assign(document.createElement('button'), {
        id: BTN_ID,
        textContent: 'Make Active',
    });
    document.body.appendChild(btn);

    const setLabel = (active: boolean) =>
        (btn.textContent = active ? 'Active ✔' : 'Make Active');

    /* initial query */
    chrome.runtime.sendMessage(
        { action: 'exportChat.isActiveTab', provider },
        res => setLabel(!!res?.active),
    );

    /* react to broadcasts from background */
    chrome.runtime.onMessage.addListener(msg => {
        if (msg?.action === 'exportChat.activeChanged' && msg.provider === provider) {
            chrome.runtime.sendMessage(
                { action: 'exportChat.isActiveTab', provider },
                res => setLabel(!!res?.active),
            );
        }
    });

    /* manual click */
    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage(
            { action: 'exportChat.setActiveTab', provider },
            () => setLabel(true),
        );
    });
}
