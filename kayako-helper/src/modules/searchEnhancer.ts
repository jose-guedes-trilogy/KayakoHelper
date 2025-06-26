/* ============================================================================
 * src/modules/searchEnhancer.ts
 *
 * Kayako Helper – Search UI Enhancement
 * ========================================================================= */

import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/generated/selectors';

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

/* ----------  TYPES  ------------------------------------------------------ */
type ModKey =
    | 'in' | 'assignee' | 'team' | 'tag' | 'status' | 'subject' | 'body'
    | 'name' | 'creator' | 'organization' | 'priority'
    | 'custom_key' | 'custom_val'
    | 'created' | 'updated';

interface ParsedQuery {
    in?: string[];
    assignee?: string;
    team?: string;
    tag?: string;
    status?: string;
    subject?: string;
    body?: string;
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

/* ----------  ENTRY POINT  ------------------------------------------------ */
export function bootSearchEnhancer(): void {
    new MutationObserver(injectUI).observe(document.body, { childList: true, subtree: true });
    injectUI();
}

/* ----------  UI BUILD  --------------------------------------------------- */
function injectUI(): void {
    const host = document.querySelector<HTMLElement>(RESULTS_LIST_SELECTOR);
    if (!host || host.querySelector(`#${QUERY_INPUT_ID}`)) return;

    /* keyword box */
    const queryLi      = document.createElement('div');

    queryLi.style.display = 'flex';
    queryLi.style.gap = '8px';
    queryLi.style.alignItems = 'center';
    queryLi.style.whiteSpace = 'nowrap';
    queryLi.style.marginBottom = '4px';

    queryLi.innerHTML  =
        `<span class="kh-enhanced-search-label">Search terms</span> <input id="${QUERY_INPUT_ID}" class="${CL_QUERY_INPUT}" type="text" placeholder="Enter the terms you'd like to search for">`;

    /* controls row */
    const controlsLi   = document.createElement('div');
    controlsLi.className = CL_CONTROLS;
    controlsLi.append(
        buildMultiIn(),
        buildText('assignee', 'Assignee'),
        buildText('team', 'Team'),
        buildText('tag', 'Tag'),
        buildDropdown('status', 'Status', STATUS_VALUES),
        buildText('subject', 'Subject'),
        buildText('body', 'Body'),
        buildText('name', 'Name'),
        buildText('creator', 'Creator'),
        buildText('organization', 'Organization'),
        buildDropdown('priority', 'Priority', PRIORITY_VALUES),
        buildCustomField(),
        buildDate('created'),
        buildDate('updated')
    );

    /* container for our elements */
    const uiWrap = document.createElement('div');
    uiWrap.id = UI_PARENT_ID;
    uiWrap.append(queryLi, controlsLi);

    host.prepend(uiWrap);

    /* events */
    originalInput = document.querySelector<HTMLInputElement>(ORIGINAL_INPUT_SELECTOR)!;
    const queryBox = document.getElementById(QUERY_INPUT_ID)! as HTMLInputElement;

    queryBox.addEventListener('input',  syncToOriginal);
    queryBox.addEventListener('keyup',  syncToOriginal);
    controlsLi.addEventListener('input',  syncToOriginal);
    controlsLi.addEventListener('change', syncToOriginal);

    originalInput.addEventListener('input', syncFromOriginal);
    originalInput.addEventListener('keyup',  syncFromOriginal);

    /* close dropdown on outside click */
    document.addEventListener('click', e => {
        if (openDropdown && !openDropdown.contains(e.target as Node) &&
            !openDropdown.previousSibling!.contains(e.target as Node)) {
            openDropdown.classList.remove('open');
            openDropdown = null;
        }
    });

    syncFromOriginal();
}

/* ----------  CONTROL BUILDERS  ------------------------------------------ */
function buildLabel(t: string) {
    const span = document.createElement('span');
    span.textContent = t;            // ← no colon
    span.className   = CL_LABEL;
    return span;
}

function buildMultiIn(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = CL_FIELD;
    wrap.appendChild(buildLabel('Search in'));

    const trig = document.createElement('button');
    trig.innerHTML = 'Search locations <span>▼</span> ';
    trig.className   = CL_DROP_TRIGGER;
    wrap.appendChild(trig);

    const dd = document.createElement('div');
    dd.className = CL_DROPDOWN;

    IN_VALUES.forEach(v => {
        const id = `kh-in-${v}`;
        dd.insertAdjacentHTML(
            'beforeend',
            `<div><input type="checkbox" id="${id}" value="${v}">
       <label for="${id}">${v}</label></div>`
        );
    });

    const cls = document.createElement('button');
    cls.textContent = 'Close';
    cls.className   = CL_CLOSE_BTN;
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

    refs.in = wrap;
    return wrap;
}

function buildText(key: Exclude<ModKey, 'in' | 'status' | 'priority' | 'custom_key' | 'custom_val' | 'created' | 'updated'>,
                   label?: string): HTMLElement {
    const w = document.createElement('div');
    w.className = CL_FIELD;

    w.append(buildLabel(label ?? key[0].toUpperCase() + key.slice(1)));

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
    if (qBox.value.trim()) parts.push(qBox.value.trim());

    /* in: */
    const chosen = Array.from(
        refs.in!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    if (chosen.length === 1) {
        parts.push(`in:${chosen[0]}`);
    } else if (chosen.length > 1) {
        parts.push('(' + chosen.map(v => `in:${v}`).join(' OR ') + ')');
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
    (['status','priority'] as const).forEach(k => {
        const val = (refs[k] as HTMLSelectElement).value;
        if (val) parts.push(`${k}:${val}`);
    });

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

    originalInput.value = parts.join(' ').trim();
    originalInput.dispatchEvent(new Event('input',  { bubbles: true }));
    originalInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));

    /* ------------------------------------------------------------------ */
    /* Let the events we just dispatched propagate, *then* drop the guard */
    setTimeout(() => { isSyncingToOriginal = false; }, 0);
    /* ------------------------------------------------------------------ */
}

function syncFromOriginal(): void {
    /* If this was triggered by syncToOriginal we ignore it,
       so the user’s caret/spacing isn’t disturbed. */
    if (isSyncingToOriginal || !originalInput) return;

    const raw = originalInput.value;

    const parsed: ParsedQuery = {};

    /* in */
    parsed.in = [...raw.matchAll(/\bin:([^\s()]+)/gi)].map(m => m[1]);

    /* -------- simple text (accepts both quoted and un-quoted null) -------- */
    (['assignee','team','tag','subject','body','name','creator','organization'] as const)
        .forEach(k => {
            const m = raw.match(new RegExp(`\\b${k}:(?:"([^"]*)"|(null))`, 'i'));
            if (m) parsed[k] = (m[1] ?? m[2])!;
        });

    /* dropdowns */
    (['status','priority'] as const).forEach(k => {
        const m = raw.match(new RegExp(`\\b${k}:([^\\s]+)`, 'i'));
        if (m) parsed[k] = m[1];
    });

    /* custom field – pick the first key:"value" pair that is NOT a built-in key */
    for (const m of raw.matchAll(/(\w+):"([^"]+)"/g)) {
        if (!(['assignee','team','tag','subject','body','name','creator','organization','status','priority'] as readonly string[]).includes(m[1])) {
            parsed.custom_key = m[1];
            parsed.custom_val = m[2];
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
        .replace(/\b(?:assignee|team|tag|subject|body|name|creator|organization):(?:"[^"]*"|null)/gi, '')
        .replace(/\b(?:status|priority):[^\s"]+/gi, '')
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

    /* update helpers ------------------------------------------------------ */
    refs.in!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        .forEach(cb => cb.checked = parsed.in?.includes(cb.value) ?? false);

    (['assignee','team','tag','subject','body','name','creator','organization'] as const)
        .forEach(k => {
            (refs[k] as HTMLInputElement).value = parsed[k] ?? '';
        });

    (['status','priority'] as const).forEach(k => {
        (refs[k] as HTMLSelectElement).value = parsed[k] ?? '';
    });

    if (parsed.custom_key)  (refs.custom_key as HTMLInputElement).value = parsed.custom_key;
    if (parsed.custom_val)  (refs.custom_val as HTMLInputElement).value = parsed.custom_val;

    /* dates */
    (['created', 'updated'] as const).forEach(k => {
        const w   = refs[k]!;
        const sel = w.querySelector('select') as HTMLSelectElement;
        const inp = w.querySelector('input[type="date"]') as HTMLInputElement;

        if (parsed[k]) {
            sel.value = parsed[k]![0];           // ':' | '>' | '<'
            inp.value = parsed[k]!.slice(1);     // yyyy-mm-dd
        } else {
            /* keep the operator as-is so the user can pick it first without losing it */
            inp.value = '';
        }
    });
}
