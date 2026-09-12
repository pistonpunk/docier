import type { CommandDescriptor, CommandRegistry } from '../api/types.js';
import { isDisabled, markPart, make, setText } from './dom.js';
import type { UI18n } from './i18n.js';
import { shortcutHint } from './keyboard.js';
import type { UiNode } from './menu-model.js';
import type { ChromeContext, ChromeActionName, ControlSpec, ResolvedControl } from './types.js';

export type DescriptorIndex = ReadonlyMap<string, CommandDescriptor>;

export interface ResolverOptions {
  readonly commands: CommandRegistry;
  readonly i18n: UI18n;
  readonly descriptors: () => DescriptorIndex;
  readonly actions?: readonly ChromeActionName[];
  readonly isActive?: ((spec: ControlSpec) => boolean) | undefined;
}

export const createResolver = (
  options: ResolverOptions,
): ((spec: ControlSpec) => ResolvedControl) => {
  const actions = new Set<string>(options.actions ?? []);
  const open = (spec: ControlSpec, label: string): ResolvedControl => ({
    id: spec.labelKey ?? 'submenu',
    label,
    hint: spec.keytip,
    enabled: true,
    active: false,
    reason: undefined,
    registered: false,
    description: undefined,
  });
  return (spec) => {
    const label = spec.labelKey === undefined ? '' : options.i18n.text(spec.labelKey);
    const keytip = spec.keytip;
    const submenu = spec.submenu === true;
    if (spec.command !== undefined) {
      const descriptor = options.descriptors().get(spec.command);
      const commandLabel =
        label === '' && descriptor !== undefined ? options.i18n.label(descriptor.label) : label;
      if (descriptor !== undefined) {
        const reason =
          descriptor.enabled || descriptor.disabledReason === undefined
            ? undefined
            : options.i18n.label(descriptor.disabledReason);
        return {
          id: spec.command,
          label: commandLabel,
          hint: shortcutHint(descriptor.bindings) ?? keytip,
          enabled: descriptor.enabled,
          active: descriptor.active,
          reason: descriptor.enabled ? undefined : (reason ?? options.i18n.text('ui.reason.unavailable')),
          registered: true,
          description:
            descriptor.description === undefined
              ? undefined
              : options.i18n.label(descriptor.description),
        };
      }
      if (spec.action !== undefined && actions.has(spec.action)) {
        return {
          id: spec.command,
          label: commandLabel,
          hint: keytip,
          enabled: true,
          active: options.isActive?.(spec) ?? false,
          reason: undefined,
          registered: false,
          description: undefined,
        };
      }
      if (submenu) return open(spec, commandLabel);
      return {
        id: spec.command,
        label: commandLabel,
        hint: keytip,
        enabled: false,
        active: false,
        reason: options.i18n.text('ui.reason.unknown'),
        registered: false,
        description: undefined,
      };
    }
    if (submenu) return open(spec, label);
    if (spec.action !== undefined && actions.has(spec.action)) {
      return {
        id: spec.action,
        label,
        hint: keytip,
        enabled: true,
        active: options.isActive?.(spec) ?? false,
        reason: undefined,
        registered: false,
        description: undefined,
      };
    }
    return {
      id: spec.labelKey ?? 'control',
      label,
      hint: keytip,
      enabled: false,
      active: false,
      reason: options.i18n.text('ui.reason.unavailable'),
      registered: false,
      description: undefined,
    };
  };
};

export const specOf = (node: UiNode): ControlSpec => ({
  command: node.command,
  args: node.command === undefined ? node.actionArgs : node.args,
  action: node.action,
  labelKey: node.labelKey,
  keytip: node.keytip,
  options: node.options,
  submenu: node.kind === 'menu',
});

export const tooltipFor = (resolved: ResolvedControl): string => {
  const parts: string[] = [];
  if (resolved.label !== '') parts.push(resolved.label);
  if (resolved.hint !== undefined) parts.push(`(${resolved.hint})`);
  const head = parts.join(' ');
  if (!resolved.enabled && resolved.reason !== undefined) {
    return head === '' ? resolved.reason : `${head} — ${resolved.reason}`;
  }
  if (resolved.description !== undefined) {
    return head === '' ? resolved.description : `${head} — ${resolved.description}`;
  }
  return head;
};

export const applyResolved = (
  element: HTMLElement,
  resolved: ResolvedControl,
  role: string,
): void => {
  element.setAttribute('role', role);
  if (role === 'menuitemcheckbox' || role === 'menuitemradio') {
    element.setAttribute('aria-checked', resolved.active ? 'true' : 'false');
  } else if (role === 'menuitem' || element.getAttribute('aria-haspopup') === 'menu') {
    element.removeAttribute('aria-checked');
  } else {
    element.setAttribute('aria-pressed', resolved.active ? 'true' : 'false');
  }
  if (resolved.enabled) element.removeAttribute('aria-disabled');
  else element.setAttribute('aria-disabled', 'true');
  element.setAttribute('aria-label', resolved.label);
  const title = tooltipFor(resolved);
  if (title === '') element.removeAttribute('title');
  else element.setAttribute('title', title);
  if (!resolved.enabled && resolved.reason !== undefined) {
    element.setAttribute('aria-description', resolved.reason);
  } else {
    element.removeAttribute('aria-description');
  }
  element.setAttribute('data-docier-enabled', resolved.enabled ? 'true' : 'false');
};

export const activate = (context: ChromeContext, node: UiNode): boolean => {
  const spec = specOf(node);
  const resolved = context.describe(spec);
  if (!resolved.enabled) {
    if (resolved.reason !== undefined) context.run('flushMessage', { message: resolved.reason });
    return false;
  }
  context.invoke(spec);
  return true;
};

