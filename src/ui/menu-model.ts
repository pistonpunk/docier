import { unsupportedIds } from '../edit/areas/unsupported.js';
import { FONT_FAMILIES as FONT_FAMILY_NAMES, FONT_SIZES as FONT_SIZE_POINTS } from './font-family.js';
import type {
  ChromeActionArgs,
  ChromeActionName,
  ContextSurface,
  ControlOption,
} from './types.js';

export type UiNodeKind =
  | 'button'
  | 'toggle'
  | 'menu'
  | 'combo'
  | 'spinner'
  | 'gallery'
  | 'separator';

export interface UiNode {
  readonly kind: UiNodeKind;
  readonly id: string;
  readonly labelKey: string;
  readonly command?: string | undefined;
  readonly args?: unknown;
  readonly action?: ChromeActionName | undefined;
  readonly actionArgs?: ChromeActionArgs | undefined;
  readonly items?: readonly UiNode[] | undefined;
  readonly options?: readonly ControlOption[] | undefined;
  readonly keytip?: string | undefined;
  readonly wide?: boolean | undefined;
  readonly large?: boolean | undefined;
  readonly value?: string | undefined;
  readonly valueKey?: string | undefined;
  readonly valueArg?: string | undefined;
}

export interface UiGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly launcher?: UiNode | undefined;
  readonly large?: boolean | undefined;
  readonly nodes: readonly UiNode[];
}

export interface UiTab {
  readonly id: string;
  readonly labelKey: string;
  readonly keytip?: string | undefined;
  readonly contextual?: boolean | undefined;
  readonly groups: readonly UiGroup[];
}

const command = (name: string): string => `docier.command.${name}`;

const idOf = (init: Partial<UiNode> & { readonly labelKey: string }): string =>
  init.id ?? init.command ?? init.action ?? init.labelKey;

const node = (kind: UiNodeKind, init: Partial<UiNode> & { readonly labelKey: string }): UiNode => {
  const base: UiNode = {
    kind,
    id: idOf(init),
    labelKey: init.labelKey,
    command: init.command,
    args: init.args,
    action: init.action,
    actionArgs: init.actionArgs,
    items: init.items,
    options: init.options,
    keytip: init.keytip,
    wide: init.wide,
    large: init.large,
    value: init.value,
    valueKey: init.valueKey,
    valueArg: init.valueArg,
  };
  return base;};

const button = (init: Partial<UiNode> & { readonly labelKey: string }): UiNode =>
  node('button', init);

const toggle = (init: Partial<UiNode> & { readonly labelKey: string }): UiNode =>
  node('toggle', init);

const menu = (labelKey: string, items: readonly UiNode[], extra?: Partial<UiNode>): UiNode =>
  node('menu', { labelKey, items, ...extra });

const separator = (id = 'separator'): UiNode => node('separator', { labelKey: '', id });

const picturePicker = (labelKey: string, keytip: string): UiNode =>
  button({
    id: 'docier.command.object.insertImage',
    labelKey,
    keytip,
    action: 'openDialog',
    actionArgs: { dialog: 'object.insertImage' },
  });

export const FIELD_INSERT_NODES: readonly UiNode[] = [
  'pageNumber',
  'pageCount',
  'sectionNumber',
  'sectionPageCount',
  'dateTime',
  'time',
].map((name) => button({ id: command(`insert.${name}`), labelKey: '', command: command(`insert.${name}`) }));

const opensDialog = (id: string, name: string, labelKey: string, keytip: string): UiNode =>
  button({
    id,
    labelKey,
    keytip,
    action: 'openDialog',
    actionArgs: { dialog: name },
  });

const pending = (name: string, labelKey: string, keytip: string): UiNode =>
  button({
    labelKey,
    command: command(name),
    keytip,
    action: 'openDialog',
    actionArgs: { dialog: command(name) },
  });

const FONT_FAMILIES: readonly ControlOption[] = FONT_FAMILY_NAMES.map((family) => ({
  value: family,
  label: family,
}));

const FONT_SIZES: readonly ControlOption[] = FONT_SIZE_POINTS.map((size) => ({
  value: String(size),
}));

export const STYLE_GALLERY: readonly UiNode[] = [
  { id: 'Normal', labelKey: 'Normal', value: 'Normal' },
  { id: 'Heading1', labelKey: 'Heading 1', value: 'Heading1' },
  { id: 'Heading2', labelKey: 'Heading 2', value: 'Heading2' },
  { id: 'Heading3', labelKey: 'Heading 3', value: 'Heading3' },
  { id: 'Title', labelKey: 'Title', value: 'Title' },
  { id: 'Subtitle', labelKey: 'Subtitle', value: 'Subtitle' },
  { id: 'Quote', labelKey: 'Quote', value: 'Quote' },
  { id: 'Caption', labelKey: 'Caption', value: 'Caption' },
].map((entry) =>
  button({
    id: `style:${entry.id}`,
    labelKey: entry.labelKey,
    command: command('style.apply'),
    args: { styleId: entry.value },
    action: 'openDialog',
    actionArgs: { dialog: `style:${entry.id}` },
    value: entry.value,
  }),
);

export const QUICK_ACCESS: readonly UiNode[] = [
  button({
    labelKey: 'ui.control.save',
    command: command('doc.save'),
    keytip: 'S',
    action: 'openDialog',
    actionArgs: { dialog: command('doc.save') },
  }),
  button({
    labelKey: 'ui.control.undo',
    command: command('history.undo'),
    keytip: 'U',
  }),
  button({
    labelKey: 'ui.control.redo',
    command: command('history.redo'),
    keytip: 'R',
  }),
];

