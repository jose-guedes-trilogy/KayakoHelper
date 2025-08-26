/* ============================================================================
 * src/modules/searchEnhancer.ts
 *
 * Kayako Helper – Search UI Enhancement
 * ========================================================================= */

import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/generated/selectors.ts';

/* ----------  CONSTANTS  -------------------------------------------------- */
const ORIGINAL_INPUT_SELECTOR = KAYAKO_SELECTORS.unifiedSearchOriginalInput;
const RESULTS_LIST_SELECTOR   = KAYAKO_SELECTORS.unifiedSearchResultsList;
const QUERY_INPUT_ID          = EXTENSION_SELECTORS
    .unifiedSearchQueryInputId
    .replace(/^#/, '');

/* class names (dot removed because we assign to .className) */
const CL_QUERY_INPUT          = EXTENSION_SELECTORS.searchQueryInput.replace(/^\./, '');
const CL_CONTROLS             = EXTENSION_SELECTORS.searchControls.replace(/^\./, '');
const CL_FIELD                = EXTENSION_SELECTORS.searchField.replace(/^\./, '');
const CL_LABEL                = EXTENSION_SELECTORS.searchLabel.replace(/^\./, '');
const CL_TEXT_INPUT           = EXTENSION_SELECTORS.searchTextInput.replace(/^\./, '');
const CL_DROP_TRIGGER         = EXTENSION_SELECTORS.searchDropTrigger.replace(/^\./, '');
const CL_DROPDOWN             = EXTENSION_SELECTORS.searchDropdown.replace(/^\./, '');
const CL_CLOSE_BTN            = EXTENSION_SELECTORS.searchDropdownCloseButton.replace(/^\./, '');

const UI_PARENT_ID            = EXTENSION_SELECTORS.unifiedSearchElementsParentId.replace(/^#/, '');

const UI_PARENT_ID_RESULTS_PAGE     = EXTENSION_SELECTORS.searchResultsButtonContainer.replace(/^#/, '');

const RESULTS_PAGE_INPUT_SELECTOR = '[class*="session_agent_search__title_"] > input'

/* Base IDs used to derive unique IDs per-context (quickview vs results page) */
const QUERY_INPUT_ID_BASE = QUERY_INPUT_ID;
const UI_PARENT_ID_BASE   = UI_PARENT_ID;

/* ----------  TYPES  ------------------------------------------------------ */
type ModKey =
    | 'in' | 'assignee' | 'team' | 'tag' | 'status' | 'subject' | 'body'
    | 'name' | 'creator' | 'organization' | 'priority'
    | 'product' | 'brand'
    | 'custom_key' | 'custom_val'
    | 'created' | 'updated'
    | 'channel';

interface ParsedQuery {
    in?: string[];
    channel?: string[];
    assignee?: string;
    team?: string;
    tag?: string;
    status?: string;
    subject?: string;
    body?: string;
    product?: string;
    brand?: string;
    name?: string;
    creator?: string;
    organization?: string;
    priority?: string;
    custom_key?: string;
    custom_val?: string;
    created?: string;
    updated?: string;
}

/* ----------  METADATA  --------------------------------------------------- */
const IN_VALUES = ['Conversations', 'Users', 'Organizations', 'Articles'] as const;
const CHANNEL_VALUES = ['Mail','Twitter','Facebook','Messenger','Helpcenter','System','Apia'] as const;
const OP_VALUES = [
    { label: 'on',     op: ':' },
    { label: 'after',  op: '>' },
    { label: 'before', op: '<' }
] as const;

const STATUS_VALUES   = ['Open', 'Pending', 'Completed', 'Hold'] as const;
const PRIORITY_VALUES = ['Low', 'Normal', 'High', 'Urgent']   as const;

/* ----------  STATE  ------------------------------------------------------ */
let originalInput : HTMLInputElement | null = null;
let openDropdown  : HTMLElement | null      = null;
const refs: Partial<Record<ModKey, HTMLElement>> = {};

/* Re-entrancy guard – true while syncToOriginal is running,
   so syncFromOriginal can ignore synthetic events it triggers. */
let isSyncingToOriginal = false;

/* Preferences for "Search in" behavior */
let prefRememberSearchIn = false;
let prefDefaultSearchIn: string[] = ['Conversations'];
let lastSelectedSearchIn: string[] | null = null;
let prefResultsAutoUpdate = true;

function loadSearchInPrefs(): Promise<void> {
    return new Promise(resolve => {
        try {
            chrome.storage.sync.get([
                'searchInRemember',
                'searchInDefaults',
                'searchInLastSelection',
                'searchResultsAutoUpdate',
            ], raw => {
                const remember = !!raw['searchInRemember'];
                const defaults = Array.isArray(raw['searchInDefaults']) ? raw['searchInDefaults'] : undefined;
                const lastSel  = Array.isArray(raw['searchInLastSelection']) ? raw['searchInLastSelection'] : null;
                const autoUpd  = raw['searchResultsAutoUpdate'];

                prefRememberSearchIn = remember;
                if (defaults) prefDefaultSearchIn = defaults;
                lastSelectedSearchIn = lastSel;
                prefResultsAutoUpdate = typeof autoUpd === 'boolean' ? autoUpd : true;
                resolve();
            });
        } catch {
            resolve();
        }
    });
}

/* ----------  UTIL  ------------------------------------------------------- */
function setNativeInputValue(el: HTMLInputElement, value: string): void {
    try {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && typeof desc.set === 'function') {
            desc.set.call(el, value);
        } else {
            el.value = value;
        }
    } catch {
        el.value = value;
    }
}

function focusTemporarily(el: HTMLElement, run: () => void): void {
    const prev = (document.activeElement as HTMLElement | null) || null;
    try {
        if (el !== prev) {
            try { (el as HTMLInputElement).focus({ preventScroll: true }); } catch { el.focus(); }
        }
        run();
    } finally {
        if (prev && prev !== el && typeof prev.focus === 'function') {
            try { prev.focus({ preventScroll: true } as any); } catch { prev.focus(); }
        }
    }
}




/* ----------  ENTRY POINT  ------------------------------------------------ */
export function bootSearchEnhancer(): void {
    new MutationObserver(() => { void injectUI(); }).observe(document.body, { childList: true, subtree: true });
    void injectUI();
}

/* ----------  UI BUILD  --------------------------------------------------- */
async function injectUI(): Promise<void> {
    const quickHost  = document.querySelector<HTMLElement>(RESULTS_LIST_SELECTOR);
    const quickInput = document.querySelector<HTMLInputElement>(ORIGINAL_INPUT_SELECTOR);

    const resultsHost  = document.querySelector<HTMLElement>(`#${UI_PARENT_ID_RESULTS_PAGE}`);
    const resultsInput = document.querySelector<HTMLInputElement>(RESULTS_PAGE_INPUT_SELECTOR);

    if (quickHost && quickInput) {
        await ensureInstance(quickHost, quickInput, false);
    }
    if (resultsHost && resultsInput) {
        await ensureInstance(resultsHost, resultsInput, true);
    }
}

type LocalRefs = Partial<Record<ModKey, HTMLElement>> & { qbox?: HTMLInputElement };

async function ensureInstance(host: HTMLElement, originalInputEl: HTMLInputElement, isResultsPage: boolean): Promise<void> {
    await loadSearchInPrefs();

    const contextSuffix = isResultsPage ? '--results' : '--quick';
    const UI_PARENT_ID_LOCAL = UI_PARENT_ID_BASE + contextSuffix;
    const QUERY_INPUT_ID_LOCAL = QUERY_INPUT_ID_BASE + contextSuffix;

    // If already injected into THIS host, do nothing.
    if (host.querySelector(`#${QUERY_INPUT_ID_LOCAL}`) || host.querySelector(`#${UI_PARENT_ID_LOCAL}`)) return;

    // Remove stale same-context nodes elsewhere to avoid duplicates
    document.querySelectorAll<HTMLElement>(`#${UI_PARENT_ID_LOCAL}, #${QUERY_INPUT_ID_LOCAL}`).forEach(node => {
        if (!host.contains(node)) node.remove();
    });

    // Instance-local state
    const refsLocal: LocalRefs = {};
    let openDropdownLocal: HTMLElement | null = null;
    let isSyncingLocal = false;
    let autoUpdateTimer: number | undefined;

    // --- Build DOM ---
    const queryLi = document.createElement('div');
    queryLi.style.display = 'flex';
    queryLi.style.gap = '8px';
    queryLi.style.alignItems = 'center';
    queryLi.style.whiteSpace = 'nowrap';
    queryLi.style.marginBottom = '4px';
    queryLi.innerHTML = `<span class="kh-enhanced-search-label">Search terms</span> <input id="${QUERY_INPUT_ID_LOCAL}" class="${CL_QUERY_INPUT}" type="text" placeholder="Enter the terms you'd like to search for">`;
    const queryBox = queryLi.querySelector('input')! as HTMLInputElement;
    refsLocal.qbox = queryBox;

    const controlsLi = document.createElement('div');
    controlsLi.className = CL_CONTROLS;

    // Helpers
    const buildLabel = (t: string) => { const span = document.createElement('span'); span.textContent = t; span.className = CL_LABEL; return span; };
    const buildText = (key: Exclude<ModKey, 'in' | 'status' | 'priority' | 'custom_key' | 'custom_val' | 'created' | 'updated'>, label?: string) => {
        const w = document.createElement('div'); w.className = CL_FIELD; w.append(buildLabel(label ?? key.charAt(0).toUpperCase() + key.slice(1)));
        const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = `${key.charAt(0).toUpperCase() + key.slice(1)} to search for`; inp.className = CL_TEXT_INPUT; inp.addEventListener('input', syncToOriginalLocal); w.append(inp); (refsLocal as any)[key] = inp; return w;
    };
    const buildDropdown = (key: 'status' | 'priority', label: string, options: readonly string[]) => {
        const w = document.createElement('div'); w.classList.add(CL_FIELD, 'kh-field-dropdown'); w.append(buildLabel(label));
        const sel = document.createElement('select'); sel.append(new Option('', '')); options.forEach(o => sel.append(new Option(o, o))); sel.addEventListener('change', syncToOriginalLocal); w.append(sel); (refsLocal as any)[key] = sel as unknown as HTMLElement; return w;
    };
    const buildInlineInCheckboxes = () => {
        const wrap = document.createElement('div'); wrap.className = CL_FIELD; wrap.appendChild(buildLabel('Search in'));
        const container = document.createElement('div'); container.style.display = 'flex'; container.style.gap = '8px'; container.style.flexWrap = 'wrap';
        IN_VALUES.forEach(v => { const id = `kh-in-${v}${contextSuffix}`; const div = document.createElement('div'); div.innerHTML = `<input type="checkbox" id="${id}" value="${v}"> <label for="${id}">${v}</label>`; const cb = div.querySelector('input')! as HTMLInputElement; cb.addEventListener('change', () => { syncToOriginalLocal(); if (prefRememberSearchIn) { const chosen = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(n => n.value); try { chrome.storage.sync.set({ searchInLastSelection: chosen }); } catch {} } }); container.appendChild(div); });
        wrap.appendChild(container); refsLocal.in = wrap; return wrap;
    };
    const buildChannelDropdown = () => {
        const wrap = document.createElement('div'); wrap.className = CL_FIELD; wrap.appendChild(buildLabel('Channel'));
        const trig = document.createElement('button'); trig.innerHTML = 'Pick channels <span>▼</span> '; trig.className = CL_DROP_TRIGGER; wrap.appendChild(trig);
        const dd = document.createElement('div'); dd.className = CL_DROPDOWN; CHANNEL_VALUES.forEach(v => { const id = `kh-channel-${v}${contextSuffix}`; dd.insertAdjacentHTML('beforeend', `<div><input type=\"checkbox\" id=\"${id}\" value=\"${v}\"> <label for=\"${id}\">${v}</label></div>`); });
        const cls = document.createElement('button'); cls.textContent = 'Close'; cls.className = CL_CLOSE_BTN; cls.addEventListener('click', () => { dd.classList.remove('open'); openDropdownLocal = null; }); dd.append(cls); wrap.appendChild(dd);
        trig.addEventListener('click', e => { e.stopPropagation(); const o = dd.classList.toggle('open'); openDropdownLocal = o ? dd : null; });
        dd.addEventListener('change', syncToOriginalLocal);
        refsLocal.channel = wrap; return wrap;
    };
    const buildStatusDropdown = () => {
        const wrap = document.createElement('div'); wrap.className = CL_FIELD; wrap.appendChild(buildLabel('Status'));
        const trig = document.createElement('button'); trig.innerHTML = 'Pick statuses <span>▼</span> '; trig.className = CL_DROP_TRIGGER; wrap.appendChild(trig);
        const dd = document.createElement('div'); dd.className = CL_DROPDOWN; STATUS_VALUES.forEach(v => { const id = `kh-status-${v}${contextSuffix}`; dd.insertAdjacentHTML('beforeend', `<div><input type=\"checkbox\" id=\"${id}\" value=\"${v}\"> <label for=\"${id}\">${v}</label></div>`); });
        const cls = document.createElement('button'); cls.textContent = 'Close'; cls.className = CL_CLOSE_BTN; cls.addEventListener('click', () => { dd.classList.remove('open'); openDropdownLocal = null; }); dd.append(cls); wrap.appendChild(dd);
        trig.addEventListener('click', e => { e.stopPropagation(); const o = dd.classList.toggle('open'); openDropdownLocal = o ? dd : null; });
        dd.addEventListener('change', syncToOriginalLocal);
        (refsLocal as any).status = wrap; return wrap;
    };
    const buildPriorityDropdown = () => {
        const wrap = document.createElement('div'); wrap.className = CL_FIELD; wrap.appendChild(buildLabel('Priority'));
        const trig = document.createElement('button'); trig.innerHTML = 'Pick priorities <span>▼</span> '; trig.className = CL_DROP_TRIGGER; wrap.appendChild(trig);
        const dd = document.createElement('div'); dd.className = CL_DROPDOWN; PRIORITY_VALUES.forEach(v => { const id = `kh-priority-${v}${contextSuffix}`; dd.insertAdjacentHTML('beforeend', `<div><input type=\"checkbox\" id=\"${id}\" value=\"${v}\"> <label for=\"${id}\">${v}</label></div>`); });
        const cls = document.createElement('button'); cls.textContent = 'Close'; cls.className = CL_CLOSE_BTN; cls.addEventListener('click', () => { dd.classList.remove('open'); openDropdownLocal = null; }); dd.append(cls); wrap.appendChild(dd);
        trig.addEventListener('click', e => { e.stopPropagation(); const o = dd.classList.toggle('open'); openDropdownLocal = o ? dd : null; });
        dd.addEventListener('change', syncToOriginalLocal);
        (refsLocal as any).priority = wrap; return wrap;
    };
    const buildCustomField = () => {
        const w = document.createElement('div'); w.classList.add(CL_FIELD, EXTENSION_SELECTORS.searchEnhancerCustomField.replace(/^./, '')); w.append(buildLabel('Custom field'));
        const keyInp = document.createElement('input'); keyInp.type = 'text'; keyInp.placeholder = `Custom field's API key`; keyInp.className = CL_TEXT_INPUT; keyInp.addEventListener('input', syncToOriginalLocal);
        const valInp = document.createElement('input'); valInp.type = 'text'; valInp.placeholder = `Custom field's value`; valInp.className = CL_TEXT_INPUT; valInp.addEventListener('input', syncToOriginalLocal);
        refsLocal.custom_key = keyInp; refsLocal.custom_val = valInp; w.append(keyInp, valInp); return w;
    };
    const buildDateRow = (key: 'created' | 'updated') => {
        const row = document.createElement('div');
        row.classList.add(EXTENSION_SELECTORS.searchEnhancerDateField.replace(/^./, ''));
        const label = buildLabel(key === 'created' ? 'Creation date' : 'Update date');
        const wrap = document.createElement('div'); wrap.className = 'kh-date-wrap'; wrap.style.display = 'flex'; wrap.style.gap = '6px'; wrap.style.flex = '1 1 100%';
        const sel = document.createElement('select'); OP_VALUES.forEach(o => { const opt = document.createElement('option'); opt.value = o.op; opt.textContent = o.label; sel.append(opt); });
        const selWrapper = document.createElement('div'); selWrapper.className = 'kh-date-select-wrapper'; selWrapper.append(sel);
        const dt = document.createElement('input'); dt.type = 'date'; [sel, dt].forEach(el => el.addEventListener('change', syncToOriginalLocal));
        wrap.append(selWrapper, dt);
        row.append(label, wrap);
        (refsLocal as any)[key] = row;
        return row;
    };
    const buildDateGroup = () => {
        const group = document.createElement('div');
        group.className = CL_FIELD;
        group.append(buildDateRow('created'), buildDateRow('updated'));
        return group;
    };

    controlsLi.append(
        // Subject, Body, Tag
        buildText('subject', 'Subject'),
        buildText('body', 'Body'),
        buildText('tag', 'Tag'),
        // Status (multi), Priority
        buildStatusDropdown(),
        buildPriorityDropdown(),
        // Product, Brand, Name, Creator, Organization
        buildText('product', 'Product'),
        buildText('brand', 'Brand'),
        buildText('name', 'Name'),
        buildText('creator', 'Creator'),
        buildText('organization', 'Organization'),
        // Channel
        buildChannelDropdown(),
        // Assignee, Team
        buildText('assignee', 'Assignee'),
        buildText('team', 'Team'),
        // Custom Field
        buildCustomField(),
        // Creation/Update Dates (stacked in one field)
        buildDateGroup(),
        // Search in
        buildInlineInCheckboxes()
    );

    const uiWrap = document.createElement('div');
    uiWrap.id = UI_PARENT_ID_LOCAL;
    uiWrap.style.position = 'relative';
    uiWrap.setAttribute('data-kh-enhanced-ui', isResultsPage ? 'results' : 'quick');
    uiWrap.append(queryLi, controlsLi);

    // Collapse/Expand toggle (pill at bottom)
    const toggleWrap = document.createElement('div');
    toggleWrap.style.position = 'absolute';
    toggleWrap.style.left = '50%';
    toggleWrap.style.bottom = '0';
    toggleWrap.style.transform = 'translate(-50%, 50%)';
    toggleWrap.style.zIndex = '2';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.style.display = 'inline-flex';
    toggleBtn.style.alignItems = 'center';
    toggleBtn.style.gap = '6px';
    toggleBtn.style.padding = '4px 12px';
    toggleBtn.style.borderRadius = '9999px';
    toggleBtn.style.border = '1px solid rgba(0,0,0,0.15)';
    toggleBtn.style.background = 'rgba(0,0,0,0.04)';
    toggleBtn.style.boxShadow = 'rgba(237, 237, 237,0.5) 0px 1px 4px 1px, rgba(235, 235, 235, 0.15) 0px 0px 0px 1px, rgba(161, 161, 161, 0.05) 0px 4px 18px 4px;';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.font = 'inherit';
    toggleBtn.style.color = '#292929;';

    const toggleText = document.createElement('span');
    const chevron = document.createElement('span');
    chevron.style.display = 'inline-block';
    chevron.style.transform = 'scaleY(0.8)';
    chevron.style.fontSize = '10px';
    chevron.style.position = 'relative';
    chevron.style.top = '1px';
    chevron.style.color = '#3b3b3b';

    let controlsVisible = true;
    function applyToggleUI() {
        toggleBtn.setAttribute('aria-expanded', String(controlsVisible));
        toggleBtn.className = 'toggle-button';
        toggleText.textContent = controlsVisible ? 'Hide filters' : 'Show filters';
        chevron.innerHTML = controlsVisible ? `▲` : `▼`;
        controlsLi.style.display = controlsVisible ? '' : 'none';
        console.debug('[KH Search] filters', controlsVisible ? 'expanded' : 'collapsed', { context: isResultsPage ? 'results' : 'quick' });
    }
    applyToggleUI();

    toggleBtn.addEventListener('click', () => {
        controlsVisible = !controlsVisible;
        applyToggleUI();
    });

    toggleBtn.append(toggleText, chevron);
    toggleWrap.appendChild(toggleBtn);
    uiWrap.appendChild(toggleWrap);

    if (isResultsPage) host.append(uiWrap); else host.prepend(uiWrap);

    // Sync helpers
    function triggerEnterOnOriginal() {
        console.debug('[KH Search] triggerEnterOnOriginal: dispatching Enter to original input');
        const dispatch = () => {
            try {
                const opts: KeyboardEventInit = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' } as any;
                (opts as any).keyCode = 13; (opts as any).which = 13; (opts as any).charCode = 13;
                originalInputEl.dispatchEvent(new KeyboardEvent('keydown', opts));
                originalInputEl.dispatchEvent(new KeyboardEvent('keyup', opts));
            } catch (e) {
                console.warn('[KH Search] triggerEnterOnOriginal: key events failed', e);
            }

            // Fallback: submit enclosing form if any
            try {
                const form = originalInputEl.closest('form') as HTMLFormElement | null;
                if (form) {
                    console.debug('[KH Search] triggerEnterOnOriginal: submitting enclosing form');
                    if (typeof (form as any).requestSubmit === 'function') (form as any).requestSubmit();
                    else form.submit();
                }
            } catch (e) {
                console.warn('[KH Search] triggerEnterOnOriginal: form submit fallback failed', e);
            }
        };
        focusTemporarily(originalInputEl, dispatch);
    }

    function syncToOriginalLocal() {
        isSyncingLocal = true;
        const parts: string[] = [];
        const qBox = refsLocal.qbox!;
        const kw = qBox.value.trim();
        if (kw) parts.push(kw);
        const chosen = Array.from((refsLocal.in as HTMLElement)!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(cb => cb.value);
        if (chosen.length === 1) parts.push(`in:${chosen[0]}`); else if (chosen.length > 1) parts.push('(' + chosen.map(v => `in:${v}`).join(' OR ') + ')');
        if (prefRememberSearchIn) { try { chrome.storage.sync.set({ searchInLastSelection: chosen }); } catch {} }
        (['assignee','team','tag','subject','body','product','brand','name','creator','organization'] as const).forEach(k => { const val = ((refsLocal as any)[k] as HTMLInputElement).value.trim(); if (val) { const needsQuotes = val.toLowerCase() !== 'null'; parts.push(`${k}:${needsQuotes ? `"${val}"` : val}`); } });
        if ((refsLocal as any).priority) {
			const selP = Array.from(((refsLocal as any).priority as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(cb => cb.value);
			console.debug('[KH Search] syncToOriginalLocal: priority[] =', selP);
			if (selP.length === 1) parts.push(`priority:${selP[0]}`);
			else if (selP.length > 1) parts.push(`priority:(${selP.join(' OR ')})`);
		}
        if (refsLocal.channel) { const sel = Array.from((refsLocal.channel as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(cb => cb.value); if (sel.length === 1) parts.push(`channel:${sel[0]}`); else if (sel.length > 1) parts.push('(' + sel.map(v => `channel:${v}`).join(' OR ') + ')'); }
        const cfKey = (refsLocal.custom_key as HTMLInputElement)?.value?.trim() ?? ''; const cfVal = (refsLocal.custom_val as HTMLInputElement)?.value?.trim() ?? ''; if (cfKey && cfVal) parts.push(`${cfKey}:"${cfVal}"`);
        (['created','updated'] as const).forEach(k => { const w = (refsLocal as any)[k] as HTMLElement | undefined; if (!w) return; const sel = w.querySelector('select') as HTMLSelectElement; const d = w.querySelector('input[type="date"]') as HTMLInputElement; const op = sel?.value ?? ':'; const dv = d?.value ?? ''; if (dv) parts.push(`${k}${op}${dv}`); });
        const finalQuery = parts.join(' ').trim();
        console.debug('[KH Search] syncToOriginalLocal: final query =', finalQuery);
        focusTemporarily(originalInputEl, () => {
            setNativeInputValue(originalInputEl, finalQuery);
            try { originalInputEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true } as any)); } catch { originalInputEl.dispatchEvent(new Event('input', { bubbles: true })); }
            originalInputEl.dispatchEvent(new Event('change', { bubbles: true }));
            originalInputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
        });
        if (isResultsPage && prefResultsAutoUpdate) { if (autoUpdateTimer) window.clearTimeout(autoUpdateTimer); autoUpdateTimer = window.setTimeout(() => { triggerEnterOnOriginal(); }, 250); }
        setTimeout(() => { isSyncingLocal = false; }, 0);
    }

    function syncFromOriginalLocal() {
        if (isSyncingLocal) return;
        const raw = originalInputEl.value;
        const parsed: any = {} as ParsedQuery;
        parsed.in = [...raw.matchAll(/\bin:([^\s()]+)/gi)].map(m => m[1]!).filter(Boolean);
        parsed.channel = [...raw.matchAll(/\bchannel:([^\s()]+)/gi)].map(m => m[1]!).filter(Boolean);
        (['assignee','team','tag','subject','body','product','brand','name','creator','organization'] as const).forEach(k => { const m = raw.match(new RegExp(`\\b${k}:(?:"([^"]*)"|(null))`, 'i')); if (m) parsed[k] = (m[1] ?? m[2])!; });
        // priority (multi)
        const prioritySet = new Set<string>();
        for (const m of raw.matchAll(/\bpriority:\(([^)]+)\)/gi)) {
            const inside = (m[1] || '').split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
            inside.forEach(v => prioritySet.add(v));
        }
        for (const m of raw.matchAll(/\bpriority:([^\s()]+)/gi)) {
            if (m[1]) prioritySet.add(m[1]);
        }
        if ((refsLocal as any).priority) {
            const priorities = Array.from(prioritySet);
            console.debug('[KH Search] syncFromOriginalLocal: parsed.priority[] =', priorities);
            ((refsLocal as any).priority as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
                cb.checked = priorities.includes(cb.value);
            });
        }
        // status (multi)
        const statusSet = new Set<string>();
        for (const m of raw.matchAll(/\bstatus:\(([^)]+)\)/gi)) {
            const inside = (m[1] || '').split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
            inside.forEach(v => statusSet.add(v));
        }
        for (const m of raw.matchAll(/\bstatus:([^\s()]+)/gi)) {
            if (m[1]) statusSet.add(m[1]);
        }
        if ((refsLocal as any).status) {
            const statuses = Array.from(statusSet);
            console.debug('[KH Search] syncFromOriginalLocal: parsed.status[] =', statuses);
            ((refsLocal as any).status as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
                cb.checked = statuses.includes(cb.value);
            });
        }
        (['custom_key'] as const).forEach(k => { const m = raw.match(new RegExp(`\\b${k}:(?:"([^"]*)"|(null))`, 'i')); if (m) parsed[k] = (m[1] ?? m[2])!; });
        [...raw.matchAll(/\b(created|updated)([:<>])(\d{4}-\d{2}-\d{2})/gi)].forEach(m => (parsed as any)[m[1] as 'created' | 'updated'] = `${m[2]}${m[3]}`);
        let kw = raw
            .replace(/\bin:[^\s()]+/gi, '')
            .replace(/\bchannel:[^\s()]+/gi, '')
            .replace(/\b(?:assignee|team|tag|subject|body|product|brand|name|creator|organization):(?:\"[^\"]*\"|null)/gi, '')
            .replace(/\bstatus:\([^)]*\)/gi, '')
            .replace(/\bstatus:[^\s()]+/gi, '')
            .replace(/\bpriority:\([^)]*\)/gi, '')
            .replace(/\bpriority:[^\s()]+/gi, '')
            .replace(/\b(?:created|updated)(?:[:<>])\d{4}-\d{2}-\d{2}/gi, '');
        if (parsed.custom_key) { const esc = parsed.custom_key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); kw = kw.replace(new RegExp(`\\b${esc}:"[^"]*"`, 'gi'), ''); }
        kw = kw.replace(/\s+OR\s+/gi, ' ').replace(/[()]/g, ' ').replace(/\s{2,}/g, ' ').trim(); if (/^(?:OR\s*)+$/i.test(kw)) kw = '';
        refsLocal.qbox!.value = kw;
        (refsLocal.in as HTMLElement)!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = parsed.in?.includes(cb.value) ?? false; });
        if (refsLocal.channel) { (refsLocal.channel as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = parsed.channel?.includes(cb.value) ?? false; }); }
        (['assignee','team','tag','subject','body','product','brand','name','creator','organization'] as const).forEach(k => { ((refsLocal as any)[k] as HTMLInputElement).value = parsed[k] ?? ''; });
        if ((refsLocal as any).priority) {
            const priorities = Array.from(prioritySet);
            console.debug('[KH Search] syncFromOriginalLocal: set priority[] checkboxes');
            ((refsLocal as any).priority as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
                cb.checked = priorities.includes(cb.value);
            });
        }
        if (parsed.custom_key)  (refsLocal.custom_key as HTMLInputElement).value = parsed.custom_key;
        if (parsed.custom_val)  (refsLocal.custom_val as HTMLInputElement).value = parsed.custom_val;
        (['created','updated'] as const).forEach(k => { const w = (refsLocal as any)[k] as HTMLElement | undefined; if (!w) return; const sel = w.querySelector('select') as HTMLSelectElement; const inp = w.querySelector('input[type="date"]') as HTMLInputElement; const pk = parsed[k]; if (pk && pk.length >= 2) { sel.value = pk.charAt(0); inp.value = pk.slice(1); } else { inp.value = ''; } });
    }

    // Events
    const onAnyInput = () => syncToOriginalLocal();
    queryBox.addEventListener('input', onAnyInput);
    queryBox.addEventListener('keyup', onAnyInput);
    controlsLi.addEventListener('input', onAnyInput);
    controlsLi.addEventListener('change', onAnyInput);
    uiWrap.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            try { triggerEnterOnOriginal(); } catch {}
        }
    });
    originalInputEl.addEventListener('input',  () => syncFromOriginalLocal());
    originalInputEl.addEventListener('keyup',  () => syncFromOriginalLocal());
    document.addEventListener('click', e => { if (openDropdownLocal && !openDropdownLocal.contains(e.target as Node) && !openDropdownLocal.previousSibling!.contains(e.target as Node)) { openDropdownLocal.classList.remove('open'); openDropdownLocal = null; } });

    // Initial
    syncFromOriginalLocal();
    // Ensure defaults if query lacks in: terms
    const hasIn = /\bin:([^\s()]+)/i.test(originalInputEl.value);
    if (!hasIn) {
        const checkboxes = Array.from((refsLocal.in as HTMLElement).querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        let toSelect: string[] | null = null;
        if (prefRememberSearchIn && Array.isArray(lastSelectedSearchIn)) toSelect = lastSelectedSearchIn; else if (!prefRememberSearchIn && Array.isArray(prefDefaultSearchIn)) toSelect = prefDefaultSearchIn; if (!toSelect || toSelect.length === 0) toSelect = ['Conversations'];
        checkboxes.forEach(cb => cb.checked = toSelect!.includes(cb.value));
        syncToOriginalLocal();
    }

    try { queryBox?.focus({ preventScroll: true }); } catch {}
}


