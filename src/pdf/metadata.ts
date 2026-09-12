import type { PdfMetadata } from './types.js';
import { PdfError } from './errors.js';
import { pdfDict, pdfText } from './objects.js';
import type { PdfDict } from './objects.js';

export const DEFAULT_PDF_DATE = 'D:20000101000000Z';

export const DEFAULT_XMP_DATE = '2000-01-01T00:00:00Z';

const PDF_DATE = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}'\d{2}')?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/;

const invalid = (field: string, value: string): never => {
  throw new PdfError(`the metadata ${field} value is not a date: ${value}`, {
    code: 'PDF_INVALID_OPTION',
    detail: `${field}=${value}`,
  });
};

export const toPdfDate = (value: string | undefined, field: string): string => {
  if (value === undefined) return DEFAULT_PDF_DATE;
  const trimmed = value.trim();
  if (PDF_DATE.test(trimmed)) return trimmed;
  const match = ISO_DATE.exec(trimmed);
  if (match === null) return invalid(field, value);
  const zone = match[7];
  const suffix = zone === undefined ? 'Z' : zone === 'Z' ? 'Z' : zone.replace(':', "'").concat("'");
  return `D:${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}${match[6] ?? '00'}${suffix}`;
};

export const toXmpDate = (value: string | undefined, field: string): string => {
  if (value === undefined) return DEFAULT_XMP_DATE;
  const trimmed = value.trim();
  const match = ISO_DATE.exec(trimmed);
  if (match === null) return invalid(field, value);
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}${match[7] ?? 'Z'}`;
};

export interface ResolvedMetadata {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: string;
  readonly creator: string;
  readonly language: string;
  readonly created: string;
  readonly modified: string;
  readonly createdIso: string;
  readonly modifiedIso: string;
}

export const resolveMetadata = (metadata: PdfMetadata, producer: string): ResolvedMetadata => ({
  title: metadata.title ?? '',
  author: metadata.author ?? '',
  subject: metadata.subject ?? '',
  keywords: metadata.keywords ?? '',
  creator: metadata.creator ?? producer,
  language: metadata.language ?? '',
  created: toPdfDate(metadata.created, 'created'),
  modified: toPdfDate(metadata.modified, 'modified'),
  createdIso: toXmpDate(metadata.created, 'created'),
  modifiedIso: toXmpDate(metadata.modified, 'modified'),
});

export const infoDict = (metadata: ResolvedMetadata, producer: string): PdfDict => {
  const dict = pdfDict({
    Producer: pdfText(producer),
    CreationDate: pdfText(metadata.created),
    ModDate: pdfText(metadata.modified),
  });
  if (metadata.title !== '') dict.set('Title', pdfText(metadata.title));
  if (metadata.author !== '') dict.set('Author', pdfText(metadata.author));
  if (metadata.subject !== '') dict.set('Subject', pdfText(metadata.subject));
  if (metadata.keywords !== '') dict.set('Keywords', pdfText(metadata.keywords));
  if (metadata.creator !== '') dict.set('Creator', pdfText(metadata.creator));
  return dict;
};
