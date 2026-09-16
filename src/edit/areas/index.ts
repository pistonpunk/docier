import type { CommandDefinition, CommandRegistry, Disposable } from '../../api/types.js';
import { documentCommands } from './document.js';
import type { DocumentAreaHost } from './document.js';
import { findCommands } from './find.js';
import { insertCommands } from './insert.js';
import { numberingCommands } from './numbering.js';
import { commentCommands } from './comment.js';
import { noteCommands } from './note.js';
import { objectCommands } from './object.js';
import { pageCommands } from './page.js';
import { paragraphCommands } from './paragraph.js';
import { proofCommands } from './proof.js';
import { regionCommands } from './region.js';
import { styleCommands } from './style.js';
import { installAll } from './support.js';
import { tableCommands } from './table.js';
import { themeCommands } from './theme.js';
import type { AreaHost } from './support.js';
import { unsupportedCommands } from './unsupported.js';

export type { AreaHost } from './support.js';
export type { DocumentAreaHost, DocumentIo } from './document.js';
export { documentCommands } from './document.js';
export { unsupportedIds } from './unsupported.js';
export { pageCommands } from './page.js';
export { paragraphCommands } from './paragraph.js';
export { styleCommands } from './style.js';
export { proofCommands } from './proof.js';
export { regionCommands } from './region.js';
export { insertCommands } from './insert.js';
export { numberingCommands } from './numbering.js';
export { commentCommands } from './comment.js';
export { noteCommands } from './note.js';
export { objectCommands } from './object.js';
export { tableCommands } from './table.js';
export { themeCommands } from './theme.js';
export { unsupportedCommands } from './unsupported.js';

export const areaCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  ...documentCommands(host as DocumentAreaHost),
  ...findCommands(host),
  ...pageCommands(host),
  ...paragraphCommands(host),
  ...styleCommands(host),
  ...proofCommands(host),
  ...insertCommands(host),
  ...numberingCommands(host),
  ...tableCommands(host),
  ...objectCommands(host),
  ...commentCommands(host),
  ...noteCommands(host),
  ...regionCommands(host),
  ...themeCommands(host),
  ...unsupportedCommands(host),
];

export const installAreaCommands = (
  registry: CommandRegistry,
  host: AreaHost,
): readonly Disposable[] => installAll(registry, areaCommands(host));
