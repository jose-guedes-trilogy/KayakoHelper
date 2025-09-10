/* modules/kayako/buttons/requester-history/copyRequesterChatsButton.ts
   Split button next to Copy chat to copy latest tickets by Requester or Organization. */

import { EXTENSION_SELECTORS }   from '@/generated/selectors.ts';
import { isConvPage, currentConvId } from '@/utils/location.ts';
import { registerSplitButton, SplitButtonConfig } from '@/modules/kayako/buttons/buttonManager.ts';
import { waitForRequesterId, waitForOrganization } from '@/modules/kayako/utils/caseContext.ts';
import { extractProductValueSafe } from '@/modules/kayako/utils/product.ts';
import { searchConversationIds, fetchTranscriptByCase, quoteForSearch } from '@/modules/kayako/utils/search.ts';

const BTN_ID = EXTENSION_SELECTORS.copyRequesterChatsButton.replace(/^#/, '');
const RIGHT_ID = `${BTN_ID}__menu`;
const ICON = { idle: '📄', work: '⏳', ok: '✅', err: '❌' } as const;
type UiState = keyof typeof ICON;

const DEFAULT_LIMIT = 20;         // conversations
const POSTS_PER_CASE = 100;       // messages per case transcript
const RESET_MS = 2000;

export function bootCopyRequesterChatsButton(): void {
    let uiState: UiState = 'idle';
    let currentTicketId: string | null = null;
    let ticketLimit = DEFAULT_LIMIT;
    let mode: 'requester' | 'organization' = 'requester';

    const buildLabel = (): string => {
        switch (uiState) {
            case 'idle': return `${ICON.idle} Copy latest`;
            case 'work': return `${ICON.work} Copying…`;
            case 'ok'  : return `${ICON.ok} Copied!`;
            case 'err' : return `${ICON.err} Failed`;
        }
    };

    const setState = (state: UiState, btn?: HTMLButtonElement): void => {
        uiState = state;
        const el = btn ?? (document.getElementById(BTN_ID) as HTMLButtonElement | null);
        if (el) el.textContent = buildLabel();
    };

    const cfg: SplitButtonConfig = {
        id: BTN_ID,
        rightId: RIGHT_ID,
        rightLabel: '▾',
        label: buildLabel,
        routeTest: isConvPage,
        // Activate only on left mouse button release via manager's mouseup;
        // keep handler here to satisfy signature.
        onClick: run,
        onContextMenu: () => {
            const input = prompt('Copy how many tickets?', String(ticketLimit));
            if (!input) return;
            const n = parseInt(input, 10);
            if (Number.isFinite(n) && n > 0) ticketLimit = n;
        },
        hideDelayMs: 200,
        buildMenu(menu) {
            menu.innerHTML = '';
            const mkItem = (text: string, val: 'requester' | 'organization') => {
                const el = document.createElement('div');
                el.className = EXTENSION_SELECTORS.twoPartBtnDropdownItem.replace(/^\./,'');
                el.textContent = text;
                // Fire only on left-button mouseup to avoid premature activation
                el.addEventListener('mouseup', (ev) => {
                    if ((ev as MouseEvent).button !== 0) return;
                    ev.preventDefault(); ev.stopPropagation(); mode = val; void run();
                });
                // Prevent click default to avoid double-fire in some UIs
                el.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
                return el;
            };
            menu.appendChild(mkItem('Requester tickets', 'requester'));
            menu.appendChild(mkItem('Organization tickets', 'organization'));
        },
        onRouteChange(btn) {
            if (!btn) return;
            const id = currentConvId();
            if (id !== currentTicketId) {
                currentTicketId = id;
                ticketLimit = DEFAULT_LIMIT;
                setState('idle', btn);
            }
        },
        groupId   : EXTENSION_SELECTORS.tabStripCustomButtonAreaGroup2,
        groupOrder: 2,
    };

    registerSplitButton(cfg);

    async function run(btn?: HTMLButtonElement): Promise<void> {
        const el = btn ?? (document.getElementById(BTN_ID) as HTMLButtonElement | null);
        if (!el) return;
        setState('work', el);

        try {
            const product = (extractProductValueSafe() || '').trim();
            let query = '';
            if (mode === 'requester') {
                const requesterId = await waitForRequesterId(2000);
                if (!requesterId) throw new Error('Requester ID not available yet');
                const qParts = [`requester:${quoteForSearch(String(requesterId))}`];
                if (product) qParts.push(`product:${quoteForSearch(product)}`);
                query = qParts.join(' ');
            } else {
                const org = await waitForOrganization(2000);
                const orgName = (org?.name || '').trim();
                const qParts = [`organization:${quoteForSearch(orgName)}`];
                if (product) qParts.push(`product:${quoteForSearch(product)}`);
                query = qParts.join(' ');
            }

            try { console.debug('[KH][RequesterChats] search query', { mode, product, query }); } catch {}

            const ids = await searchConversationIds(query, ticketLimit, 0);
            if (!ids.length) throw new Error('No conversations found');

            const texts = await Promise.all(
                ids.map(async id => {
                    const raw = await fetchTranscriptByCase(id, POSTS_PER_CASE);
                    return raw.replace(/^Ticket ID:\s+Unknown ID\b/m, `Ticket ID: ${id}`);
                })
            );

            const bundle = texts.join('\n\n[=========== Next Conversation ===========]\n\n');
            await navigator.clipboard.writeText(bundle);

            setState('ok', el);
        } catch (err: any) {
            try { console.error('[KH][RequesterChats] failed', err); } catch {}
            alert(`Copy requester chats failed: ${err?.message ?? err}`);
            setState('err', el);
        } finally {
            setTimeout(() => setState('idle'), RESET_MS);
        }
    }
}


