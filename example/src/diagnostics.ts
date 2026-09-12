export type Severity = 'info' | 'warning' | 'error';

export interface Entry {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly detail?: string | undefined;
  readonly source?: string | undefined;
}

export interface Panel {
  add(entry: Entry): void;
  addMany(entries: readonly Entry[]): void;
  clear(): void;
  setCollapsed(collapsed: boolean): void;
  count(): number;
}

const MAX_ENTRIES = 400;

export const createPanel = (list: HTMLElement, count: HTMLElement, root: HTMLElement): Panel => {
  let total = 0;
  let errors = 0;
  let warnings = 0;

  const render = (): void => {
    count.textContent = String(total);
    count.className =
      total === 0 ? 'pill pill-ok' : errors > 0 ? 'pill pill-bad' : warnings > 0 ? 'pill pill-warn' : 'pill';
    count.title = `${String(errors)} error(s), ${String(warnings)} warning(s), ${String(total)} total`;
  };

  const add = (entry: Entry): void => {
    total += 1;
    if (entry.severity === 'error') errors += 1;
    else if (entry.severity === 'warning') warnings += 1;

    const item = document.createElement('li');
    item.dataset.severity = entry.severity;

    const code = document.createElement('div');
    code.className = 'code';
    code.textContent = entry.code;

    const message = document.createElement('div');
    message.className = 'message';
    message.textContent = entry.message;

    item.append(code, message);

    if (entry.detail !== undefined && entry.detail !== '') {
      const detail = document.createElement('div');
      detail.className = 'meta';
      detail.textContent = entry.detail;
      item.append(detail);
    }

    if (entry.source !== undefined) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = entry.source;
      item.append(meta);
    }

    list.prepend(item);
    while (list.childElementCount > MAX_ENTRIES) list.lastElementChild?.remove();
    render();
  };

  render();

  return {
    add,
    addMany: (entries) => {
      for (const entry of entries) add(entry);
    },
    clear: () => {
      list.replaceChildren();
      total = 0;
      errors = 0;
      warnings = 0;
      render();
    },
    setCollapsed: (collapsed) => {
      root.dataset.collapsed = String(collapsed);
    },
    count: () => total,
  };
};
