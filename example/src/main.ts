import './styles.css';

import { DocxPackage, createEditor, ui } from 'docier';
import type { Diagnostic, EditorHandle, LayoutEnd } from 'docier';
import { exportPdf } from 'docier/pdf';
import type { TextMeasurer } from 'docier/layout';
import {
  DEFAULT_FONT_ALIASES,
  DETERMINISTIC_SANS,
  createDeterministicMeasurer,
  createFontMeasurer,
} from 'docier/layout';

import { createPanel } from './diagnostics';
import type { Severity } from './diagnostics';
import { buildFontPlan, loadFonts, registerScreenFonts } from './fonts';

const host = document.getElementById('editor-host');
const list = document.getElementById('diagnostics-list');
const count = document.getElementById('diagnostics-count');
const panelRoot = document.getElementById('diagnostics');
const fileInput = document.getElementById('open-file');

if (
  host === null ||
  list === null ||
  count === null ||
  panelRoot === null ||
  fileInput === null
) {
  throw new Error('the demo shell is missing one of its mount points');
}

const panel = createPanel(list, count, panelRoot);

const describe = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const stackOf = (error: unknown): string => {
  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack.split('\n').slice(0, 8).join(' | ');
  }
  return describe(error);
};

const download = (bytes: Uint8Array, name: string, type: string): void => {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
};

const busy = (id: string, value: boolean): void => {
  const element = document.getElementById(id);
  if (element instanceof HTMLButtonElement) element.setAttribute('aria-busy', String(value));
};

const fontAliases: readonly string[] = [...DEFAULT_FONT_ALIASES, DETERMINISTIC_SANS.family, 'Symbol'];

const fonts = await loadFonts();
const plan = buildFontPlan(fonts, fontAliases);

registerScreenFonts(fonts, fontAliases);

panel.add({
  code: 'host.fonts',
  severity: plan.screenFamilies.length === 0 ? 'error' : 'info',
  message: plan.report,
  detail: 'A host must answer every document family name with real font bytes; see the notes panel for what the engine expects.',
  source: 'example/src/fonts.ts',
});

const measurer: TextMeasurer =
  plan.faces.length === 0
    ? createDeterministicMeasurer()
    : createFontMeasurer({ faces: plan.faces, fallbackFamily: 'DejaVu Sans' });

panel.add({
  code: 'host.measurer',
  severity: plan.faces.length === 0 ? 'error' : 'info',
  message: `layout and PDF measure with ${measurer.id} over ${String(plan.faces.length)} face(s)`,
  detail:
    plan.faces.length === 0
      ? 'no font bytes reached the measurer, so the built-in advance model is in use and runs will not match the painted text'
      : 'the measured widths come from the same bytes the screen @font-face rules serve, so layout slots and painted runs agree',
  source: 'example/src/main.ts',
});

let handle: EditorHandle;
try {
  handle = createEditor(
    host,
    {
      // ui.chrome and layout.measurer are reload keys: they must be set here, they cannot be applied later.
      ui: { chrome: 'full', ariaLabel: 'docier demo document' },
      layout: { measurer },
      document: { docId: 'docier-demo', autoFocus: true },
      permissions: { readOnly: false, allow: [], regionEnforcement: false },
      export: { fontMissing: 'fallback' },
      debug: { logCommands: true, includeValues: true },
      theme: { vars: {}, mode: 'light' },
    },
    {
      zoom: 1,
      render: {
        zoom: 1,
        pageGapPx: 24,
        imageProvider: (id) => imageSources.get(id),
        detectDivergence: true,
        onDivergence: (report) => {
          panel.removeWhere((code) => code.startsWith('divergence.'));
          if (report.divergences.length === 0 && report.complete) return;
          for (const divergence of report.divergences.slice(0, 12)) {
            panel.add({
              code: `divergence.${divergence.kind}`,
              severity: 'warning',
              message: divergence.message,
              detail: `page ${String(divergence.page)} line ${String(divergence.lineId)}: engine ${String(divergence.engineWidthMp)} mp vs rendered ${String(divergence.renderedWidthPx)} px (${divergence.deltaPx.toFixed(2)} px over ${String(divergence.tolerancePx)} px) — font "${divergence.resolvedFontFamily}" — ${JSON.stringify(divergence.text)}`,
              source: `render/divergence.ts (${report.rectSource} rect source, authoritative=${String(report.authoritative)})`,
            });
          }
          if (report.skipped.length > 0) {
            panel.add({
              code: 'divergence.skipped',
              severity: 'info',
              message: `${String(report.skipped.length)} divergence check(s) were skipped`,
              detail: report.skipped
                .slice(0, 6)
                .map((skip) => `${skip.reason} x${String(skip.count)}`)
                .join(', '),
              source: 'render/divergence.ts',
            });
          }
        },
        onIssue: (issue) => {
          panel.add({
            code: `render.${issue.code}`,
            severity: 'warning',
            message: issue.message,
            detail: issue.detail,
            source: 'render/images.ts',
          });
        },
      },
    },
  );
} catch (error) {
  panel.add({
    code: 'createEditor.failed',
    severity: 'error',
    message: 'createEditor threw before the editor mounted',
    detail: stackOf(error),
    source: 'api/editor.ts',
  });
  throw error;
}

