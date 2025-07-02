// src/modules/kayako/buttons/export-chat/promptInserter.ts
// • waits (≤ 5 s) for a *visible* textarea or a content-editable field
// • inserts the prompt exactly (keeps all newlines)
// • leaves the caret at the end
(() => {
    /** Find the first usable input field:
     *  – any <textarea> that is *visible*
     *  – otherwise the first [contenteditable="true"] element
     */
    const locateField = () => {
        // visible textarea → ChatGPT keeps a hidden one we must skip
        const ta = [...document.querySelectorAll('textarea')]
            .find(t => {
                const s = getComputedStyle(t);
                return s.display !== 'none' && s.visibility !== 'hidden';
            });
        if (ta) return ta;

        return document.querySelector('[contenteditable="true"]');
    };

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.action !== 'exportChat.insertPrompt') return;

        (async () => {
            try {
                const { prompt } = msg;

                /* ───── wait ≤ 5 s for the field to appear ───── */
                let field = locateField();
                const deadline = performance.now() + 5_000;
                while (!field && performance.now() < deadline) {
                    await new Promise(r => setTimeout(r, 200));
                    field = locateField();
                }
                if (!field) throw new Error('Prompt field not found');

                /* ───── textarea-based UIs (Gemini, Ephor, …) ───── */
                if (field.tagName === 'TEXTAREA') {
                    field.value = prompt;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    field.focus();
                    sendResponse('ok');
                    return;
                }

                /* ───── contentEditable-based UIs (ChatGPT) ───── */
                field.innerHTML = prompt
                    .split('\n')
                    .map(line => line
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;'))
                    .join('<br>');

                // move caret to the end so the user can keep typing
                const range = document.createRange();
                range.selectNodeContents(field);
                range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);

                field.focus();
                sendResponse('ok');
            } catch (err) {
                console.warn('[promptInserter] failed', err);
                sendResponse((err && err.message) || 'Insert failed');
            }
        })();

        // keep the message port open while the async work runs
        return true;
    });
})();
