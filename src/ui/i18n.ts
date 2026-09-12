import { DEFAULT_LOCALE } from '../api/constants.js';
import { createLocalizer } from '../api/localize.js';
import type { MessagesOverride } from '../api/localize.js';
import type { LocaleCode, LocalizedString } from '../api/types.js';

export type MessageCatalogue = Readonly<Record<string, string>>;

export type MessageParams = Readonly<Record<string, string | number>>;

export const EN_MESSAGES: MessageCatalogue = {
  'ui.chrome.title': 'Document',
  'ui.chrome.menuBar': 'Menu bar',
  'ui.chrome.ribbon': 'Ribbon',
  'ui.chrome.canvas': 'Document canvas',
  'ui.chrome.ruler': 'Ruler',
  'ui.chrome.statusBar': 'Status bar',
  'ui.chrome.backstage': 'File',
  'ui.chrome.floatingControls': 'Text formatting',
  'ui.chrome.keyTips': 'Key tips',
  'ui.reason.unavailable': 'Unavailable here',
  'ui.reason.unknown': 'This command is not available in this build',
  'ui.reason.readOnly': 'The document is read-only',
  'ui.tab.file': 'File',
  'ui.tab.home': 'Home',
  'ui.tab.insert': 'Insert',
  'ui.tab.design': 'Design',
  'ui.tab.layout': 'Layout',
  'ui.tab.references': 'References',
  'ui.tab.review': 'Review',
  'ui.tab.view': 'View',
  'ui.tab.help': 'Help',
  'ui.tab.table': 'Table',
  'ui.tab.picture': 'Picture',
  'ui.group.clipboard': 'Clipboard',
  'ui.group.font': 'Font',
  'ui.group.paragraph': 'Paragraph',
  'ui.group.styles': 'Styles',
  'ui.group.editing': 'Editing',
  'ui.group.pages': 'Pages',
  'ui.group.tables': 'Tables',
  'ui.group.illustrations': 'Illustrations',
  'ui.group.links': 'Links',
  'ui.group.headerFooter': 'Header & Footer',
  'ui.group.text': 'Text',
  'ui.group.symbols': 'Symbols',
  'ui.group.pageSetup': 'Page Setup',
  'ui.group.arrange': 'Arrange',
  'ui.group.tableTools': 'Table',
  'ui.group.pictureTools': 'Picture',
  'ui.group.proofing': 'Proofing',
  'ui.group.language': 'Language',
  'ui.group.comments': 'Comments',
  'ui.group.tracking': 'Tracking',
  'ui.group.views': 'Views',
  'ui.group.show': 'Show',
  'ui.group.zoom': 'Zoom',
  'ui.group.documentFormatting': 'Document Formatting',
  'ui.group.tableOfContents': 'Table of Contents',
  'ui.group.footnotes': 'Footnotes',
  'ui.group.captions': 'Captions',
  'ui.group.index': 'Index',
  'ui.group.pageBackground': 'Page Background',
  'ui.group.tableProperties': 'Table',
  'ui.group.merge': 'Merge',
  'ui.control.undo': 'Undo',
  'ui.control.redo': 'Redo',
  'ui.control.cut': 'Cut',
  'ui.control.copy': 'Copy',
  'ui.control.paste': 'Paste',
  'ui.control.formatPainter': 'Format Painter',
  'ui.control.selectAll': 'Select All',
  'ui.control.find': 'Find',
  'ui.control.replace': 'Replace',
  'ui.control.bold': 'Bold',
  'ui.control.italic': 'Italic',
  'ui.control.underline': 'Underline',
  'ui.control.strike': 'Strikethrough',
  'ui.control.superscript': 'Superscript',
  'ui.control.subscript': 'Subscript',
  'ui.control.fontFamily': 'Font',
  'ui.control.fontSize': 'Font Size',
  'ui.control.growFont': 'Grow Font',
  'ui.control.shrinkFont': 'Shrink Font',
  'ui.control.textColor': 'Font Colour',
  'ui.control.highlight': 'Text Highlight Colour',
  'ui.control.clearFormatting': 'Clear All Formatting',
  'ui.control.bullets': 'Bullets',
  'ui.control.numbering': 'Numbering',
  'ui.control.alignLeft': 'Align Left',
  'ui.control.alignCenter': 'Centre',
  'ui.control.alignRight': 'Align Right',
  'ui.control.alignJustify': 'Justify',
  'ui.control.lineSpacing': 'Line and Paragraph Spacing',
  'ui.control.indentIncrease': 'Increase Indent',
  'ui.control.indentDecrease': 'Decrease Indent',
  'ui.control.styles': 'Styles',
  'ui.control.insertPageBreak': 'Page Break',
  'ui.control.insertTable': 'Table',
  'ui.control.insertImage': 'Pictures',
  'ui.control.insertShape': 'Shapes',
  'ui.control.insertLink': 'Link',
  'ui.control.insertHeader': 'Header',
  'ui.control.insertFooter': 'Footer',
  'ui.control.insertField': 'Field',
  'ui.control.insertSymbol': 'Symbol',
  'ui.control.margins': 'Margins',
  'ui.control.orientation': 'Orientation',
  'ui.control.pageSize': 'Size',
  'ui.control.paragraphDialog': 'Paragraph',
  'ui.control.arrangeBringForward': 'Bring Forward',
  'ui.control.arrangeSendBackward': 'Send Backward',
  'ui.control.tableOfContents': 'Table of Contents',
  'ui.control.insertFootnote': 'Insert Footnote',
  'ui.control.insertEndnote': 'Insert Endnote',
  'ui.control.insertCaption': 'Insert Caption',
  'ui.control.spelling': 'Spelling & Grammar',
  'ui.control.wordCount': 'Word Count',
  'ui.control.thesaurus': 'Thesaurus',
  'ui.control.setLanguage': 'Set Proofing Language',
  'ui.control.newComment': 'New Comment',
  'ui.control.deleteComment': 'Delete Comment',
  'ui.control.trackChanges': 'Track Changes',
  'ui.control.acceptChange': 'Accept Change',
  'ui.control.rejectChange': 'Reject Change',
  'ui.control.viewPrint': 'Print Layout',
  'ui.control.viewWeb': 'Web Layout',
  'ui.control.viewDraft': 'Draft',
  'ui.control.viewRead': 'Read Mode',
  'ui.control.showRuler': 'Ruler',
  'ui.control.showGridlines': 'Gridlines',
  'ui.control.showNavigation': 'Navigation Pane',
  'ui.control.zoomIn': 'Zoom In',
  'ui.control.zoomOut': 'Zoom Out',
  'ui.control.zoom100': '100%',
  'ui.control.zoomPageWidth': 'Page Width',
  'ui.control.zoomWholePage': 'Whole Page',
  'ui.control.collapseRibbon': 'Collapse the Ribbon',
  'ui.control.expandRibbon': 'Expand the Ribbon',
  'ui.control.addToQuickAccess': 'Add to Quick Access Toolbar',
  'ui.control.customizeRibbon': 'Customise the Ribbon',
  'ui.control.save': 'Save',
  'ui.control.saveAs': 'Save As',
  'ui.control.open': 'Open',
  'ui.control.print': 'Print',
  'ui.control.exportPdf': 'Export as PDF',
  'ui.control.exportDocx': 'Export as DOCX',
  'ui.control.exportHtml': 'Export as HTML',
  'ui.control.close': 'Close',
  'ui.control.diagnostics': 'Copy Diagnostics',
  'ui.control.diagnosticsDescription': 'Copy the diagnostics payload to the clipboard',
  'ui.control.back': 'Back',
  'ui.control.multilevelList': 'Multilevel List',
  'ui.control.lineSpacingSingle': '1.0',
  'ui.control.lineSpacingDouble': '2.0',
  'ui.control.spaceBefore': 'Space Before',
  'ui.control.spaceAfter': 'Space After',
  'ui.control.stylesLauncher': 'Styles',
  'ui.control.coverPage': 'Cover Page',
  'ui.control.insertChart': 'Chart',
  'ui.control.insertPageNumber': 'Page Number',
  'ui.control.insertTextBox': 'Text Box',
  'ui.control.insertDate': 'Date & Time',
  'ui.control.themeFonts': 'Theme Fonts',
  'ui.control.themeColors': 'Theme Colours',
  'ui.control.paragraphSpacing': 'Paragraph Spacing',
  'ui.control.pageSetupDialog': 'Page Setup',
  'ui.control.marginsNormal': 'Normal',
  'ui.control.marginsNarrow': 'Narrow',
  'ui.control.marginsWide': 'Wide',
  'ui.control.columns': 'Columns',
  'ui.control.lineNumbers': 'Line Numbers',
  'ui.control.alignObjects': 'Align Objects',
  'ui.control.groupObjects': 'Group Objects',
  'ui.control.updateTable': 'Update Table',
  'ui.control.crossReference': 'Cross-reference',
  'ui.control.insertIndex': 'Index',
  'ui.control.bibliography': 'Bibliography',
  'ui.control.pasteSpecial': 'Paste Special',
  'ui.menu.text': 'Text menu',
  'ui.menu.table': 'Table menu',
  'ui.menu.image': 'Picture menu',
  'ui.menu.field': 'Field menu',
  'ui.menu.page': 'Page menu',
  'ui.menu.pasteboard': 'Pasteboard menu',
  'ui.menu.headerFooter': 'Header and footer menu',
  'ui.menu.ruler': 'Ruler menu',
  'ui.menu.statusBar': 'Status bar menu',
  'ui.menu.ribbon': 'Ribbon menu',
  'ui.menu.font': 'Font',
  'ui.menu.paragraph': 'Paragraph',
  'ui.menu.bullets': 'Bullets',
  'ui.menu.numbering': 'Numbering',
  'ui.menu.styles': 'Styles',
  'ui.menu.insert': 'Insert',
  'ui.menu.pasteOptions': 'Paste Options',
  'ui.menu.wrapText': 'Wrap Text',
  'ui.menu.changePicture': 'Change Picture',
  'ui.menu.compressPictures': 'Compress Pictures',
  'ui.menu.sizePosition': 'Size and Position',
  'ui.menu.insertRows': 'Insert Rows',
  'ui.menu.insertRowsAbove': 'Insert Rows Above',
  'ui.menu.insertRowsBelow': 'Insert Rows Below',
  'ui.menu.insertColumns': 'Insert Columns',
  'ui.menu.insertColumnsLeft': 'Insert Columns to the Left',
  'ui.menu.insertColumnsRight': 'Insert Columns to the Right',
  'ui.menu.cellAlignment': 'Cell Alignment',
  'ui.menu.borders': 'Borders',
  'ui.menu.synonyms': 'Synonyms',
  'ui.menu.deleteRows': 'Delete Rows',
  'ui.menu.deleteColumns': 'Delete Columns',
  'ui.menu.deleteTable': 'Delete Table',
  'ui.menu.mergeCells': 'Merge Cells',
  'ui.menu.splitCells': 'Split Cells',
  'ui.menu.tableProperties': 'Table Properties',
  'ui.menu.updateField': 'Update Field',
  'ui.menu.editField': 'Edit Field',
  'ui.menu.toggleFieldCodes': 'Toggle Field Codes',
  'ui.menu.fieldShading': 'Field Shading',
  'ui.menu.unlinkField': 'Unlink Field',
  'ui.menu.pageColour': 'Page Colour',
  'ui.menu.watermark': 'Watermark',
  'ui.menu.pageBorders': 'Page Borders',
  'ui.menu.delete': 'Delete',
  'ui.menu.selectAll': 'Select All',
  'ui.menu.clearFormatting': 'Clear Formatting',
  'ui.menu.editHeader': 'Edit Header',
  'ui.menu.editFooter': 'Edit Footer',
  'ui.menu.closeHeaderFooter': 'Close Header and Footer',
  'ui.menu.units': 'Units',
  'ui.menu.showRuler': 'Show Ruler',
  'ui.menu.tabsDialog': 'Tabs',
  'ui.menu.statusItems': 'Status bar items',
  'ui.menu.noItems': 'No commands are available here',
  'ui.status.page': 'Page {page} of {pages}',
  'ui.status.words': '{count} words',
  'ui.status.wordCountOne': '1 word',
  'ui.status.zoom': 'Zoom',
  'ui.status.zoomPercent': '{percent}%',
  'ui.status.language': 'Proofing language',
  'ui.status.save': 'Save state',
  'ui.status.save.saved': 'Saved',
  'ui.status.save.unsaved': 'Unsaved changes',
  'ui.status.save.saving': 'Saving…',
  'ui.status.save.failed': 'Save failed (retry)',
  'ui.status.save.autosaved': 'Autosaved',
  'ui.status.viewMode': 'View mode',
  'ui.status.item.page': 'Page number',
  'ui.status.item.words': 'Word count',
  'ui.status.item.language': 'Proofing language',
  'ui.status.item.save': 'Save state',
  'ui.status.item.view': 'View toggles',
  'ui.status.item.zoom': 'Zoom',
  'ui.ruler.marginLeft': 'Left margin',
  'ui.ruler.marginRight': 'Right margin',
  'ui.ruler.marginTop': 'Top margin',
  'ui.ruler.marginBottom': 'Bottom margin',
  'ui.ruler.indentFirstLine': 'First line indent',
  'ui.ruler.indentHanging': 'Hanging indent',
  'ui.ruler.indentLeft': 'Left indent',
  'ui.ruler.indentRight': 'Right indent',
  'ui.ruler.gutter': 'Gutter',
  'ui.ruler.value': '{name}: {value}',
  'ui.ruler.units': 'Ruler units',
  'ui.ruler.unit.cm': 'Centimetres',
  'ui.ruler.unit.mm': 'Millimetres',
  'ui.ruler.unit.inch': 'Inches',
  'ui.ruler.unit.pt': 'Points',
  'ui.ruler.unit.pica': 'Picas',
  'ui.ruler.unit.px': 'Pixels',
  'ui.ruler.mixed': 'Mixed values',
  'ui.keytip.press': 'Press {key} to use the {name}',
  'ui.dialog.notImplemented': '{name} is not available yet',
};

