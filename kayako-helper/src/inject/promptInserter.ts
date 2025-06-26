// src/inject/promptInserter.ts

(() => {
    /* ───────────────────── prompt insertion helper ───────────────────── */

    const SELECTORS = [
        '#prompt-textarea',               // ChatGPT – new UI
        'textarea:not([readonly])',
        '.ProseMirror',                   // ChatGPT – old UI
        '[contenteditable="true"]',
    ];

    function tryInsert(prompt: string): boolean {
        const el = SELECTORS.map(sel => document.querySelector<HTMLElement>(sel))
            .find(Boolean);
        if (!el) return false;

        if ('value' in el)  (el as HTMLTextAreaElement).value = prompt;
        else                el.textContent                  = prompt;

        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        (el as HTMLElement).focus();
        return true;
    }

    function insertWithRetry(prompt: string) {
        if (tryInsert(prompt)) return;          // quick path
        const t0 = Date.now();
        const id = setInterval(() => {
            if (tryInsert(prompt) || Date.now() - t0 > 5_000) clearInterval(id);
        }, 200);
    }

    /* receive prompt from background */
    chrome.runtime.onMessage.addListener(msg => {
        if (msg?.action === 'KayakoHelper/insertPrompt')
            insertWithRetry(msg.prompt as string);
    });

    /* ───────────────────────── status indicator ───────────────────────── */

    const IND_ID = 'kh-exp-indicator';
    if (document.getElementById(IND_ID)) return;   // once per tab

    const ind = document.createElement('div');
    ind.id = IND_ID;
    ind.style.cssText = [
        'position:fixed','right:12px','bottom:12px',
        'z-index:2147483647','background:#222','color:#fff',
        'padding:6px 10px','border-radius:8px','font:12px/1 sans-serif',
        'box-shadow:0 1px 4px rgba(0,0,0,.4)','cursor:move','user-select:none',
        'display:flex','gap:8px','align-items:center',
    ].join(';');

    const txt = document.createElement('span');
    const btn = document.createElement('button');
    btn.style.cssText = 'background:#444;border:0;color:#fff;padding:2px 6px;border-radius:4px;cursor:pointer;';
    ind.append(txt, btn);
    document.body.appendChild(ind);

    /* drag-move */
    let offX=0, offY=0, dragging=false;
    ind.addEventListener('mousedown', e => {
        dragging=true; offX=e.clientX-ind.offsetLeft; offY=e.clientY-ind.offsetTop;
        e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
        if (!dragging) return;
        ind.style.left = e.clientX - offX + 'px';
        ind.style.top  = e.clientY - offY + 'px';
    });
    window.addEventListener('mouseup', () => dragging=false);

    /* helpers */
    function refresh(active: boolean) {
        txt.textContent = active ? 'Export tab: ACTIVE' : 'Export tab: inactive';
        btn.textContent = active ? 'Deactivate' : 'Activate';
        ind.style.background = active ? '#0a3' : '#444';
    }

    /* toggle handler */
    btn.addEventListener('click', () => {
        chrome.runtime.sendMessage(
            { action: btn.textContent === 'Activate'
                    ? 'exportChat.setActiveTab'
                    : 'exportChat.clearActiveTab' },
            () => {  /* response ignored – we re-query below */  });
        setTimeout(queryStatus, 100);   // tiny delay for bg update
    });

    function queryStatus() {
        chrome.runtime.sendMessage({ action: 'exportChat.getStatus' },
            (res: {active:boolean}) => refresh(!!res?.active));
    }

    queryStatus();   // initial paint
})();
