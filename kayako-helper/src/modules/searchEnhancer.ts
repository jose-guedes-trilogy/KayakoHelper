/* ============================================================================
 * Kayako Helper – Search UI Enhancement (v2.5)
 *   • v2.5 – UI labels updated (no colons)
 * ========================================================================== */

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

const UI_PARENT_ID            = EXTENSION_SELECTORS
    .unifiedSearchElementsParentId
    .replace(/^#/, '');

/* ----------  TYPES  ------------------------------------------------------ */
type ModKey = 'in' | 'assignee' | 'tag' | 'created' | 'updated';
interface ParsedQuery {
    in?: string[];
    assignee?: string;
    tag?: string;
    created?: string;
    updated?: string;
}

/* ----------  METADATA  --------------------------------------------------- */
const IN_VALUES = ['conversations', 'users', 'organizations', 'articles'] as const;
const OP_VALUES = [
    { label: 'on',     op: ':' },
    { label: 'after',  op: '>' },
    { label: 'before', op: '<' }
] as const;

/* ----------  STATE  ------------------------------------------------------ */
let originalInput : HTMLInputElement | null = null;
let openDropdown  : HTMLElement | null      = null;
const refs: Partial<Record<ModKey, HTMLElement>> = {};

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
    queryLi.innerHTML  =
        `<input id="${QUERY_INPUT_ID}" class="${CL_QUERY_INPUT}" type="text" placeholder="Search keywords…">`;

    /* controls row */
    const controlsLi   = document.createElement('div');
    controlsLi.className = CL_CONTROLS;
    controlsLi.append(
        buildMultiIn(),
        buildText('assignee'),
        buildText('tag'),
        buildDate('created'),
        buildDate('updated')
    );

    /* container for our elements */
    const uiWrap = document.createElement('div');
    uiWrap.id = UI_PARENT_ID;
    uiWrap.append(controlsLi, queryLi);

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
    trig.innerHTML = '<span style="font-size: 5px">▼</span> Search locations';
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

function buildText(key: 'assignee' | 'tag') {
    const w = document.createElement('div');
    w.className = CL_FIELD;

    const label = key === 'assignee' ? 'Assignee' : 'Tag';
    w.append(buildLabel(label));

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.placeholder = `${key} value`;
    inp.className   = CL_TEXT_INPUT;
    inp.addEventListener('input', syncToOriginal);
    w.append(inp);

    refs[key] = inp;
    return w;
}

function buildDate(key: 'created' | 'updated') {
    const w = document.createElement('div');
    w.className = CL_FIELD;

    const label = key === 'created' ? 'Creation date' : 'Update date';
    w.append(buildLabel(label));

    const sel = document.createElement('select');
    OP_VALUES.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.op;
        opt.textContent = o.label;
        sel.append(opt);
    });

    const dt = document.createElement('input');
    dt.type = 'date';

    [sel, dt].forEach(el => el.addEventListener('change', syncToOriginal));
    w.append(sel, dt);

    refs[key] = w;
    return w;
}

/* ----------  SYNC: helper ------------------------------------------------ */
function syncToOriginal(): void {
    if (!originalInput) return;

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

    /* assignee, tag */
    (['assignee', 'tag'] as const).forEach(k => {
        const val = (refs[k] as HTMLInputElement).value.trim();
        if (val) parts.push(`${k}:"${val}"`);
    });

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
}

function syncFromOriginal(): void {
    if (!originalInput) return;
    const raw = originalInput.value;

    const parsed: ParsedQuery = {};
    parsed.in = [...raw.matchAll(/\bin:([^\s()]+)/gi)].map(m => m[1]);

    [...raw.matchAll(/\b(assignee|tag):"([^"]*)"/gi)]
        .forEach(m => parsed[m[1] as 'assignee' | 'tag'] = m[2]);

    [...raw.matchAll(/\b(created|updated)([:<>])(\d{4}-\d{2}-\d{2})/gi)]
        .forEach(m => parsed[m[1] as 'created' | 'updated'] = `${m[2]}${m[3]}`);

    /* keywords */
    const qBox = document.getElementById(QUERY_INPUT_ID)! as HTMLInputElement;
    let kw = raw
        .replace(/\bin:[^\s()]+/gi, '')
        .replace(/\b(assignee|tag):"[^"]*"/gi, '')
        .replace(/\b(created|updated)([:<>])\d{4}-\d{2}-\d{2}/gi, '')
        .replace(/\s+OR\s+/gi, ' ')
        .replace(/[()]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (/^(?:OR\s*)+$/i.test(kw)) kw = '';
    qBox.value = kw;

    /* update helpers */
    refs.in!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        .forEach(cb => cb.checked = parsed.in?.includes(cb.value) ?? false);

    (['assignee', 'tag'] as const).forEach(k => {
        (refs[k] as HTMLInputElement).value = parsed[k] ?? '';
    });

    (['created', 'updated'] as const).forEach(k => {
        const w   = refs[k]!;
        const sel = w.querySelector('select') as HTMLSelectElement;
        const inp = w.querySelector('input[type="date"]') as HTMLInputElement;

        if (!parsed[k]) { sel.value = ':'; inp.value = ''; return; }
        sel.value  = parsed[k]![0];
        inp.value  = parsed[k]!.slice(1);
    });
}
