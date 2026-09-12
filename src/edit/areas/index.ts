import type { CommandDefinition, CommandRegistry, Disposable } from '../../api/types.js';
import { insertCommands } from './insert.js';
import { pageCommands } from './page.js';
import { paragraphCommands } from './paragraph.js';
import { proofCommands } from './proof.js';
import { styleCommands } from './style.js';
import { installAll } from './support.js';
import type { AreaHost } from './support.js';
import { unsupportedCommands } from './unsupported.js';

export type { AreaHost } from './support.js';
export { unsupportedIds } from './unsupported.js';
export { pageCommands } from './page.js';
export { paragraphCommands } from './paragraph.js';
export { styleCommands } from './style.js';
export { proofCommands } from './proof.js';
export { insertCommands } from './insert.js';
export { unsupportedCommands } from './unsupported.js';

export const areaCommands = (host: AreaHost): readonly CommandDefinition<never, void>[] => [
  ...pageCommands(host),
  ...paragraphCommands(host),
  ...styleCommands(host),
  ...proofCommands(host),
  ...insertCommands(host),
  ...unsupportedCommands(host),
];

export const installAreaCommands = (
  registry: CommandRegistry,
  host: AreaHost,
): readonly Disposable[] => installAll(registry, areaCommands(host));
