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

const NO_OBJECT_SELECTION =
  'There is no object selection in this build, so drawing commands cannot act';
const NO_DRAWING =
  'This build authors a picture from bytes the host supplies and nothing else: it has no shape, chart or text-box geometry';
const NO_PART = (part: string): string =>
  `This build cannot create a ${part} part from the editing layer; it edits only the parts the document already has`;
const HOST_OWNED = (action: string): string =>
  `The host application owns ${action} in this build; the editor exposes no ${action} backend`;

const REFUSALS: readonly Refusal[] = [
  { id: 'docier.command.doc.open', label: 'Open', category: 'doc', reason: HOST_OWNED('opening documents') },
  { id: 'docier.command.doc.save', label: 'Save', category: 'doc', reason: HOST_OWNED('saving documents') },
  { id: 'docier.command.doc.saveAs', label: 'Save as', category: 'doc', reason: HOST_OWNED('saving documents') },
  { id: 'docier.command.doc.print', label: 'Print', category: 'doc', reason: HOST_OWNED('printing') },
  {
    id: 'docier.command.doc.setPageBackground',
    label: 'Page colour',
    category: 'doc',
    reason: 'A page colour is a w:background element on the document root, which the undo history does not cover',
  },
  {
    id: 'docier.command.doc.setWatermark',
    label: 'Watermark',
    category: 'doc',
    reason: 'A watermark is a shape drawn inside a header part, and this build cannot author drawing content',
  },
  {
    id: 'docier.command.doc.setLineNumbers',
    label: 'Line numbers',
    category: 'doc',
    reason: 'Line numbering is deferred (LE-044) and is not modelled by this build',
  },
  {
    id: 'docier.command.doc.toggleTrackChanges',
    label: 'Track changes',
    category: 'doc',
    reason: 'This build does not record tracked changes; revision marks are preserved exactly as they were loaded',
  },
  {
    id: 'docier.command.doc.acceptChange',
    label: 'Accept change',
    category: 'doc',
    reason: 'This build preserves revision marks and never accepts them',
  },
  {
    id: 'docier.command.doc.rejectChange',
    label: 'Reject change',
    category: 'doc',
    reason: 'This build preserves revision marks and never rejects them',
  },

  { id: 'docier.command.export.docx', label: 'Export as Word', category: 'export', reason: HOST_OWNED('exports') },
  { id: 'docier.command.export.pdf', label: 'Export as PDF', category: 'export', reason: HOST_OWNED('exports') },
  { id: 'docier.command.export.html', label: 'Export as HTML', category: 'export', reason: HOST_OWNED('exports') },

  {
    id: 'docier.command.find.find',
    label: 'Find',
    category: 'find',
    reason: 'This build has no search engine, so find and replace are not implemented',
  },
  {
    id: 'docier.command.find.replace',
    label: 'Replace',
    category: 'find',
    reason: 'This build has no search engine, so find and replace are not implemented',
  },

  { id: 'docier.command.insert.textBox', label: 'Text box', category: 'insert', reason: NO_DRAWING },
  { id: 'docier.command.insert.endnote', label: 'Endnote', category: 'insert', reason: NO_PART('endnotes') },
  {
    id: 'docier.command.insert.coverPage',
    label: 'Cover page',
    category: 'insert',
    reason: 'Cover pages need a built-in gallery, which this build does not ship',
  },
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
  { id: 'docier.command.object.changeImage', label: 'Change picture', category: 'object', reason: NO_DRAWING },
  {
    id: 'docier.command.object.compress',
    label: 'Compress pictures',
    category: 'object',
    reason: 'Compression re-encodes media bytes, and this build inserts and scales them but never rewrites them',
  },
  { id: 'docier.command.object.align', label: 'Align objects', category: 'object', reason: NO_OBJECT_SELECTION },
  { id: 'docier.command.object.bringForward', label: 'Bring forward', category: 'object', reason: NO_OBJECT_SELECTION },
  { id: 'docier.command.object.sendBackward', label: 'Send backward', category: 'object', reason: NO_OBJECT_SELECTION },
  { id: 'docier.command.object.group', label: 'Group', category: 'object', reason: NO_OBJECT_SELECTION },
  { id: 'docier.command.object.setWrap', label: 'Wrap text', category: 'object', reason: NO_OBJECT_SELECTION },
  { id: 'docier.command.object.delete', label: 'Delete object', category: 'object', reason: NO_OBJECT_SELECTION },

  {
    id: 'docier.command.theme.setColors',
    label: 'Theme colours',
    category: 'theme',
    reason: 'The theme part is not modelled in this build, so theme colours cannot be written',
  },
  {
    id: 'docier.command.theme.setFonts',
    label: 'Theme fonts',
    category: 'theme',
    reason: 'The theme part is not modelled in this build, so theme fonts cannot be written',
  },
  {
    id: 'docier.command.theme.setSpacing',
    label: 'Theme spacing',
    category: 'theme',
    reason: 'The theme part is not modelled in this build, so theme spacing cannot be written',
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
    id: 'docier.command.table.propertiesDialog',
    label: 'Table properties',
    category: 'table',
    reason:
      'This build has no table-properties dialog; the width, the layout and the alignment are set by the commands that need them, and the row cannot enable a dialog that does not exist',
  },
  {
    id: 'docier.command.table.distributeRows',
    label: 'Distribute rows evenly',
    category: 'table',
    reason:
      'Even row heights need a height for the selection as a whole, and this build has no row selection to measure one against',
  },
  {
    id: 'docier.command.table.splitTable',
    label: 'Split table',
    category: 'table',
    reason:
      'Splitting a table moves rows into a second table, and this build has no command that moves blocks between tables',
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
    id: 'docier.command.table.setBorders',
    label: 'Borders and shading',
    category: 'table',
    reason: 'This build edits table borders as cell properties and has no borders-and-shading dialog',
  },
  {
    id: 'docier.command.table.setTextDirection',
    label: 'Text direction',
    category: 'table',
    reason: 'This build reads w:textDirection and never writes it',
  },
  {
    id: 'docier.command.table.sort',
    label: 'Sort',
    category: 'table',
    reason: 'This build has no sort over table rows, and sorting would reorder blocks the undo history tracks one at a time',
  },
  {
    id: 'docier.command.table.formula',
    label: 'Formula',
    category: 'table',
    reason: 'This build evaluates no field formula; fields are preserved exactly as they were loaded',
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
