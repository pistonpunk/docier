import type { Disposable } from '../api/types.js';
import { createDisposableStore, markPart, make, setText } from './dom.js';
import type { CommentSummary } from './queries.js';
import { DIALOG_TOKENS } from './dialog.js';
import type { ChromeContext } from './types.js';

export const COMMENTS_PART = 'comments-panel';

export interface CommentsPanelOptions {
  readonly context: ChromeContext;
  readonly comments: () => readonly CommentSummary[];
  readonly onSelect?: ((comment: CommentSummary) => void) | undefined;
  readonly mount: HTMLElement;
}

export interface CommentsPanelHandle extends Disposable {
  readonly element: HTMLElement;
  refresh(): void;
  readonly count: number;
}

const initialsOf = (comment: CommentSummary): string => {
  if (comment.initials !== undefined && comment.initials !== '') return comment.initials;
  const words = comment.author.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
};

export const createCommentsPanel = (options: CommentsPanelOptions): CommentsPanelHandle => {
  const { context } = options;
  const store = createDisposableStore();
  let count = 0;

  const element = make('aside', 'docier-comments-panel');
  markPart(element, COMMENTS_PART);
  element.setAttribute('data-docier-comments', '');
  element.setAttribute('role', 'complementary');
  element.setAttribute('aria-label', context.i18n.text('ui.comments.title'));
  element.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'gap:6px',
    'min-width:200px',
    'max-width:280px',
    'padding:8px',
    'box-sizing:border-box',
    `background:${DIALOG_TOKENS.surface}`,
    `border-left:1px solid ${DIALOG_TOKENS.borderSoft}`,
    `font-family:${DIALOG_TOKENS.font}`,
    `font-size:${DIALOG_TOKENS.fontSize}`,
    `color:${DIALOG_TOKENS.text}`,
    'overflow:auto',
  ].join(';');

  const heading = make('div', 'docier-comments-heading');
  setText(heading, context.i18n.text('ui.comments.title'));
  heading.style.cssText = `font-weight:600;color:${DIALOG_TOKENS.muted};padding:0 2px 2px`;
  element.appendChild(heading);

  const empty = make('div', 'docier-comments-empty');
  setText(empty, context.i18n.text('ui.comments.empty'));
  empty.style.cssText = `color:${DIALOG_TOKENS.muted};padding:2px`;
  element.appendChild(empty);

  const list = make('div', 'docier-comments-list');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  element.appendChild(list);

  const refresh = (): void => {
    const comments = options.comments();
    count = comments.length;
    element.hidden = false;
    empty.hidden = comments.length > 0;
    while (list.firstChild !== null) list.removeChild(list.firstChild);
    for (const comment of comments) {
      const row = document.createElement('button');
      row.className = 'docier-comment-row';
      row.type = 'button';
      row.setAttribute('data-docier-comment-row', String(comment.id));
      row.style.cssText = [
        'display:flex',
        'gap:6px',
        'text-align:left',
        'width:100%',
        'box-sizing:border-box',
        'padding:6px',
        'cursor:pointer',
        `background:${DIALOG_TOKENS.control}`,
        `border:1px solid ${DIALOG_TOKENS.borderSoft}`,
        `border-radius:${DIALOG_TOKENS.radius}`,
        'font:inherit',
        `color:${DIALOG_TOKENS.text}`,
      ].join(';');
      const badge = make('span', 'docier-comment-initials');
      setText(badge, initialsOf(comment));
      badge.style.cssText = [
        'flex:0 0 auto',
        'width:20px',
        'height:20px',
        `border-radius:${DIALOG_TOKENS.radius}`,
        `background:${DIALOG_TOKENS.accent}`,
        `color:${DIALOG_TOKENS.accentText}`,
        'font-size:11px',
        'display:flex',
        'align-items:center',
        'justify-content:center',
      ].join(';');
      const body = make('span', 'docier-comment-body');
      const who = make('span', 'docier-comment-author');
      setText(who, comment.author === '' ? context.i18n.text('ui.comments.anonymous') : comment.author);
      who.style.cssText = 'display:block;font-weight:600';
      const text = make('span', 'docier-comment-text');
      setText(text, comment.text);
      text.style.cssText = `display:block;color:${DIALOG_TOKENS.muted}`;
      body.appendChild(who);
      body.appendChild(text);
      row.appendChild(badge);
      row.appendChild(body);
      row.addEventListener('click', (event) => {
        event.preventDefault();
        options.onSelect?.(comment);
      });
      list.appendChild(row);
    }
  };

  refresh();

  return {
    element,
    refresh,
    get count(): number {
      return count;
    },
    dispose: () => {
      store.dispose();
      if (element.parentNode !== null) element.parentNode.removeChild(element);
    },
  };
};