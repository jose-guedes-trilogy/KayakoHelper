/* ============================================================================
*  Kayako Helper – Search UI Enhancement
*  File:  searchEnhancer.ts              (drop-in/stand-alone module)
*  Description:
*    - Adds a “keywords-only” input at the top of the results list.
*    - Provides buttons for the most-used search modifiers
*      (in, assignee, tag, created, updated).
*    - Keeps the new controls and the native search box in perfect sync,
*      regardless of where the user types or edits.
*    - No external dependencies – ready to paste into any content script.
* ========================================================================== */


/* ----------  CONSTANTS & TYPES  --------------------------------------- */
import {injectStyles} from "@/utils/dom";

const ORIGINAL_INPUT_SELECTOR   = '#ko-ember3114-input';
const RESULTS_LIST_SELECTOR     = 'div[class^="ko-universal-search__results-list_"]';
const LIST_UL_SELECTOR          = 'ul[class^="ko-universal-search__list_"]';
const QUERY_INPUT_ID            = 'kh-query-only-input';

interface ParsedQuery { [key: string]: string; }

const MODIFIERS = {
    in:       { type: 'dropdown', values: ['conversations', 'users', 'organizations', 'articles'] },
    assignee: { type: 'text'     },
    tag:      { type: 'text'     },
    created:  { type: 'date'     },
    updated:  { type: 'date'     },
} as const;

/* ----------  STATE  ---------------------------------------------------- */
let originalInput: HTMLInputElement | null = null;

/* ----------  INITIALISATION & DOM HOOK-UP  ----------------------------- */
export function bootSearchEnhancer(): void {
    const observer = new MutationObserver(() => injectUI());
    observer.observe(document.body, { childList: true, subtree: true });
    injectUI(); // first attempt in case the node is already present
}

/* ----------  CORE FUNCTIONS  ------------------------------------------ */
function injectUI(): void {
    const resultsList = document.querySelector<HTMLElement>(RESULTS_LIST_SELECTOR);
    if (!resultsList) return;
    if (resultsList.querySelector(`#${QUERY_INPUT_ID}`)) return; // already injected

    injectStyles();

    /* ----- add keywords-only input ------------------------------------- */
    const queryContainer = document.createElement('li');
    queryContainer.style.listStyle = 'none';
    const queryInput = document.createElement('input');
    queryInput.type        = 'text';
    queryInput.id          = QUERY_INPUT_ID;
    queryInput.placeholder = 'Search keywords…';
    queryInput.className   = 'kh-query-input';
    queryContainer.appendChild(queryInput);

    /* ----- add modifier buttons ---------------------------------------- */
    const buttonContainer = document.createElement('li');
    buttonContainer.style.cssText = `
  list-style:none;
  display:flex;
  flex-wrap:wrap;
  gap:4px;
`;

    Object.keys(MODIFIERS).forEach(key => {
        const btn = document.createElement('button');
        btn.textContent = `${key}:`;
        btn.dataset.modifier = key;
        btn.className = 'kh-modifier-btn';
        buttonContainer.appendChild(btn);
    });

    /* ----- insert both into DOM ---------------------------------------- */
    const ul = resultsList.querySelector<HTMLUListElement>(LIST_UL_SELECTOR);
    if (!ul) return;
    ul.insertBefore(queryContainer, ul.firstChild);
    ul.insertBefore(buttonContainer, queryContainer.nextSibling);

    /* ----- wire-up events ---------------------------------------------- */
    originalInput = document.querySelector<HTMLInputElement>(ORIGINAL_INPUT_SELECTOR);
    if (!originalInput) return;

    queryInput.addEventListener('input',  () => syncToOriginal());
    originalInput.addEventListener('input', () => syncFromOriginal());
    buttonContainer.addEventListener('click', openModifier);

    syncFromOriginal(); // one-time initial sync
}

/* ----------  UI HELPERS  --------------------------------------------- */
function openModifier(ev: Event): void {
    const target = ev.target as HTMLElement;
    if (!target?.dataset.modifier) return;
    const mod = target.dataset.modifier as keyof typeof MODIFIERS;
    createPopover(target, mod);
}

