/*  Kayako Helper – targetBlankLinks.ts
    Adds target="_blank" to all links inside the conversation timeline
---------------------------------------------------------------------------- */

const TIMELINE_SEL = '[class*=ko-agent-content_layout__timeline_]';
const LINK_SEL     = 'a[href]';

let rootObserver: MutationObserver | undefined;

// ——— Helpers ————————————————————————————————————————————————
function setTargetBlank(a: HTMLAnchorElement): void {
    if (!a.target || a.target === '_self') {
        a.target = '_blank';
        // Defensive: prevents noopener phishing + preserves referrer privacy
        const rel = a.rel ? a.rel.split(/\s+/) : [];
        if (!rel.includes('noopener'))  rel.push('noopener');
        if (!rel.includes('noreferrer')) rel.push('noreferrer');
        a.rel = rel.join(' ');
    }
}

function processContainer(container: Element): void {
    container.querySelectorAll<HTMLAnchorElement>(LINK_SEL).forEach(setTargetBlank);
}

function observeContainer(container: Element): void {
    const linkObserver = new MutationObserver(muts =>
        muts.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if ((node as Element).matches?.(LINK_SEL)) {
                        setTargetBlank(node as HTMLAnchorElement);
                    }
                    // If an element subtree is injected, catch links inside it
                    (node as Element).querySelectorAll?.(LINK_SEL)
                        .forEach(setTargetBlank);
                }
            });
        })
    );
    linkObserver.observe(container, { childList: true, subtree: true });
    // Optional: store or return linkObserver if you want to disconnect later
}

function scanForTimelines(root: Node = document): void {
    root.querySelectorAll(TIMELINE_SEL).forEach(container => {
        processContainer(container);
        observeContainer(container);
    });
}

// ——— Bootstrapping ————————————————————————————————————————
export function bootTargetBlankLinks(): void {
    // Initial scan (in case the ticket is already loaded)
    scanForTimelines();

    // Watch the whole document for new timeline containers (SPA navigation, lazy load, etc.)
    if (!rootObserver) {
        rootObserver = new MutationObserver(muts =>
            muts.forEach(m =>
                m.addedNodes.forEach(node => {
                    if (node.nodeType === 1) {
                        if ((node as Element).matches?.(TIMELINE_SEL)) {
                            scanForTimelines(node);               // new timeline root
                        } else {
                            // A subtree that might *contain* a timeline
                            (node as Element)
                                .querySelectorAll?.(TIMELINE_SEL)
                                .forEach(scanForTimelines);
                        }
                    }
                })
            )
        );

        rootObserver.observe(document.body, { childList: true, subtree: true });
    }
}