/* ----------  CONTROL BUILDERS  ------------------------------------------ */
function buildLabel(t: string) {
    const span = document.createElement('span');
    span.textContent = t;            // ← no colon
    span.className   = CL_LABEL;
    return span;
}

function buildInlineInCheckboxes(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = CL_FIELD;
    wrap.appendChild(buildLabel('Search in'));

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.gap = '8px';
    container.style.flexWrap = 'wrap';

    IN_VALUES.forEach(v => {
        const id = `kh-in-${v}`;
        const div = document.createElement('div');
        div.innerHTML = `<input type="checkbox" id="${id}" value="${v}">
                         <label for="${id}">${v}</label>`;
        const cb = div.querySelector('input')! as HTMLInputElement;
        cb.addEventListener('change', () => {
            syncToOriginal();
            if (prefRememberSearchIn) {
                const chosen = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map(n => n.value);
                try { chrome.storage.sync.set({ searchInLastSelection: chosen }); } catch {}
            }
        });
        container.appendChild(div);
    });

    wrap.appendChild(container);
    refs.in = wrap;
    console.debug('[KH Search] UI: built inline in[] checkboxes');
    return wrap;
}

function buildChannelDropdown(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = CL_FIELD;
    wrap.appendChild(buildLabel('Channel'));

    const trig = document.createElement('button');
    trig.innerHTML = 'Pick channels <span>▼</span> ';
    trig.className = CL_DROP_TRIGGER;
    wrap.appendChild(trig);

    const dd = document.createElement('div');
    dd.className = CL_DROPDOWN;

    CHANNEL_VALUES.forEach(v => {
        const id = `kh-channel-${v}`;
        dd.insertAdjacentHTML(
            'beforeend',
            `<div><input type="checkbox" id="${id}" value="${v}">
       <label for="${id}">${v}</label></div>`
        );
    });

    const cls = document.createElement('button');
    cls.textContent = 'Close';
    cls.className = CL_CLOSE_BTN;
    cls.addEventListener('click', () => {
        dd.classList.remove('open');
        openDropdown = null;
    });
    dd.append(cls);
    wrap.appendChild(dd);

    trig.addEventListener('click', e => {
        e.stopPropagation();
        const o = dd.classList.toggle('open');
        openDropdown = o ? dd : null;
    });
    dd.addEventListener('change', syncToOriginal);

    refs.channel = wrap;
    console.debug('[KH Search] UI: built channel dropdown');
    return wrap;
}

