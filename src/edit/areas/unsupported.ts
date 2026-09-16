import type { CommandArea, CommandDefinition } from '../../api/types.js';
import { areaCommand } from './support.js';
import type { AreaHost, AreaSpec } from './support.js';

interface Refusal {
  readonly id: string;
  readonly label: string;
  readonly category: CommandArea;
  readonly reason: string;
  readonly live?: (host: AreaHost) => string;
}

const NO_DRAWING =
  'This build authors pictures and text boxes; it has no geometry for a preset shape or a chart part';
const NO_PART = (part: string): string =>
  `This build cannot create a ${part} part from the editing layer; it edits only the parts the document already has`;
const REFUSALS: readonly Refusal[] = [
  {
    id: 'docier.command.doc.toggleTrackChanges',
    label: 'Track changes',
    category: 'doc',
    reason:
      'This build lays out the revision marks a document carries and does not record new ones',
  },
  {
    id: 'docier.command.doc.acceptChange',
    label: 'Accept change',
    category: 'doc',
    reason: 'This build lays out revision marks and never accepts them',
  },
  {
    id: 'docier.command.doc.rejectChange',
    label: 'Reject change',
    category: 'doc',
    reason: 'This build lays out revision marks and never rejects them',
  },


  { id: 'docier.command.insert.endnote', label: 'Endnote', category: 'insert', reason: NO_PART('endnotes') },
  {
    id: 'docier.command.insert.updateTable',
    label: 'Update table',
    category: 'insert',
    reason: 'This build inserts no fields to update',
  },
  {
    id: 'docier.command.insert.crossReference',
    label: 'Cross-reference',
    category: 'insert',
    reason: 'Cross references need bookmark-scoped field evaluation, which this build does not implement',
  },
  {
    id: 'docier.command.insert.caption',
    label: 'Caption',
    category: 'insert',
    reason: 'Captions need sequence fields, which this build does not implement',
  },
  {
    id: 'docier.command.insert.index',
    label: 'Index',
    category: 'insert',
    reason: 'An index needs field evaluation over marked entries, which this build does not implement',
  },
  {
    id: 'docier.command.insert.bibliography',
    label: 'Bibliography',
    category: 'insert',
    reason: 'Citations are preserved but never generated in this build',
  },

  {
    id: 'docier.command.numbering.continuePrevious',
    label: 'Continue previous list',
    category: 'numbering',
    reason:
      "This build joins a paragraph to a list only by applying that list; it has no command that adopts the previous list's w:numId",
  },
  {
    id: 'docier.command.numbering.newDefinition',
    label: 'New numbering definition',
    category: 'numbering',
    reason:
      'This build cannot clone an abstract definition: a format change rewrites the definition every list of that kind shares',
  },
  {
    id: 'docier.command.numbering.setLevelRestart',
    label: 'Level restart',
    category: 'numbering',
    reason:
      "This build never writes w:lvlRestart; a level's restart rule is preserved exactly as it was loaded",
  },
  {
    id: 'docier.command.numbering.setLegal',
    label: 'Legal numbering',
    category: 'numbering',
    reason:
      "This build never writes w:isLgl; a level's legal-numbering flag is preserved exactly as it was loaded",
  },
  {
    id: 'docier.command.numbering.applyListStyle',
    label: 'List style',
    category: 'numbering',
    reason:
      'This build applies numbering as a direct w:numPr and never authors a w:style of type numbering with a w:numStyleLink',
  },
  {
    id: 'docier.command.numbering.cleanup',
    label: 'Clean up numbering',
    category: 'numbering',
    reason:
      'This build never deletes unused w:abstractNum definitions, so a numbered document keeps every definition it was given',
  },
  {
    id: 'docier.command.numbering.convertToText',
    label: 'Convert list to text',
    category: 'numbering',
    reason:
      'List numbers come from w:numFmt/w:lvlText rather than from w:t, so this build cannot turn them into literal text',
  },

  { id: 'docier.command.object.insertShape', label: 'Shape', category: 'object', reason: NO_DRAWING },
  { id: 'docier.command.object.insertChart', label: 'Chart', category: 'object', reason: NO_DRAWING },
  {
    id: 'docier.command.object.compress',
    label: 'Compress pictures',
    category: 'object',
    reason: 'Compression re-encodes media bytes, and this build inserts and scales them but never rewrites them',
  },
  {
    id: 'docier.command.object.group',
    label: 'Group',
    category: 'object',
    reason:
      'Grouping needs several objects selected at once, and this build selects one object at a time',
  },

  {
    id: 'docier.command.proof.spelling',
    label: 'Spelling',
    category: 'proof',
    reason: 'This build ships no proofing provider',
  },
  {
    id: 'docier.command.proof.thesaurus',
    label: 'Thesaurus',
    category: 'proof',
    reason: 'This build ships no thesaurus provider',
  },
  {
    id: 'docier.command.proof.wordCount',
    label: 'Word count',
    category: 'proof',
    reason: 'Word count is reported by the status bar; this build has no word count dialog',
  },

  {
    id: 'docier.command.view.setGridlines',
    label: 'Gridlines',
    category: 'view',
    reason: 'The renderer draws no gridlines in this build',
  },
  {
    id: 'docier.command.view.setNavigation',
    label: 'Navigation pane',
    category: 'view',
    reason: 'This build has no navigation pane',
  },

  {
    id: 'docier.command.comment.delete',
    label: 'Delete comment',
    category: 'comment',
    reason: 'This build writes a comment but does not remove one',
  },
  {
    id: 'docier.command.clipboard.formatPainter',
    label: 'Format painter',
    category: 'clipboard',
    reason:
      'This build has no format painter: it would have to hold a character format independently of the selection, and nothing in the editing layer carries one between edits',
  },
  {
    id: 'docier.command.proof.translate',
    label: 'Translate',
    category: 'proof',
    reason: 'This build has no translation backend; the host application owns anything that leaves the machine',
  },
  {
    id: 'docier.command.table.insertCells',
    label: 'Insert cells',
    category: 'table',
    reason:
      'Shifting cells sideways rewrites the grid spans of the whole row, which this build does not do; insert a row or a column instead',
  },
  {
    id: 'docier.command.table.distributeRows',
    label: 'Distribute rows evenly',
    category: 'table',
    reason:
      'Even row heights need a height for the selection as a whole, and this build has no row selection to measure one against',
  },
  {
    id: 'docier.command.table.selectRow',
    label: 'Select row',
    category: 'table',
    reason:
      'A row spans several cell containers and no edit command accepts a range crossing one, so selecting a row would leave a selection that swallows every keystroke',
  },
  {
    id: 'docier.command.table.selectColumn',
    label: 'Select column',
    category: 'table',
    reason:
      'A column spans several cell containers and no edit command accepts a range crossing one, so selecting a column would leave a selection that swallows every keystroke',
  },
  {
    id: 'docier.command.table.selectTable',
    label: 'Select table',
    category: 'table',
    reason:
      'A table spans several cell containers and no edit command accepts a range crossing one, so selecting it would leave a selection that swallows every keystroke',
  },
  {
    id: 'docier.command.table.setTextDirection',
    label: 'Text direction',
    category: 'table',
    reason: 'This build reads w:textDirection and never writes it',
  },
];