let chrome: ui.ChromeHandle | undefined;
try {
  chrome = ui.mountChrome(handle, { mode: 'full', language: () => navigator.language });
} catch (error) {
  panel.add({
    code: 'mountChrome.failed',
    severity: 'error',
    message: 'the chrome did not mount: the ribbon, ruler, menus and status bar are absent',
    detail: stackOf(error),
    source: 'ui/chrome.ts',
  });
}

const emitDiagnostics = (diagnostics: readonly Diagnostic[], source: string): void => {
  for (const diagnostic of diagnostics) {
    panel.add({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      detail: diagnostic.key,
      source,
    });
  }
};

emitDiagnostics(handle.getDiagnostics(), 'api/config.ts');

handle.events.on('docier:error', (event) => {
  panel.add({
    code: event.code,
    severity: 'error',
    message: event.message,
    detail: event.detail ?? `operation: ${event.operation}`,
    source: `docier:error${event.listener === undefined ? '' : ` (listener ${event.listener})`}`,
  });
});

handle.events.on('docier:command:blocked', (event) => {
  const reason = typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason);
  panel.add({
    code: `blocked.${event.code}`,
    severity: 'warning',
    message: `command "${event.commandId}" was blocked: ${reason}`,
    source: 'api/commands.ts',
  });
});

handle.events.on('docier:clipboard:degraded', (event) => {
  for (const entry of event.entries) {
    panel.add({
      code: 'clipboard.degraded',
      severity: 'warning',
      message: entry.reason,
      detail: entry.detail,
      source: 'edit/clipboard',
    });
  }
});

handle.events.on('docier:render:layoutend', (event: LayoutEnd) => {
  const diagnostics = event.result.diagnostics;
  for (const diagnostic of diagnostics) {
    panel.add({
      code: diagnostic.code,
      severity: diagnostic.severity as Severity,
      message: diagnostic.message,
      detail: diagnostic.docPos === undefined ? undefined : `at ${diagnostic.docPos}`,
      source: `layout (${String(event.pages)} page(s), ${String(Math.round(event.durationMs))} ms)`,
    });
  }

  const families = [...new Set(event.result.paint.map((paint) => paint.requestedFamily))];
  const resolved = new Set(event.result.paint.map((paint) => paint.family));
  const substituted = event.result.paint
    .filter((paint) => paint.requestedFamily !== paint.family)
    .map((paint) => `${paint.requestedFamily} -> ${paint.family}`);
  const tables = event.result.pages.reduce((sum, page) => sum + page.tables.length, 0);
  const lines = event.result.pages.reduce(
    (sum, page) => sum + page.blocks.reduce((inner, block) => inner + block.lines.length, 0),
    0,
  );

  panel.add({
    code: 'layout.summary',
    severity: diagnostics.length === 0 ? 'info' : 'warning',
    message: `${String(event.pages)} page(s), ${String(lines)} line(s), ${String(tables)} table(s), ${String(event.result.paint.length)} paint style(s) in ${String(Math.round(event.durationMs))} ms`,
    detail: `families requested: ${families.join(', ') || '(none)'} | resolved: ${[...resolved].join(', ') || '(none)'}${substituted.length === 0 ? '' : ` | substituted: ${[...new Set(substituted)].join('; ')}`}`,
    source: `layout/pipeline.ts (hash ${event.result.documentHash})`,
  });
});