function buildText(key: Exclude<ModKey, 'in' | 'status' | 'priority' | 'custom_key' | 'custom_val' | 'created' | 'updated'>,
                   label?: string): HTMLElement {
    const w = document.createElement('div');
    w.className = CL_FIELD;

    w.append(buildLabel(label ?? key.charAt(0).toUpperCase() + key.slice(1)));

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.placeholder = `${key.charAt(0).toUpperCase() + key.slice(1)} to search for`;
    inp.className   = CL_TEXT_INPUT;
    inp.addEventListener('input', syncToOriginal);
    w.append(inp);

    refs[key] = inp;
    return w;
}

function buildDropdown(
    key: 'status' | 'priority',
    label: string,
    options: readonly string[]
): HTMLElement {
    const w = document.createElement('div');
    w.classList.add(CL_FIELD, 'kh-field-dropdown');

    w.append(buildLabel(label));

    const sel = document.createElement('select');
    sel.append(new Option('', ''));     // empty default
    options.forEach(o => sel.append(new Option(o, o)));
    sel.addEventListener('change', syncToOriginal);
    w.append(sel);

    refs[key] = sel;
    return w;
}

function buildCustomField(): HTMLElement {
    const w = document.createElement('div');
    w.classList.add(CL_FIELD, EXTENSION_SELECTORS.searchEnhancerCustomField.replace(/^./, ''));

    w.append(buildLabel('Custom field'));

    const keyInp = document.createElement('input');
    keyInp.type = 'text';
    keyInp.placeholder = `Custom field's API key`;
    keyInp.className = CL_TEXT_INPUT;
    keyInp.addEventListener('input', syncToOriginal);

    const valInp = document.createElement('input');
    valInp.type = 'text';
    valInp.placeholder = `Custom field's value`;
    valInp.className = CL_TEXT_INPUT;
    valInp.addEventListener('input', syncToOriginal);

    refs.custom_key = keyInp;
    refs.custom_val = valInp;

    w.append(keyInp, valInp);
    return w;
}