export const RIBBON_TABS: readonly UiTab[] = [
  {
    id: 'home',
    labelKey: 'ui.tab.home',
    keytip: 'H',
    groups: [
      {
        id: 'clipboard',
        labelKey: 'ui.group.clipboard',
        launcher: button({
          labelKey: 'ui.group.clipboard',
          action: 'openDialog',
          actionArgs: { dialog: 'clipboard' },
        }),
        nodes: [
          button({
            labelKey: 'ui.control.paste',
            command: command('clipboard.paste'),
            keytip: 'V',
            wide: true,
            large: true,
            action: 'openDialog',
            actionArgs: { dialog: command('clipboard.paste') },
          }),
          button({
            labelKey: 'ui.control.cut',
            command: command('clipboard.cut'),
            keytip: 'X',
            action: 'openDialog',
            actionArgs: { dialog: command('clipboard.cut') },
          }),
          button({
            labelKey: 'ui.control.copy',
            command: command('clipboard.copy'),
            keytip: 'C',
            action: 'openDialog',
            actionArgs: { dialog: command('clipboard.copy') },
          }),
          button({
            labelKey: 'ui.control.formatPainter',
            command: command('clipboard.formatPainter'),
            keytip: 'FP',
            action: 'openDialog',
            actionArgs: { dialog: command('clipboard.formatPainter') },
          }),
        ],
      },
      {
        id: 'font',
        labelKey: 'ui.group.font',
        launcher: button({
          labelKey: 'ui.control.fontFamily',
          action: 'openDialog',
          actionArgs: { dialog: 'font' },
        }),
        nodes: [
          node('combo', {
            labelKey: 'ui.control.fontFamily',
            command: command('format.setFontFamily'),
            options: FONT_FAMILIES,
            valueKey: 'family',
            valueArg: 'fontFamily',
            keytip: 'FF',
            action: 'openDialog',
            actionArgs: { dialog: command('format.setFontFamily') },
          }),
          node('spinner', {
            labelKey: 'ui.control.fontSize',
            command: command('format.setFontSize'),
            options: FONT_SIZES,
            valueKey: 'sizePoints',
            valueArg: 'sizeHalfPoints',
            keytip: 'FS',
            action: 'openDialog',
            actionArgs: { dialog: command('format.setFontSize') },
          }),
          button({
            labelKey: 'ui.control.growFont',
            command: command('format.growFont'),
            keytip: 'FG',
            action: 'openDialog',
            actionArgs: { dialog: command('format.growFont') },
          }),
          button({
            labelKey: 'ui.control.shrinkFont',
            command: command('format.shrinkFont'),
            keytip: 'FK',
            action: 'openDialog',
            actionArgs: { dialog: command('format.shrinkFont') },
          }),
          toggle({ labelKey: 'ui.control.bold', command: command('format.bold'), keytip: 'B' }),
          toggle({ labelKey: 'ui.control.italic', command: command('format.italic'), keytip: 'I' }),
          toggle({
            labelKey: 'ui.control.underline',
            command: command('format.underline'),
            keytip: 'U',
          }),
          toggle({ labelKey: 'ui.control.strike', command: command('format.strike'), keytip: 'S' }),
          toggle({
            labelKey: 'ui.control.superscript',
            command: command('format.superscript'),
            keytip: '1',
          }),
          toggle({
            labelKey: 'ui.control.subscript',
            command: command('format.subscript'),
            keytip: '2',
          }),
          button({
            labelKey: 'ui.control.textColor',
            command: command('format.setColor'),
            keytip: 'FC',
            action: 'openColourPicker',
            actionArgs: { command: command('format.setColor') },
          }),
          button({
            labelKey: 'ui.control.highlight',
            command: command('format.setHighlight'),
            keytip: 'H',
            action: 'openColourPicker',
            actionArgs: { command: command('format.setHighlight') },
          }),
          button({
            labelKey: 'ui.control.clearFormatting',
            command: command('format.clearCharacterFormatting'),
            keytip: 'CF',
          }),
        ],
      },
      {
        id: 'paragraph',
        labelKey: 'ui.group.paragraph',
        launcher: button({
          labelKey: 'ui.control.paragraphDialog',
          action: 'openDialog',
          actionArgs: { dialog: 'paragraph' },
        }),
        nodes: [
          menu('ui.menu.bullets', [
            button({
              labelKey: 'ui.control.bullets',
              command: command('numbering.bullets'),
              action: 'openDialog',
              actionArgs: { dialog: command('numbering.bullets') },
            }),
            button({
              labelKey: 'ui.control.numbering',
              command: command('numbering.numbers'),
              action: 'openDialog',
              actionArgs: { dialog: command('numbering.numbers') },
            }),
            button({
              labelKey: 'ui.control.multilevelList',
              command: command('numbering.multilevel'),
              action: 'openDialog',
              actionArgs: { dialog: command('numbering.multilevel') },
            }),
          ], { id: 'docier.command.numbering.bullets' }),
          button({
            labelKey: 'ui.control.indentDecrease',
            command: command('format.decreaseIndent'),
            keytip: 'AI',
            action: 'setIndent',
            actionArgs: { deltaTwips: -720, target: 'left' },
          }),
          button({
            labelKey: 'ui.control.indentIncrease',
            command: command('format.increaseIndent'),
            keytip: 'II',
            action: 'setIndent',
            actionArgs: { deltaTwips: 720, target: 'left' },
          }),
          toggle({
            labelKey: 'ui.control.alignLeft',
            command: command('format.alignLeft'),
            keytip: 'AL',
          }),
          toggle({
            labelKey: 'ui.control.alignCenter',
            command: command('format.alignCenter'),
            keytip: 'AC',
          }),
          toggle({
            labelKey: 'ui.control.alignRight',
            command: command('format.alignRight'),
            keytip: 'AR',
          }),
          toggle({
            labelKey: 'ui.control.alignJustify',
            command: command('format.alignJustify'),
            keytip: 'AJ',
          }),
          menu('ui.control.lineSpacing', [
            button({
              labelKey: 'ui.control.lineSpacingSingle',
              command: command('format.setLineSpacing'),
              args: { lineSpacing: 1 },
              action: 'openDialog',
              actionArgs: { dialog: command('format.setLineSpacing') },
            }),
            button({
              labelKey: 'ui.control.lineSpacingDouble',
              command: command('format.setLineSpacing'),
              args: { lineSpacing: 2 },
              action: 'openDialog',
              actionArgs: { dialog: command('format.setLineSpacing') },
            }),
            separator('spacing'),
            button({
              labelKey: 'ui.control.spaceAfter',
              command: command('format.setSpaceAfter'),
              action: 'openDialog',
              actionArgs: { dialog: command('format.setSpaceAfter') },
            }),
            button({
              labelKey: 'ui.control.spaceBefore',
              command: command('format.setSpaceBefore'),
              action: 'openDialog',
              actionArgs: { dialog: command('format.setSpaceBefore') },
            }),
          ], { id: 'docier.command.format.setLineSpacing' }),
        ],
      },
      {
        id: 'styles',
        labelKey: 'ui.group.styles',
        launcher: button({
          labelKey: 'ui.control.stylesLauncher',
          action: 'openDialog',
          actionArgs: { dialog: 'styles' },
        }),
        nodes: [node('gallery', { labelKey: 'ui.control.styles', items: STYLE_GALLERY })],
      },
      {
        id: 'editing',
        labelKey: 'ui.group.editing',
        nodes: [
          // No command on these two: a spec that names one is executed rather than
          // opened, and the dialog is the only sensible entry point for a search box.
          button({
            id: command('find.find'),
            labelKey: 'ui.control.find',
            action: 'openDialog',
            actionArgs: { dialog: command('find.find') },
            keytip: 'FD',
            large: true,
          }),
          button({
            id: command('find.replace'),
            labelKey: 'ui.control.replace',
            action: 'openDialog',
            actionArgs: { dialog: command('find.find') },
            keytip: 'HR',
          }),
          button({
            labelKey: 'ui.control.selectAll',
            command: command('edit.selectAll'),
            keytip: 'SA',
          }),
        ],
      },
    ],
  },
  {
    id: 'insert',
    labelKey: 'ui.tab.insert',
    keytip: 'N',
    groups: [
      {
        id: 'pages',
        labelKey: 'ui.group.pages',
        large: true,
        nodes: [
          button({
            labelKey: 'ui.control.insertPageBreak',
            command: command('edit.insertPageBreak'),
            keytip: 'PB',
          }),
          pending('insert.coverPage', 'ui.control.coverPage', 'CV'),
        ],
      },
      {
        id: 'tables',
        labelKey: 'ui.group.tables',
        large: true,
        nodes: [pending('insert.table', 'ui.control.insertTable', 'T')],
      },
      {
        id: 'illustrations',
        labelKey: 'ui.group.illustrations',
        large: true,
        nodes: [
          picturePicker('ui.control.insertImage', 'P'),
          pending('object.insertShape', 'ui.control.insertShape', 'SH'),
          pending('object.insertChart', 'ui.control.insertChart', 'CH'),
        ],
      },
      {
        id: 'links',
        labelKey: 'ui.group.links',
        large: true,
        nodes: [opensDialog('docier.command.insert.link', 'insert.link', 'ui.control.insertLink', 'L')],
      },
      {
        id: 'headerFooter',
        labelKey: 'ui.group.headerFooter',
        large: true,
        nodes: [
          pending('insert.header', 'ui.control.insertHeader', 'HD'),
          pending('insert.footer', 'ui.control.insertFooter', 'FT'),
          pending('insert.pageNumber', 'ui.control.insertPageNumber', 'PN'),
        ],
      },
      {
        id: 'text',
        labelKey: 'ui.group.text',
        large: true,
        nodes: [
          menu('ui.control.insertField', FIELD_INSERT_NODES, { keytip: 'F' }),
          pending('insert.textBox', 'ui.control.insertTextBox', 'TB'),
        ],
      },
      {
        id: 'symbols',
        labelKey: 'ui.group.symbols',
        large: true,
        nodes: [
          opensDialog('docier.command.insert.symbol', 'insert.symbol', 'ui.control.insertSymbol', 'SY'),
          button({
            labelKey: 'ui.control.insertDate',
            command: command('insert.dateTime'),
            action: 'openDialog',
            actionArgs: { dialog: command('insert.dateTime') },
          }),
        ],
      },
    ],
  },
  {
    id: 'design',
    labelKey: 'ui.tab.design',
    keytip: 'D',
    groups: [
      {
        id: 'documentFormatting',
        labelKey: 'ui.group.documentFormatting',
        large: true,
        nodes: [
          pending('theme.setFonts', 'ui.control.themeFonts', 'TF'),
          pending('theme.setColors', 'ui.control.themeColors', 'TC'),
          pending('theme.setSpacing', 'ui.control.paragraphSpacing', 'PS'),
        ],
      },
      {
        id: 'pageBackground',
        labelKey: 'ui.group.pageBackground',
        large: true,
        nodes: [
          pending('doc.setPageBackground', 'ui.menu.pageColour', 'PC'),
          pending('doc.setWatermark', 'ui.menu.watermark', 'WM'),
          pending('doc.setPageBorders', 'ui.menu.pageBorders', 'PBD'),
        ],
      },
    ],
  },
  {
    id: 'layout',
    labelKey: 'ui.tab.layout',
    keytip: 'P',
    groups: [
      {
        id: 'pageSetup',
        labelKey: 'ui.group.pageSetup',
        large: true,
        launcher: button({
          labelKey: 'ui.control.pageSetupDialog',
          action: 'openDialog',
          actionArgs: { dialog: 'pageSetup' },
        }),
        nodes: [
          menu('ui.control.margins', [
            button({
              labelKey: 'ui.control.marginsNormal',
              command: command('doc.setMargins'),
              args: { topTwips: 1440, rightTwips: 1440, bottomTwips: 1440, leftTwips: 1440 },
              action: 'setMargin',
              actionArgs: { preset: 'normal' },
            }),
            button({
              labelKey: 'ui.control.marginsNarrow',
              command: command('doc.setMargins'),
              args: { topTwips: 720, rightTwips: 720, bottomTwips: 720, leftTwips: 720 },
              action: 'setMargin',
              actionArgs: { preset: 'narrow' },
            }),
            button({
              labelKey: 'ui.control.marginsWide',
              command: command('doc.setMargins'),
              args: { topTwips: 1440, rightTwips: 2880, bottomTwips: 1440, leftTwips: 2880 },
              action: 'setMargin',
              actionArgs: { preset: 'wide' },
            }),
          ]),
          button({
            labelKey: 'ui.control.orientation',
            command: command('doc.setOrientation'),
            keytip: 'OR',
            action: 'openDialog',
            actionArgs: { dialog: command('doc.setOrientation') },
          }),
          button({
            labelKey: 'ui.control.pageSize',
            command: command('doc.setPageSize'),
            keytip: 'SZ',
            action: 'openDialog',
            actionArgs: { dialog: command('doc.setPageSize') },
          }),
          pending('doc.setColumns', 'ui.control.columns', 'CO'),
          button({
            labelKey: 'ui.control.lineNumbers',
            command: command('doc.setLineNumbers'),
            action: 'openDialog',
            actionArgs: { dialog: command('doc.setLineNumbers') },
          }),
        ],
      },
      {
        id: 'paragraphLayout',
        labelKey: 'ui.group.paragraph',
        large: true,
        launcher: button({
          labelKey: 'ui.control.paragraphDialog',
          action: 'openDialog',
          actionArgs: { dialog: 'paragraph' },
        }),
        nodes: [
          button({
            labelKey: 'ui.ruler.indentLeft',
            command: command('format.setParagraphIndent'),
            action: 'setIndent',
            actionArgs: { deltaTwips: 720, target: 'left' },
          }),
          button({
            labelKey: 'ui.ruler.indentRight',
            command: command('format.setParagraphIndent'),
            action: 'setIndent',
            actionArgs: { deltaTwips: -720, target: 'right' },
          }),
          pending('format.setSpaceBefore', 'ui.control.spaceBefore', 'SB'),
          pending('format.setSpaceAfter', 'ui.control.spaceAfter', 'SA'),
        ],
      },
      {
        id: 'arrange',
        labelKey: 'ui.group.arrange',
        large: true,
        nodes: [
          pending('object.bringForward', 'ui.control.arrangeBringForward', 'BF'),
          pending('object.sendBackward', 'ui.control.arrangeSendBackward', 'SBK'),
          pending('object.align', 'ui.control.alignObjects', 'AO'),
          pending('object.group', 'ui.control.groupObjects', 'GO'),
        ],
      },
    ],
  },
  {
    id: 'references',
    labelKey: 'ui.tab.references',
    keytip: 'R',
    groups: [
      {
        id: 'toc',
        labelKey: 'ui.group.tableOfContents',
        large: true,
        nodes: [
          pending('insert.tableOfContents', 'ui.control.tableOfContents', 'TOC'),
          pending('insert.updateTable', 'ui.control.updateTable', 'UT'),
        ],
      },
      {
        id: 'notes',
        labelKey: 'ui.group.footnotes',
        large: true,
        nodes: [
          pending('insert.footnote', 'ui.control.insertFootnote', 'FN'),
          pending('insert.endnote', 'ui.control.insertEndnote', 'EN'),
        ],
      },
      {
        id: 'captions',
        labelKey: 'ui.group.captions',
        large: true,
        nodes: [
          pending('insert.caption', 'ui.control.insertCaption', 'CP'),
          pending('insert.crossReference', 'ui.control.crossReference', 'CR'),
        ],
      },
      {
        id: 'index',
        labelKey: 'ui.group.index',
        large: true,
        nodes: [
          pending('insert.index', 'ui.control.insertIndex', 'IX'),
          pending('insert.bibliography', 'ui.control.bibliography', 'BI'),
        ],
      },
    ],
  },
  {
    id: 'review',
    labelKey: 'ui.tab.review',
    keytip: 'E',
    groups: [
      {
        id: 'proofing',
        labelKey: 'ui.group.proofing',
        large: true,
        nodes: [
          pending('proof.spelling', 'ui.control.spelling', 'SP'),
          pending('proof.thesaurus', 'ui.control.thesaurus', 'TH'),
          button({
            labelKey: 'ui.control.wordCount',
            command: command('proof.wordCount'),
            keytip: 'WC',
            action: 'openDialog',
            actionArgs: { dialog: command('proof.wordCount') },
          }),
        ],
      },
      {
        id: 'language',
        labelKey: 'ui.group.language',
        large: true,
        nodes: [pending('proof.setLanguage', 'ui.control.setLanguage', 'SL')],
      },
      {
        id: 'comments',
        labelKey: 'ui.group.comments',
        large: true,
        nodes: [
          pending('comment.create', 'ui.control.newComment', 'NC'),
          pending('comment.delete', 'ui.control.deleteComment', 'DC'),
          button({
            labelKey: 'ui.control.commentsPane',
            id: 'docier.command.view.toggleComments',
            action: 'toggleComments',
            keytip: 'CP',
          }),
        ],
      },
      {
        id: 'tracking',
        labelKey: 'ui.group.tracking',
        large: true,
        nodes: [
          toggle({
            labelKey: 'ui.control.trackChanges',
            command: command('doc.toggleTrackChanges'),
            keytip: 'TC',
            action: 'openDialog',
            actionArgs: { dialog: command('doc.toggleTrackChanges') },
          }),
          pending('doc.acceptChange', 'ui.control.acceptChange', 'AC'),
          pending('doc.rejectChange', 'ui.control.rejectChange', 'RC'),
        ],
      },
    ],
  },
  {
    id: 'view',
    labelKey: 'ui.tab.view',
    keytip: 'W',
    groups: [
      {
        id: 'views',
        labelKey: 'ui.group.views',
        large: true,
        nodes: [
          toggle({ labelKey: 'ui.control.viewPrint', action: 'setViewMode', actionArgs: { mode: 'print' }, keytip: 'VP' }),
          toggle({ labelKey: 'ui.control.viewWeb', action: 'setViewMode', actionArgs: { mode: 'web' }, keytip: 'VW' }),
          toggle({ labelKey: 'ui.control.viewDraft', action: 'setViewMode', actionArgs: { mode: 'draft' }, keytip: 'VD' }),
          toggle({ labelKey: 'ui.control.viewRead', action: 'setViewMode', actionArgs: { mode: 'read' }, keytip: 'VR' }),
        ],
      },
      {
        id: 'show',
        labelKey: 'ui.group.show',
        large: true,
        nodes: [
          toggle({ labelKey: 'ui.control.showRuler', action: 'toggleRuler', keytip: 'RU' }),
          pending('view.setGridlines', 'ui.control.showGridlines', 'GL'),
          pending('view.setNavigation', 'ui.control.showNavigation', 'NP'),
        ],
      },
      {
        id: 'zoom',
        labelKey: 'ui.group.zoom',
        large: true,
        nodes: [
          button({ labelKey: 'ui.control.zoomIn', action: 'zoomIn', keytip: 'ZI' }),
          button({ labelKey: 'ui.control.zoomOut', action: 'zoomOut', keytip: 'ZO' }),
          button({ labelKey: 'ui.control.zoom100', action: 'zoomSet', actionArgs: { zoom: 1 }, keytip: 'Z1' }),
          button({ labelKey: 'ui.control.zoomPageWidth', action: 'zoomFit', actionArgs: { mode: 'pageWidth' }, keytip: 'ZW' }),
          button({ labelKey: 'ui.control.zoomWholePage', action: 'zoomFit', actionArgs: { mode: 'wholePage' }, keytip: 'ZP' }),
          toggle({ labelKey: 'ui.control.collapseRibbon', action: 'ribbonToggle', keytip: 'CR' }),
        ],
      },
    ],
  },
];

