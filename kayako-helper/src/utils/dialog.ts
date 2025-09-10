/* Reusable Ephor-styled dialog utilities */

export interface ConfirmOptions {
  title?: string;
  message: string | HTMLElement;
  confirmText?: string;
  cancelText?: string;
  dismissOnOverlay?: boolean;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const {
    title = 'Please confirm',
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    dismissOnOverlay = true,
  } = options;

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'kh-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'kh-dialog';

    const header = document.createElement('header');
    header.textContent = title;

    const main = document.createElement('main');
    if (typeof message === 'string') {
      const p = document.createElement('p');
      p.textContent = message;
      main.appendChild(p);
    } else {
      main.appendChild(message);
    }

    const footer = document.createElement('footer');

    const btnCancel = document.createElement('button');
    btnCancel.className = 'kh-btn';
    btnCancel.textContent = cancelText;

    const btnOk = document.createElement('button');
    btnOk.className = 'kh-btn kh-btn-primary';
    btnOk.textContent = confirmText;

    footer.append(btnCancel, btnOk);

    dialog.append(header, main, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    const cleanup = (result: boolean) => {
      if (settled) return;
      settled = true;
      try { overlay.remove(); } catch {}
      resolve(result);
    };

    btnCancel.addEventListener('click', () => cleanup(false));
    btnOk.addEventListener('click', () => cleanup(true));

    if (dismissOnOverlay) {
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) cleanup(false);
      });
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(false); }
      if (ev.key === 'Enter')  { ev.preventDefault(); cleanup(true); }
    };
    document.addEventListener('keydown', onKey, { capture: true, once: true });
  });
}

export async function confirmLargeOperation(count: number): Promise<boolean> {
  const tiers = [
    { min: 21, max: 100, title: 'Large copy – confirm', note: 'This may take a while and will run with reduced concurrency.' },
    { min: 101, max: Infinity, title: 'Very large copy – confirm', note: 'This is a heavy operation and will run slowly to avoid server overload.' },
  ];
  const tier = tiers.find(t => count >= t.min && count <= t.max);
  if (!tier) return true;

  const msg = document.createElement('div');
  msg.style.maxWidth = '520px';
  msg.innerHTML = `
    <p>You are about to process <strong>${count}</strong> tickets.</p>
    <p>${tier.note}</p>
  `;
  return confirmDialog({ title: tier.title, message: msg, confirmText: 'Proceed', cancelText: 'Cancel' });
}


/* Multi-choice dialog (e.g., Retry / Skip / Proceed) */
export interface ChoiceDialogOption {
  id: string;
  label: string;
  primary?: boolean;
}

export interface ChoiceDialogOptions {
  title?: string;
  message: string | HTMLElement;
  options: ChoiceDialogOption[]; // order matters
  dismissOnOverlay?: boolean;
}

export function choiceDialog(opts: ChoiceDialogOptions): Promise<string | null> {
  const { title = 'Select an option', message, options, dismissOnOverlay = true } = opts;
  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'kh-dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'kh-dialog';

    const header = document.createElement('header');
    header.textContent = title;

    const main = document.createElement('main');
    if (typeof message === 'string') {
      const p = document.createElement('p');
      p.textContent = message;
      main.appendChild(p);
    } else {
      main.appendChild(message);
    }

    const footer = document.createElement('footer');
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'kh-btn' + (opt.primary ? ' kh-btn-primary' : '');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => cleanup(opt.id));
      footer.appendChild(btn);
    });

    dialog.append(header, main, footer);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    const cleanup = (result: string | null) => {
      if (settled) return;
      settled = true;
      try { overlay.remove(); } catch {}
      resolve(result);
    };

    if (dismissOnOverlay) {
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) cleanup(null);
      });
    }

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); cleanup(null); }
    };
    document.addEventListener('keydown', onKey, { capture: true, once: true });
  });
}


