import type { InlineNode, Run } from './nodes.js';
import { Hyperlink, InlineContainer, Run as RunView, SimpleField } from './nodes.js';
import { FieldCharContent, InstructionTextContent, TextContent } from './run-content.js';

export interface FieldSwitch {
  readonly name: string;
  readonly argument: string | undefined;
}

export interface FieldInstruction {
  readonly type: string;
  readonly switches: readonly FieldSwitch[];
}

export interface FieldSpan {
  readonly instruction: string;
  readonly type: string | undefined;
  readonly switches: readonly FieldSwitch[];
  readonly isDirty: boolean;
  readonly isLocked: boolean;
  readonly hasResult: boolean;
  readonly beginRun: Run;
  readonly separateRun: Run | undefined;
  readonly endRun: Run | undefined;
  readonly resultRuns: readonly Run[];
}

export interface SimpleFieldSpan {
  readonly element: SimpleField;
  readonly instruction: string;
  readonly type: string | undefined;
  readonly switches: readonly FieldSwitch[];
}

const SWITCH_PATTERN = /\\([*A-Za-z])/g;

export const parseFieldInstruction = (instruction: string): FieldInstruction => {
  const switches: FieldSwitch[] = [];
  SWITCH_PATTERN.lastIndex = 0;
  const matches = [...instruction.matchAll(SWITCH_PATTERN)];
  const type = matches.length === 0 ? instruction : instruction.slice(0, matches[0]?.index ?? 0);
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (match === undefined) continue;
    const name = match[1];
    if (name === undefined) continue;
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[index + 1];
    const stop = next === undefined ? instruction.length : next.index ?? instruction.length;
    const rawArgument = instruction.slice(start, stop).trim();
    switches.push({
      name,
      argument: rawArgument === '' ? undefined : rawArgument.replace(/^"|"$/g, ''),
    });
  }
  return { type: type.trim(), switches };
};

export const fieldSwitchArgument = (field: FieldSpan | SimpleFieldSpan, name: string): string | undefined =>
  field.switches.find((entry) => entry.name === name)?.argument;

export const collectRuns = (inlines: readonly InlineNode[]): readonly Run[] => {
  const runs: Run[] = [];
  const walk = (nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      if (node instanceof RunView) runs.push(node);
      else if (node instanceof Hyperlink || node instanceof InlineContainer) walk(node.children());
      else if (node instanceof SimpleField) walk(node.children());
    }
  };
  walk(inlines);
  return runs;
};

export const scanFields = (inlines: readonly InlineNode[]): readonly FieldSpan[] => {
  const runs = collectRuns(inlines);
  const fields: FieldSpan[] = [];
  let depth = 0;
  let instruction = '';
  let beginRun: Run | undefined;
  let separateRun: Run | undefined;
  let resultRuns: Run[] = [];
  let lastResultRun: Run | undefined;
  let sawSeparate = false;
  let dirty = false;
  let locked = false;

  for (const run of runs) {
    for (const item of run.contents()) {
      if (item instanceof FieldCharContent) {
        const kind = item.fieldCharKind;
        if (kind === 'begin') {
          if (depth === 0) {
            instruction = '';
            beginRun = run;
            separateRun = undefined;
            resultRuns = [];
            lastResultRun = undefined;
            sawSeparate = false;
            dirty = item.isDirty;
            locked = item.isLocked;
          }
          depth += 1;
          continue;
        }
        if (kind === 'separate') {
          if (depth === 1) {
            sawSeparate = true;
            separateRun = run;
          }
          continue;
        }
        depth -= 1;
        if (depth <= 0) {
          depth = 0;
          const opening = beginRun;
          if (opening !== undefined) {
            const parsed = parseFieldInstruction(instruction);
            fields.push({
              instruction,
              type: parsed.type === '' ? undefined : parsed.type,
              switches: parsed.switches,
              isDirty: dirty,
              isLocked: locked,
              hasResult: sawSeparate,
              beginRun: opening,
              separateRun,
              endRun: run,
              resultRuns,
            });
          }
          beginRun = undefined;
          separateRun = undefined;
          resultRuns = [];
          lastResultRun = undefined;
          sawSeparate = false;
        }
        continue;
      }
      if (depth > 0 && item instanceof InstructionTextContent) {
        instruction += item.value;
        continue;
      }
      if (depth === 1 && beginRun !== undefined) {
        if (!sawSeparate) {
          if (item instanceof TextContent) instruction += item.value;
          continue;
        }
        if (lastResultRun !== run) {
          resultRuns.push(run);
          lastResultRun = run;
        }
      }
    }
  }
  return fields;
};

export const scanSimpleFields = (inlines: readonly InlineNode[]): readonly SimpleFieldSpan[] => {
  const found: SimpleFieldSpan[] = [];
  const walk = (nodes: readonly InlineNode[]): void => {
    for (const node of nodes) {
      if (node instanceof SimpleField) {
        const parsed = parseFieldInstruction(node.instruction);
        found.push({
          element: node,
          instruction: node.instruction,
          type: parsed.type === '' ? undefined : parsed.type,
          switches: parsed.switches,
        });
        walk(node.children());
        continue;
      }
      if (node instanceof Hyperlink || node instanceof InlineContainer) walk(node.children());
    }
  };
  walk(inlines);
  return found;
};