export const TABLE_TAB: UiTab = {
  id: 'table',
  labelKey: 'ui.tab.table',
  keytip: 'JT',
  contextual: true,
  groups: [
    {
      id: 'tableTools',
      labelKey: 'ui.group.tableTools',
      nodes: [
        button({ labelKey: 'ui.menu.insertRowsAbove', id: 'ctx:table:rowsAbove', command: command('table.insertRowsAbove') }),
        button({ labelKey: 'ui.menu.insertRowsBelow', id: 'ctx:table:rowsBelow', command: command('table.insertRowsBelow') }),
        button({ labelKey: 'ui.menu.insertColumnsLeft', id: 'ctx:table:colsLeft', command: command('table.insertColumnsLeft') }),
        button({ labelKey: 'ui.menu.insertColumnsRight', id: 'ctx:table:colsRight', command: command('table.insertColumnsRight') }),
      ],
    },
    {
      id: 'merge',
      labelKey: 'ui.group.merge',
      nodes: [
        pending('table.mergeCells', 'ui.menu.mergeCells', 'MC'),
        pending('table.splitCells', 'ui.menu.splitCells', 'SC'),
        pending('table.delete', 'ui.menu.deleteTable', 'DT'),
      ],
    },
    {
      id: 'tableProperties',
      labelKey: 'ui.group.tableProperties',
      nodes: [pending('table.setProperties', 'ui.menu.tableProperties', 'TP')],
    },
  ],
};

