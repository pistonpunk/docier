import type { UiNode } from './menu-model.js';

const OPEN =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const GLYPHS: Readonly<Record<string, string>> = {
  'clipboard.paste':
    '<path d="M6 3.5H4.5A1.5 1.5 0 0 0 3 5v8a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5a1.5 1.5 0 0 0-1.5-1.5H10"/>' +
    '<rect x="6" y="2" width="4" height="3" rx="1"/><path d="M5.5 8.5h5"/><path d="M5.5 11h3"/>',
  'clipboard.cut':
    '<circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><path d="M5.5 10.5 12 2"/><path d="M10.5 10.5 4 2"/>',
  'clipboard.copy':
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/>' +
    '<path d="M10.5 5.5V3.7A1.2 1.2 0 0 0 9.3 2.5H3.7A1.2 1.2 0 0 0 2.5 3.7v5.6a1.2 1.2 0 0 0 1.2 1.2h1.8"/>',
  'clipboard.formatPainter':
    '<path d="M4 2.5h8V6H4z"/><path d="M8 6v2.5"/><path d="M6.4 12.6a1.6 1.6 0 0 0 3.2 0V8.5H6.4z"/>',
  'history.undo': '<path d="M3 8a5 5 0 1 1 1.8 3.85"/><path d="M3 3.5V8h4.5"/>',
  'history.redo': '<path d="M13 8a5 5 0 1 0-1.8 3.85"/><path d="M13 3.5V8H8.5"/>',
  'doc.save':
    '<path d="M3 3.5h7.5L13 6v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>' +
    '<path d="M5.5 3.5v3H10v-3"/><path d="M5.5 9h5v4.5"/>',
  'format.growFont': '<path d="M2.5 12.5 6 4l3.5 8.5"/><path d="M3.8 9.8h4.4"/><path d="M12.5 10.5v-6"/><path d="m10.5 6.5 2-2 2 2"/>',
  'format.shrinkFont': '<path d="M2.5 12.5 6 4l3.5 8.5"/><path d="M3.8 9.8h4.4"/><path d="M12.5 5.5v6"/><path d="m10.5 9.5 2 2 2-2"/>',
  'format.bold': '<path d="M4.5 3h3.8a2.5 2.5 0 0 1 0 5H4.5z"/><path d="M4.5 8h4.4a2.5 2.5 0 0 1 0 5H4.5z"/>',
  'format.italic': '<path d="M6.5 3h5"/><path d="M4.5 13h5"/><path d="M9.5 3 6.5 13"/>',
  'format.underline': '<path d="M4 3v5a4 4 0 0 0 8 0V3"/><path d="M3 14h10"/>',
  'format.strike':
    '<path d="M11.4 5A3.5 3.5 0 0 0 8.4 3.2C6.6 3.2 5.2 4.2 5.2 5.6c0 .8.4 1.4 1.2 1.9"/>' +
    '<path d="M4.6 11.2A3.6 3.6 0 0 0 7.9 13c1.9 0 3.3-1 3.3-2.4 0-.5-.2-1-.5-1.3"/><path d="M2.5 8h11"/>',
  'format.superscript': '<path d="M3 12.5 7.5 5"/><path d="M7.5 12.5 3 5"/><path d="M10.5 5.5h3l-3 3h3"/>',
  'format.subscript': '<path d="M3 11 7.5 3.5"/><path d="M7.5 11 3 3.5"/><path d="M10.5 9.5h3l-3 3h3"/>',
  'format.setColor': '<path d="M3.2 11 6.8 3.5 10.4 11"/><path d="M4.6 8.6h4.4"/><path d="M3 14h10"/>',
  'format.setLineSpacing':
    '<path d="M2.5 4h5"/><path d="M2.5 8h5"/><path d="M2.5 12h5"/>' +
    '<path d="M11.2 3.5v9"/><path d="m9.7 5 1.5-1.5L12.7 5"/><path d="m9.7 11 1.5 1.5L12.7 11"/>',
  'format.setHighlight': '<path d="M9.5 3.2 12.8 6.5 8 11.3H4.7V8z"/><path d="M3 13.8h10"/>',
  'format.clearCharacterFormatting':
    '<path d="M9.8 3.4 6 7.2l3.4 3.4 3.8-3.8z"/>' +
    '<path d="M6 7.2 3.4 9.8a1 1 0 0 0 0 1.4l1.4 1.4a1 1 0 0 0 1.4 0l3-3"/><path d="M8 14h5"/>',
  'numbering.bullets':
    '<path d="M5.5 4h8"/><path d="M5.5 8h8"/><path d="M5.5 12h8"/>' +
    '<circle cx="3" cy="4" r=".9"/><circle cx="3" cy="8" r=".9"/><circle cx="3" cy="12" r=".9"/>',
  'numbering.numbers':
    '<path d="M5.5 4h8"/><path d="M5.5 8h8"/><path d="M5.5 12h8"/>' +
    '<path d="M2.2 2.4 3.2 2v4"/><path d="M2 7.4h2l-2 2h2"/><path d="M2 11.6h2v2"/>',
  'numbering.multilevel':
    '<path d="M5.5 3h8"/><path d="M7.5 8h6"/><path d="M9.5 13h4"/>' +
    '<circle cx="3" cy="3" r=".9"/><circle cx="5" cy="8" r=".9"/><circle cx="7" cy="13" r=".9"/>',
  'format.decreaseIndent': '<path d="M8 4h6"/><path d="M8 8h6"/><path d="M8 12h6"/><path d="m5 6-2.5 2L5 10"/>',
  'format.increaseIndent': '<path d="M8 4h6"/><path d="M8 8h6"/><path d="M8 12h6"/><path d="m2.5 6 2.5 2-2.5 2"/>',
  'format.alignLeft': '<path d="M2.5 3.5h11"/><path d="M2.5 6.5h7"/><path d="M2.5 9.5h11"/><path d="M2.5 12.5h7"/>',
  'format.alignCenter': '<path d="M2.5 3.5h11"/><path d="M4.5 6.5h7"/><path d="M2.5 9.5h11"/><path d="M4.5 12.5h7"/>',
  'format.alignRight': '<path d="M2.5 3.5h11"/><path d="M6.5 6.5h7"/><path d="M2.5 9.5h11"/><path d="M6.5 12.5h7"/>',
  'format.alignJustify': '<path d="M2.5 3.5h11"/><path d="M2.5 6.5h11"/><path d="M2.5 9.5h11"/><path d="M2.5 12.5h11"/>',
  'table:properties':
    '<rect x="2" y="3" width="12" height="10" rx="1"/>' +
    '<path d="M2 6.6h12"/><path d="M6 6.6V13"/><path d="M10 6.6V13"/>',
  'cover:plain':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/>' +
    '<path d="M5.5 5h5"/><path d="M5.5 7.5h5"/><path d="M6.5 10h3"/>',
  'cover:banded':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/>' +
    '<path d="M3 5.5h10"/><path d="M5.5 8h5"/><path d="M6.5 10.5h3"/>',
  'cover:lines':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/>' +
    '<path d="M3 5h10"/><path d="M3 11h10"/><path d="M5.5 7.5h5"/>',
  'toggleMarks':
    '<path d="M9 2.5h4v11"/><path d="M11 2.5v11"/><path d="M4 2.5h3.5a3 3 0 0 1 0 6H4z"/>' +
    '<path d="M4 8.5h3.5a3 3 0 0 1 0 6H4z"/>',
  'align:left':
    '<path d="M2.5 2.5v11"/><rect x="4.5" y="4" width="8" height="3" rx="1"/><rect x="4.5" y="9" width="5" height="3" rx="1"/>',
  'align:center':
    '<path d="M8 2.5v11"/><rect x="3" y="4" width="10" height="3" rx="1"/><rect x="4.5" y="9" width="7" height="3" rx="1"/>',
  'align:right':
    '<path d="M13.5 2.5v11"/><rect x="3.5" y="4" width="8" height="3" rx="1"/><rect x="6.5" y="9" width="5" height="3" rx="1"/>',
  'align:top':
    '<path d="M2.5 2.5h11"/><rect x="4" y="4.5" width="3" height="8" rx="1"/><rect x="9" y="4.5" width="3" height="5" rx="1"/>',
  'align:middle':
    '<path d="M2.5 8h11"/><rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="4.5" width="3" height="7" rx="1"/>',
  'align:bottom':
    '<path d="M2.5 13.5h11"/><rect x="4" y="3.5" width="3" height="8" rx="1"/><rect x="9" y="6.5" width="3" height="5" rx="1"/>',
  'wrap:square':
    '<rect x="2" y="3" width="5" height="5" rx="1"/><path d="M9 3.5h5"/>' +
    '<path d="M9 6h4"/><path d="M9 8.5h5"/><path d="M2.5 11h11"/>',
  'wrap:tight':
    '<rect x="2" y="3" width="5" height="5" rx="2.5"/><path d="M9 3.5h5"/>' +
    '<path d="M9 6h4"/><path d="M9 8.5h5"/><path d="M2.5 11h11"/>',
  'wrap:through':
    '<rect x="2" y="3" width="5" height="5"/><path d="M2 3l5 5"/><path d="M7 3 2 8"/>' +
    '<path d="M9 4h5"/><path d="M9 8h5"/>',
  'wrap:topAndBottom':
    '<rect x="5" y="4" width="6" height="4" rx="1"/><path d="M2.5 2.5h11"/><path d="M2.5 11.5h11"/>',
  'wrap:none':
    '<rect x="5" y="4" width="6" height="4" rx="1"/><path d="M2.5 8h2"/><path d="M11.5 8h2"/>',
  'table.splitTable':
    '<rect x="2" y="2.5" width="12" height="4.5" rx="1"/>' +
    '<rect x="2" y="9" width="12" height="4.5" rx="1"/>' +
    '<path d="M8 7v2"/>',
  'table.sort':
    '<path d="M2.5 4h6"/><path d="M2.5 7h4"/><path d="M2.5 10h6"/>' +
    '<path d="M11 3v9"/><path d="m8.8 9.8 2.2 2.2 2.2-2.2"/>',
  'table:borders':
    '<rect x="2" y="3" width="12" height="10" rx="1"/>' +
    '<path d="M2 6.6h12"/><path d="M6 6.6V13"/><path d="M10 6.6V13"/>' +
    '<path d="m10.5 10.5 2.5 2.5"/>',
  'format.changeCase':
    '<path d="M1.5 12.5 4.6 3.5h1.2l3.1 9"/><path d="M2.6 9.4h6.2"/>' +
    '<path d="M9.8 12.5c0-2 .3-3.3 1.9-3.3s1.9 1.3 1.9 3.3" />' +
    '<path d="M13.6 12.5c0-1.4-.6-2.2-1.9-2.2s-1.9.8-1.9 2.2"/>',
  'find.find': '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>',
  'find.replace': '<circle cx="6.5" cy="6.5" r="3.7"/><path d="m9.3 9.3 2.7 2.7"/><path d="M2.5 13.5h11"/>',
  'edit.selectAll':
    '<path d="M3 5.5V4a1 1 0 0 1 1-1h1.5"/><path d="M10.5 3H12a1 1 0 0 1 1 1v1.5"/>' +
    '<path d="M13 10.5V12a1 1 0 0 1-1 1h-1.5"/><path d="M5.5 13H4a1 1 0 0 1-1-1v-1.5"/>' +
    '<rect x="5.5" y="5.5" width="5" height="5" rx="1"/>',
  'clipboard.pastePlain':
    '<path d="M6 3.5H4.5A1.5 1.5 0 0 0 3 5v8a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5a1.5 1.5 0 0 0-1.5-1.5H10"/>' +
    '<rect x="6" y="2" width="4" height="3" rx="1"/><path d="M5.5 8.5h5"/><path d="M6.5 11.5 8 10l1.5 1.5"/>',
  'clipboard.pasteSpecial':
    '<path d="M6 3.5H4.5A1.5 1.5 0 0 0 3 5v8a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V5a1.5 1.5 0 0 0-1.5-1.5H10"/>' +
    '<rect x="6" y="2" width="4" height="3" rx="1"/><path d="M8 8.2 8.7 9.7l1.6.2-1.2 1.1.3 1.6L8 11.8l-1.4.8.3-1.6-1.2-1.1 1.6-.2z"/>',
  'doc.setLineNumbers':
    '<path d="M6 4h7"/><path d="M6 8h7"/><path d="M6 12h4"/><path d="M3 3.5v9"/><path d="M3 4h.01"/><path d="M3 8h.01"/><path d="M3 12h.01"/>',
  'doc.setMargins':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1.2"/><path d="M5.5 5.5h5v5h-5z"/>',
  'doc.setOrientation':
    '<rect x="3" y="2.5" width="7" height="11" rx="1.2"/><path d="M12 8.5a3 3 0 0 1-1.4 2.5"/><path d="M12.6 7.5l-.6 1-.9-.5"/>',
  'doc.setPageSize':
    '<rect x="2.5" y="2.5" width="8" height="11" rx="1.2"/><path d="M12.5 5.5v5"/><path d="M11.6 6.4 12.5 5.5l.9.9"/><path d="M13.4 9.6l-.9.9-.9-.9"/>',
  'doc.toggleTrackChanges':
    '<path d="M10.5 2.5 13.5 5.5 6 13H3v-3z"/><path d="M9 4 12 7"/>',
  'edit.insertPageBreak':
    '<path d="M4 2.5h5l3 3V8"/><path d="M4 2.5V13.5h4"/><path d="M2.5 8h11" stroke-dasharray="2 1.6"/><path d="M11 10.5v3"/><path d="M9.5 12 11 13.5 12.5 12"/>',
  'format.setFontFamily':
    '<path d="M3 12.5 7 4l4 8.5"/><path d="M4.4 10h5.2"/><path d="M12.5 7.5l1.5 1.5-1.5 1.5"/>',
  'format.setFontSize':
    '<path d="M2.5 11.5 5.5 5l3 6.5"/><path d="M3.6 9.6h3.8"/><path d="M12 5v6.5"/><path d="M10.8 6.2 12 5l1.2 1.2"/>',
  'format.setParagraphIndent':
    '<path d="M6 4h7.5"/><path d="M6 8h7.5"/><path d="M6 12h7.5"/><path d="M2.5 6.5 4.5 8l-2 1.5z"/>',
  'format.setSpaceAfter':
    '<path d="M3 4h10"/><path d="M3 7.5h10"/><path d="M3 11h10" stroke-dasharray="2 1.6"/><path d="M8 12.5v2"/><path d="M6.8 13.7 8 14.9l1.2-1.2"/>',
  'format.setSpaceBefore':
    '<path d="M3 5h10" stroke-dasharray="2 1.6"/><path d="M3 8.5h10"/><path d="M3 12h10"/><path d="M8 4.5v-2"/><path d="M6.8 3.7 8 2.5l1.2 1.2"/>',
  'insert.dateTime':
    '<rect x="2.5" y="3.5" width="11" height="10" rx="1.2"/><path d="M2.5 6.5h11"/><path d="M5.5 2.5v2"/><path d="M10.5 2.5v2"/><path d="M5.5 9h1"/><path d="M9.5 9h1"/><path d="M5.5 11.2h1"/>',
  'proof.thesaurus':
    '<path d="M3 3.2h4a2 2 0 0 1 2 2v7.6a1.6 1.6 0 0 0-1.6-1.6H3z"/><path d="M13 3.2H9a2 2 0 0 0-2 2v7.6a1.6 1.6 0 0 1 1.6-1.6H13z"/>',
  'proof.wordCount':
    '<path d="M2.5 4.5h11"/><path d="M2.5 8h11"/><path d="M2.5 11.5h7"/><circle cx="12" cy="12" r="2.2"/>',
  'style.apply':
    '<rect x="2.5" y="3" width="11" height="4" rx="1"/><path d="M3.5 9.5h4"/><path d="M3.5 12h7"/>',
  'table.insertColumnsLeft':
    '<rect x="6.5" y="3" width="7" height="10" rx="1"/><path d="M10 6.5v3"/><path d="M2 8.5h3.5"/><path d="M4.2 7 2.7 8.5l1.5 1.5"/>',
  'table.insertColumnsRight':
    '<rect x="2.5" y="3" width="7" height="10" rx="1"/><path d="M6 6.5v3"/><path d="M10.5 8.5H14"/><path d="M11.8 7l1.5 1.5-1.5 1.5"/>',
  'table.insertRowsAbove':
    '<rect x="3" y="6.5" width="10" height="7" rx="1"/><path d="M6.5 10h3"/><path d="M8.5 2v3.5"/><path d="M7 4.2 8.5 2.7 10 4.2"/>',
  'table.insertRowsBelow':
    '<rect x="3" y="2.5" width="10" height="7" rx="1"/><path d="M6.5 6h3"/><path d="M8.5 10.5V14"/><path d="M7 12.8 8.5 14.3 10 12.8"/>',
  'token.insert':
    '<path d="M6 3.5H4.8A1.3 1.3 0 0 0 3.5 4.8v6.4a1.3 1.3 0 0 0 1.3 1.3H6"/><path d="M10 3.5h1.2a1.3 1.3 0 0 1 1.3 1.3v6.4a1.3 1.3 0 0 1-1.3 1.3H10"/><path d="M8 6v4"/><path d="M6.5 8h3"/>',
  'insert.coverPage':
    '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M3 5.5h10"/><path d="M5.8 7.8h4.4"/><path d="M5.8 10.4h4.4"/>',
  'insert.table':
    '<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M2.5 6.3h11"/><path d="M2.5 9.7h11"/><path d="M6.2 3v10"/><path d="M9.8 3v10"/>',
  'object.insertImage':
    '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.6" cy="6.2" r="1.1"/><path d="M2.3 11.6 6 8.2l2.4 2.2 2.2-1.8 3.1 2.9"/>',
  'object.insertShape':
    '<path d="M5.4 2.6 8.4 7.4H2.4z"/><circle cx="11" cy="5" r="2.8"/><rect x="2.6" y="8.6" width="4.8" height="4.8" rx=".8"/>',
  'object.insertChart':
    '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 10.6V7.4"/><path d="M8 10.6V5.4"/><path d="M11 10.6V8.6"/>',
  'insert.link':
    '<path d="M6.6 9.4 9.4 6.6"/><path d="M7.4 4.6 9 3a2.6 2.6 0 0 1 3.7 3.7l-1.6 1.6"/><path d="M8.6 11.4 7 13a2.6 2.6 0 0 1-3.7-3.7l1.6-1.6"/>',
  'insert.header':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5 5h6"/><path d="M3 8h10" stroke-dasharray="2 1.6"/>',
  'insert.footer':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5 11h6"/><path d="M3 8h10" stroke-dasharray="2 1.6"/>',
  'insert.pageNumber':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M7.1 5.6 6.5 10.4"/><path d="M9.5 5.6 8.9 10.4"/><path d="M5.4 7.4h5.2"/><path d="M5.4 9h5.2"/>',
  'insert.pageCount':
    '<rect x="2.5" y="2.5" width="8" height="11" rx="1"/><path d="M12.6 4.6a1 1 0 0 1 .9 1v8a1 1 0 0 1-1 1h-7"/><path d="M5.2 6.2h2.6"/><path d="M5.2 9h2.6"/>',
  'insert.sectionNumber':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M6.6 5.4c-1.1 0-1.1 1.6 0 1.6s1.1 1.6 0 1.6"/><path d="M9.6 5.4c-1.1 0-1.1 1.6 0 1.6s1.1 1.6 0 1.6"/><path d="M7.4 4.6 8.8 9.4"/><path d="M5.4 11.6h5.2"/>',
  'insert.sectionPageCount':
    '<rect x="2.5" y="2.5" width="8" height="11" rx="1"/><path d="M12.6 4.6a1 1 0 0 1 .9 1v8a1 1 0 0 1-1 1h-7"/><path d="M4.4 6.4c-.9 0-.9 1.3 0 1.3s.9 1.3 0 1.3"/><path d="M7.2 6.4c-.9 0-.9 1.3 0 1.3s.9 1.3 0 1.3"/><path d="M5.4 5.8 6.4 9.6"/>',
  'insert.time':
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2.2 1.4"/>',
  'insert.textBox':
    '<rect x="2.5" y="3.5" width="11" height="9" rx="1" stroke-dasharray="3 1.8"/><path d="M5.8 6.2h4.4"/><path d="M8 6.2v4.2"/>',
  'insert.symbol':
    '<path d="M6.3 9.8a2.8 2.8 0 1 1 3.4 0"/><path d="M6.3 9.8v2.8"/><path d="M9.7 9.8v2.8"/><path d="M5.3 12.6h2.4"/><path d="M8.3 12.6h2.4"/>',
  'theme.setFonts':
    '<path d="M2.4 12 5.2 5.5 8 12"/><path d="M3.5 9.7h3.4"/><circle cx="11.4" cy="10" r="2"/><path d="M13.4 8v4"/>',
  'theme.setColors':
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11"/><path d="M3.2 5.2 12.8 10.8"/><path d="M3.2 10.8 12.8 5.2"/>',
  'theme.setSpacing':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5 6h6"/><path d="M5 10.5h6"/><path d="M8 7.1v2.4"/><path d="m6.9 8.2 1.1-1.1 1.1 1.1"/><path d="m6.9 8.4 1.1 1.1 1.1-1.1"/>',
  'ui.control.margins':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1.2"/><path d="M5.5 5.5h5v5h-5z"/>',
  'doc.setPageBackground':
    '<rect x="2.5" y="2.5" width="9.5" height="11" rx="1"/><rect x="9.6" y="9.6" width="4" height="4" rx="1"/><path d="m10.3 13 2.9-2.9"/>',
  'doc.setWatermark':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M4.6 10.2 10.2 4.6"/><path d="M6.4 11.9 11.9 6.4"/>',
  'doc.setPageBorders':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M4.4 7.6V4.4h3.2"/><path d="M11.6 8.4v3.2H8.4"/>',
  'doc.setColumns':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M6.2 3.5v9"/><path d="M9.8 3.5v9"/>',
  'object.bringForward':
    '<rect x="4" y="8" width="8" height="5.5" rx="1"/><path d="M8 6V2.5"/><path d="m6.3 4.2 1.7-1.7 1.7 1.7"/>',
  'object.sendBackward':
    '<rect x="4" y="2.5" width="8" height="5.5" rx="1"/><path d="M8 10v3.5"/><path d="m6.3 11.8 1.7 1.7 1.7-1.7"/>',
  'object.align':
    '<path d="M2.5 2.5v11"/><rect x="5" y="4.5" width="8" height="3" rx=".8"/><rect x="5" y="9" width="5.5" height="3" rx=".8"/>',
  'object.group':
    '<path d="M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" stroke-dasharray="2.4 1.6"/><rect x="4.4" y="4.4" width="4" height="4" rx=".8"/><circle cx="10.9" cy="10.9" r="1.9"/>',
  'insert.tableOfContents':
    '<path d="M2.5 3.5h11"/><path d="M2.5 6.8h6.5"/><path d="M11.5 6.8h2"/><path d="M2.5 10h4.5"/><path d="M11.5 10h2"/><path d="M2.5 13h6"/><path d="M11.5 13h2"/>',
  'insert.updateTable':
    '<rect x="2.5" y="2.5" width="6" height="6" rx="1"/><path d="M2.5 4.9h6"/><path d="M5.5 2.5v6"/><path d="M13.1 9.6a2.8 2.8 0 1 1-3.9 3.8"/><path d="M13.1 7v2.6h-2.6"/>',
  'insert.footnote':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="M5.2 5.4h5.6"/><path d="M5.2 7.6h4"/><path d="M4.6 9.8h6.8"/><path d="M5.4 12.2h3.4"/>',
  'insert.endnote':
    '<rect x="3" y="2" width="10" height="8.5" rx="1"/><path d="M5.2 4.6h5.6"/><path d="M5.2 6.8h3.6"/><path d="M8 10.6v3"/><path d="m6.4 12.2 1.6 1.6 1.6-1.6"/>',
  'insert.caption':
    '<rect x="2.5" y="2.8" width="11" height="6.6" rx="1"/><path d="M5 11.6h6"/><path d="M5 13.4h3.5"/>',
  'insert.crossReference':
    '<rect x="2.5" y="2.5" width="7" height="11" rx="1"/><path d="M4.2 5.6h3.6"/><path d="M4.2 8h2"/><path d="M10.2 8h3.2"/><path d="m11.8 6.4 1.6 1.6-1.6 1.6"/>',
  'insert.index':
    '<rect x="2.5" y="3" width="9.5" height="10.5" rx="1"/><path d="M4.4 6.2h5.7"/><path d="M4.4 8.7h5.7"/><path d="M4.4 11.2h3.4"/><path d="M12.6 6.4h1.4"/><path d="M12.6 8.9h1.4"/><path d="M12.6 11.4h1.4"/>',
  'insert.bibliography':
    '<path d="M2.4 13.6h11.2"/><rect x="2.6" y="4.6" width="3" height="9" rx=".6"/><rect x="6.4" y="3.6" width="3" height="10" rx=".6"/><rect x="10.2" y="5.4" width="3" height="8.2" rx=".6"/>',
  'proof.spelling':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 6h6"/><path d="M5 8c.7-1.2 1.4 1.2 2.1 0s1.4 1.2 2.1 0 1.4 1.2 2.1 0"/>',
  'proof.setLanguage':
    '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5c1.9 1.6 2.9 3.4 2.9 5.5s-1 3.9-2.9 5.5"/><path d="M8 2.5c-1.9 1.6-2.9 3.4-2.9 5.5s1 3.9 2.9 5.5"/><path d="M2.8 6.2h10.4"/><path d="M2.8 9.8h10.4"/>',
  'comment.create':
    '<path d="M2.5 4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.6 13.4V11H4a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8.2 5.4v2.8"/><path d="M6.8 6.8h2.8"/>',
  'comment.delete':
    '<path d="M2.5 4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.6 13.4V11H4a1.5 1.5 0 0 1-1.5-1.5z"/><path d="m6.7 5.4 2.8 2.8"/><path d="m9.5 5.4-2.8 2.8"/>',
  'view.toggleComments':
    '<rect x="2.5" y="2.5" width="7.5" height="11" rx="1"/><path d="M4.6 5.5h3.3"/><path d="M4.6 8h3.3"/><path d="M12.6 4.4h1.2a1.2 1.2 0 0 1 1.2 1.2v6.8a1.2 1.2 0 0 1-1.2 1.2h-1.2"/><path d="M12.9 7.2h1.3"/><path d="M12.9 9.6h1.3"/>',
  'doc.acceptChange':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="m5.2 8.4 2.2 2.2 3.6-4.4"/>',
  'doc.rejectChange':
    '<rect x="3" y="2.5" width="10" height="11" rx="1"/><path d="m5.4 5.8 5.2 5.2"/><path d="m10.6 5.8-5.2 5.2"/>',
  'setViewMode:print':
    '<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5.4 5h5.2"/><path d="M5.4 7.6h5.2"/><path d="M5.4 10.2h3.4"/>',
  'setViewMode:web':
    '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 5.8h12"/><circle cx="3.9" cy="4.4" r=".7"/><circle cx="6" cy="4.4" r=".7"/><path d="M8 4.4h3.6"/><path d="M4.4 8h7.2"/><path d="M4.4 10.4h4.6"/>',
  'setViewMode:draft':
    '<path d="M2.5 4h11" stroke-dasharray="2 1.6"/><path d="M2.5 8h11"/><path d="M2.5 12h11" stroke-dasharray="2 1.6"/>',
  'setViewMode:read':
    '<rect x="2" y="3" width="5.6" height="10" rx="1"/><rect x="8.4" y="3" width="5.6" height="10" rx="1"/><path d="M4 6.2h1.6"/><path d="M4 8.4h1.6"/><path d="M10.4 6.2H12"/><path d="M10.4 8.4H12"/>',
  'toggleRuler':
    '<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M4.6 5v1.6"/><path d="M7 5v2.4"/><path d="M9.4 5v1.6"/><path d="M11.8 5v2.4"/>',
  'view.setGridlines':
    '<path d="M2.5 5.5h11" stroke-dasharray="2 1.6"/><path d="M2.5 10.5h11" stroke-dasharray="2 1.6"/><path d="M5.5 2.5v11" stroke-dasharray="2 1.6"/><path d="M10.5 2.5v11" stroke-dasharray="2 1.6"/>',
  'view.setNavigation':
    '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M6.8 2.5v11"/><path d="M4 5.6h1.4"/><path d="M4 8h1.4"/><path d="M4 10.4h1.4"/><path d="M8.6 5.6h3.8"/><path d="M8.6 8h3.8"/><path d="M8.6 10.4h2.4"/>',
  'zoomIn':
    '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/><path d="M7 5.2v3.6"/><path d="M5.2 7h3.6"/>',
  'zoomOut':
    '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/><path d="M5.2 7h3.6"/>',
  'zoomSet':
    '<rect x="4.5" y="2.5" width="9" height="9" rx="1"/><circle cx="6" cy="9.5" r="3.4"/><path d="m3.6 12.4-1.1 1.1"/>',
  'zoomFit:pageWidth':
    '<rect x="3.5" y="2.5" width="9" height="11" rx="1"/><path d="M4.9 8h6.2"/><path d="m6.5 6.5-1.6 1.5 1.6 1.5"/><path d="m9.5 6.5 1.6 1.5-1.6 1.5"/>',
  'zoomFit:wholePage':
    '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="m5.5 5.5 5 5"/><path d="M7.4 5.5H5.5V7.4"/><path d="M8.6 10.5h1.9V8.6"/>',
  'ribbonToggle':
    '<path d="M2.5 3h11"/><path d="m5.3 11.6 2.7-2.7 2.7 2.7"/><path d="m5.3 8.2 2.7-2.7 2.7 2.7"/>',
  'table.mergeCells':
    '<rect x="2" y="4.5" width="4.2" height="7" rx=".9"/><rect x="9.8" y="4.5" width="4.2" height="7" rx=".9"/><path d="M6.7 6.7h2.6"/><path d="m8.3 5.9 1 .8-1 .8"/><path d="M9.3 9.3H6.7"/><path d="m7.7 8.5-1 .8 1 .8"/>',
  'table.splitCells':
    '<rect x="2" y="2.5" width="4.2" height="11" rx=".9"/><rect x="9.8" y="2.5" width="4.2" height="5" rx=".9"/><rect x="9.8" y="8.5" width="4.2" height="5" rx=".9"/><path d="M6.7 6.4h2.6"/><path d="m8.3 5.6 1 .8-1 .8"/><path d="M6.7 9.6h2.6"/><path d="m8.3 8.8 1 .8-1 .8"/>',
  'table.delete':
    '<rect x="2.5" y="2.5" width="8" height="8" rx="1"/><path d="M2.5 5.6h8"/><path d="M6.5 2.5v8"/><path d="m10.4 10.4 3.2 3.2"/><path d="m13.6 10.4-3.2 3.2"/>',
  'table.setProperties':
    '<rect x="2.5" y="2.5" width="11" height="6.5" rx="1"/><path d="M2.5 5.8h11"/><path d="M6.5 2.5v6.5"/><path d="M2.5 12.6h11"/><circle cx="6.2" cy="12.6" r="1.6"/>',
  'object.setWrap':
    '<path d="M2.5 3h11"/><path d="M2.5 6.2h2.6"/><path d="M9.5 6.2h4"/><path d="M2.5 9.4h2.6"/><path d="M9.5 9.4h4"/><path d="M2.5 12.6h11"/><rect x="5.8" y="4.9" width="3.2" height="6" rx=".6"/>',
  'object.changeImage':
    '<rect x="4.5" y="3" width="9.5" height="10" rx="1"/><circle cx="7.8" cy="6.2" r="1.1"/><path d="M4.8 11.4 8.2 8.2l2.2 2 1.6-1.4 1.8 1.7"/><path d="M1.4 8h2.7"/><path d="m2.6 6.6 1.4 1.4-1.4 1.4"/>',
  'object.compress':
    '<rect x="2" y="2.5" width="12" height="11" rx="1"/><path d="M8 4.4v2"/><path d="m6.8 5.5 1.2 1.2 1.2-1.2"/><path d="M8 11.6v-2"/><path d="m6.8 10.5 1.2-1.2 1.2 1.2"/>',
  'object.setSize':
    '<rect x="3.5" y="5.5" width="9" height="8" rx="1"/><path d="M3.5 3.2h9"/><path d="M3.5 2.4v1.6"/><path d="M12.5 2.4v1.6"/>',
  'object.delete':
    '<rect x="1.5" y="3" width="9" height="9" rx="1"/><circle cx="4.4" cy="5.9" r=".9"/><path d="M1.8 10.6 4.4 8.2l2 1.9 1.3-1.2 1.8 1.7"/><path d="m10.4 10.4 3.2 3.2"/><path d="m13.6 10.4-3.2 3.2"/>',
  'token.toggleCodes':
    '<path d="M6 3.5H4.8A1.3 1.3 0 0 0 3.5 4.8v6.4a1.3 1.3 0 0 0 1.3 1.3H6"/><path d="M10 3.5h1.2a1.3 1.3 0 0 1 1.3 1.3v6.4a1.3 1.3 0 0 1-1.3 1.3H10"/><path d="M7 8h2"/>',
};

const modeOf = (node: UiNode): string | undefined => {
  const mode = node.actionArgs?.['mode'];
  return typeof mode === 'string' && mode !== '' ? mode : undefined;
};

const keyOf = (node: UiNode): string | undefined => {
  const source = node.command ?? node.id;
  const key = source.startsWith('docier.command.') ? source.slice('docier.command.'.length) : source;
  const mode = node.command === undefined ? modeOf(node) : undefined;
  return mode === undefined ? key : `${key}:${mode}`;
};

export const iconFor = (node: UiNode): string | undefined => {
  const key = keyOf(node);
  if (key === undefined) return undefined;
  const glyph = GLYPHS[key];
  return glyph === undefined ? undefined : `${OPEN}${glyph}</svg>`;
};

export const iconKeys = (): readonly string[] => Object.keys(GLYPHS);
