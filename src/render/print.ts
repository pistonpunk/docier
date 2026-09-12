import type { RenderedDocument } from './types.js';
import { DEFAULT_CLASS_NAME } from './types.js';
import { ATTR } from './dom.js';
import type { PageRange, PageRangeFilter } from './page-range.js';
import { parsePageRange } from './page-range.js';
import type { PrintCss } from './print-style.js';
import { buildPrintCss } from './print-style.js';

export type PrintMode = 'css' | 'pdf';

export type PrintDiagnosticCode =
  | 'browserPrintDialog'
  | 'browserRasterises'
  | 'copiesUnsupported'
  | 'annotationsUnsupported'
  | 'namedPageUnsupported'
  | 'rangeOutsideTheDialog';

export interface PrintDiagnostic {
  readonly code: PrintDiagnosticCode;
  readonly message: string;
  readonly detail?: string;
}

export type AnnotationPolicy = 'all' | 'none';

export interface PrintOptions {
  readonly pageRange?: string;
  readonly filter?: PageRangeFilter;
  readonly annotations?: AnnotationPolicy;
  readonly background?: boolean;
  readonly grayscale?: boolean;
  readonly copies?: number;
  readonly preview?: boolean;
  readonly print?: (target: Window) => void;
}

export interface PrintSession {
  readonly mode: PrintMode;
  readonly pages: PageRange;
  readonly css: string;
  readonly style: HTMLStyleElement;
  readonly diagnostics: readonly PrintDiagnostic[];
  readonly active: boolean;
  print(): void;
  end(): void;
}

export interface PdfPrintOptions {
  readonly mimeType?: string;
  readonly target?: Document;
  readonly print?: (target: Window) => void;
  readonly createUrl?: (blob: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
}

export interface PdfPrintSession {
  readonly mode: PrintMode;
  readonly byteLength: number;
  readonly url: string;
  readonly frame: HTMLIFrameElement;
  readonly diagnostics: readonly PrintDiagnostic[];
  readonly active: boolean;
  print(): void;
  end(): void;
}

export class PrintError extends Error {
  readonly code: 'PRINT_INVALID_OPTION';

  constructor(message: string) {
    super(message);
    this.name = 'PrintError';
    this.code = 'PRINT_INVALID_OPTION';
  }
}

const dialogDiagnostic: PrintDiagnostic = {
  code: 'browserPrintDialog',
  message:
    'copies, duplex, paper source and the dialog range field belong to the browser print dialog; the session controls what is laid out on the sheets',
};

const rasterDiagnostic: PrintDiagnostic = {
  code: 'browserRasterises',
  message:
    'the browser renders these sheets itself: text is re-rasterised rather than taken from an exported file, and the printer may scale the sheet to the paper it has',
};

const rangeDiagnostic: PrintDiagnostic = {
  code: 'rangeOutsideTheDialog',
  message:
    'the browser print dialog cannot be pre-set to a range; export the PDF with the range so the file carries only the selected pages',
};

interface CssSupport {
  supports?(property: string, value: string): boolean;
}

const namedPageSupport = (win: Window | null | undefined): boolean => {
  const css = (win as (Window & { CSS?: CssSupport }) | null | undefined)?.CSS;
  return css?.supports?.('page', 'docier-page-1') ?? false;
};

const blobOf = (bytes: Uint8Array, mimeType: string): Blob => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([buffer], { type: mimeType });
};

const printWindowOf = (owner: Document): Window => {
  const win = owner.defaultView;
  if (win === null) throw new PrintError('the document has no window to print');
  return win;
};

const requireCopies = (value: number | undefined): number => {
  const copies = value ?? 1;
  if (!Number.isSafeInteger(copies) || copies < 1) {
    throw new PrintError(`copies must be a positive whole number, not ${String(value)}`);
  }
  return copies;
};

export const printStyleSheet = (rendered: RenderedDocument, options: PrintOptions = {}): PrintCss =>
  buildPrintCss(rendered.result, pagesOf(rendered, options), {
    media: options.preview === true ? 'all' : 'print',
    background: options.background ?? true,
    grayscale: options.grayscale ?? false,
    className: rendered.root.classList.item(0) ?? DEFAULT_CLASS_NAME,
  });

const pagesOf = (rendered: RenderedDocument, options: PrintOptions): PageRange =>
  parsePageRange(
    options.pageRange ?? '',
    rendered.result.pages.length,
    options.filter ?? 'all',
  );

