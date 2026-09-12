import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { ALL_FIXTURE_FILES, BROKEN_CORPUS, CORPUS, fixtureBytes } from './harness/corpus.js';
import { crc32Of } from './harness/zip-build.js';
import { readZipMembers } from './harness/zip-read.js';
import { parsePart, partIsWellFormed, sameBytes } from './harness/roundtrip.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDirectory = join(repositoryRoot, 'fixtures');
const emitRequested = process.env.DOCIER_EMIT_FIXTURES === '1';

const toolAvailable = (command: string): boolean => {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const pythonAvailable = toolAvailable('python3');
const unzipAvailable = toolAvailable('unzip');

beforeAll(() => {
  if (!emitRequested) return;
  mkdirSync(fixturesDirectory, { recursive: true });
  for (const file of ALL_FIXTURE_FILES) {
    const target = join(fixturesDirectory, file.name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
});

describe('fixture recipes', () => {
  it('covers every construct the round-trip contract names', () => {
    const names = CORPUS.map((fixture) => fixture.name);
    expect(names).toEqual([
      'minimal.docx',
      'contract.docx',
      'unknown-markup.docx',
      'hostile.docx',
      'strict.docx',
      'macro-enabled.docm',
      'signed.docx',
    ]);
    const brokenNames = BROKEN_CORPUS.map((fixture) => fixture.name);
    expect(brokenNames).toHaveLength(9);
  });

  it('gives every fixture a non-empty description and a distinct name', () => {
    const names = ALL_FIXTURE_FILES.map((file) => file.name);
    expect(new Set(names).size).toBe(names.length);
    for (const fixture of [...CORPUS, ...BROKEN_CORPUS]) {
      expect(fixture.description.length).toBeGreaterThan(40);
    }
  });

  it('writes the corpus to fixtures/ when DOCIER_EMIT_FIXTURES=1', () => {
    if (!emitRequested) return;
    expect(existsSync(fixturesDirectory)).toBe(true);
    for (const file of ALL_FIXTURE_FILES) {
      const target = join(fixturesDirectory, file.name);
      expect(existsSync(target), target).toBe(true);
      expect(sameBytes(readFileSync(target), file.bytes), target).toBe(true);
    }
  });

  it('matches the fixtures checked into fixtures/', () => {
    expect(
      existsSync(fixturesDirectory),
      'fixtures/ is missing; run `npm run fixtures`',
    ).toBe(true);
    for (const file of ALL_FIXTURE_FILES) {
      const target = join(fixturesDirectory, file.name);
      expect(existsSync(target), `${target} is missing; run \`npm run fixtures\``).toBe(true);
      expect(sameBytes(readFileSync(target), file.bytes), `${target} is stale`).toBe(true);
    }
  });
});

describe('fixture archives', () => {
  it.each(CORPUS.map((fixture) => fixture.name))('%s is a readable zip with sound CRCs', (name) => {
    const file = ALL_FIXTURE_FILES.find((candidate) => candidate.name === name);
    expect(file).toBeDefined();
    const members = readZipMembers(file?.bytes ?? new Uint8Array(0));
    expect(members.length).toBeGreaterThan(0);
    for (const member of members) {
      expect(crc32Of(member.bytes), `${member.name} CRC`).toBe(member.crc32);
      expect(member.flags & 0x0001, `${member.name} must not be encrypted`).toBe(0);
      expect(member.flags & 0x0008, `${member.name} must not use a data descriptor`).toBe(0);
      expect(member.dosDate, `${member.name} DOS date`).toBe(0x0021);
      expect(member.dosTime, `${member.name} DOS time`).toBe(0);
    }
  });

  it.each(CORPUS.map((fixture) => fixture.name))(
    '%s is accepted by unzip and every XML part is well formed',
    (name) => {
      const file = ALL_FIXTURE_FILES.find((candidate) => candidate.name === name);
      const bytes = file?.bytes ?? new Uint8Array(0);
      if (unzipAvailable) {
        const target = join(fixturesDirectory, name);
        const output = execFileSync('unzip', ['-t', target], { encoding: 'utf8' });
        expect(output).toContain('No errors detected');
      }
      if (pythonAvailable) {
        for (const member of readZipMembers(bytes)) {
          if (!member.name.endsWith('.xml') && !member.name.endsWith('.rels')) continue;
          const script =
            'import sys, xml.dom.minidom\nxml.dom.minidom.parseString(sys.stdin.buffer.read())\n';
          const result = execFileSync('python3', ['-c', script], {
            input: member.bytes,
            encoding: 'utf8',
          });
          expect(result).toBe('');
        }
      }
      for (const member of readZipMembers(bytes)) {
        if (member.name === '[Content_Types].xml') continue;
        if (!member.name.endsWith('.xml') && !member.name.endsWith('.rels')) continue;
        expect(partIsWellFormed(parsePart(member.bytes)), member.name).toBe(true);
      }
    },
  );

  it.each(BROKEN_CORPUS.map((fixture) => fixture.name))(
    '%s is present and non-empty so the recovery tests have input',
    (name) => {
      const file = ALL_FIXTURE_FILES.find((candidate) => candidate.name === name);
      expect(file).toBeDefined();
      expect(file?.bytes.byteLength ?? 0).toBeGreaterThan(0);
    },
  );

  it('keeps the first content-types entry first', () => {
    for (const fixture of CORPUS) {
      const file = ALL_FIXTURE_FILES.find((candidate) => candidate.name === fixture.name);
      expect(readZipMembers(file?.bytes ?? new Uint8Array(0))[0]?.name, fixture.name).toBe(
        '[Content_Types].xml',
      );
    }
  });

  it('stores media rather than deflating it', () => {
    for (const fixture of CORPUS) {
      const file = ALL_FIXTURE_FILES.find((candidate) => candidate.name === fixture.name);
      for (const member of readZipMembers(file?.bytes ?? new Uint8Array(0))) {
        if (!/\.(png|jpg|jpeg|gif)$/i.test(member.name)) continue;
        expect(member.method, `${fixture.name}:${member.name}`).toBe(0);
      }
    }
  });

  it('uses a UTF-8 entry name flag only where the name needs it', () => {
    for (const member of readZipMembers(ALL_FIXTURE_FILES[1]?.bytes ?? new Uint8Array(0))) {
      expect(member.flags & 0x0800, member.name).toBe(0);
    }
  });

  it('keeps the fixtures small enough to live in the repository', () => {
    for (const file of ALL_FIXTURE_FILES) {
      expect(file.bytes.byteLength, file.name).toBeLessThan(64 * 1024);
    }
  });

  it('produces identical bytes for the same recipe on every build', () => {
    for (const fixture of CORPUS) {
      const stored = ALL_FIXTURE_FILES.find((file) => file.name === fixture.name)?.bytes;
      expect(sameBytes(fixtureBytes(fixture), stored ?? new Uint8Array(0)), fixture.name).toBe(true);
    }
  });
});