export const PICTURE_TAB: UiTab = {
  id: 'picture',
  labelKey: 'ui.tab.picture',
  keytip: 'JP',
  contextual: true,
  groups: [
    {
      id: 'pictureTools',
      labelKey: 'ui.group.pictureTools',
      nodes: [
        pending('object.setWrap', 'ui.menu.wrapText', 'WT'),
        pending('object.changeImage', 'ui.menu.changePicture', 'CP'),
        pending('object.compress', 'ui.menu.compressPictures', 'CM'),
      ],
    },
    {
      id: 'pictureArrange',
      labelKey: 'ui.group.arrange',
      nodes: [
        pending('object.bringForward', 'ui.control.arrangeBringForward', 'BF'),
        pending('object.sendBackward', 'ui.control.arrangeSendBackward', 'BK'),
        pending('object.setSize', 'ui.menu.sizePosition', 'SZ'),
      ],
    },
    {
      id: 'pictureCaption',
      labelKey: 'ui.group.captions',
      nodes: [
        pending('insert.caption', 'ui.control.insertCaption', 'CA'),
        pending('object.delete', 'ui.menu.delete', 'DL'),
      ],
    },
  ],
};


const editSubmenuFor = (prefix: string): readonly UiNode[] => [
  button({ labelKey: 'ui.control.cut', id: `${prefix}:cut`, command: command('clipboard.cut') }),
  button({ labelKey: 'ui.control.copy', id: `${prefix}:copy`, command: command('clipboard.copy') }),
  button({ labelKey: 'ui.control.paste', id: `${prefix}:paste`, command: command('clipboard.paste') }),
];

