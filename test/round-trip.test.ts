import { describe, expect, it } from 'vitest';

import { DocxPackage } from '../src/ooxml/index.js';

import type { Fixture } from './harness/corpus.js';
import { CORPUS, fixtureBytes } from './harness/corpus.js';
import { canonicalEntries, canonicalPartOrder } from './harness/opc-order.js';
import { compareArchives, parsePart, partText, sameBytes } from './harness/roundtrip.js';
import { buildZip } from './harness/zip-build.js';
import { readZipMembers } from './harness/zip-read.js';

const MAIN_DOCUMENT = 'word/document.xml';

const expectedKindFor = (fixture: Fixture): string =>
  fixture.name.endsWith('.docm') ? 'docm' : 'docx';

const describeComparison = (comparison: ReturnType<typeof compareArchives>): string =>
  JSON.stringify(
    {
      missing: comparison.missing,
      added: comparison.added,
      firstEntry: comparison.firstEntry,
      members: comparison.members.filter(
        (member) => !member.present || !member.decompressedIdentical || !member.compressedIdentical,
      ),
    },
    null,
    2,
  );

const textProjections = (archive: Uint8Array): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const member of readZipMembers(archive)) {
    if (!member.name.endsWith('.xml') && !member.name.endsWith('.rels')) continue;
    out.set(member.name, partText(parsePart(member.bytes)));
  }
  return out;
};

for (const fixture of CORPUS) {
  describe(fixture.name, () => {
    it('opens as a WordprocessingML package with every part readable', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      expect(pkg.mainDocumentPartName).toBe(MAIN_DOCUMENT);
      expect(pkg.kind).toBe(expectedKindFor(fixture));
      expect([...pkg.partNames()].sort()).toEqual(
        [...fixture.parts.map((part) => part.name)].sort(),
      );
      expect(await pkg.readPartBytes(MAIN_DOCUMENT)).toBeDefined();
      expect(await pkg.readPartDocument(MAIN_DOCUMENT)).toBeDefined();
    });

    it('reports no validation findings on load', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      expect(pkg.validate()).toEqual([]);
    });

    it('marks nothing dirty on load', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      expect(pkg.hasChanges()).toBe(false);
      expect(pkg.dirtyPartNames()).toEqual([]);
    });

    it('saves a no-edit round trip FL0 for every part', async () => {
      const input = fixtureBytes(fixture);
      const pkg = await DocxPackage.open(input);
      const output = await pkg.save();
      const comparison = compareArchives(input, output);
      expect(comparison.missing, describeComparison(comparison)).toEqual([]);
      expect(comparison.added, describeComparison(comparison)).toEqual([]);
      expect(comparison.allDecompressedIdentical, describeComparison(comparison)).toBe(true);
      expect(comparison.allCompressedIdentical, describeComparison(comparison)).toBe(true);
    });

    it('writes a no-edit archive in canonical entry order', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      const output = await pkg.save();
      const expected = canonicalPartOrder(
        fixture.parts.map((part) => part.name),
        MAIN_DOCUMENT,
      );
      expect(readZipMembers(output).map((member) => member.name)).toEqual([...expected]);
      expect(readZipMembers(output)[0]?.name).toBe('[Content_Types].xml');
      expect(readZipMembers(output)[1]?.name).toBe('_rels/.rels');
    });

    it('writes container records a strict reader accepts', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      const output = await pkg.save();
      for (const member of readZipMembers(output)) {
        expect(member.flags & 0x0001, `${member.name} must not be encrypted`).toBe(0);
        expect(member.flags & 0x0008, `${member.name} must not use a data descriptor`).toBe(0);
        expect(member.dosDate, `${member.name} DOS date`).toBe(0x0021);
        expect(member.dosTime, `${member.name} DOS time`).toBe(0);
        if (/\.(png|jpg|jpeg|gif|bin)$/i.test(member.name)) {
          expect(member.method, `${member.name} must be stored`).toBe(0);
        } else {
          expect(member.method, `${member.name} must be deflated`).toBe(8);
        }
      }
    });

    it('is byte-identical for the whole archive when the layout is already canonical', async () => {
      const input = buildZip(canonicalEntries(fixture.parts, MAIN_DOCUMENT));
      const pkg = await DocxPackage.open(input);
      const output = await pkg.save();
      const comparison = compareArchives(input, output);
      expect(comparison.allDecompressedIdentical, describeComparison(comparison)).toBe(true);
      expect(readZipMembers(output).map((member) => member.name)).toEqual(
        readZipMembers(input).map((member) => member.name),
      );
      expect(sameBytes(output, input), 'whole archive bytes').toBe(true);
    });

    it('verifies fidelity for every passthrough part', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      const passthrough = pkg
        .listParts()
        .filter((part) => part.isPassthrough)
        .map((part) => part.name)
        .sort();
      const findings = await pkg.verifyFidelity(await pkg.save());
      expect(findings.map((finding) => finding.partName).sort()).toEqual(passthrough);
      expect(findings.filter((finding) => !finding.identical)).toEqual([]);
      expect(pkg.dirtyPartNames()).toEqual([]);
    });

    it('produces identical bytes when saved twice from the same open package', async () => {
      const pkg = await DocxPackage.open(fixtureBytes(fixture));
      const first = await pkg.save();
      const second = await pkg.save();
      expect(sameBytes(second, first)).toBe(true);
    });

    it('is cycle-stable across three open and save cycles', async () => {
      const first = await DocxPackage.open(fixtureBytes(fixture));
      const cycleOne = await first.save();
      const second = await DocxPackage.open(cycleOne);
      const cycleTwo = await second.save();
      const third = await DocxPackage.open(cycleTwo);
      const cycleThree = await third.save();
      expect(sameBytes(cycleTwo, cycleThree), 'cycle 2 to cycle 3').toBe(true);
      expect(sameBytes(cycleOne, cycleTwo), 'cycle 1 to cycle 2').toBe(true);
    });

    it('leaves the text projection unchanged by a no-edit round trip', async () => {
      const input = fixtureBytes(fixture);
      const pkg = await DocxPackage.open(input);
      const output = await pkg.save();
      expect(textProjections(output)).toEqual(textProjections(input));
    });
  });
}