const optionsFor = (node: UiNode, context: ChromeContext): string => {
  const listId = `${context.host.id === '' ? 'docier' : context.host.id}-${node.id}-options`
    .replace(/[^A-Za-z0-9_-]/g, '-');
  const doc = context.host.ownerDocument;
  let list = doc.getElementById(listId);
  if (list === null) {
    list = doc.createElement('datalist');
    list.id = listId;
    context.host.appendChild(list);
  }
  while (list.firstChild !== null) list.removeChild(list.firstChild);
  for (const option of node.options ?? []) {
    const entry = doc.createElement('option');
    entry.value = option.value;
    list.appendChild(entry);
  }
  return listId;
};

export interface ControlRenderOptions {
  readonly role?: string;
  readonly item?: boolean;
  readonly showShortcut?: boolean;
}

export const createControl = (
  context: ChromeContext,
  node: UiNode,
  renderOptions?: ControlRenderOptions,
): HTMLElement => {
  const role = renderOptions?.role ?? 'button';
  const item = renderOptions?.item ?? false;
  const spec = specOf(node);
  const resolved = context.describe(spec);

  if (node.kind === 'menu') {
    const element = make('button', item ? 'docier-menu-item' : 'docier-control docier-control-wide');
    markPart(element, 'menu-open');
    setText(element, resolved.label === '' ? context.i18n.text('ui.menu.noItems') : resolved.label);
    element.setAttribute('aria-haspopup', 'menu');
    element.setAttribute('aria-expanded', 'false');
    element.setAttribute('type', 'button');
    element.setAttribute('data-docier-kind', 'menu');
    element.setAttribute('data-docier-id', node.id);
    applyResolved(element, resolved, role);
    return element;
  }

  if (node.kind === 'separator') {
    const element = make('div', item ? 'docier-menu-separator' : 'docier-control-separator');
    element.setAttribute('role', 'separator');
    markPart(element, 'separator');
    return element;
  }

  if (node.kind === 'combo' || node.kind === 'spinner') {
    const wrapper = make(
      'span',
      node.kind === 'spinner'
        ? 'docier-control docier-control-combo docier-control-spinner'
        : 'docier-control docier-control-combo',
    );
    markPart(wrapper, 'combo');
    wrapper.setAttribute('data-docier-kind', node.kind);
    const input = context.host.ownerDocument.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', resolved.label);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('list', optionsFor(node, context));
    if (node.value !== undefined) input.value = node.value;
    if (!resolved.enabled) input.setAttribute('aria-disabled', 'true');
    input.readOnly = !resolved.enabled;
    if (resolved.hint !== undefined) input.setAttribute('title', `${resolved.label} (${resolved.hint})`);
    input.addEventListener('change', () => {
      if (!resolved.enabled) return;
      const key = node.valueKey ?? 'value';
      const raw = node.valueKey === 'sizePoints' ? Number(input.value) : input.value;
      const args = { ...(typeof node.args === 'object' && node.args !== null ? node.args : {}), [key]: raw };
      if (node.command !== undefined) {
        void context.commands.execute(node.command, args, { source: 'ui' });
        return;
      }
      context.run('openDialog', { dialog: node.id, value: raw });
    });
    wrapper.appendChild(input);
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-label', resolved.label);
    if (resolved.hint !== undefined) wrapper.setAttribute('data-docier-shortcut', resolved.hint);
    return wrapper;
  }

  if (node.kind === 'gallery') {
    const list = make('div', 'docier-menu-gallery');
    markPart(list, 'gallery');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', resolved.label);
    for (const entry of node.items ?? []) list.appendChild(createControl(context, entry, { role: 'button' }));
    return list;
  }

  const element = make('button', item ? 'docier-menu-item' : 'docier-control');
  element.setAttribute('type', 'button');
  markPart(element, 'control');
  element.setAttribute('data-docier-kind', node.kind);
  if (node.wide === true) element.classList.add('docier-control-wide');
  element.setAttribute('data-docier-id', node.id);

  const label = make('span', 'docier-control-label');
  setText(label, resolved.label);
  element.appendChild(label);

  if (item) {
    const check = make('span', 'docier-menu-check');
    check.setAttribute('aria-hidden', 'true');
    setText(check, '✓');
    element.insertBefore(check, label);
    if (renderOptions?.showShortcut !== false && resolved.hint !== undefined) {
      const shortcut = make('span', 'docier-menu-shortcut');
      setText(shortcut, resolved.hint);
      element.appendChild(shortcut);
    }
    if (!resolved.enabled && resolved.reason !== undefined) {
      const reason = make('span', 'docier-menu-hint');
      setText(reason, resolved.reason);
      element.appendChild(reason);
    }
  } else if (resolved.hint !== undefined) {
    element.setAttribute('data-docier-shortcut', resolved.hint);
  }

  applyResolved(element, resolved, role);
  if (node.kind === 'toggle' && role === 'button') element.setAttribute('data-docier-toggle', 'true');

  element.addEventListener('click', (event) => {
    event.preventDefault();
    if (isDisabled(element)) {
      if (resolved.reason !== undefined) context.run('flushMessage', { message: resolved.reason });
      return;
    }
    context.invoke(spec);
  });

  return element;
};

export const renderControlInto = (
  host: HTMLElement,
  context: ChromeContext,
  node: UiNode,
  renderOptions?: ControlRenderOptions,
): HTMLElement => {
  const element = createControl(context, node, renderOptions);
  host.appendChild(element);
  return element;
};

export const reasonTextFor = (context: ChromeContext, node: UiNode): string | undefined =>
  context.describe(specOf(node)).reason;