handle.events.on('docier:issues:change', (event) => {
  if (event.errors === 0 && event.warnings === 0) return;
  panel.add({
    code: 'issues.change',
    severity: event.errors > 0 ? 'error' : 'warning',
    message: `${String(event.errors)} error(s) and ${String(event.warnings)} warning(s) reported by the instance`,
    source: 'api/events.ts',
  });
});

const setTitle = (name: string): void => {
  document.title = `docier — ${name}`;
};

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const imageSources = new Map<string, { id: string; bytes: Uint8Array; mimeType: string }>();

const collectImages = async (bytes: Uint8Array): Promise<number> => {
  imageSources.clear();
  try {
    const pkg = await DocxPackage.open(bytes);
    for (const partName of pkg.relationships.sourceParts()) {
      const relationships = pkg.relationships.get(partName);
      if (relationships === undefined) continue;
      for (const relationship of relationships.entries) {
        if (!relationship.type.endsWith('/image')) continue;
        const data = await pkg.readPartBytes(relationship.resolvedTarget);
        if (data === undefined) continue;
        const extension = relationship.resolvedTarget.split('.').pop()?.toLowerCase() ?? '';
        imageSources.set(relationship.id, {
          id: relationship.id,
          bytes: data,
          mimeType: MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
        });
      }
    }
  } catch (error) {
    panel.add({
      code: 'host.images',
      severity: 'warning',
      message: 'the media parts could not be read, so pictures will render as placeholders',
      detail: stackOf(error),
      source: 'example/src/main.ts',
    });
  }
  return imageSources.size;
};

const loadBytes = async (bytes: Uint8Array, name: string): Promise<void> => {
  const started = performance.now();
  try {
    const images = await collectImages(bytes);
    if (images > 0) {
      panel.add({
        code: 'host.images',
        severity: 'info',
        message: `${String(images)} picture(s) handed to the renderer`,
        source: 'example/src/main.ts',
      });
    }
    await handle.load(bytes);
    await handle.whenReady();
    setTitle(name);
    panel.add({
      code: 'document.loaded',
      severity: 'info',
      message: `${name}: ${String(bytes.byteLength)} bytes loaded in ${String(Math.round(performance.now() - started))} ms`,
      source: 'api/editor.ts',
    });
  } catch (error) {
    panel.add({
      code: 'document.loadFailed',
      severity: 'error',
      message: `${name} did not load`,
      detail: stackOf(error),
      source: 'api/editor.ts',
    });
  }
};