const tokenReason = (host: AreaHost): string =>
  host.tokenizationEnabled
    ? 'This build has no token subsystem'
    : 'Tokenization is not enabled for this document';

const tokenRefusals = (): readonly Refusal[] => [
  { id: 'docier.command.token.insert', label: 'Insert token', category: 'token', reason: '', live: tokenReason },
  { id: 'docier.command.token.edit', label: 'Edit token', category: 'token', reason: '', live: tokenReason },
  { id: 'docier.command.token.setValue', label: 'Token value', category: 'token', reason: '', live: tokenReason },
  { id: 'docier.command.token.update', label: 'Update token', category: 'token', reason: '', live: tokenReason },
  { id: 'docier.command.token.unlink', label: 'Unlink token', category: 'token', reason: '', live: tokenReason },
  { id: 'docier.command.token.toggleCodes', label: 'Field codes', category: 'token', reason: '', live: tokenReason },
];

const refusalCommand = (host: AreaHost, refusal: Refusal): CommandDefinition<never, void> => {
  const spec: AreaSpec<Record<string, never>> = {
    id: refusal.id,
    label: refusal.label,
    category: refusal.category,
    enabledIn: () => false,
    reason: (active) => refusal.live?.(active) ?? refusal.reason,
  };
  return areaCommand<Record<string, never>>(host, spec);
};

export const unsupportedCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  ...REFUSALS.map((refusal) => refusalCommand(host, refusal)),
  ...tokenRefusals().map((refusal) => refusalCommand(host, refusal)),
];

export const unsupportedIds: readonly string[] = [
  ...REFUSALS.map((refusal) => refusal.id),
  ...tokenRefusals().map((refusal) => refusal.id),
];