function buildDate(key: 'created' | 'updated'): HTMLElement {
    /* outer field container (same as before) */
    const w = document.createElement('div');
    w.classList.add(
        CL_FIELD,
        EXTENSION_SELECTORS.searchEnhancerDateField.replace(/^./, '')
    );

    /* label */
    const label = key === 'created' ? 'Creation date' : 'Update date';
    w.append(buildLabel(label));

    /* --- NEW: wrap the two controls so they share the same grid cell ---- */
    const wrap = document.createElement('div');
    wrap.className = 'kh-date-wrap';
    wrap.style.display = 'flex';
    wrap.style.gap = '6px';
    wrap.style.flex = '1 1 100%';
    /* ------------------------------------------------------------------- */

    /* operator select */
    const sel = document.createElement('select');
    OP_VALUES.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.op;
        opt.textContent = o.label;
        sel.append(opt);
    });

    const selWrapper = document.createElement('div');
    selWrapper.className = 'kh-date-select-wrapper';
    selWrapper.append(sel);

    /* date picker */
    const dt = document.createElement('input');
    dt.type = 'date';

    [sel, dt].forEach(el => el.addEventListener('change', syncToOriginal));

    wrap.append(selWrapper, dt);
    w.append(wrap);

    refs[key] = w;
    return w;
}

