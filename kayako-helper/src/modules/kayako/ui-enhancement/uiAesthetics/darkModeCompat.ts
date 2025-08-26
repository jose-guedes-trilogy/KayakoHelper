import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/generated/selectors.ts';

const KEY_COMPAT = 'uiDarkCompat';
const KEY_TEXT = 'uiDarkTextColor';
const KEY_BG = 'uiDarkBgColor';

const DEFAULT_TEXT = '#EAEAEA';
const DEFAULT_BG = '#1E1E1E';

const STYLE_ID = 'oh-dark-mode-style';

const sel = EXTENSION_SELECTORS;

const TARGET_SELECTORS: string[] = [
    sel.newLinesButton,
    sel.copyChatButton,
    sel.createFolderButton,
    sel.copyPostButton,
    sel.scrollTopButton,
    sel.exportChatButton,
    sel.exportChatButtonRight,
    sel.twoPartBtnLeftHalf,
    sel.twoPartBtnRightHalf,
    sel.sendToQcButton,
    sel.ephorButton || '#kh-ephor-btn',
    sel.assetsButton
].filter(Boolean) as string[];

let observer: MutationObserver | null = null;
let compatEnabled = false;
let currentText = DEFAULT_TEXT;
let currentBg = DEFAULT_BG;

function ensureStyleTag(): HTMLStyleElement {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
    }
    const joined = TARGET_SELECTORS.map(s => `${s}.dark-mode`).join(',\n');
    const tipRoot = (KAYAKO_SELECTORS as any).tooltipRoot || '[class*=ko-tooltip__tooltip_]';
    const tipBox = KAYAKO_SELECTORS.tooltipContainer || '[class*=ko-tooltip__tooltip_] [class*=tooltipster-box]';
    const tipContent = KAYAKO_SELECTORS.tooltipContent || '[class*=ko-tooltip__tooltip_] .tooltipster-content';
    style.textContent = `
${joined} {
  color: var(--dark-mode-text-color) !important;
  background: var(--dark-mode-background-color) !important;
}

/* Keep Kayako tooltips on one line and allow full width */
${tipRoot} {
  width: auto !important;
  max-width: none !important;
  height: auto !important;
}
${tipBox} {
  max-width: none !important;
}
${tipContent} {
  white-space: nowrap !important;
  max-width: none !important;
  max-height: none !important;
  overflow: visible !important;
}
  `.trim();
    return style;
}

function tagTargets(apply: boolean, textColor: string, bgColor: string): void {
    TARGET_SELECTORS.forEach(selector => {
        document.querySelectorAll<HTMLElement>(selector).forEach(el => {
            el.classList.toggle('dark-mode', apply);
            if (apply) {
                el.style.setProperty('--dark-mode-text-color', textColor || DEFAULT_TEXT);
                el.style.setProperty('--dark-mode-background-color', bgColor || DEFAULT_BG);
            } else {
                el.style.removeProperty('--dark-mode-text-color');
                el.style.removeProperty('--dark-mode-background-color');
            }
        });
    });
}

function nodeMightContainTarget(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    return TARGET_SELECTORS.some(s => (node.matches?.(s) ?? false) || !!node.querySelector(s));
}

function startObserver(): void {
    if (observer) observer.disconnect();
    observer = new MutationObserver(muts => {
        if (!compatEnabled) return;
        for (const m of muts) {
            if (m.type === 'childList') {
                m.addedNodes.forEach(n => {
                    if (nodeMightContainTarget(n)) tagTargets(true, currentText, currentBg);
                });
            } else if (m.type === 'attributes') {
                const target = m.target as Element;
                if (TARGET_SELECTORS.some(s => target.matches(s))) {
                    const el = target as HTMLElement;
                    el.classList.toggle('dark-mode', true);
                    el.style.setProperty('--dark-mode-text-color', currentText);
                    el.style.setProperty('--dark-mode-background-color', currentBg);
                }
            }
        }
    });
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
}

function stopObserver(): void {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

function setRootCssVariables(textColor: string, bgColor: string): void {
    const root = document.documentElement;
    root.style.setProperty('--dark-mode-text-color', textColor || DEFAULT_TEXT);
    root.style.setProperty('--dark-mode-background-color', bgColor || DEFAULT_BG);
}

function applyState({ enabled, textColor, bgColor }: { enabled: boolean; textColor: string; bgColor: string; }): void {
    compatEnabled = enabled;
    currentText = textColor || DEFAULT_TEXT;
    currentBg = bgColor || DEFAULT_BG;

    ensureStyleTag();
    setRootCssVariables(currentText, currentBg);

    if (enabled) {
        tagTargets(true, currentText, currentBg);
        startObserver();
    } else {
        stopObserver();
        tagTargets(false, currentText, currentBg);
    }
}

export function initDarkModeCompat(): void {
    try {
        chrome.storage.sync.get([KEY_COMPAT, KEY_TEXT, KEY_BG] as const, res => {
            const enabled = !!res[KEY_COMPAT];
            const textColor = (res[KEY_TEXT] as string) ?? DEFAULT_TEXT;
            const bgColor = (res[KEY_BG] as string) ?? DEFAULT_BG;
            applyState({ enabled, textColor, bgColor });
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            try {
                if (area !== 'sync') return;

                const hasCompat = Object.prototype.hasOwnProperty.call(changes, KEY_COMPAT);
                const hasText = Object.prototype.hasOwnProperty.call(changes, KEY_TEXT);
                const hasBg = Object.prototype.hasOwnProperty.call(changes, KEY_BG);
                if (!(hasCompat || hasText || hasBg)) return;

                const enabled = hasCompat ? !!changes[KEY_COMPAT]?.newValue : compatEnabled;
                const textColor = hasText ? (changes[KEY_TEXT]?.newValue as string) : currentText;
                const bgColor = hasBg ? (changes[KEY_BG]?.newValue as string) : currentBg;

                applyState({ enabled, textColor, bgColor });

                if (enabled && (hasText || hasBg)) tagTargets(true, textColor, bgColor);
            } catch (err) {
                try {
                    console.warn('[OH][DarkModeCompat] Skipping storage.onChanged due to invalidated context', err);
                } catch {}
            }
        });

        // Clean up in case the page unloads while the extension is reloading
        try {
            const removeHandler = () => {
                try { chrome.storage.onChanged.removeListener?.(() => {}); } catch {}
                try { window.removeEventListener('unload', removeHandler); } catch {}
            };
            window.addEventListener('unload', removeHandler);
        } catch {}
    } catch {
        // no-op if storage isn't available yet
    }
}
