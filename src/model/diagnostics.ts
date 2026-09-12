export type ModelDiagnosticCode =
  | 'unknownMarkupEncountered'
  | 'missingStyleReference'
  | 'basedOnCycle'
  | 'missingNumberingInstance'
  | 'missingAbstractNumbering'
  | 'missingNumberingLevel'
  | 'numberingRemoved'
  | 'duplicateStyleId'
  | 'duplicateContentControlId'
  | 'levelOutOfRange'
  | 'unbalancedRange'
  | 'missingHeaderPart'
  | 'defaultStyleMissing';

export type ModelDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface ModelDiagnostic {
  readonly code: ModelDiagnosticCode;
  readonly severity: ModelDiagnosticSeverity;
  readonly message: string;
  readonly name?: string;
  readonly partName?: string;
}

export class DiagnosticCollector {
  private readonly items: ModelDiagnostic[] = [];
  private readonly seen = new Set<string>();

  add(diagnostic: ModelDiagnostic): void {
    const key = `${diagnostic.code}|${diagnostic.name ?? ''}|${diagnostic.partName ?? ''}|${diagnostic.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push(diagnostic);
  }

  warn(code: ModelDiagnosticCode, message: string, extra: { name?: string; partName?: string } = {}): void {
    this.add({ code, severity: 'warning', message, ...extra });
  }

  info(code: ModelDiagnosticCode, message: string, extra: { name?: string; partName?: string } = {}): void {
    this.add({ code, severity: 'info', message, ...extra });
  }

  list(): readonly ModelDiagnostic[] {
    return [...this.items];
  }

  get count(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
    this.seen.clear();
  }
}