/* ----------  SYNC: helper ------------------------------------------------ */
function syncToOriginal(): void {
    if (!originalInput) return;

    /* ------------------------------------------------------------------ */
    isSyncingToOriginal = true;      // <-- RE-ENTRANCY GUARD (begin)
    /* ------------------------------------------------------------------ */

    const parts: string[] = [];
    const qBox = document.getElementById(QUERY_INPUT_ID)! as HTMLInputElement;
    const kw = qBox.value.trim();
    console.debug('[KH Search] syncToOriginal: keywords =', kw);
    if (kw) parts.push(kw);

    /* in: */
    const chosen = Array.from(
        refs.in!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    console.debug('[KH Search] syncToOriginal: in[] =', chosen);
    if (chosen.length === 1) {
        parts.push(`in:${chosen[0]}`);
    } else if (chosen.length > 1) {
        parts.push('(' + chosen.map(v => `in:${v}`).join(' OR ') + ')');
    }

    /* persist last selection if requested */
    if (prefRememberSearchIn) {
        try {
            chrome.storage.sync.set({ searchInLastSelection: chosen });
            console.debug('[KH Search] saved last in[] selection', chosen);
        } catch (e) {
            console.warn('[KH Search] failed to save last in[] selection', e);
        }
    }

    /* ---------- simple text fields (quotes omitted when value === "null") ---- */
    (['assignee','team','tag','subject','body','name','creator','organization'] as const)
        .forEach(k => {
            const val = (refs[k] as HTMLInputElement).value.trim();
            if (val) {
                const needsQuotes = val.toLowerCase() !== 'null';
                parts.push(`${k}:${needsQuotes ? `"${val}"` : val}`);
            }
        });

    /* dropdowns */
    (['priority'] as const).forEach(k => {
        const val = (refs[k] as HTMLSelectElement).value;
        if (val) parts.push(`${k}:${val}`);
    });

    /* channel (multi) */
    if (refs.channel) {
        const sel = Array.from(refs.channel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
            .map(cb => cb.value);
        console.debug('[KH Search] syncToOriginal: channel[] =', sel);
        if (sel.length === 1) parts.push(`channel:${sel[0]}`);
        else if (sel.length > 1) parts.push('(' + sel.map(v => `channel:${v}`).join(' OR ') + ')');
    }

    /* custom field */
    const cfKey = (refs.custom_key as HTMLInputElement).value.trim();
    const cfVal = (refs.custom_val as HTMLInputElement).value.trim();
    if (cfKey && cfVal) parts.push(`${cfKey}:"${cfVal}"`);

    /* dates */
    (['created', 'updated'] as const).forEach(k => {
        const w  = refs[k]!;
        const op = (w.querySelector('select') as HTMLSelectElement).value;
        const d  = (w.querySelector('input[type="date"]') as HTMLInputElement).value;
        if (d) parts.push(`${k}${op}${d}`);
    });

    const finalQuery = parts.join(' ').trim();
    console.debug('[KH Search] syncToOriginal: final query =', finalQuery);
    setNativeInputValue(originalInput, finalQuery);
    originalInput.dispatchEvent(new Event('input',  { bubbles: true }));
    originalInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));

    /* ------------------------------------------------------------------ */
    /* Let the events we just dispatched propagate, *then* drop the guard */
    setTimeout(() => { isSyncingToOriginal = false; }, 0);
    /* ------------------------------------------------------------------ */
}