function createPopover(anchor: HTMLElement, mod: keyof typeof MODIFIERS): void {
    document.querySelectorAll('.kh-popover').forEach(p => p.remove()); // clean existing

    const pop = document.createElement('div');
    pop.className = 'kh-popover';
    pop.style.cssText = `
  position:absolute;
  z-index:9999;
  padding:6px;
  border:1px solid #ccc;
  background:#fff;
  border-radius:4px;
  box-shadow:0 2px 6px rgba(0,0,0,.12);
`;

    /* --- field -------------------------------------------------------- */
    let input: HTMLElement;
    const info = MODIFIERS[mod];

    if (info.type === 'dropdown') {
        const select = document.createElement('select');
        info.values!.forEach(v => {
            const option = document.createElement('option');
            option.value = v;
            option.textContent = v;
            select.appendChild(option);
        });
        input = select;
    } else if (info.type === 'text') {
        const txt = document.createElement('input');
        txt.type = 'text';
        txt.placeholder = `${mod} value`;
        input = txt;
    } else { // date
        const wrapper = document.createElement('div');
        const opSelect = document.createElement('select');
        ['on', 'before', 'after'].forEach(op => {
            const option = document.createElement('option');
            option.value = op;
            option.textContent = op;
            opSelect.appendChild(option);
        });
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        wrapper.append(opSelect, dateInput);
        wrapper.style.display = 'flex';
        wrapper.style.gap = '4px';
        input = wrapper;
    }
    pop.appendChild(input);

    /* --- save button -------------------------------------------------- */
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.marginLeft = '6px';
    saveBtn.addEventListener('click', () => {
        applyModifier(mod, input);
        pop.remove();
    });
    pop.appendChild(saveBtn);

    /* --- mount -------------------------------------------------------- */
    document.body.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.top  = `${rect.bottom + window.scrollY}px`;
    pop.style.left = `${rect.left   + window.scrollX}px`;
}

function applyModifier(mod: keyof typeof MODIFIERS, input: HTMLElement): void {
    if (!originalInput) return;

    /* --- strip any existing instance of this modifier ---------------- */
    let query = originalInput.value.replace(new RegExp(`\\b${mod}(:|[><]=?)[^\\s]+`, 'gi'), '').trim();

    /* --- build replacement ------------------------------------------- */
    const info = MODIFIERS[mod];
    let snippet = '';

    if (info.type === 'dropdown') {
        const v = (input as HTMLSelectElement).value;
        if (v) snippet = `${mod}:${v}`;
    } else if (info.type === 'text') {
        const v = (input as HTMLInputElement).value.trim();
        if (v) snippet = `${mod}:"${v}"`;
    } else { // date
        const opSel  = input.querySelector('select') as HTMLSelectElement;
        const dateEl = input.querySelector('input[type="date"]') as HTMLInputElement;
        if (dateEl.value) {
            const op = opSel.value === 'before' ? '<' : opSel.value === 'after' ? '>' : ':';
            snippet = `${mod}${op}${dateEl.value}`;
        }
    }

    if (snippet) query += ' ' + snippet;
    originalInput.value = query.trim();
    originalInput.dispatchEvent(new Event('input', { bubbles: true }));
    syncFromOriginal(); // refresh UI
}

/* ----------  PARSE / SYNC  ------------------------------------------ */
function parseModifiers(q: string): ParsedQuery {
    const parts = q.match(/\S+:"[^"]+"|\S+/g) || [];
    const parsed: ParsedQuery = {};
    parts.forEach(part => {
        const [rawKey, rest] = part.split(/:(.+)/); // split only on first :
        const key = rawKey.toLowerCase();
        if (!MODIFIERS.hasOwnProperty(key)) return;
        if (key === 'in' && !MODIFIERS.in.values!.includes(rest)) return; // invalid value
        parsed[key] = rest;
    });
    return parsed;
}

function syncFromOriginal(): void {
    const resultsList = document.querySelector<HTMLElement>(RESULTS_LIST_SELECTOR);
    const queryInput  = resultsList?.querySelector<HTMLInputElement>(`#${QUERY_INPUT_ID}`);
    if (!resultsList || !queryInput || !originalInput) return;

    const parsed = parseModifiers(originalInput.value);

    // strip modifiers to leave pure keywords in the top input
    queryInput.value = originalInput.value
        .replace(new RegExp(`\\b(?:${Object.keys(MODIFIERS).join('|')})(:|[><]=?)[^\\s"]+"?[^\\s"]*"?(?=\\s|$)`, 'gi'), '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // reflect ON/OFF state on buttons
    Object.keys(MODIFIERS).forEach(key => {
        const btn = resultsList.querySelector<HTMLButtonElement>(`.kh-modifier-btn[data-modifier="${key}"]`);
        btn?.classList.toggle('kh-active', parsed.hasOwnProperty(key));
    });
}

function syncToOriginal(): void {
    if (!originalInput) return;
    const queryInput = document.getElementById(QUERY_INPUT_ID) as HTMLInputElement;
    if (!queryInput) return;

    const parsed = parseModifiers(originalInput.value); // keep existing modifiers
    const modString = Object.entries(parsed).map(([k, v]) => `${k}:${v}`).join(' ');
    originalInput.value = `${queryInput.value.trim()} ${modString}`.trim();
    originalInput.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ----------  STYLES  -------------------------------------------------- */

const css = `
  .kh-query-input {
    width: 100%; padding: 4px 6px;
    border: 1px solid #d0d3d6; border-radius: 4px;
    font-size: 14px; box-sizing: border-box;
  }
  .kh-modifier-btn {
    background:#f0f2f4; border:1px solid #d0d3d6;
    border-radius:4px; padding:2px 6px;
    cursor:pointer; font-size:12px; line-height:1.4;
  }
  .kh-modifier-btn.kh-active {
    background:#4285f4; color:#fff; border-color:#4285f4;
  }
  .kh-popover button { cursor:pointer; }
`

injectStyles(css, 'kh-search-style');