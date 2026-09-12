import type { XmlDocument } from '../../src/ooxml/xml/nodes.js';
import { hasXmlErrors, rootElement, textContent } from '../../src/ooxml/xml/nodes.js';
import { parseXmlBytes } from '../../src/ooxml/xml/io.js';

import type { ZipMember } from './zip-read.js';
import { compressedAgree, membersAgree, readZipMembers } from './zip-read.js';

export interface MemberComparison {
  readonly name: string;
  readonly present: boolean;
  readonly decompressedIdentical: boolean;
  readonly compressedIdentical: boolean;
  readonly method: number;
  readonly dosTime: number;
  readonly dosDate: number;
  readonly flags: number;
}

export interface ArchiveComparison {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly missing: readonly string[];
  readonly added: readonly string[];
  readonly members: readonly MemberComparison[];
  readonly firstEntry: string | undefined;
  readonly allDecompressedIdentical: boolean;
  readonly allCompressedIdentical: boolean;
}

const index = (members: readonly ZipMember[]): ReadonlyMap<string, ZipMember> => {
  const map = new Map<string, ZipMember>();
  for (const member of members) map.set(member.name, member);
  return map;
};

export const compareArchives = (input: Uint8Array, output: Uint8Array): ArchiveComparison => {
  const before = readZipMembers(input);
  const after = readZipMembers(output);
  const beforeIndex = index(before);
  const afterIndex = index(after);
  const members: MemberComparison[] = [];

  for (const original of before) {
    const written = afterIndex.get(original.name);
    members.push({
      name: original.name,
      present: written !== undefined,
      decompressedIdentical: written === undefined ? false : membersAgree(original, written),
      compressedIdentical: written === undefined ? false : compressedAgree(original, written),
      method: written?.method ?? original.method,
      dosTime: written?.dosTime ?? -1,
      dosDate: written?.dosDate ?? -1,
      flags: written?.flags ?? -1,
    });
  }

  return {
    inputNames: before.map((member) => member.name),
    outputNames: after.map((member) => member.name),
    missing: before.filter((member) => !afterIndex.has(member.name)).map((member) => member.name),
    added: after.filter((member) => !beforeIndex.has(member.name)).map((member) => member.name),
    members,
    firstEntry: after[0]?.name,
    allDecompressedIdentical: members.every((member) => member.decompressedIdentical),
    allCompressedIdentical: members.every((member) => member.compressedIdentical),
  };
};

export const partNamesThatDiffer = (
  comparison: ArchiveComparison,
  predicate: (member: MemberComparison) => boolean,
): readonly string[] => comparison.members.filter(predicate).map((member) => member.name);

export const parsePart = (bytes: Uint8Array): XmlDocument => parseXmlBytes(bytes);

export const partIsWellFormed = (document: XmlDocument): boolean => !hasXmlErrors(document);

export const partText = (document: XmlDocument): string => {
  const root = rootElement(document);
  return root === undefined ? '' : textContent(root);
};

export const membersByName = (archive: Uint8Array): ReadonlyMap<string, ZipMember> =>
  index(readZipMembers(archive));

export const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let offset = 0; offset < left.byteLength; offset += 1) {
    if (left[offset] !== right[offset]) return false;
  }
  return true;
};