function syncFromOriginal(ev?: Event): void {
    if (ev && ev.currentTarget && ev.currentTarget !== originalInput) return;
    if (isSyncingToOriginal || !originalInput) return;

    const raw = originalInput.value;
    console.debug('[KH Search] syncFromOriginal: raw =', raw);

    const parsed: ParsedQuery = {};

    /* in */
    parsed.in = [...raw.matchAll(/\bin:([^\s()]+)/gi)].map(m => m[1]!).filter(Boolean) as string[];
    console.debug('[KH Search] syncFromOriginal: parsed.in =', parsed.in);

    /* channel */
    parsed.channel = [...raw.matchAll(/\bchannel:([^\s()]+)/gi)].map(m => m[1]!).filter(Boolean) as string[];
    console.debug('[KH Search] syncFromOriginal: parsed.channel =', parsed.channel);

    /* -------- simple text (accepts both quoted and un-quoted null) -------- */
    (['assignee','team','tag','subject','body','name','creator','organization'] as const)
        .forEach(k => {
            const m = raw.match(new RegExp(`\\b${k}:(?:"([^"]*)"|(null))`, 'i'));
            if (m) parsed[k] = (m[1] ?? m[2])!;
        });

    /* dropdowns */
    (['priority'] as const).forEach(k => {
        const m = raw.match(new RegExp(`\\b${k}:([^\\s]+)`, 'i'));
        if (m && m[1]) parsed[k] = m[1] as string;
    });

    /* custom field – pick the first key:"value" pair that is NOT a built-in key */
    for (const m of raw.matchAll(/(\w+):"([^"]+)"/g)) {
        const key = m[1];
        const val = m[2];
        if (key && !(['assignee','team','tag','subject','body','name','creator','organization','priority'] as readonly string[]).includes(key)) {
            parsed.custom_key = key as string;
            parsed.custom_val = val as string;
            break;
        }
    }

    /* dates */
    [...raw.matchAll(/\b(created|updated)([:<>])(\d{4}-\d{2}-\d{2})/gi)]
        .forEach(m => parsed[m[1] as 'created' | 'updated'] = `${m[2]}${m[3]}`);

    /* keywords */
    const qBox = document.getElementById(QUERY_INPUT_ID)! as HTMLInputElement;
    let kw = raw
        .replace(/\bin:[^\s()]+/gi, '')
        .replace(/\bchannel:[^\s()]+/gi, '')
        .replace(/\b(?:assignee|team|tag|subject|body|product|brand|name|creator|organization):(?:\"[^\"]*\"|null)/gi, '')
        .replace(/\bstatus:\([^)]*\)/gi, '')
        .replace(/\bstatus:[^\s()]+/gi, '')
        .replace(/\bpriority:\([^)]*\)/gi, '')
        .replace(/\bpriority:[^\s()]+/gi, '')
        .replace(/\b(?:created|updated)(?:[:<>])\d{4}-\d{2}-\d{2}/gi, '');

    /* --------- strip current custom-field pair from kw -------------------- */
    if (parsed.custom_key) {
        const esc = parsed.custom_key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        kw = kw.replace(new RegExp(`\\b${esc}:"[^"]*"`, 'gi'), '');
    }
    /* ---------------------------------------------------------------------- */

    kw = kw
        .replace(/\s+OR\s+/gi, ' ')
        .replace(/[()]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (/^(?:OR\s*)+$/i.test(kw)) kw = '';
    qBox.value = kw;
    console.debug('[KH Search] syncFromOriginal: keywords ->', kw);

    /* update helpers ------------------------------------------------------ */
    refs.in!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
        cb.checked = parsed.in?.includes(cb.value) ?? false;
    });
    console.debug('[KH Search] syncFromOriginal: set in[] checkboxes');

    /* channel */
    if (refs.channel) {
        refs.channel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
            cb.checked = parsed.channel?.includes(cb.value) ?? false;
        });
        console.debug('[KH Search] syncFromOriginal: set channel[] checkboxes');
    }

    (['assignee','team','tag','subject','body','name','creator','organization'] as const)
        .forEach(k => {
            (refs[k] as HTMLInputElement).value = parsed[k] ?? '';
        });

    (['priority'] as const).forEach(k => {
        (refs[k] as HTMLSelectElement).value = parsed[k] ?? '';
    });

    if (parsed.custom_key)  (refs.custom_key as HTMLInputElement).value = parsed.custom_key;
    if (parsed.custom_val)  (refs.custom_val as HTMLInputElement).value = parsed.custom_val;

    /* dates */
    (['created', 'updated'] as const).forEach(k => {
        const w   = refs[k]!;
        const sel = w.querySelector('select') as HTMLSelectElement;
        const inp = w.querySelector('input[type="date"]') as HTMLInputElement;

        const pk = parsed[k];
        if (pk && pk.length >= 2) {
            sel.value = pk.charAt(0);           // ':' | '>' | '<'
            inp.value = pk.slice(1);            // yyyy-mm-dd
        } else {
            /* keep the operator as-is so the user can pick it first without losing it */
            inp.value = '';
        }
    });
}

function ensureDefaultInSelection(): void {
    if (!refs.in || !originalInput) return;
    const hasInInQuery = /\bin:([^\s()]+)/i.test(originalInput.value);
    if (hasInInQuery) return;

    const checkboxes = Array.from(refs.in.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

    let toSelect: string[] | null = null;

    if (prefRememberSearchIn && Array.isArray(lastSelectedSearchIn)) {
        toSelect = lastSelectedSearchIn;
    } else if (!prefRememberSearchIn && Array.isArray(prefDefaultSearchIn)) {
        toSelect = prefDefaultSearchIn;
    }

    if (!toSelect || toSelect.length === 0) {
        toSelect = ['Conversations'];
    }

    checkboxes.forEach(cb => cb.checked = toSelect!.includes(cb.value));
    syncToOriginal();
}