const fontSubmenu = (prefix: string): UiNode =>
  menu('ui.menu.font', [
    toggle({ labelKey: 'ui.control.bold', id: `${prefix}:bold`, command: command('format.bold') }),
    toggle({ labelKey: 'ui.control.italic', id: `${prefix}:italic`, command: command('format.italic') }),
    toggle({ labelKey: 'ui.control.underline', id: `${prefix}:underline`, command: command('format.underline') }),
    toggle({ labelKey: 'ui.control.strike', id: `${prefix}:strike`, command: command('format.strike') }),
    separator(`${prefix}:font-sep`),
    toggle({ labelKey: 'ui.control.superscript', id: `${prefix}:sup`, command: command('format.superscript') }),
    toggle({ labelKey: 'ui.control.subscript', id: `${prefix}:sub`, command: command('format.subscript') }),
    separator(`${prefix}:font-sep2`),
    button({ labelKey: 'ui.control.textColor', id: `${prefix}:color`, command: command('format.setColor'), action: 'openColourPicker', actionArgs: { command: command('format.setColor') } }),
    button({ labelKey: 'ui.control.highlight', id: `${prefix}:highlight`, command: command('format.setHighlight'), action: 'openColourPicker', actionArgs: { command: command('format.setHighlight') } }),
  ]);

const paragraphSubmenu = (prefix: string): UiNode =>
  menu('ui.menu.paragraph', [
    toggle({ labelKey: 'ui.control.alignLeft', id: `${prefix}:al`, command: command('format.alignLeft') }),
    toggle({ labelKey: 'ui.control.alignCenter', id: `${prefix}:ac`, command: command('format.alignCenter') }),
    toggle({ labelKey: 'ui.control.alignRight', id: `${prefix}:ar`, command: command('format.alignRight') }),
    toggle({ labelKey: 'ui.control.alignJustify', id: `${prefix}:aj`, command: command('format.alignJustify') }),
    separator(`${prefix}:p-sep`),
    button({ labelKey: 'ui.control.indentIncrease', id: `${prefix}:ind+`, command: command('format.increaseIndent'), action: 'setIndent', actionArgs: { deltaTwips: 720, target: 'left' } }),
    button({ labelKey: 'ui.control.indentDecrease', id: `${prefix}:ind-`, command: command('format.decreaseIndent'), action: 'setIndent', actionArgs: { deltaTwips: -720, target: 'left' } }),
  ]);

const CELL_ALIGNMENTS: readonly { readonly name: string; readonly labelKey: string }[] = [
  { name: 'TopLeft', labelKey: 'ui.menu.cellAlignTopLeft' },
  { name: 'TopCenter', labelKey: 'ui.menu.cellAlignTopCentre' },
  { name: 'TopRight', labelKey: 'ui.menu.cellAlignTopRight' },
  { name: 'CenterLeft', labelKey: 'ui.menu.cellAlignMiddleLeft' },
  { name: 'CenterCenter', labelKey: 'ui.menu.cellAlignMiddle' },
  { name: 'CenterRight', labelKey: 'ui.menu.cellAlignMiddleRight' },
  { name: 'BottomLeft', labelKey: 'ui.menu.cellAlignBottomLeft' },
  { name: 'BottomCenter', labelKey: 'ui.menu.cellAlignBottomCentre' },
  { name: 'BottomRight', labelKey: 'ui.menu.cellAlignBottomRight' },
];

const CELL_ALIGNMENT_ITEMS = (): readonly UiNode[] =>
  CELL_ALIGNMENTS.map((alignment) =>
    toggle({
      labelKey: alignment.labelKey,
      id: `ctx:table2:align${alignment.name}`,
      command: command(`table.cellAlign${alignment.name}`),
    }),
  );

export const ALL_RIBBON_TABS: readonly UiTab[] = [...RIBBON_TABS, TABLE_TAB, PICTURE_TAB];