const diagnosticsOf = (
  plan: PrintCss,
  options: PrintOptions,
  win: Window | null,
): readonly PrintDiagnostic[] => {
  const diagnostics: PrintDiagnostic[] = [rasterDiagnostic, dialogDiagnostic];
  const copies = requireCopies(options.copies);
  if (copies > 1) {
    diagnostics.push({
      code: 'copiesUnsupported',
      message: 'the browser print dialog owns the number of copies; this session lays out one copy',
      detail: String(copies),
    });
  }
  if (options.annotations === 'all') {
    diagnostics.push({
      code: 'annotationsUnsupported',
      message:
        'the layout result carries no annotation marks; annotation policy belongs to the export path',
    });
  }
  if (plan.namedPageCount > 0 && !namedPageSupport(win)) {
    diagnostics.push({
      code: 'namedPageUnsupported',
      message:
        'this browser ignores named @page rules, so a document whose sections differ in page size prints at the first page size',
      detail: String(plan.namedPageCount),
    });
  }
  return diagnostics;
};

export const beginPrint = (
  rendered: RenderedDocument,
  options: PrintOptions = {},
): PrintSession => {
  const owner = rendered.root.ownerDocument;
  const plan = printStyleSheet(rendered, options);
  const diagnostics = diagnosticsOf(plan, options, owner.defaultView);
  const style = owner.createElement('style');
  style.setAttribute(ATTR.printStyle, '');
  style.textContent = plan.css;
  owner.head.appendChild(style);
  const zoom = rendered.zoom;
  rendered.setZoom(1);
  const print = options.print ?? ((target: Window): void => target.print());
  let printing = false;
  let active = true;
  let listening: Window | null = null;
  const end = (): void => {
    if (!active) return;
    active = false;
    printing = false;
    listening?.removeEventListener('afterprint', end);
    listening = null;
    style.remove();
    rendered.setZoom(zoom);
  };
  const session: PrintSession = {
    mode: 'css',
    pages: plan.sheets.map((sheet) => sheet.position),
    css: plan.css,
    style,
    diagnostics,
    get active(): boolean {
      return active;
    },
    print: (): void => {
      if (!active || printing) return;
      printing = true;
      const win = printWindowOf(owner);
      listening = win;
      win.addEventListener('afterprint', end);
      print(win);
    },
    end,
  };
  return session;
};

export const beginPrintPreview = (
  rendered: RenderedDocument,
  options: PrintOptions = {},
): PrintSession => beginPrint(rendered, { ...options, preview: true });

export const beginPdfPrint = (
  bytes: Uint8Array,
  options: PdfPrintOptions = {},
): PdfPrintSession => {
  const owner = options.target ?? document;
  const create = options.createUrl ?? ((blob: Blob): string => URL.createObjectURL(blob));
  const revoke = options.revokeUrl ?? ((url: string): void => URL.revokeObjectURL(url));
  const print = options.print ?? ((target: Window): void => target.print());
  const url = create(blobOf(bytes, options.mimeType ?? 'application/pdf'));
  const frame = owner.createElement('iframe');
  frame.className = 'docier-print-frame';
  frame.setAttribute(ATTR.printFrame, '');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.setProperty('position', 'fixed');
  frame.style.setProperty('right', '0');
  frame.style.setProperty('bottom', '0');
  frame.style.setProperty('width', '1px');
  frame.style.setProperty('height', '1px');
  frame.style.setProperty('border', '0');
  frame.style.setProperty('opacity', '0');
  frame.style.setProperty('pointer-events', 'none');
  frame.src = url;
  owner.body.appendChild(frame);
  let active = true;
  let printing = false;
  const end = (): void => {
    if (!active) return;
    active = false;
    printing = false;
    frame.remove();
    revoke(url);
  };
  const run = (): void => {
    if (!active) return;
    const win = frame.contentWindow;
    if (win === null) return;
    if (typeof win.addEventListener === 'function') win.addEventListener('afterprint', end);
    print(win);
  };
  const session: PdfPrintSession = {
    mode: 'pdf',
    byteLength: bytes.byteLength,
    url,
    frame,
    diagnostics: [rangeDiagnostic, dialogDiagnostic],
    get active(): boolean {
      return active;
    },
    print: (): void => {
      if (!active || printing) return;
      printing = true;
      const ready = frame.contentDocument;
      if (ready !== null && ready.readyState === 'complete') run();
      else frame.addEventListener('load', run, { once: true });
    },
    end,
  };
  return session;
};
