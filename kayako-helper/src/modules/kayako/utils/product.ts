/* src/modules/kayako/utils/product.ts
   Resilient extraction of the current ticket's Product field value. */

import { KAYAKO_SELECTORS } from '@/generated/selectors';

export function extractProductValueSafe(): string {
    try {
        const headers = Array.from(document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.customFieldContainer));
        const productHeader = headers.find(h => /\bproduct\b/i.test(h.textContent || ''));
        if (!productHeader) return '';

        const fieldRoot = (productHeader.closest('[class*="ko-info-bar_field_select__power-select_"]') as HTMLElement | null)
            || (productHeader.closest(KAYAKO_SELECTORS.fieldContainer as string) as HTMLElement | null)
            || productHeader.parentElement;
        if (!fieldRoot) return '';

        const pillVals = Array.from(fieldRoot.querySelectorAll<HTMLElement>('[class*="ko-select_multiple_pill__pill_"]'))
            .map(el => (el.textContent || '').trim()).filter(Boolean);
        if (pillVals.length) return pillVals.join(', ');

        const selectedItem = fieldRoot.querySelector<HTMLElement>('[class*="ember-power-select-selected-item"], [class*="selected-item"]');
        if (selectedItem) {
            const txt = (selectedItem.textContent || '').replace(/\bProduct\b/i, '').trim();
            if (txt) return txt;
        }

        const trigger = fieldRoot.querySelector<HTMLElement>(KAYAKO_SELECTORS.fieldSelectTrigger || '[class*="ko-info-bar_field_select_trigger__trigger_"]');
        if (trigger) {
            const placeholder = trigger.querySelector<HTMLElement>('[class*="ko-info-bar_field_select_trigger__placeholder_"]');
            if (placeholder) {
                const placeholderText = (placeholder.textContent || '').trim();
                const placeholderTitle = (placeholder.getAttribute('title') || '').trim();
                const best = placeholderText || placeholderTitle;
                if (best) return best;
            }

            const raw = (trigger.textContent || '')
                .replace(/\bProduct\b/i, '')
                .replace(/Search|Type to search|Clear/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (raw) return raw;
        }

        const combined = (fieldRoot.textContent || '').replace(/\bProduct\b/i, '').trim();
        const parts = combined.split(/\s{2,}|\n+/).map(s => s.trim()).filter(Boolean);
        const best = parts.sort((a, b) => b.length - a.length)[0];
        return best || '';
    } catch (_e) {
        try { console.debug('[KH][productUtil] extractProductValueSafe error', _e); } catch {}
        return '';
    }
}