export const CONTEXT_MENUS: Readonly<Record<ContextSurface, readonly UiNode[]>> = {
  text: [
    ...editSubmenuFor('ctx:text'),
    menu('ui.menu.pasteOptions', [
      button({ labelKey: 'ui.control.paste', id: 'ctx:text:paste', command: command('clipboard.paste') }),
      button({ labelKey: 'ui.control.pasteSpecial', id: 'ctx:text:pasteSpecial', command: command('clipboard.pastePlain') }),
    ]),
    separator('ctx:text:sep1'),
    fontSubmenu('ctx:text'),
    paragraphSubmenu('ctx:text'),
    menu('ui.menu.bullets', [
      button({ labelKey: 'ui.control.bullets', id: 'ctx:text:bullets', command: command('numbering.bullets'), action: 'openDialog', actionArgs: { dialog: command('numbering.bullets') } }),
      button({ labelKey: 'ui.control.numbering', id: 'ctx:text:numbers', command: command('numbering.numbers'), action: 'openDialog', actionArgs: { dialog: command('numbering.numbers') } }),
    ]),
    separator('ctx:text:sep2'),
    menu('ui.menu.insert', [pending('insert.table', 'ui.control.insertTable', 'T'), opensDialog('ctx:page:link', 'insert.link', 'ui.control.insertLink', 'L'), opensDialog('ctx:page:symbol', 'insert.symbol', 'ui.control.insertSymbol', 'SY')]),
    separator('ctx:text:sep3'),
    node('menu', {
      id: 'ctx:text:synonyms',
      labelKey: 'ui.menu.synonyms',
      items: [button({ labelKey: 'ui.control.thesaurus', id: 'ctx:text:thesaurus', command: command('proof.thesaurus'), action: 'openDialog', actionArgs: { dialog: command('proof.thesaurus') } })],
    }),
    button({ labelKey: 'ui.control.translate', id: 'ctx:text:translate', command: command('proof.translate') }),
    pending('comment.create', 'ui.control.newComment', 'NC'),
    separator('ctx:text:sep4'),
    button({ labelKey: 'ui.control.find', id: 'ctx:text:find', action: 'openDialog', actionArgs: { dialog: command('find.find') } }),
    button({ labelKey: 'ui.control.selectAll', id: 'ctx:text:all', command: command('edit.selectAll') }),
  ],
  table: [
    menu('ui.menu.insertRows', [
      button({ labelKey: 'ui.menu.insertRowsAbove', id: 'ctx:table2:rowsAbove', command: command('table.insertRowsAbove') }),
      button({ labelKey: 'ui.menu.insertRowsBelow', id: 'ctx:table2:rowsBelow', command: command('table.insertRowsBelow') }),
    ]),
    menu('ui.menu.insertColumns', [
      button({ labelKey: 'ui.menu.insertColumnsLeft', id: 'ctx:table2:colsLeft', command: command('table.insertColumnsLeft') }),
      button({ labelKey: 'ui.menu.insertColumnsRight', id: 'ctx:table2:colsRight', command: command('table.insertColumnsRight') }),
    ]),
    button({ labelKey: 'ui.menu.insertCells', id: 'ctx:table2:insertCells', command: command('table.insertCells'), keytip: 'IC' }),
    separator('ctx:table:sep0'),
    menu('ui.menu.delete', [
      button({ labelKey: 'ui.menu.deleteRows', id: 'ctx:table2:deleteRows', command: command('table.deleteRow'), keytip: 'DR' }),
      button({ labelKey: 'ui.menu.deleteColumns', id: 'ctx:table2:deleteCols', command: command('table.deleteColumn'), keytip: 'DC' }),
      button({ labelKey: 'ui.menu.deleteTable', id: 'ctx:table2:deleteTable', command: command('table.delete'), keytip: 'DT' }),
    ]),
    separator('ctx:table:sep1'),
    menu('ui.menu.select', [
      button({ labelKey: 'ui.menu.selectRow', id: 'ctx:table2:selectRow', command: command('table.selectRow'), keytip: 'SR' }),
      button({ labelKey: 'ui.menu.selectColumn', id: 'ctx:table2:selectCol', command: command('table.selectColumn'), keytip: 'SC' }),
      button({ labelKey: 'ui.menu.selectTable', id: 'ctx:table2:selectTable', command: command('table.selectTable'), keytip: 'ST' }),
    ]),
    separator('ctx:table:sep2'),
    button({ labelKey: 'ui.menu.mergeCells', id: 'ctx:table2:merge', command: command('table.mergeCells'), keytip: 'MC' }),
    button({ labelKey: 'ui.menu.splitCells', id: 'ctx:table2:split', command: command('table.splitCells'), keytip: 'SP' }),
    button({ labelKey: 'ui.menu.splitTable', id: 'ctx:table2:splitTable', command: command('table.splitTable'), keytip: 'SB' }),
    separator('ctx:table:sep3'),
    menu('ui.menu.cellAlignment', CELL_ALIGNMENT_ITEMS()),
    menu('ui.menu.autoFit', [
      toggle({ labelKey: 'ui.menu.autoFitContents', id: 'ctx:table2:autoFitContents', command: command('table.autoFitContents') }),
      toggle({ labelKey: 'ui.menu.autoFitWindow', id: 'ctx:table2:autoFitWindow', command: command('table.autoFitWindow') }),
      toggle({ labelKey: 'ui.menu.fixedWidth', id: 'ctx:table2:fixedWidth', command: command('table.autoFitFixed') }),
    ]),
    button({ labelKey: 'ui.menu.distributeColumns', id: 'ctx:table2:distributeCols', command: command('table.distributeColumns'), keytip: 'DC' }),
    button({ labelKey: 'ui.menu.distributeRows', id: 'ctx:table2:distributeRows', command: command('table.distributeRows'), keytip: 'DR' }),
    button({ labelKey: 'ui.menu.bordersShading', id: 'ctx:table2:borders', command: command('table.setBorders'), keytip: 'BS' }),
    button({ labelKey: 'ui.menu.textDirection', id: 'ctx:table2:textDirection', command: command('table.setTextDirection'), keytip: 'TD' }),
    separator('ctx:table:sep4'),
    button({ labelKey: 'ui.menu.sort', id: 'ctx:table2:sort', command: command('table.sort'), keytip: 'SO' }),
    button({ labelKey: 'ui.menu.formula', id: 'ctx:table2:formula', command: command('table.formula'), keytip: 'FM' }),
    toggle({ labelKey: 'ui.menu.repeatHeaderRows', id: 'ctx:table2:repeatHeader', command: command('table.repeatHeaderRows'), keytip: 'RH' }),
    separator('ctx:table:sep5'),
    button({ labelKey: 'ui.menu.tableProperties', id: 'ctx:table2:properties', command: command('table.propertiesDialog'), keytip: 'TP' }),
  ],
  image: [
    pending('object.setWrap', 'ui.menu.wrapText', 'WT'),
    separator('ctx:image:sep1'),
    pending('object.changeImage', 'ui.menu.changePicture', 'CP'),
    pending('object.compress', 'ui.menu.compressPictures', 'CM'),
    separator('ctx:image:sep2'),
    pending('insert.caption', 'ui.control.insertCaption', 'CA'),
    pending('object.setSize', 'ui.menu.sizePosition', 'SZ'),
    pending('object.bringForward', 'ui.control.arrangeBringForward', 'BF'),
    pending('object.sendBackward', 'ui.control.arrangeSendBackward', 'BK'),
    separator('ctx:image:sep3'),
    menu('ui.menu.insert', [picturePicker('ui.control.insertImage', 'P')]),
    pending('object.delete', 'ui.menu.delete', 'DL'),
  ],
  field: [
    pending('token.update', 'ui.menu.updateField', 'UF'),
    pending('token.edit', 'ui.menu.editField', 'EF'),
    separator('ctx:field:sep1'),
    toggle({ labelKey: 'ui.menu.toggleFieldCodes', id: 'ctx:field:codes', command: command('token.toggleCodes'), action: 'openDialog', actionArgs: { dialog: command('token.toggleCodes') } }),
    button({ labelKey: 'ui.menu.fieldShading', id: 'ctx:field:shading', action: 'openDialog', actionArgs: { dialog: 'token.shading' } }),
    separator('ctx:field:sep2'),
    pending('token.unlink', 'ui.menu.unlinkField', 'UL'),
    pending('token.setValue', 'ui.control.insertField', 'IF'),
  ],
  page: [
    menu('ui.menu.pasteOptions', [
      button({ labelKey: 'ui.control.paste', id: 'ctx:page:paste', command: command('clipboard.paste'), action: 'openDialog', actionArgs: { dialog: command('clipboard.paste') } }),
      button({ labelKey: 'ui.control.pasteSpecial', id: 'ctx:page:pasteSpecial', command: command('clipboard.pasteSpecial'), action: 'openDialog', actionArgs: { dialog: command('clipboard.pasteSpecial') } }),
    ]),
    separator('ctx:page:sep1'),
    pending('doc.setPageBackground', 'ui.menu.pageColour', 'PC'),
    pending('doc.setWatermark', 'ui.menu.watermark', 'WM'),
    pending('doc.setPageBorders', 'ui.menu.pageBorders', 'PB'),
    separator('ctx:page:sep2'),
    menu('ui.control.margins', [
      pending('doc.setMargins', 'ui.control.margins', 'MG'),
    ]),
    pending('doc.setOrientation', 'ui.control.orientation', 'OR'),
    pending('doc.setPageSize', 'ui.control.pageSize', 'SZ'),
    separator('ctx:page:sep3'),
    pending('insert.header', 'ui.control.insertHeader', 'HD'),
    pending('insert.footer', 'ui.control.insertFooter', 'FT'),
    pending('insert.pageNumber', 'ui.control.insertPageNumber', 'PN'),
    separator('ctx:page:sep4'),
    button({ labelKey: 'ui.control.selectAll', id: 'ctx:page:all', command: command('edit.selectAll') }),
  ],
  pasteboard: [
    button({ labelKey: 'ui.control.paste', id: 'ctx:pasteboard:paste', command: command('clipboard.paste'), action: 'openDialog', actionArgs: { dialog: command('clipboard.paste') } }),
    separator('ctx:pasteboard:sep1'),
    button({ labelKey: 'ui.control.insertPageBreak', id: 'ctx:pasteboard:pb', command: command('edit.insertPageBreak') }),
    pending('insert.table', 'ui.control.insertTable', 'T'),
    separator('ctx:pasteboard:sep2'),
    button({ labelKey: 'ui.control.selectAll', id: 'ctx:pasteboard:all', command: command('edit.selectAll') }),
    separator('ctx:pasteboard:sep3'),
    node('menu', {
      id: 'ctx:pasteboard:zoom',
      labelKey: 'ui.group.zoom',
      items: [
        button({ labelKey: 'ui.control.zoomIn', id: 'ctx:pasteboard:zi', action: 'zoomIn' }),
        button({ labelKey: 'ui.control.zoomOut', id: 'ctx:pasteboard:zo', action: 'zoomOut' }),
        button({ labelKey: 'ui.control.zoom100', id: 'ctx:pasteboard:z1', action: 'zoomSet', actionArgs: { zoom: 1 } }),
      ],
    }),
    toggle({ labelKey: 'ui.control.showRuler', id: 'ctx:pasteboard:ruler', action: 'toggleRuler' }),
  ],
  headerFooter: [
    menu('ui.menu.editHeader', [
      pending('insert.header', 'ui.menu.editHeader', 'EH'),
      pending('insert.footer', 'ui.menu.editFooter', 'EF'),
    ]),
    separator('ctx:hf:sep1'),
    pending('insert.pageNumber', 'ui.control.insertPageNumber', 'PN'),
    pending('insert.dateTime', 'ui.control.insertDate', 'DT'),
    separator('ctx:hf:sep2'),
    pending('insert.closeHeaderFooter', 'ui.menu.closeHeaderFooter', 'CH'),
    button({ labelKey: 'ui.control.selectAll', id: 'ctx:hf:all', command: command('edit.selectAll') }),
  ],
  ruler: [
    node('menu', {
      id: 'ctx:ruler:units',
      labelKey: 'ui.menu.units',
      items: [
        toggle({ labelKey: 'ui.ruler.unit.cm', id: 'ctx:ruler:cm', action: 'setUnits', actionArgs: { units: 'cm' } }),
        toggle({ labelKey: 'ui.ruler.unit.mm', id: 'ctx:ruler:mm', action: 'setUnits', actionArgs: { units: 'mm' } }),
        toggle({ labelKey: 'ui.ruler.unit.inch', id: 'ctx:ruler:inch', action: 'setUnits', actionArgs: { units: 'inch' } }),
        toggle({ labelKey: 'ui.ruler.unit.pt', id: 'ctx:ruler:pt', action: 'setUnits', actionArgs: { units: 'pt' } }),
        toggle({ labelKey: 'ui.ruler.unit.pica', id: 'ctx:ruler:pica', action: 'setUnits', actionArgs: { units: 'pica' } }),
        toggle({ labelKey: 'ui.ruler.unit.px', id: 'ctx:ruler:px', action: 'setUnits', actionArgs: { units: 'px' } }),
      ],
    }),
    separator('ctx:ruler:sep1'),
    pending('doc.setMargins', 'ui.control.margins', 'MG'),
    pending('format.setTabs', 'ui.menu.tabsDialog', 'TB'),
    separator('ctx:ruler:sep2'),
    toggle({ labelKey: 'ui.menu.showRuler', id: 'ctx:ruler:show', action: 'toggleRuler' }),
  ],
  statusBar: [],
  ribbon: [
    toggle({ labelKey: 'ui.control.collapseRibbon', id: 'ctx:ribbon:collapse', action: 'ribbonToggle' }),
    separator('ctx:ribbon:sep1'),
    button({ labelKey: 'ui.control.customizeRibbon', id: 'ctx:ribbon:customize', action: 'openDialog', actionArgs: { dialog: 'customizeRibbon' } }),
    button({ labelKey: 'ui.control.addToQuickAccess', id: 'ctx:ribbon:qat', action: 'openDialog', actionArgs: { dialog: 'quickAccess' } }),
    separator('ctx:ribbon:sep2'),
    button({ labelKey: 'ui.control.diagnostics', id: 'ctx:ribbon:diagnostics', action: 'openDialog', actionArgs: { dialog: 'diagnostics' } }),
  ],
};