const fetchInto = async (url: string, name: string): Promise<void> => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${String(response.status)} ${response.statusText}`);
    await loadBytes(new Uint8Array(await response.arrayBuffer()), name);
  } catch (error) {
    panel.add({
      code: 'document.fetchFailed',
      severity: 'error',
      message: `could not fetch ${url}`,
      detail: stackOf(error),
      source: 'example/src/main.ts',
    });
  }
};

const exportPdfNow = async (): Promise<void> => {
  const layout = handle.layout;
  if (layout === undefined) {
    panel.add({
      code: 'export.noLayout',
      severity: 'error',
      message: 'there is no layout to export yet',
      source: 'example/src/main.ts',
    });
    return;
  }
  busy('export-pdf', true);
  const started = performance.now();
  try {
    const result = await exportPdf(layout, {
      fontProvider: plan.provider,
      measurer,
      fontMissing: 'fallback',
      metadata: { title: 'docier demo export', creator: 'docier example' },
      onProgress: (progress) => {
        panel.add({
          code: `export.${progress.phase}`,
          severity: 'info',
          message: `${progress.phase} ${String(Math.round(progress.fraction * 100))}%`,
          source: 'pdf/options.ts onProgress',
        });
      },
    });
    panel.add({
      code: 'export.pdf',
      severity: result.losses.some((loss) => loss.code !== 'painterGap') ? 'warning' : 'info',
      message: `${String(result.bytes.byteLength)} byte PDF in ${String(Math.round(performance.now() - started))} ms; ${String(result.fonts.length)} font(s) embedded, ${String(result.losses.length)} loss(es)`,
      detail:
        result.fonts.length === 0
          ? 'NO FONT WAS EMBEDDED — the PDF has no text in it'
          : `embedded: ${result.fonts.map((font) => `${font.family} (${String(font.glyphCount)} glyphs, subset=${String(font.subset)})`).join(', ')}`,
      source: 'pdf/index.ts exportPdf',
    });
    for (const loss of result.losses) {
      panel.add({
        code: `pdf.loss.${loss.code}`,
        severity: loss.code === 'painterGap' ? 'info' : 'warning',
        message: loss.message,
        detail: loss.detail,
        source: 'pdf/fonts/registry.ts',
      });
    }
    download(result.bytes, 'docier-demo.pdf', 'application/pdf');
  } catch (error) {
    panel.add({
      code: 'export.failed',
      severity: 'error',
      message: 'PDF export failed',
      detail: stackOf(error),
      source: 'pdf/index.ts exportPdf',
    });
  } finally {
    busy('export-pdf', false);
  }
};

const saveDocx = async (): Promise<void> => {
  const model = handle.document;
  if (model === undefined) {
    panel.add({
      code: 'save.noDocument',
      severity: 'error',
      message: 'there is no document to save',
      source: 'example/src/main.ts',
    });
    return;
  }
  busy('save-docx', true);
  try {
    const bytes = await model.save();
    panel.add({
      code: 'save.docx',
      severity: 'info',
      message: `${String(bytes.byteLength)} byte .docx written`,
      source: 'api/editor.ts DocumentModel.save',
    });
    download(bytes, 'docier-demo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  } catch (error) {
    panel.add({
      code: 'save.failed',
      severity: 'error',
      message: 'saving the .docx failed',
      detail: stackOf(error),
      source: 'ooxml/package.ts',
    });
  } finally {
    busy('save-docx', false);
  }
};

document.getElementById('load-sample')?.addEventListener('click', () => {
  void fetchInto('sample.docx', 'sample.docx');
});

document.getElementById('load-contract')?.addEventListener('click', () => {
  void fetchInto('contract.docx', 'contract.docx');
});

document.getElementById('export-pdf')?.addEventListener('click', () => {
  void exportPdfNow();
});

document.getElementById('save-docx')?.addEventListener('click', () => {
  void saveDocx();
});

document.getElementById('diagnostics-clear')?.addEventListener('click', () => {
  panel.clear();
});

document.getElementById('diagnostics-toggle')?.addEventListener('click', (event) => {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const collapsed = panelRoot.dataset.collapsed === 'true';
  panel.setCollapsed(!collapsed);
  target.textContent = collapsed ? 'Collapse' : 'Expand';
});

fileInput.addEventListener('change', () => {
  const file = (fileInput as HTMLInputElement).files?.[0];
  if (file === undefined) return;
  void (async () => {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  })();
});

window.addEventListener('error', (event) => {
  panel.add({
    code: 'window.error',
    severity: 'error',
    message: event.message,
    detail: `${event.filename}:${String(event.lineno)}:${String(event.colno)}`,
    source: 'window',
  });
});

window.addEventListener('unhandledrejection', (event) => {
  panel.add({
    code: 'window.unhandledRejection',
    severity: 'error',
    message: 'a promise rejected with nobody listening',
    detail: stackOf(event.reason),
    source: 'window',
  });
});

panel.add({
  code: 'demo.ready',
  severity: 'info',
  message: `${String(handle.commands.list().length)} commands registered; chrome ${chrome?.mounted === true ? `mounted (${chrome.mode})` : 'NOT mounted'}`,
  detail: `ui.chrome is a reload key — it is set in the createEditor patch, not in updateConfig(). Slots still unclaimed: ${chrome?.remaining().join(', ') ?? 'n/a'}`,
  source: 'example/src/main.ts',
});

(window as unknown as { docierDemo?: unknown }).docierDemo = { handle, measurer, plan };

await fetchInto('sample.docx', 'sample.docx');
