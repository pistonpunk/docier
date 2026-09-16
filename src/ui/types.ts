import type { ChromeMode, CommandRegistry, Unsubscribe } from '../api/types.js';
import type { SlotContent } from '../render/index.js';
import type { UI18n } from './i18n.js';

export type { ChromeMode };

export type ChromeSlot =
  | 'menuBar'
  | 'ribbon'
  | 'quickAccess'
  | 'ruler'
  | 'statusBar'
  | 'miniToolbar'
  | 'floatingControls'
  | 'contextMenu'
  | 'dialogs'
  | 'panels'
  | 'navigationPane'
  | 'placeholder';

export type RibbonCollapse = 'expanded' | 'collapsed' | 'hidden';

export type ContextSurface =
  | 'text'
  | 'table'
  | 'image'
  | 'field'
  | 'page'
  | 'pasteboard'
  | 'headerFooter'
  | 'ruler'
  | 'statusBar'
  | 'ribbon';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'autosaved';

export type RulerUnit = 'cm' | 'mm' | 'inch' | 'pt' | 'pica' | 'px';

export type Density = 'compact' | 'comfortable' | 'touch';

export type ViewMode = 'print' | 'web' | 'draft' | 'read';

export type StatusItemId = 'page' | 'words' | 'language' | 'save' | 'view' | 'zoom';

export interface TablePropertiesState {
  readonly alignment: 'left' | 'center' | 'right' | undefined;
  readonly widthTwips: number | undefined;
  readonly layout: 'autofit' | 'fixed' | undefined;
}

export interface ChromeState {
  readonly tab: string;
  readonly collapse: RibbonCollapse;
  readonly page: number;
  readonly pages: number;
  readonly words: number;
  readonly zoom: number;
  readonly save: SaveState;
  readonly language: string | undefined;
  readonly surface: ContextSurface | null;
  readonly caretSurface: 'table' | 'image' | null;
  readonly tableProperties: TablePropertiesState | undefined;
  readonly selectionEmpty: boolean;
  readonly rulerVisible: boolean;
  readonly marks: boolean;
  readonly units: RulerUnit;
  readonly density: Density;
  readonly viewMode: ViewMode;
  readonly statusItems: readonly StatusItemId[];
  readonly keyTips: boolean;
  readonly backstage: boolean;
  readonly message: string | undefined;
}

export type ChromeActionName =
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomSet'
  | 'zoomFit'
  | 'ribbonCollapse'
  | 'ribbonExpand'
  | 'ribbonToggle'
  | 'setTab'
  | 'openBackstage'
  | 'closeBackstage'
  | 'toggleRuler'
  | 'toggleMarks'
  | 'setUnits'
  | 'toggleStatusItem'
  | 'toggleKeyTips'
  | 'toggleComments'
  | 'showFloatingControls'
  | 'hideFloatingControls'
  | 'openContextMenu'
  | 'openDialog'
  | 'openColourPicker'
  | 'compressPicture'
  | 'closeDialog'
  | 'setIndent'
  | 'setMargin'
  | 'setViewMode'
  | 'flushMessage';

export interface ChromeActionArgs {
  readonly [key: string]: unknown;
}

export type ChromeAction = (args: ChromeActionArgs) => void;

export interface ControlSpec {
  readonly command?: string | undefined;
  readonly args?: unknown;
  readonly action?: ChromeActionName | undefined;
  readonly labelKey?: string | undefined;
  readonly keytip?: string | undefined;
  readonly options?: readonly ControlOption[] | undefined;
  readonly submenu?: boolean | undefined;
  readonly valueKey?: string | undefined;
  readonly valueArg?: string | undefined;
}

export interface ControlOption {
  readonly value: string;
  readonly labelKey?: string;
  readonly label?: string;
}

export interface ResolvedControl {
  readonly id: string;
  readonly label: string;
  readonly hint: string | undefined;
  readonly keytip?: string | undefined;
  readonly enabled: boolean;
  readonly active: boolean;
  readonly reason: string | undefined;
  readonly registered: boolean;
  readonly description: string | undefined;
  readonly value?: string | undefined;
}

export interface DocumentStatistics {
  readonly pages: number;
  readonly words: number;
  readonly characters: number;
  readonly charactersNoSpaces: number;
  readonly paragraphs: number;
  readonly lines: number;
}

export interface ChromeContext {
  readonly commands: CommandRegistry;
  readonly statistics: () => DocumentStatistics;
  readonly state: ChromeState;
  readonly i18n: UI18n;
  readonly host: HTMLElement;
  subscribe(listener: (state: ChromeState) => void): Unsubscribe;
  describe(spec: ControlSpec): ResolvedControl;
  invoke(spec: ControlSpec, anchor?: HTMLElement | undefined): void;
  run(action: ChromeActionName, args?: ChromeActionArgs): void;
}

export type ChromeRenderer = (context: ChromeContext) => SlotContent;

export const CONTEXT_SURFACES: readonly ContextSurface[] = [
  'text',
  'table',
  'image',
  'field',
  'page',
  'pasteboard',
  'headerFooter',
  'ruler',
  'statusBar',
  'ribbon',
];

export const STATUS_ITEM_IDS: readonly StatusItemId[] = [
  'page',
  'words',
  'language',
  'save',
  'view',
  'zoom',
];

export const VIEW_MODES: readonly ViewMode[] = ['print', 'web', 'draft', 'read'];

export const STATUS_VIEW_MODES: readonly ViewMode[] = ['read', 'print', 'web'];