export const STATUS_ITEM_MENU: readonly UiNode[] = [
  toggle({ labelKey: 'ui.status.item.page', id: 'status:page', action: 'toggleStatusItem', actionArgs: { item: 'page' } }),
  toggle({ labelKey: 'ui.status.item.words', id: 'status:words', action: 'toggleStatusItem', actionArgs: { item: 'words' } }),
  toggle({ labelKey: 'ui.status.item.language', id: 'status:language', action: 'toggleStatusItem', actionArgs: { item: 'language' } }),
  toggle({ labelKey: 'ui.status.item.save', id: 'status:save', action: 'toggleStatusItem', actionArgs: { item: 'save' } }),
  toggle({ labelKey: 'ui.status.item.view', id: 'status:view', action: 'toggleStatusItem', actionArgs: { item: 'view' } }),
  toggle({ labelKey: 'ui.status.item.zoom', id: 'status:zoom', action: 'toggleStatusItem', actionArgs: { item: 'zoom' } }),
];

export const BACKSTAGE_ITEMS: readonly UiNode[] = [
  pending('doc.open', 'ui.control.open', 'O'),
  button({ labelKey: 'ui.control.save', id: 'backstage:save', command: command('doc.save'), action: 'openDialog', actionArgs: { dialog: command('doc.save') } }),
  pending('doc.saveAs', 'ui.control.saveAs', 'A'),
  separator('backstage:sep1'),
  pending('export.pdf', 'ui.control.exportPdf', 'P'),
  pending('export.docx', 'ui.control.exportDocx', 'D'),
  pending('export.html', 'ui.control.exportHtml', 'H'),
  separator('backstage:sep2'),
  pending('doc.print', 'ui.control.print', 'PR'),
  separator('backstage:sep3'),
  button({ labelKey: 'ui.control.diagnostics', id: 'backstage:diagnostics', action: 'openDialog', actionArgs: { dialog: 'diagnostics' } }),
  button({ labelKey: 'ui.control.close', id: 'backstage:close', action: 'closeBackstage' }),
];

