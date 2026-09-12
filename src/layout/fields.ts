import type { FieldSwitch, Paragraph, Run, SimpleFieldSpan } from '../model/index.js';
import { collectRuns } from '../model/index.js';

export interface PageFieldValues {
  readonly page: number;
  readonly pages: number;
  readonly section: number;
  readonly sectionPages: number;
}

export const PAGE_FIELD_TYPES = ['PAGE', 'NUMPAGES', 'SECTION', 'SECTIONPAGES'] as const;

export type PageFieldType = (typeof PAGE_FIELD_TYPES)[number];

export const pageFieldTypeOf = (type: string | undefined): PageFieldType | undefined => {
  if (type === undefined) return undefined;
  const upper = type.trim().toUpperCase();
  for (const candidate of PAGE_FIELD_TYPES) {
    if (candidate === upper) return candidate;
  }
  return undefined;
};

export const pageFieldText = (type: PageFieldType, values: PageFieldValues): string => {
  switch (type) {
    case 'PAGE':
      return String(values.page);
    case 'NUMPAGES':
      return String(values.pages);
    case 'SECTION':
      return String(values.section);
    case 'SECTIONPAGES':
      return String(values.sectionPages);
  }
};

export interface FieldInjection {
  readonly text: string;
  readonly run: Run;
}

export interface FieldSubstitution {
  readonly suppressed: ReadonlySet<Run>;
  readonly injections: ReadonlyMap<Run, FieldInjection>;
  readonly formats: readonly string[];
}

interface SwitchCarrier {
  readonly switches: readonly FieldSwitch[];
}

const innerRunsOf = (field: SimpleFieldSpan): readonly Run[] => collectRuns([field.element]);

const numberFormatOf = (field: SwitchCarrier): string | undefined =>
  field.switches.find((entry) => entry.name === '*')?.argument;

export const fieldSubstitutions = (
  paragraph: Paragraph,
  values: PageFieldValues,
): FieldSubstitution => {
  const suppressed = new Set<Run>();
  const injections = new Map<Run, FieldInjection>();
  const formats: string[] = [];
  const runs = paragraph.runs();
  const indexOf = new Map<Run, number>();
  runs.forEach((run, index) => {
    if (!indexOf.has(run)) indexOf.set(run, index);
  });

  const record = (field: SwitchCarrier, type: PageFieldType, endRun: Run, source: Run): void => {
    injections.set(endRun, { text: pageFieldText(type, values), run: source });
    const format = numberFormatOf(field);
    if (format !== undefined && !formats.includes(format)) formats.push(format);
  };

  for (const field of paragraph.fields()) {
    const type = pageFieldTypeOf(field.type);
    if (type === undefined) continue;
    const endRun = field.endRun ?? field.beginRun;
    const start = indexOf.get(field.beginRun);
    const end = indexOf.get(endRun);
    if (start === undefined || end === undefined || end < start) continue;
    for (let index = start; index <= end; index += 1) {
      const run = runs[index];
      if (run !== undefined) suppressed.add(run);
    }
    record(field, type, endRun, field.resultRuns[0] ?? field.beginRun);
  }

  for (const field of paragraph.simpleFields()) {
    const type = pageFieldTypeOf(field.type);
    if (type === undefined) continue;
    const inner = innerRunsOf(field);
    const first = inner[0];
    const last = inner[inner.length - 1];
    if (first === undefined || last === undefined) continue;
    for (const run of inner) suppressed.add(run);
    record(field, type, last, first);
  }

  return { suppressed, injections, formats };
};
