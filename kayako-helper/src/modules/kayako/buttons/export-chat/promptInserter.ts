// src/modules/kayako/buttons/export-chat/promptInserter.ts
// • waits (≤ 5 s) for a *visible* textarea or a content-editable field
// • detects Gemini (Quill .ql-editor) and Ephor (textarea.ephor-mentions-input__input)
// • inserts the prompt exactly (keeps all newlines)
// • leaves the caret at the end and fires input-like events so UIs enable the send button
(() => {
    /** Find the first usable input field:
     *  – any <textarea> that is *visible*
     *  – otherwise the first [contenteditable="true"] element
     */
    const locateField = () => {
        // Prefer provider-specific robust selectors first
        // Gemini (Quill editor)
        const gemini = document.querySelector('.ql-editor[contenteditable="true"]');
        if (gemini) return gemini as HTMLElement;

        // Ephor (mentions textarea)
        const ephor = document.querySelector('textarea.ephor-mentions-input__input');
        if (ephor) return ephor as HTMLTextAreaElement;

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
                const isEphor = !!document.querySelector('textarea.ephor-mentions-input__input')
                    || /(^|\.)ephor\.ai$/i.test(location.hostname);

                // Ephor initializes twice; wait a bit so the final input mounts
                if (isEphor) {
                    console.debug('[promptInserter] Ephor detected – delaying 1.5s before insert');
                    await new Promise(r => setTimeout(r, 1_500));
                }

                let field = locateField();
                const deadline = performance.now() + 5_000;
                while (!field && performance.now() < deadline) {
                    await new Promise(r => setTimeout(r, 200));
                    field = locateField();
                }
                if (!field) throw new Error('Prompt field not found');

                /* ───── textarea-based UIs (Ephor, some others) ───── */
                if (field.tagName === 'TEXTAREA') {
                    console.debug('[promptInserter] inserting into <textarea>');
                    const setTextarea = (el: HTMLTextAreaElement) => {
                        el.value = prompt;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        el.focus();
                    };

                    setTextarea(field as HTMLTextAreaElement);

                    // For Ephor, verify persistence for up to 3.5s and re-assert if cleared
                    if (isEphor) {
                        const verifyUntil = performance.now() + 3_500;
                        while (performance.now() < verifyUntil) {
                            await new Promise(r => setTimeout(r, 250));
                            const cur = document.querySelector('textarea.ephor-mentions-input__input') as HTMLTextAreaElement | null;
                            if (!cur) continue;
                            if (cur.value !== prompt) {
                                console.debug('[promptInserter] Ephor input changed/cleared – reasserting');
                                setTextarea(cur);
                            }
                        }
                    }

                    sendResponse('ok');
                    return;
                }

                /* ───── contentEditable-based UIs (ChatGPT, Gemini) ───── */
                console.debug('[promptInserter] inserting into [contenteditable]');

                // Try a Quill-/editor-friendly path first
                field.focus();
                let usedExecCommand = false;
                try {
                    // Attempt to insert as user-typed text (helps Quill/Gemini detect changes)
                    // eslint-disable-next-line deprecation/deprecation
                    usedExecCommand = document.execCommand('insertText', false, prompt);
                } catch { /* ignore */ }

                if (!usedExecCommand) {
                    // Fallback: set structured HTML preserving paragraphs
                    (field as HTMLElement).innerHTML = prompt
                        .split('\n')
                        .map(line => {
                            const safe = line
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;');
                            return safe.trim() === '' ? '<p><br></p>' : `<p>${safe}</p>`;
                        })
                        .join('');
                }

                // move caret to the end so the user can keep typing
                const range = document.createRange();
                range.selectNodeContents(field);
                range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);

                // Fire typical events so frameworks enable the send button
                field.dispatchEvent(new Event('input',  { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
                field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
                field.focus();

                // Ephor path shouldn't reach here, but if contenteditable is used, loosely verify
                if (isEphor) {
                    const verifyUntil = performance.now() + 3_500;
                    while (performance.now() < verifyUntil) {
                        await new Promise(r => setTimeout(r, 250));
                        const cur = locateField();
                        if (!cur) continue;
                        if (cur.tagName === 'TEXTAREA') break; // handled above normally
                        // Best-effort check: ensure textContent includes a prefix of the prompt
                        const ok = (cur.textContent ?? '').includes(prompt.slice(0, Math.min(24, prompt.length)));
                        if (!ok) {
                            console.debug('[promptInserter] Ephor CE verify – re-inserting');
                            // eslint-disable-next-line deprecation/deprecation
                            document.execCommand('selectAll', false);
                            // eslint-disable-next-line deprecation/deprecation
                            document.execCommand('insertText', false, prompt);
                        }
                    }
                }
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