export const FLOATING_CONTROLS: readonly UiNode[] = [
  node('combo', {
    labelKey: 'ui.control.fontFamily',
    command: command('format.setFontFamily'),
    options: FONT_FAMILIES,
    valueKey: 'family',
    valueArg: 'fontFamily',
    action: 'openDialog',
    actionArgs: { dialog: command('format.setFontFamily') },
  }),
  node('spinner', {
    labelKey: 'ui.control.fontSize',
    command: command('format.setFontSize'),
    options: FONT_SIZES,
    valueKey: 'sizePoints',
    valueArg: 'sizeHalfPoints',
    action: 'openDialog',
    actionArgs: { dialog: command('format.setFontSize') },
  }),
  separator('float:sep1'),
  toggle({ labelKey: 'ui.control.bold', id: 'float:bold', command: command('format.bold') }),
  toggle({ labelKey: 'ui.control.italic', id: 'float:italic', command: command('format.italic') }),
  toggle({ labelKey: 'ui.control.underline', id: 'float:underline', command: command('format.underline') }),
  toggle({ labelKey: 'ui.control.strike', id: 'float:strike', command: command('format.strike') }),
  separator('float:sep2'),
  button({ labelKey: 'ui.control.textColor', id: 'float:color', command: command('format.setColor'), action: 'openColourPicker', actionArgs: { command: command('format.setColor') } }),
  button({ labelKey: 'ui.control.highlight', id: 'float:highlight', command: command('format.setHighlight'), action: 'openColourPicker', actionArgs: { command: command('format.setHighlight') } }),
  separator('float:sep3'),
  toggle({ labelKey: 'ui.control.alignLeft', id: 'float:al', command: command('format.alignLeft') }),
  toggle({ labelKey: 'ui.control.alignCenter', id: 'float:ac', command: command('format.alignCenter') }),
  toggle({ labelKey: 'ui.control.alignRight', id: 'float:ar', command: command('format.alignRight') }),
  separator('float:sep4'),
  button({ labelKey: 'ui.control.clearFormatting', id: 'float:clear', command: command('format.clearCharacterFormatting') }),
];

export const isSeparator = (value: UiNode): boolean => value.kind === 'separator';

export const menuHeads = (items: readonly UiNode[]): readonly UiNode[] =>
  items.filter((item) => !isSeparator(item));

const UNSUPPORTED: ReadonlySet<string> = new Set(unsupportedIds);

const isPlaceholder = (node: UiNode): boolean =>
  node.command !== undefined && UNSUPPORTED.has(node.command);

const withoutLooseSeparators = (nodes: readonly UiNode[]): readonly UiNode[] => {
  const out: UiNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'separator' && (out.length === 0 || out[out.length - 1]?.kind === 'separator')) {
      continue;
    }
    out.push(node);
  }
  while (out.length > 0 && out[out.length - 1]?.kind === 'separator') out.pop();
  return out;
};

const withoutPlaceholders = (nodes: readonly UiNode[]): readonly UiNode[] => {
  const out: UiNode[] = [];
  for (const node of nodes) {
    if (isPlaceholder(node)) continue;
    if (node.items === undefined) {
      out.push(node);
      continue;
    }
    const items = withoutPlaceholders(node.items);
    if (items.length === 0) continue;
    out.push({ ...node, items });
  }
  return withoutLooseSeparators(out);
};

export const visibleGroups = (groups: readonly UiGroup[]): readonly UiGroup[] =>
  groups
    .map((group) => ({ ...group, nodes: withoutPlaceholders(group.nodes) }))
    .filter((group) => group.nodes.length > 0);

export const visibleNodes = withoutPlaceholders;

export const visibleTabs = (tabs: readonly UiTab[]): readonly UiTab[] =>
  tabs
    .map((tab) => ({ ...tab, groups: visibleGroups(tab.groups) }))
    .filter((tab) => tab.groups.length > 0);
