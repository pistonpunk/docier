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
  removeWhere(match: (code: string) => boolean): void;
  setCollapsed(collapsed: boolean): void;
  count(): number;
}

const MAX_ENTRIES = 400;
const MIN_PANEL_PX = 220;
const MIN_STAGE_PX = 320;
const DRAG_STEP_PX = 16;

const installSplitter = (root: HTMLElement): void => {
  const workspace = root.parentElement;
  if (workspace === null) return;
  const handle = document.createElement('div');
  handle.className = 'splitter';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize the diagnostics panel');
  root.prepend(handle);

  const maxWidth = (): number => Math.max(MIN_PANEL_PX, workspace.clientWidth - MIN_STAGE_PX);

  const setWidth = (px: number): void => {
    const limit = maxWidth();
    const clamped = Math.max(MIN_PANEL_PX, Math.min(limit, Math.round(px)));
    root.style.setProperty('--panel-width', `${String(clamped)}px`);
    handle.setAttribute('aria-valuenow', String(clamped));
    handle.setAttribute('aria-valuemin', String(MIN_PANEL_PX));
    handle.setAttribute('aria-valuemax', String(Math.round(limit)));
  };

  let dragging = false;
  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setWidth(workspace.getBoundingClientRect().right - event.clientX);
  });
  const stop = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('keydown', (event) => {
    const current = root.getBoundingClientRect().width;
    if (event.key === 'ArrowLeft') setWidth(current + DRAG_STEP_PX);
    else if (event.key === 'ArrowRight') setWidth(current - DRAG_STEP_PX);
    else if (event.key === 'Home') setWidth(MIN_PANEL_PX);
    else if (event.key === 'End') setWidth(maxWidth());
    else return;
    event.preventDefault();
  });

  setWidth(root.getBoundingClientRect().width);
};

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
    item.dataset.code = entry.code;

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

  const recount = (): void => {
    total = 0;
    errors = 0;
    warnings = 0;
    for (const item of list.children) {
      total += 1;
      if (item.getAttribute('data-severity') === 'error') errors += 1;
      else if (item.getAttribute('data-severity') === 'warning') warnings += 1;
    }
  };

  render();
  installSplitter(root);

  return {
    add,
    addMany: (entries) => {
      for (const entry of entries) add(entry);
    },
    removeWhere: (match) => {
      for (const item of [...list.children]) {
        const code = item.getAttribute('data-code') ?? '';
        if (match(code)) item.remove();
      }
      recount();
      render();
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
