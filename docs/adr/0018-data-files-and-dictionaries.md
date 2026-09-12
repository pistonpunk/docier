# 0018 - Required data files: dictionaries, word lists and rule sets

**Status:** proposed, awaiting a product decision · **Decided by:** PRODUCT OWNER, with licensing review ·
**Blocks:** `ED-017`, `ED-018`, `ED-019`, `ED-036`, `FM-016`, `FM-023`

## Context

Several features are not code, they are data, and the editing draft records them together as one open item
because their constraint is the same:

- Romanian and Russian **spellcheck dictionaries** (proofing, `ED-036`).
- Romanian and Russian **hyphenation dictionaries**.
- A **Romanian word list** for the diacritic-restore assist (`ED-017`).
- **Autocorrect rule sets** for Romanian and Russian (`ED-019`).
- The **built-in style table** - the OOXML built-in style names and their definitions (`FM-016`, `FM-023`).

The constraint the draft states is licensing, and it is a hard one: a GPL dictionary cannot ship in an
MIT-licensed library. The draft's proposed resolution is to source permissively licensed or self-produced
dictionaries, and to treat the built-in style table as original data transcribed from the OOXML built-in
style names - which are not copyrightable as names - but written as our own definitions.

Three practical facts make this urgent rather than a footnote. First, **the affected features cannot be
finished without the data**, so a licensing failure is a feature failure, not a delay. Second, **the
dictionaries are large**, so shipping all of them eagerly would dominate the bundle for a customer who reads
only one language. Third, **spellcheck quality is user-visible in a way that most features are not**: an HR
manager writing a Romanian contract with a dictionary that misspells `întâlnire` will conclude the editor is
broken, and they will be right.

## Options

| Option | Tradeoff |
|---|---|
| Source permissively licensed dictionaries (BSD/MIT/CC0) and ship them per locale | Fastest to a working feature with known-good quality, at the cost of licence review per dictionary and of bundle weight for locales a customer does not use. |
| Produce our own dictionaries from public-domain word lists | No third-party licence at all, and full control. Cost: real linguistic work per language, and quality is unlikely to match a mature community dictionary on first release. |
| Require the host to supply dictionaries and hyphenation patterns | Zero licensing exposure, zero bundle weight, and the host may already have licensed data. Cost: spellcheck and hyphenation do not work out of the box, so the feature is not shipped in any meaningful sense; and the host's dictionary may be GPL, which is their problem but our support burden. |
| Ship permissively licensed dictionaries **per locale, loaded on demand** | Working out of the box for the languages the customer uses, without a Russian dictionary in a Romanian deployment's bundle. Cost: one fetch path and a cache, and an offline deployment must bundle the locale it needs. |
| Drop proofing and hyphenation from v1 | Removes the licensing problem entirely. Cost: `ED-036` is `core` in the draft, and hyphenation is pagination-affecting, so dropping it changes line breaking in justified text - a visible difference from Word in exactly the documents this product targets. |

## Decision

**Recommended: permissively licensed dictionaries per locale, loaded on demand; self-produced word lists and
autocorrect sets; and the built-in style table written by us as original definitions transcribed from the
non-copyrightable OOXML built-in style names.** The data lives behind a provider interface
(`SpellcheckProvider` for proofing, a hyphenation provider for pagination, and a rule-set object for
autocorrect and typography), so a host can substitute its own licensed data and the library still works with
none. Every data file carries its licence and attribution in a machine-readable manifest that is validated in
CI, and a data file without a passing licence entry **fails the build** rather than shipping.

Two of these features are additive (diacritic restore, Russian typography) and are marked `later`: their
command ids and events are reserved now so the host UI is built once, and they stay inert until their data
exists.

**This is a product and licensing decision, and it has three parts:** (1) licensing sign-off on each
dictionary we ship, including its attribution obligations; (2) whether on-demand loading is acceptable for
the customer's deployment (an air-gapped deployment must bundle its locale); and (3) whether the first
release's proofing quality bar is met by a permissively licensed dictionary or whether we must commission a
self-produced one, which is a cost decision. If no decision is made, **the provider interfaces and the
built-in style table ship** (neither has a licensing problem), and proofing and hyphenation stay disabled
with a clear diagnostic naming the missing data - the features are absent rather than present and wrong.

## Consequences

- Spellcheck and hyphenation are switchable per locale and degrade to "off with a stated reason", so a
  deployment with no licensed data still has a working editor with correct justification for the languages
  whose patterns it does have.
- The built-in style table is ours, which means a Word-authored document that references `Normal`,
  `Heading 1` or `List Bullet` resolves through our definitions; those definitions are fixtures, and a wrong
  one is a layout regression across the corpus.
- Hyphenation affects line breaking, so it is a layout input and part of `documentHash`; enabling or disabling
  it must invalidate layout, and the layout result must not depend on whether a dictionary happened to load
  after the first paint - the dictionary's presence is a config input, resolved before layout runs.
- A host supplying GPL data of its own is outside our distribution, but the manifest format makes that
  visible in diagnostics, which protects us from a support claim that the library "ships" GPL data.
- Because the affected features cannot be finished without the data, the licensing review is on the critical
  path for proofing and hyphenation and must start before those features are scheduled, not when they are
  implemented.