const registry = new Map<string, MessageCatalogue>();

const languageOf = (locale: LocaleCode): string => {
  const dash = locale.indexOf('-');
  return dash < 0 ? locale : locale.slice(0, dash);
};

registry.set(DEFAULT_LOCALE, EN_MESSAGES);
registry.set('en', EN_MESSAGES);

export const registerLanguage = (locale: LocaleCode, messages: MessageCatalogue): void => {
  const existing = registry.get(locale) ?? {};
  registry.set(locale, { ...existing, ...messages });
};

export const hasLanguage = (locale: LocaleCode): boolean => registry.has(locale);

export const registeredLanguages = (): readonly LocaleCode[] => [...registry.keys()].sort();

export const messagesFor = (locale: LocaleCode): MessageCatalogue => registry.get(locale) ?? {};

const lookup = (
  locale: LocaleCode,
  key: string,
  overrides: MessagesOverride | undefined,
): string | undefined => {
  const override = overrides?.[locale]?.[key];
  if (override !== undefined) return override;
  const exact = registry.get(locale)?.[key];
  if (exact !== undefined) return exact;
  const byLanguage = registry.get(languageOf(locale))?.[key];
  if (byLanguage !== undefined) return byLanguage;
  return undefined;
};

const interpolate = (template: string, params: MessageParams | undefined): string => {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
};

export interface UI18n {
  readonly locale: LocaleCode;
  readonly fallbackLocale: LocaleCode;
  text(key: string, params?: MessageParams): string;
  label(value: LocalizedString | undefined): string;
  formatNumber(value: number): string;
}

export const createUiI18n = (
  locale: LocaleCode,
  fallbackLocale: LocaleCode = DEFAULT_LOCALE,
  overrides?: MessagesOverride,
): UI18n => {
  const localizer = createLocalizer(locale, fallbackLocale, overrides);
  return {
    locale,
    fallbackLocale,
    text: (key, params) => {
      const resolved =
        lookup(locale, key, overrides) ??
        lookup(fallbackLocale, key, overrides) ??
        lookup(DEFAULT_LOCALE, key, overrides) ??
        EN_MESSAGES[key] ??
        key;
      return interpolate(resolved, params);
    },
    label: (value) => localizer.text(value),
    formatNumber: (value) => {
      try {
        return new Intl.NumberFormat(locale).format(value);
      } catch {
        return String(value);
      }
    },
  };
};
