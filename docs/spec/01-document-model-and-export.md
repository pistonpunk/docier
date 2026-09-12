# 01 — Document Model, File Layer and Export

**Status:** draft · **Domain:** the OOXML document model, the .docx package, persistence, and every export target
**Sibling specs:** 02 (layout/pagination), 03 (commands/events/embedding API), 04 (tokenization/templating), 05 (UI/editor surface)
**Applies to:** `docier` core (`@docier/core`) and the optional export modules.

---

## 0. Scope and governing rules

This spec defines the internal document model, how a `.docx` package is read into it and written back out,
and how that model becomes DOCX, PDF, print, plain text, HTML and Markdown.

Six rules override convenience everywhere in this document. A feature that violates one of them is wrong even
if it is faster:

- **R1 — OOXML is the model.** The internal model is a lossless-enough projection of WordprocessingML. We never
  route edits through HTML. HTML exists only as an export target.
- **R2 — Nothing is ever silently dropped.** Any element, attribute, or part we do not model is carried through
  as preserved raw markup (see MOD-02) and re-emitted in place. "Unsupported" means "untouched", never "deleted".
- **R3 — Untouched bytes stay bytes.** A part we did not modify is written back from its original compressed
  bytes, not re-serialised. This is the primary fidelity mechanism (PKG-05).
- **R4 — The model is the single source of truth.** Layout (spec 02) and rendering read the model; they never
  write back markup. Export reads the model, plus a layout result, and never re-parses our own output.
- **R5 — Framework-agnostic purity.** Core has zero dependencies on React/Vue/Svelte/DOM. DOM-touching code
  (Blob creation, `window.print`, canvas rasterisation) lives behind injectable interfaces so the core runs in
  Node, in a worker, or on a server.
- **R6 — Deterministic by default.** Given the same model, the same config and the same library version, the
  bytes of every export are identical. No embedded wall-clock time, no UUIDs, no Map-iteration-order drift.

### 0.1 Round-trip fidelity levels

Every feature below states its guarantee in these terms. These levels are the contract, and INT-02 turns them
into test assertions.

| Level | Name | Definition |
|---|---|---|
| **FL0** | Byte-identical | The part is written from its original compressed bytes. `unzip(a) == unzip(b)` for that part. |
| **FL1** | Semantically equivalent | Modelled content re-emitted; equality holds after canonical normalisation (attribute order, insignificant whitespace, rsid renumbering). Must be **cycle-stable**: `save(parse(save(parse(x)))) == save(parse(x))`. |
| **FL2** | Structurally preserved | Modelled subtrees re-emitted from the model; unmodelled subtrees emitted verbatim in their original position. Round-trips through us, and Word renders it, but byte/semantic equality is not claimed. |
| **FL3** | Lossy (declared) | Content is intentionally not carried. Must appear in the **loss ledger** (EXD-02), must be reported by the parse/export event, and must be opt-in or warn-once. |

**Cycle stability is the load-bearing test.** FL1 without idempotence is worthless: a file that drifts a little
on every open/save corrupts a customer's template after ten edits.

### 0.2 Terminology

- **Part** — one entry in the OPC zip (e.g. `word/document.xml`).
- **Story** — one of the text containers: main body, each header, each footer, each footnote/endnote part,
  each comment, each textbox. Layout (spec 02) paginates stories, not documents.
- **Canonical model** — the in-memory tree. Namespaced, ordered, node-addressed.
- **Dirty** — a part whose model content changed since load, and therefore must be re-serialised (R3).
- **Host** — the application embedding docier.

---

## 1. The .docx package — parts, content types, relationships

### PKG-01 — OPC container read
**Priority:** core · **Effort:** L

**Behaviour.**
- Read a `Blob`/`File`/`ArrayBuffer`/`Uint8Array`/`ReadableStream` as an OPC (ECMA-376 Part 2) zip.
- Enumerate entries **without** decompressing bodies: build the part index from the central directory first,
  then inflate lazily per part on first access (see SER-02).
- Reject non-zip input with a typed error (`DocierParseError` code `NOT_A_PACKAGE`), not a raw zip exception.
- Detect and reject, with distinct error codes, in this order: OLE/CFB compound file (a legacy `.doc` or an
  encrypted `.docx` — both start with `D0 CF 11 E0`), a zip without `[Content_Types].xml` (`NOT_OOXML`),
  a package whose main part is not WordprocessingML (`WRONG_DOCUMENT_TYPE` — e.g. `.xlsx`, `.pptx`).
- Preserve, per entry: original compressed bytes, compression method, uncompressed size, and the original
  entry name byte-for-byte (including any `word/media/image1.PNG` capitalisation).
- Handle entries that are directories, zero-length, or duplicated in the central directory (last wins, warn).

**OOXML.** `[Content_Types].xml`, `_rels/.rels`, every part name.
**Edge cases.** Zip64 archives; stored (method 0) entries; entries with a data descriptor; names with
non-ASCII characters; a package >2 GB (reject with a clear message rather than exhausting memory).
**Round-trip.** Read itself is lossless by construction — the whole original archive is retained (R3).
**Open item.** Encrypted packages are detected but not decrypted (see PKG-07).

### PKG-02 — OPC container write
**Priority:** core · **Effort:** M

**Behaviour.**
- Write the parts the model's dirty-tracking marks dirty, plus brand-new parts, into a new zip.
- **Entry order is fixed and canonical** (R6): `[Content_Types].xml` first, then `_rels/.rels`, `docProps/*`,
  `word/document.xml`, then remaining Word parts in a stable order derived from their part names, then media.
  First-entry ordering matters: some consumers (and several server-side validators) expect the content-types
  stream first.
- Compression: DEFLATE level 6 for XML parts; **STORE** (method 0) for media and embedded binaries whose own
  format is already compressed (png, jpeg, gif, webp, zip-based embeddings) — recompressing them costs CPU and
  can enlarge the file.
- Use a fixed DOS timestamp (1980-01-01) on every entry unless the host opts into real timestamps via config.
  No extra fields, no Unicode path extra field, no data descriptors.
- No explicit directory entries. No `[Content_Types].xml` self-reference in `_rels`.
- Emit as `Blob` (browser) or `Buffer`/`Uint8Array` (Node) through the same sink interface (EXD-01).

**OOXML.** The zip container itself.
**Edge cases.** A part that must be dropped because its relationship was removed (orphan media); a part added
whose name collides with an existing one (PKG-06 allocates a fresh name rather than overwriting); output size
larger than 4 GB (Zip64 emission).
**Round-trip.** Container write is the mechanism behind FL0 — unchanged parts are copied as raw deflated bytes,
never re-inflated and re-deflated.

### PKG-03 — `[Content_Types].xml` management
**Priority:** core · **Effort:** M

**Behaviour.**
- Parse into two maps: `Default` (extension → content type) and `Override` (part name → content type).
- Maintain a **known-good default set** so the common case never grows the file: `rels`, `xml`, `png`, `jpeg`,
  `jpg`, `gif`, `bmp`, `tiff`, `emf`, `wmf`, `svg`, `bin`, `odttf`, `mht`.
- Every XML part must resolve to a content type; if no `Default` covers its extension and no `Override` exists,
  the package is invalid — add an `Override` on write and emit a `contentTypeAdded` event.
- New media parts get an `Override` only if their extension is not already in `Default`; prefer adding a
  `Default` when three or more parts share an extension.
- Removing a part removes its `Override`, and removes a `Default` only when no part uses that extension.
- **The main document part must always be an `Override`** with
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml` (or the `.macroEnabled`
  / `.template` / `.template.macroEnabled` variants derived from the original package).
- Namespace: `http://schemas.openxmlformats.org/package/2006/content-types`.

**OOXML.** `<Types><Default Extension ContentType/><Override PartName ContentType/></Types>`.
**Edge cases.** A `Default` for the empty extension; a part name with no extension (must be an `Override`);
an `Override` pointing at a part that does not exist (drop it, warn); case differences in `Extension`
(compared case-insensitively, but emitted as-is); content type for `.xml` default is
`application/xml` — the document part still needs its `Override`.
**Round-trip.** FL1. Ordering of children is normalised (all `Default`s then all `Override`s, each sorted by
`Extension`/`PartName`) — this is the one place we deliberately reorder, for determinism.

### PKG-04 — Relationship graph
**Priority:** core · **Effort:** M

**Behaviour.**
- Parse every `_rels/*.rels` into a graph keyed by source part. Each relationship has `Id`, `Type`, `Target`,
  and `TargetMode` (`Internal` | `External`).
- Resolve `Target` relative to the **source part's directory**, not the package root
  (`word/_rels/document.xml.rels` + `media/image1.png` → `word/media/image1.png`). `Target` may be
  root-relative (`/word/styles.xml`), and may contain `..` segments — normalise but never escape the package.
- Expose typed accessors: `getRelationships(partName, type?)`, `getRelatedPart(rel)`, `addRelationship()`,
  `removeRelationship()`. Relationship `Id` values are unique **per source part** only.
- Enforce the constraint set on write: no duplicate `Id` within a source part; every internal `Target` exists;
  no orphan `.rels` file; a `.rels` file is deleted when its last relationship is removed; a part that has
  relationships always has a `.rels` part.
- **Relationship ID stability.** Existing `Id`s (`rId5`) are never renumbered — reuse of a stale `rId` by a
  field, hyperlink, or `a:blip` is the single most common cause of corrupted output. New relationships take
  `rId{max+1}`.
- Garbage-collect unreferenced media relationships only on an explicit `pruneUnusedParts` command; never
  implicitly during save.

**OOXML.** `<Relationships><Relationship Id Type Target TargetMode/></Relationships>`. Relationship type URIs
that must be round-tripped (abbreviated to the local name; full URI is
`http://schemas.openxmlformats.org/officeDocument/2006/relationships/{name}`):

| Local name | Target |
|---|---|
| `officeDocument` | `word/document.xml` (from `_rels/.rels`) |
| `core-properties` / `extended-properties` / `custom-properties` | `docProps/*` |
| `thumbnail` | `docProps/thumbnail.jpeg` |
| `styles` `stylesWithEffects` `numbering` `settings` `webSettings` `fontTable` `theme` | `word/*.xml`, `word/theme/theme1.xml` |
| `footnotes` `endnotes` `comments` `commentsExtended` `commentsIds` `people` | `word/*.xml` |
| `header` `footer` | `word/headerN.xml`, `word/footerN.xml` |
| `image` `chart` `oleObject` `package` `hyperlink` `afChunk` `customXml` `glossaryDocument` | media, embeddings, external URLs, `word/customXml/*`, `word/afchunk.mht` |
| `printerSettings` | `word/printerSettings/printerSettings1.bin` |
| `attachedTemplate` `subDocument` `endnotes`… | as named |

**Edge cases.** A `.rels` part for a part that does not exist (drop, warn); `TargetMode="External"` (PKG-06);
two relationships to the same target (legal — do not merge, both are referenced by different `rId`s);
`Target` with URL-encoded characters; a `hyperlink` relationship whose `Target` is a `#bookmark` anchor with
no external part.
**Round-trip.** FL1 for the parts we touch (ordering normalised: `Id` ascending), FL0 for untouched `.rels`.

### PKG-05 — Unmodified-part passthrough
**Priority:** core · **Effort:** L

**Behaviour.** — *the central fidelity mechanism*
- On load, every part is marked clean. A part becomes dirty only when a mutation transaction (MOD-09) writes
  into its model subtree, or a command explicitly dirties it (e.g. `setCoreProperties` dirties `docProps/core.xml`).
- On save, clean parts are copied from their original compressed bytes. They are never parsed-then-serialised.
- Byte-identity is **verifiable**, not aspirational: a debug config flag re-reads the output and asserts FL0 for
  every clean part, failing loudly in tests.
- Consequences we accept and must document: if we never touch `word/comments.xml`, changes to comment authors
  in memory do not persist (they cannot — the part is clean and unchanged); a command that changes state must
  touch the model.
- A "touch nothing" save (open + save with no edits) must produce an output archive that is **member-for-member
  byte-identical** to the input. This is the headline test of the whole file layer.

**OOXML.** All parts.
**Edge cases.** A part that is dirty but whose serialisation happens to equal the original (keep the new bytes —
do not attempt to detect and revert); a part removed by a command (delete the entry);
a part added by a command (write fresh).
**Round-trip.** FL0 by construction. This is the feature that makes "docier does not mangle your templates" true.

### PKG-06 — Part naming, allocation and media lifecycle
**Priority:** core · **Effort:** M

**Behaviour.**
- Allocate new part names by the producer convention (`word/media/image{N}.{ext}`, `word/header{N}.xml`,
  `word/comments{N}.xml`), taking `max(existing N) + 1`, scanning **all** parts, not just those of that type
  (a stale `word/header3.xml` may exist without a relationship).
- Never reuse the name of a part that existed at load time, even if that part was deleted — a stale `rId`
  or bookmark elsewhere may still name it, and reuse turns a repair-prompt into data loss.
- Media de-duplication on insert: hash the candidate bytes (SHA-256) and reuse an existing media part with
  identical bytes and matching content type instead of adding a twin. Emit `mediaReused`.
- Media parts are referenced by content hash in the model's asset registry so that copy/paste within a
  document never duplicates a 4 MB scan.
- On `pruneUnusedParts`: remove media/embeddings with no inbound relationship, then remove their `.rels`
  entries and `Override`s (PKG-03), in one pass.

**OOXML.** Part naming conventions, `word/_rels/document.xml.rels`, `word/media/*`.
**Edge cases.** Case-insensitive filesystems vs case-sensitive zip names (never rely on case to distinguish two
parts); a `Target` that points outside `word/` (e.g. `media/` at the package root — legal, must be preserved);
an image referenced twice from two stories (one part, two relationships is the Word behaviour; one part, one
relationship reused is acceptable — document which we emit).
**Round-trip.** FL1 for names touched; FL0 for everything else.

### PKG-07 — Unsupported and special package variants
**Priority:** important · **Effort:** L

**Behaviour.**
- **`.doc` (binary, OLE/CFB).** Not supported. Detect by magic bytes, throw `LEGACY_DOC_NOT_SUPPORTED` with a
  message naming the required conversion (Word, LibreOffice, or our server path) — never attempt a partial parse.
- **Encrypted OOXML.** An ECMA-376 encrypted package is an OLE container wrapping `EncryptionInfo` +
  `EncryptedPackage`. Detect, throw `PACKAGE_ENCRYPTED`, and (later) accept a password to decrypt before the
  normal pipeline. Decryption is out of scope for v1; the honest error is the deliverable.
- **Rights-managed / IRM.** Detect the `_xmlsignatures` + `docProps/` IRM markers and refuse with
  `PACKAGE_RIGHTS_MANAGED`.
- **Macro-enabled `.docm` / `.dotm` / `.dotx`.** Supported: load and save, and — critically — carry
  `word/vbaProject.bin`, `word/vbaData.xml`, `word/activeX/*`, and `word/embeddings/*.bin` through untouched
  (FL0), with the correct macro-enabled content type for the main part (PKG-03). Never strip macros silently:
  stripping is an explicit, warned command, because it changes the file's trust semantics.
- **Digital signatures.** `_xmlsignatures/*` parts must be **dropped on save with a warning event** when
  anything else in the package changed, because the signature is invalid by construction afterwards. Keeping a
  broken signature produces a file Word reports as tampered; dropping it is the correct, declared loss (FL3).
  If nothing changed at all (PKG-05 pure passthrough), signatures are preserved byte-for-byte.
- **Digital-rights/password-to-modify** (`w:documentProtection` in `settings.xml`): a write-protection hash,
  not encryption. Preserve it faithfully (SET-01); the editor may honour it as a read-only hint.

**OOXML.** OLE CFB header, `EncryptionInfo`, `_xmlsignatures/`, `word/vbaProject.bin`, `w:documentProtection`.
**Round-trip.** Encrypted/RM: not supported (declared). Macro/signature: FL0 for all macro parts; FL3 (declared
drop) for signatures after any edit.

---

## 2. Core document model

### MOD-01 — XML tree, namespaces and prefix fidelity
**Priority:** core · **Effort:** L

**Behaviour.**
- The model's substrate is a namespace-aware, **order-preserving** XML tree: element (namespace URI + local
  name + original prefix), attributes (in original order, includes namespace declarations), children (elements,
  text, CDATA, comments, processing instructions), and parent links.
- **Prefixes are preserved as authored.** A part that declares `xmlns:w14` and uses `w14:` keeps exactly that
  spelling. We do not normalise `ns0:` to `w:` or vice versa; Word's own parts use inconsistent prefixes and
  re-spelling them is a gratuitous diff.
- Namespace scope is resolved per element with standard inheritance; `xml:space`, `xml:lang`, `xml:base` are
  handled by their defined scoping, not as ordinary attributes.
- `mc:Ignorable` on the root of each part lists the prefixes a consumer may ignore. It must be preserved exactly
  (its absence/presence changes how Word treats unknown elements) and **extended** — not replaced — when a new
  extension namespace is introduced by an edit.
- `mc:AlternateContent` / `mc:Choice` / `mc:Fallback` is handled structurally: the model keeps both branches.
  Rules: a `Choice` we understand is what we read and write; a `Fallback` is preserved verbatim so that older
  consumers keep working; if neither branch carries a requirement we implement, both are preserved and no
  content is exposed to the editor (see MED-02 for the SVG picture case).
- Whitespace: text is preserved exactly. `xml:space="preserve"` is emitted on any text node whose value has
  leading or trailing whitespace, has a double space, or is empty-but-non-trivial — omitting it is the classic
  "my spaces disappeared on save" bug.
- Element order is **schema order**, not insertion order. Elements are inserted at their schema-correct position
  (a lookup table of child-element order per parent, derived from the ECMA-376 schemas) and merged
  non-destructively: setting `w:jc` on a `w:pPr` that already contains `w:spacing` inserts between, it does not
  append.
- Duplicate attributes, CDATA sections, and XML comments in parts are preserved.

**OOXML.** `w:document`, `w:hdr`, `w:ftr`, `w:styles`, `w:numbering`, `w:settings`, `w:theme`, all parts.
**Edge cases.** A part with a non-standard default namespace; an element in a namespace declared only on that
element; an attribute in a namespace (`w:val` vs `w14:val`); `xml:space` inside `w:instrText`; an undeclared
prefix (tolerate, keep the raw name, warn); BOM and encoding declaration (UTF-8 always; UTF-16 input
transcoded, declared encoding preserved on output unless we changed the part, in which case write UTF-8 with a
matching declaration).
**Round-trip.** FL0 for untouched parts; FL1 for touched — with prefix and attribute-order preservation making
FL1 diffs small in practice. Schema-order insertion is what makes FL1 achievable rather than aspirational.

### MOD-02 — Unknown-markup preservation
**Priority:** core · **Effort:** L

**Behaviour.** — *R2, the promise that we never eat a customer's document*
- Any element the model has no typed handler for becomes an **opaque node**: it retains its namespace, name,
  attributes, children, text and tail, and is re-emitted verbatim, in its original position, with the same
  prefix spelling.
- Opaque nodes are attached at the nearest modelled ancestor, in their correct child position, so that
  structural operations elsewhere in the parent do not dislodge them. Insertions into a modelled parent must
  **not** push opaque nodes to the end.
- The opaque layer is not a second-class citizen: it is part of the addressable tree. A test can address
  `/body/p[3]/opaque[0]`, and layout (spec 02) can be told to skip a named opaque element.
- A command may **promote** an opaque element to a typed model (e.g. when a later release adds support for
  `w:moveFrom`); promotion is a parse-time concern (a new parser version) and never happens on an existing
  in-memory tree, to keep save idempotent.
- The parse emits a `unknownMarkupEncountered` report (element namespaced name → count) so integrators can see
  what their corpus contains without reading the code.
- **Never** leave a modelled wrapper behind when a subtree is opaque. If `w:smartTag` is opaque but the run
  inside it is modelled, the run is modelled and the wrapper is opaque — do not flatten, do not delete the
  wrapper.

**OOXML.** Everything outside the modelled vocabulary: `w:smartTag`, `v:*` (VML), `o:*`, `wne:*`, `wps:*`,
`wpg:*`, `a:*` outside pictures, `c:*`, `m:*` (OMML), `w:customXml` markup, `w:permStart`/`w:permEnd`,
`w:subDoc`, `w:ruby`, `w:dir`/`w:bdo`, unknown future `w16*` elements.
**Edge cases.** An opaque element that contains a bookmark start whose end is modelled outside it (the range
must still balance — bookmarks are collected across the whole story, see MOD-08); an opaque element inside
`w:pPr` whose ordering constraint we do not know (preserve position relative to neighbours); an opaque
element with a `w:id` that collides with a modelled id space (`w:sdt`, revisions, bookmarks) — id allocation
must scan opaque nodes too.
**Round-trip.** FL2 minimum for any part containing opaque nodes; FL1 for an untouched part. The **test** is a
corpus of real-world documents asserting that the set of element names and their text content is unchanged
across a load/save cycle.

### MOD-03 — Body and block-level content model
**Priority:** core · **Effort:** M

**Behaviour.**
- The document exposes **stories**: main body, one per header, one per footer, footnotes, endnotes, comments,
  and (later) textboxes. Each story has a uniform block-content interface (`children`, `insertBlock`,
  `removeBlock`).
- Block-level vocabulary: `w:p`, `w:tbl`, `w:sdt` (block), `w:altChunk` (opaque unless flattened), `w:sectPr`
  (final, body-level only), plus opaque nodes.
- The body's traversal API yields **flattened block order** — an `w:sdt`'s `w:sdtContent` blocks appear as
  children of the sdt, but `blocksOf(story)` walks into content controls so the editor sees a flat sequence
  while an `outline` view keeps the nesting. Provide both: `topLevelBlocks()` and `allBlocks()`.
- Block insertion must respect: a body may not end with a bare `w:sectPr` orphaned from the last paragraph's
  `w:pPr` (the last section's `sectPr` is a body child; earlier sections' `sectPr`s live inside `w:pPr` — see
  SEC-02);
- Every story root carries its own namespace declarations and any `w:*` attributes of the root
  (`w:rsidR`, `w:rsidRDefault` on `w:body` wrappers).
- Story-level `w:background` (body only) and `w:docPart` (glossary only) roots preserved.

**OOXML.** `w:body`, `w:hdr`/`w:ftr` roots, `w:footnotes`/`w:endnotes`, `w:comments`, `w:background`.
**Edge cases.** A body with **zero** paragraphs (legal, unusual — must not crash layout); a body whose only
child is a table; a `w:sectPr` inside a `w:pPr` on the last paragraph *and* a body-level one (both legal,
last-wins is wrong — the body-level one is the final section); a body with trailing opaque nodes after the
final `w:sectPr`.
**Round-trip.** FL1.

### MOD-04 — Paragraph model (`w:p`, `w:pPr`)
**Priority:** core · **Effort:** M

**Behaviour.**
- A paragraph holds an ordered `pPr` (typed property object with an opaque overflow list) and an ordered
  sequence of inline children: `w:r`, `w:hyperlink`, `w:sdt` (run), `w:fldSimple`, `w:bookmarkStart/End`,
  `w:commentRangeStart/End`, `w:commentReference`, `w:proofErr`, `w:ins`/`w:del`/`w:moveFrom`/`w:moveTo`,
  `w:permStart/End`, `w:customXml`, plus opaque nodes.
- Typed `pPr` accessors with exact `w:val` semantics for the properties the editor and layout need:
  `pStyle`, `numPr` (`ilvl`, `numId`), `keepNext`, `keepLines`, `pageBreakBefore`, `widowControl`,
  `spacing` (`before`, `after`, `line`, `lineRule`), `ind` (`left`, `right`, `firstLine`, `hanging`,
  `start`, `end`, `firstLineChars`, `hangingChars`), `jc`, `outlineLvl`, `pBdr`, `shd`, `tabs`,
  `contextualSpacing`, `suppressAutoHyphens`, `bidi`, `textDirection`, `textAlignment`, `framePr`,
  `divId`, `cnfStyle`, `sectPr`, `rPr`, `pPrChange`. Everything else is preserved.
- **Measurement model.** All lengths normalised to a single internal unit (twips are the OOXML native unit for
  pPr/sectPr; EMU for DrawingML; half-points for font size; eighths of a point for borders). The model stores
  the **original unit and value** and exposes a normalised accessor, so a value of `w:sz="24"` re-emits as `24`
  and never as `12pt`.
- Char-unit properties (`firstLineChars`, `hangingChars`, `leftChars`) are preserved alongside their twip
  twins; which one Word honours depends on `w:settings/w:characterSpacingControl` (SET-01).
- Empty paragraph vs paragraph containing one empty run (`<w:p/>` vs `<w:p><w:r><w:t/></w:r></w:p>`) are
  distinct states and must both round-trip; Word produces the former for an empty line and the latter after
  certain edits, and the distinction survives until Word rewrites it.
- Deleted-paragraph-mark state: `w:pPr/w:rPr/w:del` means the paragraph mark itself is deleted under tracked
  changes; the paragraph is then marked `mergeWithNext` in the revision view (ANN-04).

**OOXML.** `w:p`, `w:pPr` and its children in schema order.
**Edge cases.** `w:pPr` containing `w:sectPr` (a section break at that paragraph — SEC-02); a `w:pPr` with no
`w:pStyle` (default paragraph style applies); `w:jc w:val="both"` vs `"distribute"` (distinct justifications);
`w:ind` with both `w:start`/`w:end` (strict) and `w:left`/`w:right` (transitional) present — emit what was
there; a paragraph inside a table cell carrying `w:framePr` (illegal but seen — preserve).
**Round-trip.** FL1.

### MOD-05 — Run model (`w:r`, `w:rPr`) and run content
**Priority:** core · **Effort:** M

**Behaviour.**
- A run holds typed `rPr` plus an ordered sequence of run-content items — a run is **not** a string. Content
  items: `w:t`, `w:tab`, `w:br` (`w:type` text|page|column|lineClear), `w:cr`, `w:noBreakHyphen`,
  `w:softHyphen`, `w:sym` (`w:font`, `w:char`), `w:drawing`, `w:pict`, `w:object`, `w:fldChar`, `w:instrText`,
  `w:delText`, `w:footnoteReference`, `w:endnoteReference`, `w:commentReference`, `w:annotationRef`,
  `w:pgNum`, `w:separator`, `w:continuationSeparator`, `w:lastRenderedPageBreak`, `w:ptab`, `w:br` variants,
  `w:tbl` (a table as run content — legal, rare), plus opaque nodes.
- `w:lastRenderedPageBreak` is a **cache of Word's pagination** and is preserved but never trusted: our layout
  (spec 02) computes its own breaks. On export it may be regenerated from our layout or stripped
  (configurable; regenerating is what keeps Word's scroll position and page count stable on open).
- Typed `rPr` accessors: `rStyle`, `rFonts` (`ascii`, `hAnsi`, `cs`, `eastAsia`, and the `*Theme` variants),
  `b`, `bCs`, `i`, `iCs`, `caps`, `smallCaps`, `strike`, `dstrike`, `outline`, `shadow`, `emboss`, `imprint`,
  `vanish`, `webHidden`, `color` (incl. `themeColor`, `themeTint`, `themeShade`), `spacing`, `w`, `kern`,
  `position`, `sz`, `szCs`, `highlight`, `u` (`w:val`, `w:color`), `effect`, `bdr`, `shd`, `fitText`,
  `vertAlign`, `rtl`, `cs`, `em`, `lang` (`w:val`, `w:eastAsia`, `w:bidi`), `noProof`, `snapToGrid`,
  `specVanish`, `math` (OMML on/off), `rPrChange`.
- Unknown `w:rPr`/`w:pPr` children are preserved in place and re-emitted — property objects therefore have a
  stable identity and a `raw` overflow that keeps order relative to typed properties.
- Complex-script pairing is preserved: `b`/`bCs`, `i`/`iCs`, `sz`/`szCs` are separate properties and are
  never auto-synchronised. Russian text in Word depends on the `Cs` variants.

**OOXML.** `w:r`, `w:rPr`, all run-content elements.
**Edge cases.** A text element containing only whitespace (needs `xml:space="preserve"`); a run with no `w:t`
at all (formatting-only run — preserved, and it is how Word stores a run-level marker); `w:tab` inside a
table cell vs a paragraph; `w:sym w:char="F0B7"` (private-use code point) rendered via the named font;
`w:br w:type="page"` inside a header (illegal — preserve, do not honour in layout); a run with both `w:t` and
`w:drawing` (a picture with a text tail).
**Round-trip.** FL1.

### MOD-06 — Property cascade and toggle semantics
**Priority:** core · **Effort:** XL

**Behaviour.** The single most error-prone area of any DOCX editor; getting it wrong makes the editor "look
right" and the exported file wrong.
- Implement the ECMA-376 §17.7.2 resolution order for a run, lowest priority first:
  1. `w:docDefaults/w:rPrDefault/w:rPr`
  2. table style (`w:tblStyle` → `w:tblStylePr` conditional formatting, MOD-07)
  3. numbering level `w:lvl/w:rPr` for the paragraph's `numPr`
  4. paragraph style chain, applied **root-ancestor first** along `w:basedOn`
  5. `w:pPr/w:rPr` (paragraph-mark run properties)
  6. character style chain along `w:basedOn`, root first
  7. the run's own `w:rPr`
- Paragraph properties resolve in the analogous order (docDefaults → table style → numbering → paragraph style
  chain → direct `w:pPr`).
- **Toggle properties** (`b`, `bCs`, `i`, `iCs`, `caps`, `smallCaps`, `strike`, `dstrike`, `outline`,
  `shadow`, `emboss`, `imprint`, `vanish`, `webHidden`, `specVanish`) do **not** overwrite — they XOR. A layer
  that says `w:b` with no `w:val` (or `w:val="true"`/`"1"`/`"on"`) flips the accumulated state; `w:val="false"`
  /`"0"` /`"off"` flips it the other way. So `b=on` in a paragraph style plus `b=off` in the run's `rPr`
  yields bold-off; and `b=off` in a based-on style inheriting `b=on` also yields bold-off, indistinguishable
  in result but different in serialisation. The model tracks accumulated state per layer, not a boolean.
- The resolver returns both a **resolved value** (for layout/render) and a **provenance chain** (which layer
  set it). The editor needs provenance to show "this is bold because of style Heading 1" and to decide whether
  a formatting command writes a direct property or must modify a style.
- **`w:rStyle` on a run whose character style does not exist** → ignore the reference, keep the element,
  warn once.
- Caching: the resolver is memoised per (paragraph, run) with invalidation on any mutation to the paragraph,
  its styles, the numbering, or `docDefaults`. Invalidation must be transitive through `basedOn` and
  `link` chains — a change to a base style must invalidate every descendant.
- `w:basedOn` cycles (illegal, seen in the wild from third-party producers) are broken deterministically
  (treat the revisited style as having no base) rather than crashing or hanging.

**OOXML.** `w:docDefaults`, `w:style/w:basedOn`, `w:style/w:link`, `w:pPr/w:rPr`, `w:rPr`, `w:lvl/w:rPr`,
`w:tblStylePr`; toggle elements listed above; `w:style/w:default` and `w:style/w:type`.
**Edge cases.** A `w:style` with `w:default="1"` that is *not* named `Normal` (it is still the default for its
type); a paragraph style whose `basedOn` points at a character style (illegal — ignore the base);
`w:semiHidden` styles still participate in resolution; a character style applie d via `w:rStyle` inside a
revision (`w:ins/w:r/w:rPr`) resolving identically; `w:qFormat` affecting only the UI, never resolution.
**Round-trip.** FL1. Resolution is derived state — nothing about it is written back. The one exception is a
command that "applies bold" to text in a style that is already bold: the command must write an explicit
`w:b w:val="0"` (a toggle-off), not nothing.

### MOD-07 — Table model
**Priority:** core · **Effort:** L

**Behaviour.**
- Model `w:tbl` → `w:tblPr` (typed: `tblStyle`, `tblW`, `jc`, `tblInd`, `tblBorders`, `shd`, `tblLayout`,
  `tblCellMar`, `tblCellSpacing`, `tblLook`, `bidiVisual`, `tblStyleRowBandSize`, `tblStyleColBandSize`,
  `tblOverlap`, `tblCaption`, `tblDescription`, `tblpPr` (floating table)) → `w:tblGrid` → `w:tr`*.
- `w:tblGrid/w:gridCol` is the column definition of record. The number of grid columns is the source of truth;
  the model exposes a logical grid of width `gridCol.count` and maps each `w:tc` onto it via `w:gridSpan` and
  `w:vMerge`.
- **Merges.** Horizontal: `w:tcPr/w:gridSpan w:val="n"` on the first cell; the following `n-1` grid positions
  are covered. Vertical: `w:vMerge` with no `w:val` (or `val="restart"`) starts a merge; `w:vMerge w:val="continue"`
  continues it. A continuation cell must still exist, must still carry a `w:tcPr` with a `w:tcW`, and must
  contain at least one empty `w:p` — omitting any of these is a Word repair prompt.
- Structural edits must maintain the grid invariant: inserting a column inserts a `w:gridCol` **and** a `w:tc`
  in every row (with `w:gridSpan` adjustments where a spanning cell crossed the insertion point); deleting a
  row that contains the `w:vMerge w:val="restart"` cell of a merge must also clear the `continue` markers
  below, or promote one of them to `restart`.
- `w:trPr`: `w:trHeight` (`w:val`, `w:hRule` atLeast|exact|auto), `w:cantSplit`, `w:tblHeader` (repeat as
  header row on each page), `w:gridBefore`/`w:gridAfter` (leading/trailing grid positions the row does not
  occupy, with `w:wBefore`/`w:wAfter`), `w:jc`, `w:hidden`, `w:divId`, plus revision children.
- `w:tcPr`: `w:tcW` (`w:w`, `w:type` dxa|pct|auto|nil), `w:gridSpan`, `w:vMerge`, `w:tcBorders`,
  `w:shd`, `w:noWrap`, `w:tcMar`, `w:textDirection`, `w:tcFitText`, `w:vAlign`, `w:hideMark`, `w:cnfStyle`.
- Cell content is block content (`w:p`, `w:tbl`, `w:sdt`) — nested tables work through the same interface.
- A cell must always contain at least one block; deleting the last paragraph from a cell inserts an empty one
  rather than leaving `w:tc` empty. Same rule for a cell that would become empty of runs.

**OOXML.** `w:tbl`, `w:tblPr`, `w:tblGrid`, `w:tr`, `w:trPr`, `w:tc`, `w:tcPr`.
**Edge cases.** Rows with differing total grid span (ragged tables — the model must not "fix" them);
`w:tblGrid` with `gridCol` entries of `w:w` absent; a table inside a table inside a cell (nesting depth is
bounded by Word's own behaviour); `w:tblpPr` (floating table) with text wrapping around it — preserved and
handed to layout; a table row inside a `w:sdt` (row-level content control, SC-01); `w:tblHeader` on a row that
is not the first; cells with `w:textDirection w:val="tbRl"` (rotated text).
**Round-trip.** FL1, with the grid invariant asserted in tests (grid columns == sum of each row's occupied
grid positions + gridBefore + gridAfter).

### MOD-08 — Hyperlinks and bookmarks
**Priority:** core · **Effort:** S

**Behaviour.**
- `w:hyperlink` is inline content: `r:id` (external URL via a `hyperlink` relationship, PKG-06) or `w:anchor`
  (internal bookmark), or both (an internal anchor inside an external document — rare, preserve both).
  `w:history`, `w:tgtFrame`, `w:docLocation`, `w:tooltip` preserved. Children are runs (and revisions).
- `w:bookmarkStart`/`w:bookmarkEnd` are **range markup**, not containers. Bookmark ranges may span paragraphs,
  may be nested, may be unbalanced in malformed input, and may be interleaved with comment ranges and revision
  ranges. The model maintains a range index per story: start/end pairs matched by `w:id`, with orphaned
  markers preserved and reported (never silently deleted).
- `w:name` is required on start and absent on end. Names are limited to 40 characters and may not contain
  spaces in Word's model; we enforce the 40-character limit on creation and preserve longer pre-existing names.
- Bookmark id allocation must avoid collision with `w:id` values used by revisions, `w:sdt` ids, footnote
  references, and comment ids — these are separate id spaces per element type, but Word is inconsistent and
  some producers reuse values; allocation scans all of them.
- Word-managed bookmarks are preserved and **excluded from the user-facing bookmark list by default**:
  `_GoBack`, `_Toc\d+`, `_Ref\d+`, `_Hlk\d+`, `_Ref<number>`, `_Sect*` (from `w:bookmarkStart` used by
  `w:bookmarkEnd` inside `w:sectPr` for page-number fields). They must round-trip because `REF`/`PAGEREF`
  fields depend on them (SC-05).
- Hyperlink and bookmark ranges participate in text addressing: a bookmark's position is expressible as
  (story, paragraph id, offset), and moving text across a bookmark boundary must update or invalidate the
  range deterministically.

**OOXML.** `w:hyperlink`, `w:bookmarkStart` (`w:id`, `w:name`, `w:displacedByCustomXml`, `w:colFirst`,
`w:colLast`), `w:bookmarkEnd`.
**Edge cases.** A bookmark covering a whole table row (uses `w:colFirst`/`w:colLast`); two bookmarks with the
same name (legal in Word's model, resolves to the first — preserve both, warn); a bookmark whose start and end
are in different table cells; a bookmark start inside `w:sdtContent` whose end is outside (illegal; preserve,
do not "repair"); a hyperlink whose relationship target is missing (render as plain text, keep the `r:id`,
warn).
**Round-trip.** FL1.

### MOD-09 — Node identity, addressing, and mutation transactions
**Priority:** core · **Effort:** L

**Behaviour.**
- Every modelled node has a stable identity for the lifetime of the loaded document (an internal id, never
  serialised). Two different nodes never alias; a node removed and re-inserted is a new node with a new id.
- Every node exposes a **path**: a structural address from the story root
  (`body/p[12]/r[3]/t[1]`), stable across re-serialisation (unlike an array index into a filtered view).
  Paths are the currency of commands, events, selection, and diffs.
- Text addressing: a position is `(story, blockPath, offsetInBlockText, affinity)`. `offsetInBlockText` counts
  **rendered text characters** — a `w:tab`, `w:br`, and the digits of a field result each occupy offsets.
  Affinity (leading/trailing) disambiguates a position at a run boundary. This is the model-side contract that
  the tokenization module (spec 04) and the editor (spec 05) both build on; the tokenizer never sees markup.
- `w14:paraId` / `w15:paraIdParent`: paragraphs in a Word-authored part carry 8-hex-digit ids. Preserve them
  exactly; generate new ones for paragraphs we create (deterministic counter-based seed, R6); keep them unique
  within the document. Never rewrite an existing `paraId` — threaded comments, `w15:repeatingSectionItem` and
  cross-references depend on them (ANN-03, SC-04).
- **Mutation transactions.** All writes go through `transaction(fn)` in which the model is mutated directly and
  changes are recorded as an undoable patch list plus a dirty-part set. On commit, one `documentChanged` event
  is emitted and the touched parts are marked dirty (PKG-05). On abort, the model is restored from the patch
  inverse. Nested transactions flatten into the outer one.
- Transaction scope must include: which parts became dirty (for R3), which node paths were invalidated
  (for layout re-pagination, spec 02), and which ids were allocated (for undo/redo stability).
- Structural validation is available as `validate()` — it asserts the invariants this spec states
  (cell non-empty, grid consistency, alternating revision markers, balanced bookmark ranges, `w:sectPr`
  placement) and returns findings rather than throwing.

**OOXML.** `w14:paraId`, `w15:paraIdParent` (namespace
`http://schemas.microsoft.com/office/word/2010/wordml`), and every element's structural position.
**Edge cases.** Undo of a command that allocated a `paraId` (reuse the same id on redo so that a comment
thread's `paraIdParent` still resolves); a transaction that touches two stories (a header and the body);
a path that becomes ambiguous after a merge (two adjacent paragraphs with identical text) — paths are
structural, never content-derived.
**Round-trip.** Ids we generate are new content in the file, which is expected and is why the "no edits" save
must not generate them (PKG-05: clean parts are never re-serialised, so no `paraId` appears in a file the user
only opened).

### MOD-10 — Revision, rsid and proofing bookkeeping at document level
**Priority:** important · **Effort:** M

**Behaviour.**
- **rsids.** Word stamps paragraphs with revision-save ids (`w:rsidR`, `w:rsidRPr`, `w:rsidRDefault`,
  `w:rsidP`, `w:rsidDel`, `w:rsidTr`, `w:rsidSect`) and lists them in `w:settings/w:rsids/w:rsid` with an
  optional `w:rsidRoot`. These are Word's change-tracking metadata, not ours. Preserve every existing value
  exactly; on save, list any newly referenced rsid in `w:rsids`. Do not invent rsids for content we did not
  edit — a spurious rsid makes Word highlight the whole document as changed in some review workflows.
- New content created by a command receives an rsid only if the source paragraph had one and the config asks
  for Word-compatible authoring (`rsidStrategy: 'preserve' | 'generate' | 'none'`, default `'preserve'`).
- **`w:proofErr`** (`w:type="spellStart|spellEnd|gramStart|gramEnd"`) is Word's cached spell-check state.
  Preserve verbatim and in position; never re-order around them; never delete them on edit of neighbouring
  text (Word tolerates stale proofing ranges).
- **`w:lastRenderedPageBreak`** — documented in MOD-05.
- **`w:settings/w:proofState`** (spelling/grammar check flags) preserved unchanged (SET-01).
- **Story-level counters**: `docProps/app.xml` word/character/page counts are Word's own; regenerate only on
  export when asked (PRO-02), and never during an ordinary save.

**OOXML.** `w:rsid*` attributes, `w:settings/w:rsids`, `w:proofErr`, `w:lastRenderedPageBreak`,
`w:settings/w:proofState`.
**Edge cases.** An rsid referenced in a part but absent from `w:rsids` (add it on save, or leave — verify
against Word during implementation); a document with `w:rsidRoot` set; rsids inside headers/footers/
footnotes (separate parts, same `w:rsids` list in `settings.xml`).
**Round-trip.** FL1 for touched parts; FL0 for untouched parts (the common case, since rsids live in the parts
we edit only when we edit them).

---

## 3. Styles

### STY-01 — `styles.xml` structure, defaults and latent styles
**Priority:** core · **Effort:** L

**Behaviour.**
- Parse and round-trip the whole part: `w:docDefaults` (`w:rPrDefault/w:rPr`, `w:pPrDefault/w:pPr`),
  `w:latentStyles` (with `w:lsdException` entries: `w:name`, `w:uiPriority`, `w:semiHidden`, `w:unhideWhenUsed`,
  `w:qFormat`, `w:locked`, `w:count`), and `w:style`*.
- Every `w:style` carries `w:type` (paragraph|character|table|numbering), `w:styleId`, optional `w:default`,
  `w:customStyle`, and children: `w:name` (`w:val`), `w:basedOn`, `w:next`, `w:link`, `w:autoRedefine`,
  `w:hidden`, `w:uiPriority`, `w:semiHidden`, `w:unhideWhenUsed`, `w:qFormat`, `w:locked`, `w:personal*`,
  `w:rsid`, `w:pPr`, `w:rPr`, `w:tblPr`, `w:trPr`, `w:tcPr`, `w:tblStylePr`*.
- **Style identity is `w:styleId`, not `w:name`.** `w:name` is a display name and is localised in the UI
  (`heading 1` vs `Überschrift 1` vs `Заголовок 1`). Matching on name is a bug; matching on the built-in
  name aliases (`Heading1`, `heading 1`, `Titre1`) is a fallback only for `w:styleId`-less input.
- Built-in style ids that must be recognised by id for semantic behaviour (STY-06, EXP outline generation):
  `Normal`, `Heading1`–`Heading9`, `Title`, `Subtitle`, `Quote`, `IntenseQuote`, `ListParagraph`,
  `FootnoteText`, `EndnoteText`, `FootnoteReference`, `EndnoteReference`, `CommentText`, `CommentReference`,
  `Caption`, `TOC1`–`TOC9`, `Header`, `Footer`, `Hyperlink`, `FollowedHyperlink`, `DefaultParagraphFont`,
  `TableNormal`, `NoList`, `BalloonText`, `PlaceholderText`, `MacroText`, `Strong`, `Emphasis`.
- **Order matters and is preserved.** Word requires `w:docDefaults`, then `w:latentStyles`, then `w:style`
  elements in its own order (built-ins generally last). New styles are appended at the end; modifying an
  existing style never moves it. `w:style` order is not semantically meaningful but reordering produces a
  large, noisy diff in a user's file and can change which style is `w:default` in broken documents.
- `w:docDefaults` toggles follow MOD-06's XOR rule like any other layer.
- `w:stylesWithEffects.xml` (Word 2010 era): if the relationship exists, keep it in sync structurally on save
  or copy the original through untouched; do not delete it (Word may still write it) and never let the two
  diverge in a way that changes rendering (prefer passthrough — it exists only for Word 2007 compat).

**OOXML.** `w:styles`, `w:docDefaults`, `w:latentStyles`, `w:style` and children as listed.
**Edge cases.** Two styles with the same `w:styleId` (illegal — keep both, use the first, warn on validation);
a `w:style` with no `w:name`; a `w:style` whose `w:type` is absent (invalid; treat as paragraph and preserve);
localised `w:name` values; a `w:default` paragraph style other than `Normal`; a character style with a `w:pPr`
(preserve); `w:locked` + `w:semiHidden` combination used by third-party producers to hide styles;
a document with no `styles.xml` at all (legal — synthesise defaults in memory, do not add the part on save
unless a style command runs).

### STY-02 — Style cascade, inheritance and resolution
**Priority:** core · **Effort:** L

**Behaviour.**
- Implements the style half of MOD-06: `w:basedOn` chains resolved to their root, applied root-first; `w:link`
  pairing a paragraph style to its character style (they are two views of one style in Word's UI and must be
  kept consistent when either is edited); `w:next` giving the style applied to the paragraph after Enter.
- `w:next` must default sensibly when absent: `Normal` for most, and self-reference is legal (a `Heading 1`
  whose `w:next` is `Heading 1`).
- Resolution is provenance-tracked (MOD-06) and cached with transitive invalidation along `basedOn`/`link`.
- A style's own `w:pPr/w:rPr` participates as layer 4/6 of the run cascade; the paragraph's `w:pPr/w:rPr`
  (paragraph mark properties) is layer 5 and wins over the paragraph style's `rPr` — this is why typing at the
  end of a styled paragraph sometimes produces different formatting than selecting its text.
- **Table style chain**: `w:tblStyle` → `w:basedOn` chain, then conditional formatting (`w:tblStylePr`) per
  MOD-07's precedence, then direct `w:tblPr`/`w:trPr`/`w:tcPr`.
- Numbering styles (`w:type="numbering"`, referenced by `w:lvl/w:pStyle` and `w:numStyleLink`) resolve through
  the same chain and feed NUM-02.

**OOXML.** `w:basedOn`, `w:link`, `w:next`, `w:tblStylePr` (`w:type` values: `wholeTable`, `firstRow`,
`lastRow`, `firstCol`, `lastCol`, `band1Vert`, `band2Vert`, `band1Horz`, `band2Horz`, `neCell`, `nwCell`,
`seCell`, `swCell`), `w:cnfStyle`, `w:numStyleLink`, `w:styleLink`.
**Edge cases.** A `basedOn` cycle; a `basedOn` chain deeper than 10 (legal, resolve anyway, warn in
validation); `w:link` pointing at a missing style (drop the link, keep the element, warn); `w:tblStylePr`
for a condition whose `w:cnfStyle` bit is not set on any row/cell (preserved, unused).
**Round-trip.** FL1; derived state is never written back.

### STY-03 — Style editing operations and id stability
**Priority:** important · **Effort:** L

**Behaviour.**
- Operations: `createStyle`, `updateStyle`, `deleteStyle`, `renameStyle`, `setDefaultStyle`,
  `linkStyles`, `applyStyleToParagraph`, `applyCharacterStyle`, `clearDirectFormatting`.
- **`w:styleId` is generated once and never changes.** `renameStyle` changes only `w:name` — changing a
  `styleId` would break every `w:pStyle`/`w:rStyle`/`w:tblStyle` reference in the document and in headers,
  footers, footnotes, comments, and glossary parts simultaneously.
- Generated ids: built-in-name-derived where possible (`Heading1`, `ListParagraph`), otherwise a deterministic
  slug of the display name plus a numeric suffix on collision (`ContractClause`, `ContractClause1`). Ids must
  match `^[^ ,./\\:;\[\]{}()#%&*+<=>?@^|~"']+$` (no spaces, no punctuation Word rejects) and must be checked
  case-insensitively for uniqueness.
- `deleteStyle`: refuse by default if the style is referenced anywhere (return the reference list: which
  paragraphs, which runs, which tables, which `w:basedOn`/`w:next`/`w:link` chains, which `w:lvl/w:pStyle`).
  With `force`, repoint references to the base style (or `Normal`), or remove the `w:pStyle`/`w:rStyle`
  attribute if there is no base, and preserve the formatting by writing the resolved `pPr`/`rPr` directly into
  the affected paragraphs (Word's "delete style, keep formatting" behaviour).
- `updateStyle`: merge properties into the style's `w:pPr`/`w:rPr` at schema-correct positions; toggles follow
  MOD-06 (writing `w:b w:val="0"` to turn off an inherited bold).
- Style commands mark `word/styles.xml` (and `word/document.xml` for reference updates) dirty; a style-only
  edit must **not** dirty `document.xml` unless references changed.
- `w:latentStyles` is never rewritten by style commands except when a new style's name matches a latent style
  and the config opts into promoting it (`w:semiHidden`/`w:unhideWhenUsed` handling).

**OOXML.** `w:style`, `w:pStyle`, `w:rStyle`, `w:tblStyle`, `w:basedOn`, `w:next`, `w:link`, `w:latentStyles`.
**Edge cases.** Deleting a style referenced by an opaque `w:pPr` node (the reference is invisible to typed
accessors — the reference scan must walk opaque subtrees too); two styles differing only in case; a style
referenced only from `numbering.xml`; deleting the default paragraph style (refuse);
`clearDirectFormatting` on a selection that spans several styles and a table (clears `w:rPr`/`w:pPr` typed
properties, preserves opaque ones).
**Round-trip.** FL1; deletions are FL3 and must be reported.

---

## 4. Numbering and multilevel lists

### NUM-01 — `numbering.xml` model
**Priority:** core · **Effort:** L

**Behaviour.**
- Parse the whole part: `w:abstractNum`* (`w:abstractNumId`, `w:nsid`, `w:multiLevelType`, `w:tmpl`,
  `w:styleLink`, `w:numStyleLink`, `w:lvl`×9 on levels 0–8) and `w:num`* (`w:numId`, `w:abstractNumId`,
  `w:lvlOverride`*).
- `w:lvl` children: `w:start`, `w:numFmt`, `w:lvlRestart`, `w:pStyle`, `w:isLgl`, `w:suff`, `w:lvlText`,
  `w:lvlJc`, `w:pPr` (`w:ind`, `w:tabs`, `w:pBdr`…), `w:rPr`, `w:lvlPicBulletId`, plus `w:legacy` and
  `w:lvlRestart`. Children must be emitted in schema order — `w:lvlText` before `w:lvlJc` before `w:pPr`,
  `w:rPr` — and third-party producers get this wrong; preserve their order and repair only on edit.
- `w:numFmt` values that must be **rendered** correctly, not just preserved: `decimal`, `decimalZero`,
  `upperRoman`, `lowerRoman`, `upperLetter`, `lowerLetter`, `ordinal`, `ordinalText`, `cardinalText`,
  `hex`, `bullet`, `none`, `numberInDash`, and — directly relevant to this product —
  `russianLower`/`russianUpper` (Cyrillic а, б, в …), `russianLower`-family forms, plus `chineseCounting`
  and the `ideograph*`/`japanese*`/`korean*` families which must be *preserved and laid out* even if the UI
  never offers them, and `hebrew1`/`arabicAlpha`/`thaiLetters` similarly.
- Level count: levels are 0-based (`w:ilvl w:val="0"` is the first level). Nine levels maximum. A `w:lvl`
  with `w:ilvl` out of range is preserved, ignored by layout, and flagged.
- `w:multiLevelType`: `singleLevel`, `multilevel`, `hybridMultilevel`. It is advisory metadata that Word uses
  in the UI; it must round-trip exactly but must not drive behaviour.
- `w:numPicBullet` (picture bullets) captured in NUM-06.

**OOXML.** `w:numbering`, `w:abstractNum`, `w:num` and their children; namespace is the standard
wordprocessingml one.
**Edge cases.** `w:numFmt` with an unknown value (preserve, render as decimal, warn);
a `w:lvl` with neither `w:numFmt` nor `w:lvlText` (legal — inherited from the level above in some Word
behaviour; preserve and treat as bullet); a document with no `numbering.xml` but `w:numPr` references in the
body (illegal but common after a bad edit — render as no numbering, preserve the reference, warn);
`w:abstractNum` referenced by no `w:num` (keep; do not garbage-collect).

### NUM-02 — Instance resolution: `numId` → `abstractNumId`
**Priority:** core · **Effort:** M

**Behaviour.**
- A paragraph's numbering is `w:pPr/w:numPr/w:numId` (instance) + `w:ilvl` (level). The instance maps to an
  abstract definition through `w:num`, and the effective level is the `w:lvlOverride` for that `w:ilvl` if
  present, else the `w:abstractNum`'s `w:lvl`.
- `w:numId w:val="0"` means **numbering explicitly removed** for that paragraph — not "instance zero". It is a
  distinct state from "no `w:numPr`" (which means "inherit from the style"). Both must be representable and
  round-trip; conflating them is a classic bug that makes "remove numbering" silently do nothing.
- A paragraph with no `w:numPr` but a `w:pStyle` whose style has `w:pPr/w:numPr` **is** numbered (inherited).
  Resolution goes: direct `numPr` → paragraph style's `numPr` → `w:numPr w:ilvl`-only override of the style's
  `numId`. The resolver must return which case applied, for the UI and for `restartNumbering`.
- Two paragraphs with the same `numId` and `ilvl` are in the **same list**; a different `numId` is a different
  list even if both point at the same `w:abstractNum`. Instance identity, not abstract identity, decides
  continuity.
- `restartNumbering` on a list works by creating a **new `w:num` instance** pointing at the same
  `w:abstractNum`, with a `w:lvlOverride`/`w:startOverride` where the restart must begin — never by mutating
  the shared abstract definition (which would renumber every other list using it).
- Creating a list from a UI "bullets/numbering" button clones an existing abstract definition (or synthesises
  one) and creates a fresh `w:num`, matching Word's own behaviour and keeping third-party files predictable.

**OOXML.** `w:numPr`, `w:numId`, `w:ilvl`, `w:num`, `w:abstractNum`, `w:abstractNumId`, `w:numFmt`, `w:suff`,
`w:pStyle`.
**Edge cases.** A `w:numId` with no matching `w:num`; a `w:num` whose `w:abstractNumId` has no matching
`w:abstractNum`; `w:abstractNumId` shared by many `w:num`s; `w:numId` reused after deletion (never reuse);
numbering on a paragraph inside a table cell continuing the numbering of the body (it does — list continuity
is per story, and a table cell's paragraphs are in the same story);
`w:numPr` on a paragraph in a header (lists in headers are their own list context).

### NUM-03 — Number evaluation and rendering
**Priority:** important · **Effort:** L

**Behaviour.**
- Evaluate the counter for each numbered paragraph once per layout pass (spec 02 owns pagination, this feature
  owns the *value*): walk the story in document order, maintain a counter per `(numId, ilvl)` and a matrix of
  values for levels 0–8, and produce the rendered label.
- `w:lvlText` placeholders: `%1` … `%9` reference the counter at that level; `%%` is a literal percent;
  any other character is literal. `%0` is invalid — preserve, render literally, warn. When a level is
  referenced that has no counter value yet (a level-3 item with no preceding level-2), Word displays the
  level's `w:start` value; match that, since it is what users expect to see.
- Level restart: `w:lvlRestart w:val="n"` restarts this level when level `n-1` increments; `w:lvlRestart
  w:val="0"` means never restart. Default behaviour restarts on the next-higher level (matching Word's
  default when the element is absent).
- `w:isLgl` (legal numbering) renders every level in the reference as decimal regardless of its `w:numFmt` —
  e.g. `1.1.1` from roman-numeral levels. Must be honoured.
- `w:suff` (`tab` | `space` | `nothing`) controls the gap between label and text: `tab` inserts a tab stop
  positioned from `w:pPr/w:ind`/`w:tabs`, `space` a space, `nothing` nothing. Layout consumes this; the model
  exposes the rendered label plus the suffix specification separately.
- `w:lvlJc` (left|center|right) aligns the label within its own box (the width implied by `w:ind/w:firstLine`
  and the label length), separate from `w:pPr/w:jc` which justifies the paragraph text.
- `w:numFmt="bullet"`: `w:lvlText` holds the bullet character(s) directly (e.g. ``, `o`, `▪`), often in a
  private-use area to be rendered with the level's `w:rPr/w:rFonts` (commonly Symbol or Wingdings). Do not
  substitute a "nicer" bullet — the font+character pair is the definition.
- `w:pStyle` on a level links it to a paragraph style (heading numbering). The link means "paragraphs of this
  style at this level get this numbering"; a change to the level's format must not silently change the style.
- Numbering values are **derived state**: never written into `w:t` of the paragraph. Word stores them nowhere;
  writing literal labels turns an editable list into dead text (the single most damaging mistake in this
  area). The one exception is re-evaluating a `listnum` field (SC-05) or an export that must flatten lists
  (EXO-01/03).

**OOXML.** `w:lvlText`, `w:lvlJc`, `w:suff`, `w:numFmt`, `w:start`, `w:lvlRestart`, `w:isLgl`, `w:pStyle`,
`w:rPr/w:rFonts` on the level.
**Edge cases.** A level whose `w:numFmt` changes mid-list (illegal after creation; preserve and honour);
`w:startOverride` vs `w:lvlOverride` (NUM-04); a list interrupted by a non-numbered paragraph and resuming
(numbering continues — the intervening paragraph does not break continuity unless it has `w:numId=0`);
numbering inside a content control's `w:sdtContent` (continuity crosses the sdt boundary because document
order does); a list split across a section break (numbering continues across sections in Word);
a `w:lvlText` longer than the label box (layout concern, but the value is ours).

---

## 5. Theme, fonts and settings

### THM-01 — `theme1.xml`
**Priority:** important · **Effort:** M

**Behaviour.**
- Parse and round-trip `a:theme` → `a:themeElements` (`a:clrScheme`, `a:fontScheme`, `a:fmtScheme`) →
  `a:objectDefaults`, `a:extraClrSchemeLst`, plus `a:theme/@name` and the `a:custClrLst` extension.
- `a:clrScheme`: `dk1`, `lt1`, `dk2`, `lt2`, `accent1`–`accent6`, `hlink`, `folHlink`, each holding either
  `a:srgbClr` or `a:sysClr` (`a:lastClr` is the fallback and must be preserved).
- `a:fontScheme`: `a:majorFont` / `a:minorFont`, each with `a:latin`, `a:ea`, `a:cs` and `a:font`
  (`a:script`, `a:typeface`) entries for script-specific fallbacks. The `a:cs` entries are directly relevant
  to Russian documents (the Cyrillic typeface of a theme font).
- `a:fmtScheme`: `a:fillStyleLst`, `a:lnStyleLst`, `a:effectStyleLst`, `a:bgFillStyleLst`. Word 2007 uses
  the DrawingML `a:*` names; Word 2010+ may use the extended `a14:*`/`a:fmtScheme` names
  (`a:fillStyleLst` children as `a:solidFill`/`a:gradFill` referencing scheme colours). Preserve both.
- Theme colour references are resolved on demand: `w:color/@w:themeColor="accent1"` +
  `w:themeTint`/`w:themeShade` (hex, 2 digits, applied as a luminance transform on the resolved RGB) →
  concrete RGB for layout/PDF. Implement Word's tint/shade maths, not an approximation: shade multiplies,
  tint interpolates toward white, in the sRGB space, per ECMA-376 Part 1 §17.3.2.35/§20.1.2.3.
- `w:clrSchemeMapping` in `settings.xml` maps the semantic names (`w:accent1`, `w:hyperlink`, `w:followedHyperlink`,
  `w:bg1`, `w:t1`…) to scheme slots; resolution must go through the mapping, not assume `accent1`→`accent1`.
- Theme parts other than `theme1.xml` (`theme2.xml` …, referenced by `w:theme` relationships from headers or
  the numbering part for theme fonts) are preserved and resolved by relationship, never by hard-coded name.

**OOXML.** `word/theme/theme1.xml`, `a:theme`, `a:clrScheme`, `a:fontScheme`, `a:fmtScheme`,
`w:themeColor`/`w:themeTint`/`w:themeShade`, `w:clrSchemeMapping`, `w:themeFontLang`.
**Edge cases.** A missing theme part (legal — fall back to the Word default Office theme, which must be
built into the library and must not be written into the file); a theme with `a:sysClr` slots (resolve via
`a:lastClr`); `a:fontScheme` with a script fallback for `cyrl`/`ro`; a document with multiple themes
(main + per-header overrides).

### THM-02 — Font resolution, `fontTable.xml`, and embedded fonts
**Priority:** core · **Effort:** L

**Behaviour.**
- Three inputs resolve to one font per run: the effective `w:rFonts` (`ascii`/`hAnsi`/`cs`/`eastAsia` and the
  `*Theme` counterparts), the theme's `a:fontScheme`, and the script of the characters being shaped.
  `w:rFonts/@w:ascii` covers Latin-1-ish and Latin Extended-A/B, `@w:hAnsi` the same in legacy contexts,
  `@w:cs` covers Cyrillic/Greek/Hebrew/Arabic/Thai, `@w:eastAsia` CJK. **Cyrillic text uses `@w:cs`** —
  picking `ascii` for Russian text selects the wrong typeface and is the most common font bug in a
  multi-language DOCX editor.
- The character→script assignment must be a real Unicode range table (Latin, Latin-Ext, Cyrillic,
  Cyrillic Supplement, Greek, Hebrew, Arabic, Thai, Devanagari, CJK, punctuation), not a "non-ASCII" test.
  Romanian `ș`/`ț` (U+0218–U+021B, Latin Extended-B) is Latin; Russian is Cyrillic; both may appear in one run.
- `w:fontTable.xml` round-trips as a list of `w:font` (`w:name`, `w:altName`, `w:panose1`, `w:charset`,
  `w:family`, `w:pitch`, `w:sig`, `w:notTrueType`) with children `w:embedRegular`, `w:embedBold`,
  `w:embedItalic`, `w:embedBoldItalic` (relating to `word/fonts/*.odttf`), `w:embedSubset` attributes, plus
  `w:font/w:embed*` `w:fontKey` (a GUID) and `w:subsetted`.
- **Embedded fonts are ODTTF**: the first 32 bytes of the obfuscated font are XORed with the bytes of the
  `w:fontKey` GUID (which is stored byte-reversed in the attribute, with `-` removed). De-obfuscate on load,
  and re-obfuscate with the **same key** on save so Word still accepts the font. If we generate a new key,
  we must rewrite both the GUID and the obfuscation consistently — never one without the other.
- Permission bits in the font's `OS/2.fsType` matter: `0x0002` (restricted licence) means the font may not be
  embedded at all; `0x0100` permits embedding for printing/preview only; `0x0200` forbids subsetting. Honour
  these on export (EXP-04) and report the restriction rather than ignoring it.
- Fonts referenced by `w:rFonts` but absent from `w:fontTable.xml` are legal (Word tolerates it) — the model
  must not add them on load; it may offer to on an explicit command.
- `w:themeFontLang` (`w:val`, `w:eastAsia`, `w:bidi`) in `settings.xml` selects the theme font for a
  language, and interacts with `w:lang` in `rPr`.

**OOXML.** `w:rFonts` (`w:ascii`, `w:hAnsi`, `w:cs`, `w:eastAsia`, `w:asciiTheme`, `w:hAnsiTheme`,
`w:cstheme`, `w:eastAsiaTheme`, `w:hint`), `word/fontTable.xml`, `word/fonts/*.odttf`, `w:embed*`,
`w:fontKey`, `w:themeFontLang`, `w:lang`.
**Edge cases.** A font name with a leading `@` (vertical/CJK writing — a distinct font, not a typo);
`w:hint="eastAsia"` overriding the script logic for ambiguous characters (the "hint" tells Word which of two
fonts to use for a character present in both); a theme reference that resolves to no font (fall back);
an ODTTF whose GUID is malformed (treat as unobfuscated, warn, and preserve bytes verbatim on save);
a font part present with no `w:font` referencing it (keep — do not prune).

### SET-01 — `settings.xml`
**Priority:** core · **Effort:** M

**Behaviour.** Round-trip every child of `w:settings`, and give typed access to the ones with behaviour:

| Element | Behaviour it drives |
|---|---|
| `w:evenAndOddHeaders` | enables the `even` header/footer variants (SEC-04). **Absence disables them** — a document with `even` header references but no `evenAndOddHeaders` renders the `default` header on even pages. |
| `w:defaultTabStop` (`w:val`) | the implicit tab interval when a paragraph has no explicit tab stops; layout consumes it. Default 720 twips. |
| `w:characterSpacingControl` | whether `*Chars` ind/spacing properties are honoured. |
| `w:compat` (`w:compatSetting` `name="compatibilityMode" val=…`, `w:useFELayout`, `w:doNotExpandShiftReturn`, …) | the compatibility mode Word opens the document in. **This must round-trip exactly** — it changes Word's own layout (line breaking, table widths, spacing) and therefore whether our layout agrees with Word's. |
| `w:rsids` | MOD-10 |
| `w:trackChanges` | whether revisions are recorded by Word |
| `w:documentProtection` | write protection: `w:edit` (`none`/`readOnly`/`comments`/`forms`/`trackedChanges`), `w:enforcement`, `w:cryptProviderType`, `w:cryptAlgorithmClass/Type/Sversion`, `w:hash`, `w:salt`, `w:spinCount`. Preserve; honour as a read-only hint; never attempt to forge a hash. |
| `w:writeProtection` | `w:recommended`, `w:algorithmName`, `w:hashValue`, `w:saltValue`, `w:spinCount` |
| `w:attachedTemplate` (`r:id`) | the document template; preserved (the target is often a `file://` path that is dead — preserve, do not follow, do not prune) |
| `w:docVars`/`w:docVar` (`w:name`, `w:val`) | values for the `DOCVARIABLE` field (SC-05) |
| `w:footnotePr` / `w:endnotePr` | note numbering (ANN-02) |
| `w:zoom` | view state — preserved, never applied to our own view |
| `w:proofState`, `w:proofState` spelling/grammar | MOD-10 |
| `w:hdrShapeDefaults`, `w:shapeDefaults` | VML shape defaults for headers/body — preserved (MED-04) |
| `w:stylePaneFormatFilter`, `w:stylePaneSortMethod` | UI state — preserved |
| `w:removePersonalInformation`, `w:removeDateAndTime` | privacy flags — preserved, surfaced to the host |
| `w:embedSystemFonts`, `w:saveSubsetFonts`, `w:saveFormsData`, `w:doNotEmbedSmartTags` | font/data embedding policy — preserved; `w:saveSubsetFonts` informs EXP-04 |
| `w:updateFields` | forces Word to refresh fields on open — we set this when we have re-evaluated fields and want Word to agree |
| `w:themeFontLang`, `w:clrSchemeMapping` | THM-01 |
| `w:decimalSymbol`, `w:listSeparator` | used in field formula evaluation and number formatting (SC-05, NUM-03) |
| `w:hyphenationZone`, `w:autoHyphenation`, `w:consecutiveHyphenLimit`, `w:doNotHyphenateCaps` | layout (spec 02) |
| `w:displayBackgroundShape`, `w:printFormsData`, `w:printFractionalCharacterWidth`, `w:printPostScriptOverText`, `w:printTwoOnOne` | print behaviour (EXP-03) |
| `w:drawingGridHorizontalSpacing`, `w:drawingGridVerticalSpacing`, `w:displayHorizontalDrawingGridEvery`, `w:displayVerticalDrawingGridEvery` | preserved |
| `w:alignBordersAndEdges`, `w:bordersDoNotSurroundHeader/Footer`, `w:bookFoldPrinting*`, `w:saveThroughXslt`, `w:showXMLTags`, `w:alwaysMergeEmptyNamespace` | preserved |
| `w:mailMerge` | merge settings (mail-merge configuration, cross-ref spec 04) — preserved |

- Unknown `w:settings` children are preserved in schema position (MOD-02), including the `w15`/`w16`
  extensions (`w15:chartTrackingRefBased`, `w16:commentsExtensible`, …).

**OOXML.** `w:settings` and the children above.
**Edge cases.** `w:settings` absent entirely (legal — synthesise nothing, use defaults, do not create the part
unless a command writes to it); a `w:compat/w:compatSetting` for a compatibility mode we do not know (preserve
verbatim); `w:documentProtection` with `w:enforcement="0"` (protection present but off — must read as
unprotected); a `w:rsids` list with thousands of entries (do not rewrite it wholesale on save — an
untouched-settings save must be FL0).

### SET-02 — Document variables, attached template and protection surface
**Priority:** later · **Effort:** S

**Behaviour.**
- Expose `docVars` as a typed map with `getDocVar`/`setDocVar`/`removeDocVar`, marking `settings.xml` dirty.
  `DOCVARIABLE "name"` fields resolve against it (SC-05) and must re-evaluate when a var changes.
- Expose `attachedTemplate` read-only with a `setAttachedTemplate(url)` command that adds/updates the
  relationship (PKG-04) — used by the template product when attaching a corporate template in the field.
- Expose protection state (`isWriteProtected`, `protectionMode`) and a `setProtection` command that can add
  `w:documentProtection` with a hash computed by WebCrypto (SHA-512, the algorithm Word 2013+ uses:
  `w:algorithmName="SHA-512"`, `w:cryptAlgorithmClass="hash"`, `w:spinCount="100000"`, iterated over
  salt+password). Setting protection is a real feature request for HR documents ("this contract must not be
  edited"); forging or removing protection without the password is not something we offer.
- `removeProtection` is allowed only when the document is not protected, or when the caller supplies the
  password and we verify it against the stored hash.

**OOXML.** `w:docVars`, `w:attachedTemplate`, `w:documentProtection`, `w:writeProtection`.
**Edge cases.** A protection hash Word wrote with a legacy algorithm (`w:cryptAlgorithmSversion="1"`,
`w:cryptProviderType="rsaAES"`); a password-protected document where the user only wants to read it (must
work — protection is not encryption); a `w:hash` that fails to verify because of a normalisation difference
in the password (document the exact pre-hash normalisation we implement).

---

## 6. Sections, headers and footers

### SEC-01 — `w:sectPr` and page geometry
**Priority:** core · **Effort:** L

**Behaviour.**
- Full typed `w:sectPr`: `w:headerReference`*, `w:footerReference`*, `w:footnotePr`, `w:endnotePr`, `w:type`,
  `w:pgSz` (`w:w`, `w:h`, `w:orient`, `w:code`), `w:pgMar` (`w:top`, `w:right`, `w:bottom`, `w:left`,
  `w:header`, `w:footer`, `w:gutter`), `w:paperSrc`, `w:pgBorders` (`w:top`/`left`/`bottom`/`right` with
  `w:val`, `w:sz`, `w:space`, `w:color`, `w:offsetFrom`, `w:shadow`), `w:lnNumType`, `w:pgNumType`
  (`w:fmt`, `w:start`, `w:chapStyle`, `w:chapSep`), `w:cols`, `w:formProt`, `w:vAlign`
  (top|center|both|bottom), `w:noEndnote`, `w:titlePg`, `w:textDirection`, `w:bidi`, `w:rtlGutter`,
  `w:docGrid` (`w:type`, `w:linePitch`, `w:charSpace`), `w:printerSettings` (`r:id`), `w:sectPrChange`.
- **Defaults when a value is absent** are Word's own, and getting them wrong shifts every page:
  `w:pgSz` absent → Letter (12240×15840 twips) — *not* A4; `w:pgMar` defaults are 1440 top/bottom, 1800
  left/right, 720 header/footer, 0 gutter; `w:type` absent → `nextPage`.
  A4 is 11906×16838 twips. Because this product's users are in RO/RU, the engineering default for a *new*
  document is A4 — but a document that omits `w:pgSz` must still be read as Letter, because that is what Word
  will do when it opens it.
- `w:orient="landscape"` swaps the interpretation of `w:w`/`w:h`: in landscape, `w:w` is the **long** edge.
  Word writes landscape A4 as `w:w="16838" w:h="11906" w:orient="landscape"`. Layout must not swap twice.
- Mirror margins (`w:settings/w:mirrorMargins`) swap left/right margins on even pages; `w:rtlGutter` and
  `w:bidi` change which side the gutter is on. Gutter is added to the inside margin.
- `w:docGrid` with `w:type="lines"`/`"linesAndChars"` (East Asian) constrains line pitch and, combined with
  `w:snapToGrid`, changes line spacing — relevant to Russian/Chinese documents created by Asian Word builds.
  Layout (spec 02) consumes it; the model preserves it exactly.
- `w:printerSettings` points at `word/printerSettings/printerSettingsN.bin`, a DEVMODE blob. It is opaque and
  machine- and driver-specific. Preserve the part and the relationship (FL0) so the user's paper source and
  duplex settings survive; never regenerate it; drop it only on explicit command.

**OOXML.** `w:sectPr` and its children.
**Edge cases.** A section with `w:pgSz` but no `w:pgMar` (defaults apply, do not inherit from the previous
section — page geometry is per-section, not inherited); a section narrower than its margins (legal, produces a
negative text width — layout must clamp, the model must not "fix" the numbers); `w:pgBorders` with
`w:offsetFrom="page"` vs `"text"`; `w:paperSrc` referencing a printer tray; a `w:pgSz w:code` naming a paper
size that contradicts `w:w`/`w:h` (the explicit dimensions win).

### SEC-02 — Section breaks and section inheritance
**Priority:** core · **Effort:** M

**Behaviour.**
- Section count and placement: the **last** section's `w:sectPr` is a direct child of `w:body`, after the last
  block. Every **earlier** section's `w:sectPr` lives inside the `w:pPr` of the last paragraph of that section
  (the paragraph mark carries the break). A document with N sections therefore has N-1 `w:sectPr`s in `w:pPr`
  plus one in `w:body`.
- Moving, splitting, or deleting a block must maintain that invariant: a paragraph carrying a `w:sectPr` may
  not be deleted without re-homing the `w:sectPr` (to the new last paragraph of the section, or to the body if
  it becomes the final section). Violating this is the second-most-common cause of a Word repair prompt after
  broken relationship ids.
- `w:type`: `nextPage` (default), `continuous`, `evenPage`, `oddPage`. `continuous` starts the new section on
  the same page; layout (spec 02) owns the break placement, the model owns the value and the invariant that a
  `continuous` break following a section with different `w:cols` still balances the previous columns.
- Inheritance for things sections do **not** declare: page size, margins, and `w:docGrid` are per-section with
  Word defaults — *not* inherited from the previous section. However `w:headerReference`/`w:footerReference`
  **are** inherited when absent (SEC-04), and so are `w:footnotePr`/`w:endnotePr` from `settings.xml`.
  Getting this asymmetry right is the whole of this feature.
- A section may be created by `w:sectPr` insertion + `w:type` duplication (Word copies the preceding
  section's properties into a new `w:sectPr`, including its header references) — match that behaviour, because
  it is what users expect from "insert a section break".
- `w:sectPrChange` (a tracked section-property change) preserves the previous `w:sectPr` and participates in
  ANN-04/05.

**OOXML.** `w:sectPr` in `w:body` and in `w:pPr`, `w:type`, `w:sectPrChange`.
**Edge cases.** A body-level `w:sectPr` missing entirely (illegal; synthesise a default in memory, do not add
it on save unless the document is edited — but do add it if we must, and warn); two body-level `w:sectPr`s;
a `w:sectPr` inside a table cell's paragraph (illegal, preserve); a `w:sectPr` in an empty paragraph at the
end of the document followed by another paragraph (the final section is the body one — order matters);
`w:sectPr` inside a header/footer story (illegal, preserve).

### SEC-03 — Headers and footers: parts and references
**Priority:** core · **Effort:** L

**Behaviour.**
- Each header and footer is its own **part** (`word/header1.xml` … `word/footer9.xml`), referenced from a
  `w:sectPr` by `w:headerReference`/`w:footerReference` with `w:type` ∈ {`default`, `first`, `even`} and
  `r:id`. The `w:type` is **optional in the schema and defaults to `default`** — an omitted type is a real
  case in third-party files and must not be dropped or guessed into `first`.
- A section may reference up to three headers and three footers. The same part may be referenced by several
  sections (this is how "same as previous" is stored — one part, many references). The model must therefore
  treat a header part as shared: editing it edits it for every section that references it, and the UI must say
  so (SEC-04).
- `w:hdr`/`w:ftr` roots contain block content (`w:p`, `w:tbl`, `w:sdt`, opaque nodes) — no `w:sectPr`.
- Headers and footers are **stories** (MOD-03) and are laid out per page by spec 02, with their own
  paragraphs, numbering, fields (PAGE, NUMPAGES, STYLEREF) and even their own content controls.
- Header/footer content must round-trip including `w:pgNum`, `w:fldSimple` with `PAGE`, and Empty headers
  (a header part containing a single empty paragraph is the normal state for "blank header" — not an error,
  and not something to prune).
- The `Header`/`Footer` paragraph styles apply and must exist (STY-01) — Word's own `styleId`s.
- A header/footer part with no referencing `w:sectPr` is orphaned; preserve it (do not prune) because a
  section may reference it again and because pruning changes relationship ids.

**OOXML.** `w:headerReference` / `w:footerReference` (`w:type`, `r:id`), `w:hdr`, `w:ftr`,
`word/_rels/headerN.xml.rels` (headers can reference images and hyperlinks of their own), `w:titlePg`,
`w:settings/w:evenAndOddHeaders`.
**Edge cases.** Two sections referencing the same header part but with different `w:type` values (e.g. the
same part as `default` in one and `even` in another — legal, preserve); a header part referenced with a
missing `r:id`; a header containing a footnote reference (illegal, preserve); a header whose `.rels` has the
`hyperlink` relationship for a mailto/URL; headers in a document with `w:evenAndOddHeaders` absent but `even`
references present (render `default`; preserve the `even` reference untouched).
**Round-trip.** FL1 (parts are modelled, so edits dirty them); FL0 when untouched (PKG-05), which is the
common case for a template being filled in the body.

### SEC-04 — Header/footer inheritance and "link to previous"
**Priority:** core · **Effort:** M

**Behaviour.**
- Resolution for a given section and page parity:
  1. If the page is the first page of the section and the section has `w:titlePg`, use the section's `first`
     reference.
  2. Determine parity: if `w:evenAndOddHeaders` is set in `settings.xml`, even pages use the `even`
     reference, odd pages the `default` reference. **Without that flag, every page except the first uses
     `default`**, even on even pages.
  3. If the chosen reference does not exist on this section, walk **backwards** to the previous section and
     repeat, using that section's corresponding-`w:type` reference. This is "link to previous" — Word stores it
     as the *absence* of a reference, not as a flag.
- The UI state for a header ("same as previous" on/off) is therefore **derived** from reference presence, and
  turning it on means *removing* the `w:headerReference`, not copying content. Turning it off means
  *adding* a `w:headerReference` to a **new part** containing a copy of the inherited content, exactly as Word
  does, so that editing it does not change the previous section.
- `w:titlePg` on a section is what enables a distinct first page; without it the `first` reference is dead
  content (preserve it; do not prune).
- The inherited reference must be resolved per story type independently: a section may inherit a `default`
  header but declare its own `default` footer.
- `w:pgNumType` (`w:fmt`, `w:start`, `w:chapStyle`, `w:chapSep`) is also inheritable-in-effect through the
  PAGE/NUMPAGES fields; `w:start` on a section restarts page numbering, and `w:fmt` changes its format
  (`decimal`, `upperRoman`, `lowerRoman`, `upperLetter`, `lowerLetter`, `ordinal`, `cardinalText`,
  `russianLower`, `russianUpper`, `chineseCounting`, …). SEC-05 owns the field side.
- Document-level default header/footer: a document whose *first* section has no reference has no header at
  all (Word shows an empty header). Do not synthesise one unless the user edits it.

**OOXML.** `w:headerReference`/`w:footerReference` (presence/absence), `w:titlePg`,
`w:settings/w:evenAndOddHeaders`, `w:pgNumType`.
**Edge cases.** A section with `titlePg` and no `first` reference but a previous section that has one (inherit
it); `evenAndOddHeaders` toggled on a document that only has `default` references (nothing changes visually —
correct); a section between two others that has a `first` reference and whose neighbours do not (does not
affect them); the first section inheriting from "nothing" (empty); a document with 20 sections each with a
shared header part (editing once must re-render all — the dependency graph must be per-part, not per-section).

### SEC-05 — Page numbering, page fields and section page counts
**Priority:** important · **Effort:** M

**Behaviour.**
- `PAGE`, `NUMPAGES`, `SECTIONPAGES`, `SECTION`, `PAGEREF` fields (SC-05) in headers/footers compute against
  the **section-aware page numbering**: a section with `w:pgNumType w:start="1"` restarts the PAGE counter,
  and `w:fmt` determines the rendered form.
- `NUMPAGES` counts the whole document; `SECTIONPAGES` counts pages in the current section.
- The chapter-numbered page format (`w:chapStyle` + `w:chapSep`, e.g. `2-14`) uses
  `STYLEREF <style> \* MERGEFORMAT` or `w:chapStyle` pointing at a heading level — layout supplies the chapter
  number, this feature supplies the composition.
- Because our page numbers come from our own layout (spec 02) and Word's come from its layout, the values can
  differ. Policy: on export we **write the cached field result from our layout** and set
  `w:settings/w:updateFields` to `true` only when the user has asked for Word to own pagination again.
  Otherwise Word shows our cached result until it repaginates. Both directions are documented in EXD-02; the
  honest note is that if our layout and Word's disagree, the number the user saw is the number in the file
  until Word recalculates.
- `w:pgNumType` is per-section and participates in SEC-02's "per-section, not inherited except where noted"
  rule: absent `w:pgNumType` on a section means numbering **continues** from the previous section (this one
  *does* inherit in effect through the counter, unlike page size).

**OOXML.** `w:pgNumType` (`w:fmt`, `w:start`, `w:chapStyle`, `w:chapSep`), `w:fldSimple`, `w:fldChar`,
`w:instrText`, `w:pgNum`.
**Edge cases.** A section restarting numbering at a value while an earlier section used a different `w:fmt`
(independent); `w:start="0"` (legal); a `PAGE` field in a header inherited from section 1 while section 3
restarts numbering (the field renders per page, so section 3's header shows restarted numbers — correct);
a `PAGEREF` to a bookmark on a page whose numbering format changed (the cached result is stale until layout).

---

## 7. Notes, comments and tracked revisions

### ANN-01 — Footnotes and endnotes
**Priority:** important · **Effort:** L

**Behaviour.**
- `word/footnotes.xml` and `word/endnotes.xml` are separate parts, each with a root (`w:footnotes` /
  `w:endnotes`) containing `w:footnote`/`w:endnote` elements with `w:id` and `w:type`.
- **`w:type` values and their reserved ids**: `separator` (id `-1`), `continuationSeparator` (id `0`),
  `continuationNotice` (id `1`), and `normal` (everything else, ids from `1` up — Word starts real notes at
  id 2 when a continuation notice exists). These special notes are **required** in many documents and must
  round-trip even though they render only as horizontal rules. A document missing its separators is legal but
  Word may add them.
- The document references a note from inline content: `w:r/w:footnoteReference w:id="N"` (with
  `w:rStyle w:val="FootnoteReference"` and `w:vertAlign w:val="superscript"` conventionally — the style
  provides the formatting, and we must not hard-code the format, because the style may be redefined).
- `w:footnoteRef` appears inside the note's first paragraph to mark where the reference mark goes.
- Each note is a **story** (MOD-03) and may contain anything: tables, images, content controls, even nested
  footnotes (illegal in Word, preserved).
- Whole-note operations: `insertFootnote`, `deleteFootnote` (removes the reference **and** the note; leaving
  an orphan note is legal and preserved, but the command must not create one), `getFootnotes`,
  `reindexFootnotes` (the `w:id`s are not necessarily sequential in the document order — the rendered number
  comes from document order and the numbering settings, not from `w:id`).
- A note part that does not exist and is needed (a document with no footnotes) is created lazily with the
  mandatory separator entries in the correct order.
- `w:footnoteReference` inside a deleted run (`w:del`) is a deleted note reference; inside `w:ins`, an inserted
  one (ANN-04).

**OOXML.** `w:footnotes`, `w:footnote` (`w:id`, `w:type`), `w:footnoteRef`, `w:footnoteReference`,
`w:endnotes`/`w:endnote`/`w:endnoteRef`/`w:endnoteReference`, `w:separator`, `w:continuationSeparator`,
`w:continuationNotice`.
**Edge cases.** Two notes with the same `w:id` (illegal — keep both, resolve references to the first, warn);
a note referenced twice (illegal but seen — preserve); a footnote in a footnote (preserve); a footnote
reference in a header (illegal — preserve and do not render); a note with `w:type="normal"` and id `-1`
(collides with the separator — preserve, treat as normal, warn); endnotes with `w:endnotePr/w:pos`
(`sectEnd` vs `docEnd`) determining whether they collect per section or at the end of the document.

### ANN-02 — Note numbering and placement settings
**Priority:** important · **Effort:** M

**Behaviour.**
- Numbering is configured in **two** places that must be merged, document settings first, section override
  second: `w:settings/w:footnotePr` (document default) and `w:sectPr/w:footnotePr` (per section). Same for
  endnotes. Children: `w:pos` (`pageBottom`|`beneathText`|`sectEnd`|`docEnd`), `w:numFmt`
  (same value set as list numbering, including `russianLower`/`russianUpper`), `w:numStart`, `w:numRestart`
  (`continuous`|`eachSect`|`eachPage`), and `w:numFmt`/`w:numStart`/`w:numRestart` per `w:footnote` /
  `w:endnote` overrides inside `w:footnotePr`.
- The rendered note number comes from document order within the restart scope, not from `w:id` — the same
  rule as NUM-03, and the same trap.
- `w:pos` affects which story's layout the note body belongs to (page bottom vs beneath text vs section end vs
  document end) — layout (spec 02) acts on it; the model owns the value and its inheritance.
- Changing `w:numRestart` or `w:numFmt` is a settings edit that dirties `settings.xml` (or `document.xml` for
  a section-level one) and nothing else.

**OOXML.** `w:footnotePr`, `w:endnotePr`, `w:pos`, `w:numFmt`, `w:numStart`, `w:numRestart`.
**Edge cases.** A section-level `w:footnotePr` that only sets `w:numRestart` and inherits the rest (merge,
do not replace the whole object); `w:numStart` on a restart scope that has no notes (no-op); a document whose
notes would be numbered `russianLower` while the `FootnoteText` style's `w:rFonts` lacks a Cyrillic face
(render with the fallback; the mismatch is the user's).

### ANN-03 — Comments: classic and threaded
**Priority:** core · **Effort:** L

**Behaviour.**
- `word/comments.xml`: `w:comments` → `w:comment` with `w:id`, `w:author`, `w:initials`, `w:date`
  (ISO 8601, `xsd:dateTime`), and block content. Every comment part begins with the two reserved comments
  (`w:id="-1"` with `w:annotationRef` for the "Comment" separator, `w:id="0"` for the "Comment"
  continuation separator) — preserve them; they are not user comments and must never appear in a UI list.
- Range markup in the main story: `w:commentRangeStart w:id="N"` … `w:commentRangeEnd w:id="N"`, plus a run
  carrying `w:commentReference w:id="N"` (usually with `w:rStyle w:val="CommentReference"`). The reference run
  is normally placed **at** the range end but may be elsewhere and may be missing in malformed documents.
- Ranges may be nested, may span paragraphs, table cells, and even sections. Like bookmarks, they are range
  markup with a per-story index; unbalanced markers are preserved, reported, and excluded from the UI list
  rather than "repaired".
- A comment with a range but no reference (or vice versa) is preserved; the reference is what anchors it in
  the UI.
- Comment ids are a single space shared with `w:commentRangeStart/End`, and must not collide with footnote
  ids or revision ids in practice (Word keeps them separate but third-party producers do not always).
- Comment body editing marks `word/comments.xml` dirty; adding/removing a comment also dirties
  `document.xml` (range markers) and the modern comment parts (below).
- `word/commentsExtended.xml`, `word/commentsIds.xml`, `word/people.xml` — the Word 2013+ "modern comments"
  machinery, which is what makes replies and resolved-state work:
  - `commentsExtended`: `w15:commentEx` with `w15:paraId` (the `w14:paraId` of the comment's last paragraph),
    `w15:paraIdParent` (the parent comment's `paraId` when it is a reply), `w15:done="1"` (resolved).
    The **`paraId` is the join key**, which is why MOD-09 forbids rewriting `paraId`s.
  - `commentsIds`: `w16cid:commentId` with `w16cid:paraId` and `w16cid:durableId` — a stable id that survives
    edits to the comment text.
  - `people`: `w15:person` with `w15:author` and `w15:presenceInfo` (deprecated but present in older files).
  - All three must be created lazily, kept consistent with `comments.xml` on every comment operation, and
    carried through untouched when the document has them and we do not touch comments (FL0).
- Reply threads are derived from `paraIdParent`; a reply whose parent is missing becomes a top-level comment
  (do not delete it).

**OOXML.** `w:comments`, `w:comment`, `w:commentRangeStart/End`, `w:commentReference`, `w:annotationRef`,
`w15:commentEx` (`w15:paraId`, `w15:paraIdParent`, `w15:done`), `w16cid:commentId`, `w15:person`,
`w16:durableId`.
**Edge cases.** A comment whose range end precedes its start (preserve, exclude from UI, warn); a nested
comment range; a comment on a deleted run (the range markers are inside `w:del` — the comment survives the
revision but its anchor moves, see ANN-04); a document using only the classic `comments.xml` and opened in a
Word that expects extended parts (we add them only when the user creates a comment, matching Word 2016+
behaviour); an author name that is an empty string; `w:date` in a non-UTC offset (preserve the literal string,
normalise only for display).

### ANN-04 — Tracked revisions: model and accept/reject
**Priority:** important · **Effort:** XL

**Behaviour.**
- Revision markup is **wrapper** markup around otherwise-normal content, and the model must expose both views:
  the raw tree (what we serialise) and the visibility view (which revisions are accepted/rejected/visible).
  The visibility view is **derived state and is never serialised** — this is the single most important rule
  here, because writing an "accepted" view back destroys the reviewer's changes.
- Run-level: `w:ins` and `w:del` wrap runs. Inside `w:del`, text lives in `w:delText`, not `w:t` — a `w:t`
  inside a `w:del` is invalid and Word repairs the file. Converting between the two on insert/delete inside a
  revision is mandatory.
- Paragraph-level: `w:ins`/`w:del` may wrap a whole `w:p` (paragraph insertion/deletion). A deleted paragraph
  additionally carries `w:pPr/w:rPr/w:del` to mark its paragraph mark as deleted (this is what makes it merge
  with the next paragraph when accepted).
- Moves: `w:moveFrom`/`w:moveTo` wrap runs; `w:moveFromRangeStart`/`w:moveFromRangeEnd` and
  `w:moveToRangeStart`/`w:moveToRangeEnd` mark the ranges with `w:id` and `w:name`. Accepting a move = keeping
  the `w:moveTo` content and accepting the `w:moveFrom` deletion. Must round-trip as a move, not be flattened
  into a delete + insert (that changes Word's "moved" review semantics).
- Property changes: `w:rPrChange` (contains the **original** `w:rPr` in a child `w:rPr`), `w:pPrChange`
  (original `w:pPr`), `w:tblPrChange`, `w:tblGridChange`, `w:trPrChange`, `w:tcPrChange`, `w:sectPrChange`,
  `w:numberingChange` (`w:original`, `w:val`). The "original" child is the *previous* state; the change is
  displaying the new state plus an audit trail. Accepting = removing the `*Change` element; rejecting =
  restoring the inner element's content. **The inner element's own content is what you restore; the outer
  element's content is the current state** — inverting this is a classic and catastrophic bug.
- Table revisions: `w:trPr/w:ins` and `w:trPr/w:del` (row insert/delete), `w:cellIns`, `w:cellDel`,
  `w:cellMerge` (`w:vMerge`, `w:vAlign`, `w:w`) in `w:tcPr` for column changes.
- Range markup revisions: `w:customXmlInsRangeStart/End`, `w:customXmlDelRangeStart/End`,
  `w:moveFromRangeStart/End`, `w:moveToRangeStart/End`, and `w:commentRangeStart/End` inside revisions.
- Every revision element carries `w:id` (unique within the part), `w:author`, `w:date`, and optionally
  `w16du:durableId`. Ids must be allocated without collision and preserved for existing revisions — undo/redo
  must restore the same id.
- Operations: `acceptRevision(id)`, `rejectRevision(id)`, `acceptAll(authorFilter?)`, `rejectAll(...)`,
  `getRevisions(filter)` with `{ type, author, dateRange, story }`. Accept/reject are real, lossy operations
  (FL3 by definition) and must be undoable as a single transaction.
- Author identity for new revisions comes from config (`author`, `initials`), never from `settings.xml` and
  never from a default of "docier" unless the host chose it.
- **`w:rsid` vs revisions**: rsids are not revisions. Never treat an rsid difference as a change.

**OOXML.** `w:ins`, `w:del`, `w:delText`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart/End`,
`w:moveToRangeStart/End`, `w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:tblGridChange`, `w:trPrChange`,
`w:tcPrChange`, `w:sectPrChange`, `w:numberingChange`, `w:cellIns`, `w:cellDel`, `w:cellMerge`,
`w:customXmlInsRangeStart/End`, `w:customXmlDelRangeStart/End`, `w16du:durableId`.
**Edge cases.** `w:del` inside `w:ins` (deleting text that was itself inserted — accepting both removes it;
rejecting both restores nothing; the state machine needs a nesting stack, not a boolean); a `w:del` whose
`w:delText` is empty (a deleted paragraph mark only); a revision whose `w:author` is empty; a `w:moveTo`
without a matching `w:moveFrom` (preserve, treat as an insert, warn); conflicting revisions from two authors
on the same run; accepting a revision that would leave a table cell empty (insert the empty paragraph, MOD-07);
rejecting an inserted section break (the `w:sectPr` must be removed and the following section's properties
re-homed, SEC-02); `w:trPr/w:del` on the only row of a table (rejecting yields a table with no rows —
illegal; the command must insert an empty row or refuse with a clear error).
**Round-trip.** FL1 when revisions are untouched (the wrappers are modelled); FL3 and warned on accept/reject.

### ANN-05 — Annotation preservation policy
**Priority:** core · **Effort:** S

**Behaviour.** One place that states what happens to every annotation class on every export, so the behaviour
is consistent rather than emergent:

| Class | DOCX export | PDF export | Plain text | HTML |
|---|---|---|---|---|
| Comments | preserved (FL1/FL0) | invisible by default; optional margin notes / endnote-style list | omitted unless opted in | `<aside data-comment-author>` when opted in |
| Footnotes/endnotes | preserved | real PDF notes at page bottom (text) or rendered inline as superscript + list | appended as `[n] text` after the paragraph | `<sup><a href="#fn1">` + `<ol>` |
| Revisions | preserved as revisions; never auto-accepted | rendered per the current visibility state, with an optional "markup" view | rendered per visibility state | `<ins>`/`<del>` elements |
| Bookmarks | preserved | named destinations (EXP-11) | omitted | `id` anchors |
| Content controls | preserved | rendered as their content; optional form-field appearance | content only | `<span data-sdt-tag>` when opted in |
| Fields | preserved with cached results | evaluated results only | evaluated results only | evaluated results only |

- A single config object (`annotationPolicy`) drives all of it, and the parser/exporters emit events when they
  drop anything (R2's reporting half).

**OOXML.** All of the above.
**Edge cases.** A comment whose range covers a revision that is hidden (the comment anchor must follow the
revision's visibility); a footnote inside deleted text (the note is not rendered, but is preserved).

---

## 8. Structured content: content controls, fields, custom XML

### SC-01 — Content controls (`w:sdt`)
**Priority:** core · **Effort:** XL

**Behaviour.**
- `w:sdt` appears at four levels, with the same shape and different content: **block** (in `w:body`, `w:tc`,
  `w:hdr`…), **run/inline** (inside a `w:p`), **row** (wrapping `w:tr`), and **cell** (wrapping `w:tc`).
  All four must be modelled; the row and cell levels are the ones most often missed and they appear in
  real contract templates.
- Structure: `w:sdtPr` (properties), `w:sdtEndPr` (run properties applied to the end marker), `w:sdtContent`
  (the content). Property order inside `w:sdtPr` is a **schema sequence** and Word repairs the file if it is
  wrong: `w:rPr`, `w:alias`, `w:tag`, `w:id`, `w:lock`, `w:placeholder`, `w:temporary`, `w:showingPlcHdr`,
  `w:dataBinding`, `w:label`, `w:tabIndex`, then exactly one **type** element
  (`w:richText`, `w:text`, `w:picture`, `w:equation`, `w:comboBox`, `w:dropDownList`, `w:date`,
  `w:docPartObj`, `w:docPartList`, `w:group`, `w:bibliography`, `w:citation`, `w:checkbox` (w14),
  `w:repeatingSection` (w15), `w:repeatingSectionItem` (w15), `w:color`, `w:entityPicker`), then `w15:appearance`.
  New properties are inserted at their schema position (MOD-01), never appended.
- `w:sdtContent` must contain exactly one block (block-level sdt) or an arbitrary run sequence (inline sdt).
  Removing the last block from a block-level sdt must insert an empty paragraph, not leave `w:sdtContent`
  empty — Word repairs empty `w:sdtContent`.
- **Placeholder and showing-plc-hdr.** A sdt is in one of three states: **placeholder** (`w:showingPlcHdr`
  set and the content is the placeholder text), **empty** (content present but no runs), and **filled**.
  The placeholder text is sourced from `w:placeholder/w:docPart` referring to a building block in the
  glossary part (SC-06) — resolving it requires reading `word/glossary/document.xml`. If the glossary entry is
  missing, the placeholder text is unavailable and the sdt renders empty; preserve the reference.
  Typing into a `showingPlcHdr` sdt must **replace** the placeholder and clear `w:showingPlcHdr`, which is
  exactly Word's behaviour.
- `w:temporary` means the control is removed on edit (Word converts it to plain content once touched) —
  preserve and honour on edit.
- sdt nesting: a `w:richText` sdt may contain another sdt; a `w:group` sdt exists only to group. Depth is
  unbounded in the schema but practically shallow; the model supports arbitrary depth and the traversal API
  flattens correctly (MOD-03).
- `w:id` on `w:sdtPr` is a numeric id unique within the part; allocate without collision (including against
  opaque nodes, MOD-02), preserve existing values, never renumber.
- Structural edits inside `w:sdtContent` are normal edits; edits that would move content **across** a content
  control boundary must be refused or must split the control, never silently merge.
- Where a sdt coexists with a revision wrapper (`w:ins/w:sdt` or `w:sdt/w:ins`), both nestings are legal and
  preserved.

**OOXML.** `w:sdt`, `w:sdtPr`, `w:sdtContent`, `w:sdtEndPr`, and the property/type elements above.
**Edge cases.** A `w:sdt` with no `w:sdtContent` (illegal — preserve, expose as empty); a sdt with two type
elements (illegal — keep both, use the first, warn); a row-level sdt whose content is not a `w:tr`;
a block-level sdt inside a table cell; a sdt containing a `w:sectPr`-bearing paragraph (legal and nasty — the
section break is inside the control); an inline sdt whose content spans a hyperlink boundary; a sdt that
contains nothing but a bookmark; a sdt in a header that references a `w:dataBinding` to a custom XML part
(SC-03).

### SC-02 — Content control semantics: `w:tag`, `w:alias`, `w:id`, `w:lock`
**Priority:** core · **Effort:** M

**Behaviour.** These four attributes are the entire programmatic surface of a content control, and the
template product depends on them.
- **`w:tag`** (`w:val`, max 64 chars) — the machine-readable key. It is the contract between a template author
  and the host application: `{{employee_name}}`, `contract_start_date`. Uniqueness is **not** enforced by
  Word and must not be enforced by us — repeating sections legitimately repeat tags. The API exposes
  `getContentControlsByTag(tag)` returning **all** matches in document order, and `fillByTag(tag, value)`
  which fills **every** match unless a caller passes an index. Silent single-match behaviour is a data-loss
  bug in a repeating contract.
- **`w:alias`** (`w:val`) — the human-readable label shown in Word's UI. Localised, may be duplicated, may be
  absent. Never used for lookup.
- **`w:id`** — numeric, unique within its part; may be absent (Word tolerates it, and third-party producers
  omit it). A control without an id gets one assigned **in memory** on first access for addressing purposes
  only; do not dirty the part just to add it. Assignment must be deterministic (R6) so that two runs of the
  same operation produce the same file.
- **`w:lock`** (`w:val`) — four values, all of which must be enforced by the editor's commands:
  - `unlocked` (or absent) — content and control are editable.
  - `sdtLocked` — the control cannot be deleted or its properties changed, but its **content is editable**.
  - `contentLocked` — the content cannot be edited, but the control can be deleted or its properties changed.
  - `sdtContentLocked` — neither.
  Enforcement lives in the command layer (spec 03); this feature exposes `getLockState(path)` and the
  resolved "can I edit / can I delete" answers, and the model must **preserve** a lock it cannot honour rather
  than dropping it.
- A locked control inherits nothing: lock state is per-sdt, never inherited by nested sdts (each carries its
  own). A nested unlocked sdt inside an `sdtContentLocked` parent is not editable in practice, because the
  parent's content cannot be edited — the resolution must therefore walk **ancestors**, and that is the rule:
  a control is editable only if it and every ancestor is editable.
- `w:sdtPr/w:rPr` applies to the content when no more specific run formatting exists (a cascade layer, MOD-06);
  `w:sdtEndPr` applies only to the end marker — do not confuse them.
- `w:label` (a fixed label above the control) and `w:tabIndex` (form tab order) are preserved and exposed for
  form-style UI; `w15:appearance` (`boundingBox` | `tags` | `hidden`) is a display hint we honour in our own
  rendering and never write unless the user changes it.

**OOXML.** `w:sdtPr/w:tag`, `w:alias`, `w:id`, `w:lock`, `w:label`, `w:tabIndex`, `w:rPr`, `w:sdtEndPr`,
`w15:appearance`, `w:showingPlcHdr`, `w:temporary`.
**Edge cases.** Two sdts with the same `w:id` (illegal — preserve, address by path, warn); a tag longer than
64 characters (preserve; refuse to create); a tag containing whitespace (legal, preserve; discourage in the
authoring UI); a nested chain of five locks (resolution walks them all); a tag on a `w:group` sdt used as a
namespace prefix by the template author (`contract.clause1`) — support dots and slashes in tags, they are
free-form strings.

### SC-03 — Data binding and custom XML parts
**Priority:** important · **Effort:** L

**Behaviour.**
- `w:dataBinding` (`w:prefixMappings`, `w:xpath`, `w:storeItemID`) plus `w:storeItemID` — binds a content
  control's content to a node in a **CustomXML part** (`word/customXml/itemN.xml`).
- The parts: `word/customXml/itemN.xml` (arbitrary XML), `word/customXml/itemPropsN.xml`
  (`ds:datastoreItem` with `ds:itemID` — the GUID referenced by `w:storeItemID` — and `ds:schemaRefs` with
  `ds:schemaRef ds:uri`), and `word/customXml/_rels/itemN.xml.rels` (typically to itemProps).
  The `ds:itemID` is the join key between a data binding and a part; **it is a GUID and must never be
  regenerated for an existing part**.
- `w:xpath` is an XPath over the item's XML with the prefix mappings declared in `w:prefixMappings`
  (a namespace-declaration string, e.g. `xmlns:ns0='urn:contract'`). The xpath may be absolute
  (`/ns0:root/ns0:name`) or relative; support the subset Word writes: element steps, `[n]` predicates, and
  attribute steps.
- Semantics: a bound control **displays** the value of the bound node. Editing it writes back to the custom
  XML part, dirtying `word/customXml/itemN.xml`. A binding whose xpath does not resolve leaves the control
  showing its last content (Word does not clear it) — the model must not "helpfully" empty it.
- `w:storeItemID` may reference a part that does not exist (producers strip custom XML aggressively, e.g.
  some servers). Preserve the binding verbatim and report the dangling reference; do not remove the binding.
- Full API: `getCustomXmlParts()`, `readCustomXml(partOrItemId)` (returns a document tree), `writeCustomXml`,
  `addCustomXmlPart`, `removeCustomXmlPart`, `resolveBinding(sdtPath)`, `bindControl(sdtPath, xpath, itemId)`.
- **Custom XML markup** (the deprecated "custom XML tags" feature, `w:customXml` as an inline/block wrapper
  with `w:uri` and `w:element`) is a different thing from the CustomXML data store, and both are called
  "custom XML". `w:customXml` wrappers are **opaque-preserved** (MOD-02) and never conflated with bindings.
  Losing the distinction deletes a customer's markup on save.
- `w:customXml` wrapper ranges (`w:customXmlInsRangeStart/End`, `w:customXmlDelRangeStart/End`) participate in
  ANN-04.

**OOXML.** `w:dataBinding`, `w:storeItemID`, `w:prefixMappings`, `w:xpath`, `ds:datastoreItem`,
`ds:itemID`, `ds:schemaRefs`, `w:customXml` (`w:uri`, `w:element`), `word/customXml/*`.
**Edge cases.** Two parts with the same `ds:itemID` (illegal — first wins, warn); an xpath with a function
call (`count()`, `position()`) — Word writes only simple paths, but preserve and, if unsupported, leave the
control unbound and report rather than corrupting the part; a binding on a `w:repeatingSection` (Word binds
the section item, not the control — the resolution must walk to the repeating section's item);
a custom XML part with no itemProps (legal in some producers — preserve).
**Round-trip.** FL1 for parts we touch through a binding edit; FL0 otherwise (this is why the "open and save
without editing" case must not rewrite custom XML).

### SC-04 — Typed content controls
**Priority:** important · **Effort:** XL

**Behaviour.** Each type has its own `w:sdtPr` payload and its own editing/validation semantics. All are
preserved exactly whether or not we implement their behaviour; the behaviours below are what "support" means.

| Type | Payload | Behaviour |
|---|---|---|
| `w:text` | `w:multiLine`, `w15:autoFit` (via appearance) | Single-line by default. Enter must not create a paragraph unless `w:multiLine` is set; a single-line control's content is plain text only (no runs with pictures). |
| `w:richText` | — | Full inline content, including images and nested sdts. |
| `w:dropDownList` / `w:comboBox` | `w:listItem`* (`w:displayText`, `w:value`) | The **displayed** text is `w:displayText`; the **stored** value is what the host reads (`w:value`), and the content of `w:sdtContent` is the display text. `fillByValue` must write the display text into the content and the value into the model, so both agree. A `w:value` with no matching item (producer edits) is preserved. |
| `w:date` | `w:date` (`w:fullDate` ISO 8601, `w:dateFormat`, `w:lid`, `w:storeMappedDataAs`, `w:calendar`) | The displayed text may be any localised form (`dd.MM.yyyy` for RO/RU); the machine value is `w:fullDate`. Setting a date must write **both**, and must honour `w:dateFormat` for the display string. `w:storeMappedDataAs` (`dateTime`|`date`|`text`) decides the serialisation when the value is exported to a data store. |
| `w:checkbox` | `w14:checkbox` with `w14:checked`, `w14:checkedState`, `w14:uncheckedState` (each `w14:val` a hex code point + `w14:font`) | The checked state is the **displayed character** in `w:sdtContent` (usually a Wingdings/`MS Gothic` glyph, `☒`/`☐` or `F0FE`/`F06F`). Toggling must flip `w14:checked` **and** replace the content run's `w:sym`/`w:t` — one without the other produces a control that renders wrong. |
| `w:picture` | — | Content is a `w:drawing`; emptied by deleting the drawing. Several sdts of this type with the same tag make an image gallery. |
| `w15:repeatingSection` | contains `w15:repeatingSectionItem`* | The unit of repetition. `repeatingSectionItem` wraps a block; duplicating an item copies its subtree, **regenerates all descendant `w:sdt` ids, `w14:paraId`s, and `w:sdtPr` ids**, and keeps tags unchanged (that is the contract — one tag, many values). Item insertion position, minimum/maximum counts and `w15:repeatingSectionItem` deletion (`allowDelete`) are honoured by the command layer; `w15:repeatingSection` may carry `w15:repeatingSectionItem` with a *single* item. Duplicating must also fix bookmarks, comment ranges and footnote references in the copy (new ids, no collision) — otherwise a duplicated clause shares a bookmark with its original and `PAGEREF` breaks. |
| `w:docPartObj` | `w:docPartGallery`, `w:docPartCategory`, `w:docPartUnique` | A building-block gallery slot; content comes from the glossary. Preserve; support insertion from the glossary (SC-06). |
| `w:group` | — | Grouping only; no editing semantics. |
| `w:equation` | — | Content is OMML; preserve (MED-04). |
| `w:citation` / `w:bibliography` | `w:bibliography`, `w:citation` sources | Preserve verbatim; no behaviour. |
| `w:entityPicker` | — | Preserve verbatim; no behaviour. |

- **Validation**: `w:dropDownList` values, `w:date` format strings, and `w:checkbox` states must be validated
  on write, because a value outside the allowed set produces a control Word cannot render correctly.

**OOXML.** All type elements above, plus `w15:repeatingSection`, `w15:repeatingSectionItem`, `w14:checkbox`,
`w14:checked`, `w14:checkedState`, `w14:uncheckedState`, `w:listItem`, `w:date`.
**Edge cases.** A `w:dropDownList` with two identical `w:displayText` values (legal; select by value);
a `w15:repeatingSection` with zero items (Word may refuse to open it — insert a template item on load in
memory, or refuse with a clear error rather than writing an invalid file); a repeating section inside a table
cell; a repeating section inside another repeating section (legal — the id regeneration must be recursive and
must not double-regenerate a shared subtree); `w:date` with a `w:lid` for Russian (`ru-RU`) and a format
string in that locale; a checkbox whose `w14:font` is not present in the document's fonts.

### SC-05 — Fields and field codes
**Priority:** core · **Effort:** L

**Behaviour.**
- Two encodings for the same concept, both of which must round-trip:
  - **Simple**: `w:fldSimple w:instr="PAGE \* MERGEFORMAT"` with the cached result as its **children**.
  - **Complex**: `w:fldChar w:fldCharType="begin"` … runs with `w:instrText` … `w:fldChar w:fldCharType="separate"`
    … result runs … `w:fldChar w:fldCharType="end"`. The complex form is what Word writes for anything
    non-trivial and is required for nesting.
- `w:fldChar` attributes: `w:fldCharType` (`begin`|`separate`|`end`|`n/a`), `w:fldLock` (result locked until
  explicitly updated), `w:dirty` (**update on next open** — this is how we tell Word to recalculate), and
  `w:fldCharType="n/a"`/`w:formProt` in legacy files.
- **Nesting**: a complex field's result may itself contain a field. The model builds a field tree with a
  stack; unbalanced fields (a `begin` with no `end`, which occurs in truncated files and after a bad HTML
  round-trip) are preserved as-is and reported, never rebalanced by deletion.
- Fields may span paragraphs (a `TOC` certainly does) and may span table cells. The field stack is therefore
  per **story**, not per paragraph, and the tree is attached to the story with children expressed as ranges
  over the story's content.
- **Result caching and `w:dirty`.** The result runs are *cached output*, not content to be preserved blindly:
  they are what the user sees in a viewer that does not evaluate fields. Policy:
  - Reading: the cached result is what layout renders unless a field evaluator is enabled for that field type.
  - After a command that invalidates a field (a merge value changes, a `REF` target moves, text reflows), the
    field is marked dirty in memory and its cached result is **regenerated by us** if we can evaluate it
    (SC-06 evaluates a subset), else `w:dirty="true"` is set so Word recalculates on open.
  - Exporting never leaves a field marked dirty *and* holding a stale result silently: either we update the
    result or we set `w:dirty`.
  - Unknown field codes keep their cached result untouched and never get `w:dirty` (we have no business asking
    Word to re-evaluate a field we do not understand, and doing so can change a customer's document).
- `w:fldSimple` inside `w:fldSimple` (illegal but seen) — preserve.
- `w:instrText` must keep `xml:space="preserve"`; the instruction is whitespace-sensitive in some producers.
- Fields in headers/footers (`PAGE`, `NUMPAGES`, `STYLEREF`, `FILENAME`, `TITLE`) are the common case for this
  product's letter templates.
- Fields **inside a content control's content** and inside `w:sdtContent` are legal and common (a date field in
  a `w:date` control); the two features compose.

**OOXML.** `w:fldSimple` (`w:instr`, `w:fldLock`, `w:dirty`), `w:fldChar`, `w:instrText`, `w:fldCharType`,
`w:pgNum`, `w:bookmarkStart`/`End` around `PAGEREF` targets.
**Edge cases.** A complex field with no `separate` (no cached result — legal for `IF`-style fields before first
update); a `begin`/`end` crossing a paragraph boundary; a field whose result contains a `w:bookmarkStart` (a
`TOC` result does, and it must be preserved); a field whose `w:instrText` contains a `"` escaped as `\"`
(field instructions have their own quoting rules, see SC-06); a field inside deleted text (`w:del`) — the
field is deleted, its instruction is preserved inside `w:delText`; an empty instruction.

### SC-06 — Field instruction parsing and the evaluated subset
**Priority:** important · **Effort:** L

**Behaviour.**
- Parse an instruction into `{ name, args, switches }` with correct lexical rules: switches begin with `\`
  (`\*`, `\#`, `\@`, `\h`, `\o "1-3"`, `\z`, `\u`, `\b`, `\l`, `\f`, `\s`, `\n`, `\e`, `\c`, `\p`, `\d`),
  arguments are `"`-quoted or bare tokens, and `"` inside a quoted argument is written `\"`. The grammar is
  Word's own and is not shell-like: never use a shell lexer.
- Field types we **evaluate** (produce a result from the model + layout):
  `PAGE`, `NUMPAGES`, `SECTIONPAGES`, `SECTION`, `PAGEREF` (needs a bookmark and layout), `REF`, `NOTEREF`,
  `STYLEREF`, `DATE`, `TIME`, `CREATEDATE`, `SAVEDATE`, `PRINTDATE`, `FILENAME`, `TITLE`, `SUBJECT`,
  `AUTHOR`, `KEYWORDS`, `COMMENTS`, `DOCVARIABLE`, `DOCPROPERTY`, `MERGEFIELD`, `IF`, `SEQ`, `LISTNUM`,
  `FORMTEXT`, `FORMCHECKBOX`, `HYPERLINK`, `INCLUDETEXT` (no — too dangerous; see below), `QUOTE`, `SET`,
  `TOC` (structure only; see below), `AUTONUM`, `AUTONUMLGL`, `AUTONUMOUT`, `NUMPAGES`.
- Field types we **do not evaluate** but preserve perfectly, never setting `w:dirty`: everything else,
  including `INCLUDEPICTURE`, `INCLUDETEXT`, `RD`, `ASK`, `FILLIN`, `MACROBUTTON`, `PRIVATE`, `GOTOBUTTON`,
  `SYMBOL` (we do not need to evaluate it — the character is a `w:sym`), and any unknown name.
- **Format switches** must be implemented for the types we evaluate: `\*` (`MERGEFORMAT`, `CHARFORMAT`,
  `Upper`, `Lower`, `FirstCap`, `Caps`, `Roman`, `roman`, `Alphabetic`, `alphabetic`, `Arabic`, `Ordinal`,
  `CardText`, `OrdText`, `Hex`, `MERGEFormat`), `\#` (numeric picture: `#,##0`, `0.00`, `#,##0.00;(#,##0.00)`,
  with the separators taken from `settings.xml`'s `w:decimalSymbol`/`w:listSeparator` — this matters for
  Romanian/Russian documents where the decimal separator is `,`), `\@` (date/time picture:
  `dd.MM.yyyy`, `dddd`, `MMMM`, `YYYY`, `HH:mm` — **locale-dependent**, so the locale must come from
  `w:lang` or the host config, never from the machine's default, or the exported PDF's dates change between
  a browser in Bucharest and a server in UTC), and `\* MERGEFORMAT` (preserve the first result run's
  formatting when updating a field — implementing this properly means cloning the cached result's `rPr`).
- **`TOC`** is special: it is a field whose result is a generated, `PAGEREF`-bearing, hyperlinked list. We
  evaluate its *structure* (which entries, which levels, from which styles/`w:outlineLvl`) using layout, and
  regenerate the result runs when asked. Regenerating a `TOC` is an explicitly triggered operation
  (`updateFields(['TOC'])`), never automatic, because it rewrites a large chunk of the document. `\o "1-3"`
  (levels from heading styles), `\t "Style,Level"` (custom styles), `\h` (hyperlinks), `\z` (hide tab leader
  in web view), `\u` (use outline levels), `\n` (no page numbers), `\b "Bookmark"` (limit to a bookmark),
  `\f` (a `TOC` for a custom "TOC" style series) are all handled or explicitly reported as unsupported.
- `IF`, `SEQ`, `SET`, `QUOTE` evaluation is needed for the honest subset; `IF` comparison operators
  (`=`, `<>`, `>`, `<`, `>=`, `<=`) and `AND`/`OR`/`NOT` with Word's own type coercion (a numeric-looking
  string compares numerically) — document the coercion rules, because subtle differences from Word produce
  different contract text, which is a legal risk, not a bug.
- **Unresolved evaluation is never a silent empty string.** A field we cannot evaluate keeps its cached result
  and reports `fieldNotEvaluated`.

**OOXML.** `w:instrText`, `w:fldSimple/@w:instr`, `w:fldChar/@w:dirty`, `w:settings/w:updateFields`,
`w:settings/w:decimalSymbol`, `w:settings/w:listSeparator`, `w:lang`.
**Edge cases.** A `MERGEFIELD` whose name matches no data source (render a clear placeholder, keep the
instruction); a `REF` to a bookmark that was deleted (render `Error! Reference source not found.` — Word's own
text, or an empty string; pick one and document it, and prefer keeping the cached result over inventing an
error string in a legal document); nested fields inside an `IF` result; a date picture with an unrecognised
token (render it literally, preserve); a `\#` picture with a negative-number section; a field code that is not
in English because it came from a localised Word (Word stores instructions in **English** always — a
localised field name in a document is a corruption; handle unknown names by preservation only).

### SC-07 — `altChunk`, glossary documents, OLE and math
**Priority:** later · **Effort:** M

**Behaviour.**
- **`w:altChunk`**: `w:altChunk r:id="…"` referencing `word/afchunk.mht` / `.html` / `.htm` / `.docx` (via a
  `afChunk` relationship) with `w:altChunkPr/w:matchSrc`. Semantics: the chunk is *not* part of the document
  body — Word imports and flattens it on open, and the chunk survives in the file until Word saves. Our
  policy: **preserve the chunk and the reference untouched (FL0/FL2) and never flatten implicitly**, because
  flattening requires a full HTML/DOCX import pipeline and changes the file in a way the user did not ask for.
  A `flattenAltChunks` command is offered; it imports the chunk's content into the body and removes the
  `w:altChunk` element plus its relationship (a declared FL3 operation, reported).
  An `altChunk` referencing a `.docx` is a nested package — flattening it means recursing into the whole
  pipeline, and nesting depth must be bounded.
- **Glossary / building blocks**: `word/glossary/document.xml` referenced by a `glossaryDocument`
  relationship, containing `w:docParts` → `w:docPart` (`w:docPartPr` with `w:name`, `w:category`,
  `w:docPartType`, `w:behavior`, `w:description`, `w:guid`, and `w:docPartBody` with block content). Needed
  for: resolving `w:placeholder/w:docPart` (SC-01), `w:docPartObj` controls (SC-04), and template building
  blocks (spec 04). Round-trip the whole part; the glossary is a separate **story-set** with the same content
  model. `w:docPartPr/w:guid` must be preserved exactly — it is the identity of the building block.
- **OLE objects and embeddings**: `w:object` with `w:objectEmbed`/`w:objectLink`, `o:OLEObject`
  (`r:id`, `ProgID`, `ShapeID`, `ObjectID`, `DrawAspect`, `UpdateMode`), `v:shape` + `v:imagedata` preview, and
  `word/embeddings/*.bin|xlsx|docx` parts referenced by an `oleObject` relationship. Preserve the object, the
  preview image and the embedding part; never re-render the preview unless asked; never prune the embedding.
  Editing an embedded spreadsheet is out of scope.
- **Math (OMML)**: `m:oMath`/`m:oMathPara` inside runs, with `m:r`, `m:t`, `m:f` (fraction), `m:sSup`,
  `m:sSub`, `m:rad`, `m:d`, `m:nary`, `m:func`, `m:limLow`, and `m:rPr`/`w:rPr` inside `m:r`. Preserve the
  whole `m:*` namespace as opaque-but-addressable (MOD-02) and render it via a MathML/OMML renderer or as
  its linearised text in exports we cannot render richly. Listed here because "preserve" is the whole
  feature, and because a contract with a formula must not lose it.
- **`w:pict` / VML** in the body is handled by MED-04; **`w:subDoc`** and **`w:movie`** are preserved opaque.

**OOXML.** `w:altChunk`, `w:altChunkPr`, `afChunk` relationship, `w:docParts`/`w:docPart`/`w:docPartPr`/
`w:docPartBody`, `w:object`, `o:OLEObject`, `v:shape`, `v:imagedata`, `m:oMath`, `m:oMathPara`, `w:subDoc`,
`w:movie`.
**Edge cases.** An `altChunk` whose part is missing (preserve the element, warn); an `.mht` chunk with
images referenced by `cid:` (the MIME part must be preserved as a whole — do not try to split it);
a glossary part with a `w:docPart` whose `w:guid` is missing (assign in memory only);
an OLE object with no preview image (legal; the file will show an icon);
OMML inside a content control inside a table cell.

---

## 9. Media and embedded content

### MED-01 — Image ingestion, format policy and de-duplication
**Priority:** core · **Effort:** M

**Behaviour.**
- Accepted on insert: PNG, JPEG, GIF (first frame stored; animation preserved but PDF export uses frame 1),
  BMP, TIFF (single and multi-page — the first page, but the part is preserved whole), EMF, WMF, SVG
  (with a generated PNG fallback, see MED-02), WEBP/HEIC/AVIF (transcoded: Word does not render webp/heic in
  a `.docx` reliably, and PDF cannot embed them — see EXP-06).
- **Format detection is by magic bytes, never by filename or MIME type** provided by the caller, because a
  `.png` that is really a JPEG is common in files produced by other tools, and writing the wrong content type
  in `[Content_Types].xml` yields a red X in Word.
- No forced re-encoding of PNG/JPEG/GIF/BMP/TIFF/EMF/WMF. Inserting a 3 MB JPEG re-encodes it to a worse 2.5 MB
  JPEG, which is a visible quality loss for no benefit.
- **EXIF**: preserve the JPEG bytes as-is (EXIF included). Apply the EXIF **orientation tag** when computing
  the display size, and record the applied rotation in the drawing transform so Word (which also honours EXIF
  orientation inconsistently) renders the same as we do. Do not strip EXIF on insert; offer a
  `pruneMetadata` command.
- **DPI**: `a:blip`/`pic:spPr` sizing is in EMU, so the intrinsic pixel size only matters for the default
  display size (`pixels / dpi * 914400`). Use the image's declared DPI, defaulting to 96, and **write** the
  chosen DPI into the part for PNG/JPEG when we generate it, so Word computes the same size.
- De-duplication by SHA-256 of the **original part bytes** (PKG-06), with a matching content type. Copy/paste
  within the document reuses the part. Two visually identical but byte-different images are two parts —
  hashing bytes, not pixels, is the rule, because we must never alter an image silently.
- Dimensions/Crop: `a:srcRect` (crop as fractions in 1/1000 percent) is a *view* property, not an edit; never
  flatten a crop into new pixels unless explicitly asked (flattening is lossy and irreversible).
- Alt text: `wp:docPr/@descr` (and `@title`). Preserved, exposed, editable, and used as the PDF `/Alt`
  (EXP-08). `wp:docPr/@name` is a non-unique human name; `@id` is unique within the part and must be
  allocated without collision — including against `@id`s in headers, which are a separate part/scope.

**OOXML.** `word/media/*`, `[Content_Types].xml` image defaults, `a:blip/@r:embed`, `pic:blipFill`,
`a:srcRect`, `wp:docPr`, image relationships.
**Edge cases.** A zero-byte image part; an image part referenced by two stories (one part, two
relationships — preserve the delta); a 100 MB TIFF (must not be decoded in full for sizing — read the header
only); an image with a colour profile we do not understand (preserve the bytes); an EMF whose header declares
a bounds rectangle that contradicts its content (use the declared bounds).

### MED-02 — DrawingML picture model (inline and anchored)
**Priority:** core · **Effort:** L

**Behaviour.**
- Two container elements: `wp:inline` and `wp:anchor`. Both hold `wp:extent` (`cx`, `cy` in EMU),
  `wp:effectExtent`, `wp:docPr`, `wp:cNvGraphicFramePr` (`a:graphicFrameLocks`), and
  `a:graphic/a:graphicData[@uri="http://schemas.openxmlformats.org/drawingml/2006/picture"]/pic:pic`.
- `pic:pic` holds `pic:nvPicPr` (`pic:cNvPr` with `id`/`name`/`descr`, `pic:cNvPicPr` with `a:picLocks` and
  the `a14:imgProps` extension for brightness/contrast), `pic:blipFill` (`a:blip` with `r:embed` or `r:link`,
  `a:srcRect`, `a:tile`/`a:stretch`, `a:fillRect`, and — critically — the `a14:imgLayer`/`a14:imgEffect`
  extensions carrying **artistic effects**, saturation, temperature, duotone and recolor), and `pic:spPr`
  (`a:xfrm` with `a:off`/`a:ext` and optional `a:rot`, `a:flipH`, `a:flipV`; `a:prstGeom` or `a:custGeom`;
  `a:ln`; `a:solidFill` etc.).
- **Artistic effects and image adjustments are part of the picture and must round-trip.** Dropping
  `a14:imgEffect` silently converts a stylised photo into a plain one. They are preserved as opaque-but-
  addressable nodes inside `pic:blipFill` and rendered where we can (grayscale, brightness/contrast,
  duotone are feasible; the "artistic" filters are not — render the base image and preserve the markup).
- `a:blip` extensions that must survive: `a:alphaModFix` (transparency), `a:grayscl`, `a:biLevel`,
  `a:duotone`, `a:clrChange` (chroma key), `a:lum`, `a:extLst` with `a14:useLocalDpi` (the flag that makes
  Word honour the file's DPI instead of assuming 96).
- **SVG**: Word 2016+ stores SVG as `mc:AlternateContent` with a `mc:Choice Requires="svg"` branch holding
  `asvg:svgBlip r:embed="rIdToSvg"` and a `mc:Fallback` holding a PNG `a:blip r:embed="rIdToPng"`. Both
  relationships, both parts, and the exact `Requires` value must round-trip; a document where we keep only the
  fallback loses the vector data permanently on the next save by Word.
- The picture's **nested shape text**: a `pic:pic` may sit in a `wps:wsp` (a DrawingML textbox containing an
  image) — MED-04.
- `w:drawing` may also be a chart (`c:chart r:id`), a SmartArt diagram (`dgm:*` with a `dgm:relIds` pointing
  at `word/diagrams/*.xml` — a whole parallel part family), a group (`wpg:wgp`), or a shape. All are preserved
  structurally; charts and diagrams are declared preserve-only (MED-04).
- Group shapes (`wpg:wgp` with `wpg:grpSpPr`/`a:xfrm` and child `wps:wsp`/`pic:pic`) — the child transform is
  relative to the group, and the group's `a:chOff`/`a:chExt` define the child coordinate space. Preserve and
  pass to layout; do not attempt to normalise.

**OOXML.** `w:drawing`, `wp:inline`, `wp:anchor`, `wp:extent`, `wp:docPr`, `wp:cNvGraphicFramePr`,
`a:graphic`, `a:graphicData`, `pic:pic`, `pic:nvPicPr`, `pic:blipFill`, `pic:spPr`, `a:blip`, `a:srcRect`,
`a:xfrm`, `a:prstGeom`, `a:custGeom`, `a14:*` extensions, `asvg:svgBlip`, `mc:AlternateContent`,
`wpg:wgp`, `dgm:relIds`.
**Edge cases.** A picture inside a picture (a `wps:wsp` in a group with a `pic:pic` child); an `a:blip` with
both `r:embed` and `r:link` (illegal — prefer embed, preserve both); a picture with `a:ext` all zeros
(use the intrinsic size); a rotated and cropped and flipped picture (all three compose — get the order right
in layout: crop, then flip, then rotate); a `pic:cNvPr/@id` colliding with a `wp:docPr/@id` (different id
spaces, but Word is inconsistent — allocate across both).

### MED-03 — Legacy VML, shapes, textboxes, charts and OLE
**Priority:** important · **Effort:** M

**Behaviour.**
- **VML** (`w:pict` with `v:shape`, `v:rect`, `v:group`, `v:line`, `v:oval`, `v:imagedata`, `v:fill`,
  `v:stroke`, `v:textbox`, `o:OLEObject`): the pre-2007 drawing format, still emitted by Word for some
  constructs (text boxes in headers, `w:object` previews, `w:sym` rendering, legacy shapes) and present in
  vast numbers of real files.
- **Policy: VML is round-tripped as opaque-but-addressable markup (MOD-02), never converted to DrawingML and
  never dropped.** Converting VML to DrawingML is a lossy transformation that changes a customer's file for
  no user-visible benefit; the two formats coexist in Word's model and Word writes both.
- The exceptions where VML has model-level meaning and must be typed:
  - `v:imagedata/@r:id` → an image part (so MED-01's de-duplication and pruning see it, and so an image
    inserted into a VML text box is not pruned as an orphan).
  - `v:shape/@style` (`width:…;height:…;position:absolute;margin-left:…`) → the shape's geometry, parsed for
    layout. The `style` string's units (`pt`, `in`, `cm`, `px`) must be handled; `mso-position-horizontal-relative`
    and the vertical counterpart define the anchor.
  - `v:textbox` → its content is a **story** (a mini document with block content). Text in a VML textbox is
    real text that must be laid out, found by search, and exported. Treating it as opaque loses content.
  - `v:shape/@o:spid`/`ShapeID` links an `o:OLEObject` to its preview shape (SC-07).
- **DrawingML shapes and textboxes** (`wps:wsp` with `wps:txbx/w:txbxContent`, `wps:bodyPr`, `wps:spPr`):
  the textbox content is a story, exactly like VML's, and must be modelled. The shape's
  `a:prstGeom`/`a:custGeom` (`a:pathLst`, `a:path` with `a:moveTo`/`a:lnTo`/`a:cubicBezTo`/`a:close`),
  `a:ln` (line), `a:solidFill`/`a:gradFill`/`a:blipFill`/`a:pattFill` (fill) are preserved and passed to
  layout. `wps:bodyPr` (`anchor`, `anchorCtr`, `wrap`, `numCol`, `vert`, `rot`, `spcFirstLastPara`,
  `a:normAutofit`/`a:spAutoFit`/`a:noAutofit`) drives text layout inside the box.
- **WordArt** (`wps:wsp` with `wps:bodyPr` and a text-effect `a:effectLst`) preserved; rendered as plain
  styled text where the effect is unsupported.
- **Charts** (`w:drawing` → `c:chart` → `word/charts/chartN.xml`, plus `word/charts/_rels/chartN.xml.rels`,
  `word/charts/colorsN.xml`, `word/charts/styleN.xml`, and embedded `word/embeddings/*.xlsx` workbooks):
  **preserve-only**, including the chart part, its style/colour parts, and its embedded workbook. Render as a
  cached picture if the chart part contains one, else as a placeholder box with the chart title. Editing chart
  data is out of scope.
- **SmartArt / diagrams** (`word/diagrams/data1.xml`, `layout1.xml`, `quickStyle1.xml`, `colors1.xml`,
  `drawing1.xml`, referenced from `dgm:relIds`): preserve-only, same policy.

**OOXML.** `w:pict`, `v:*`, `o:*`, `wps:*`, `wpg:*`, `w:txbxContent`, `wps:txbx`, `a:custGeom`, `c:chart`,
`dgm:relIds`, and their `.rels`.
**Edge cases.** A VML textbox inside a header inside a table; a VML shape with `style` in `px` (96 dpi
conversion); two shapes sharing an `o:spid`; a chart part whose embedded workbook is missing (the chart still
renders from its cache — preserve); a `wps:wsp` with a `w:txbxContent` containing a table (a table in a
textbox in a header — legal and it happens).

---

## 10. Document properties

### PRO-01 — Core properties (`docProps/core.xml`)
**Priority:** core · **Effort:** S

**Behaviour.**
- Typed accessors for the Dublin Core + OPC set: `dc:title`, `dc:subject`, `dc:creator`,
  `cp:lastModifiedBy`, `cp:revision`, `cp:keywords`, `dc:description`, `cp:category`, `cp:contentStatus`,
  `dcterms:created` (`xsi:type="dcterms:W3CDTF"`), `dcterms:modified`, `cp:lastPrinted`, `dc:language`,
  `dc:identifier`, `dc:source`, `dc:rights`, `cp:version`.
- **Date handling is strict.** W3CDTF is ISO 8601 with a `Z` or an offset; the value must be preserved as
  written (including a non-UTC offset) and only normalised for comparison. `dcterms:modified` is **only**
  updated when the config opts in (`touchModified: true`) — silently stamping the current time on every save
  destroys determinism (R6) and makes "has this file changed?" unanswerable for the customer's document
  management system.
- `dc:creator` and `cp:lastModifiedBy` are set from config on document creation and on save-if-configured;
  we never overwrite them with our own product name.
- `cp:revision` is a **string** in OOXML (`<cp:revision>3</cp:revision>`) even though it is a number. Preserve
  as a string; increment only on an explicit save command, and only when configured.
- The part is optional: a document may have no `docProps/core.xml`. Reading yields empty values; writing
  creates the part and adds the relationship and `Override` (PKG-03/04) on the first write.
- Namespace declarations on the root (`cp:`, `dc:`, `dcterms:`, `dcmitype:`, `xsi:`) must be preserved and
  extended, not replaced (MOD-01). `xsi:type="dcterms:W3CDTF"` on the two dates is **required by the schema**
  and must always be written when we create them.
- Unknown children of `cp:coreProperties` are preserved (there are third-party extensions in the wild).

**OOXML.** `docProps/core.xml`, the `core-properties` relationship from `_rels/.rels`.
**Edge cases.** A `dcterms:created` with no `xsi:type`; a reversed or absurd date; a date with a fractional
second; a title with XML-illegal characters (encoded, not stripped); a document with two `dc:title` elements
(illegal — keep the first, preserve both, warn).

### PRO-02 — Extended and custom properties (`app.xml`, `custom.xml`)
**Priority:** important · **Effort:** M

**Behaviour.**
- `docProps/app.xml` (`Properties` in the extended-properties namespace): `Application`, `AppVersion`,
  `Company`, `Manager`, `Pages`, `Words`, `Characters`, `CharactersWithSpaces`, `Lines`, `Paragraphs`,
  `Template`, `TotalTime`, `DocSecurity`, `ScaleCrop`, `LinksUpToDate`, `SharedDoc`, `HyperlinksChanged`,
  `HyperlinkBase`, `HeadingPairs`, `TitlesOfParts`, `HLinks`, `DigSig`.
- **`HeadingPairs`/`TitlesOfParts` are a paired vector**: `HeadingPairs` is a flat vector
  (`<vt:vector size="4" baseType="variant">` with `vt:lpstr` name + `vt:i4` count pairs), and
  `TitlesOfParts` is a flat list of the corresponding names in order. Rewriting one without the other
  produces a document with a corrupted navigation pane. Update both together, or neither — the safe default
  is **neither** (regenerate only on an explicit `updateAppProperties` command).
- Regenerable values (`Words`, `Characters`, `Pages`, `Paragraphs`, `Lines`) come from a layout pass and our
  own text projection. Policy: **preserved by default**, regenerated only when asked, because
  `docProps/app.xml` is Word's cache and a wrong value is worse than a stale one. Word rewrites it on its own
  next save anyway.
- `Application`/`AppVersion`: never claim to be Word. Write our own product name/version, or preserve the
  original value untouched — never a lie that misleads a document-management system's provenance checks.
  `DocSecurity` values (`0`, `1`, `2`, `4`, `8`) are preserved.
- `docProps/custom.xml`: `Properties` with `property` elements carrying `fmtid="{D5CDD505-…}"` (constant),
  `pid` (>= 2, unique, monotonically increasing), and a `vt:*` value child (`vt:lpwstr`, `vt:i4`, `vt:r8`,
  `vt:bool`, `vt:filetime`, `vt:cy`, `vt:date`). Typed API: `getCustomProperty(name)` returning a JS value
  with its `vt` type, and `setCustomProperty(name, value, vtType?)`. `pid` allocation takes `max(pid)+1` and
  never reuses a removed `pid`.
- `vt:filetime` values are W3CDTF (same rules as PRO-01). `vt:bool` is `true`/`false`; `vt:i4` is a 32-bit
  signed integer.
- Property **names are case-insensitive for lookup** (Windows convention) and must be stored as given; two
  properties differing only in case are preserved and the first wins on lookup, with a warning — this is a
  real hazard for a template product's data mapping.

**OOXML.** `docProps/app.xml`, `docProps/custom.xml`, `extended-properties` and `custom-properties`
relationships, `vt:*` value types, `fmtid`, `pid`.
**Edge cases.** A `pid` collision (fix on write, do not silently drop); a `vt:vector` custom property (legal —
preserve, expose read-only); a custom property with no `vt` child; a `TitlesOfParts` whose size disagrees with
`HeadingPairs` (preserve, warn); a document with no `app.xml` (create on first write, `Override` included).

---

## 11. Parse / serialise pipeline

### SER-01 — Parse pipeline and error recovery
**Priority:** core · **Effort:** XL

**Behaviour.** Fixed stages, each individually testable and observable:

1. **Container** — PKG-01. Failure → typed error, no partial model.
2. **Content types + relationships** — PKG-03, PKG-04. A missing `[Content_Types].xml` is fatal; a missing
   `.rels` for one part is a warning (that part's relationships are empty).
3. **Part classification** — every part is assigned a role by relationship type (not by filename): main
   document, styles, numbering, settings, theme, fontTable, webSettings, header/footer (with its section
   references), footnotes, endnotes, comments (+ extended/ids/people), customXml, glossary, media, charts,
   diagrams, embeddings, printerSettings, afChunk, or **unknown → passthrough**. Unknown parts are retained
   and reported, never pruned (this is what keeps a `.docx` with a vendor extension intact).
4. **XML parse** — namespace-aware, order-preserving, prefix-preserving (MOD-01). Use a streaming/SAX-style
   parser that builds our tree directly; never `DOMParser` in the core (it is a DOM dependency, R5, and it
   normalises namespaces and drops prefix information we need to preserve). Entity expansion must be bounded
   (billion-laughs), external entities disabled, and DTDs ignored.
5. **Model build** — typed handlers populate the model; anything without a handler becomes an opaque node
   (MOD-02) with its raw subtree attached.
6. **Cross-part linking** — resolve `numId`s, style references, header references per section, bookmark
   targets for `REF`/`PAGEREF`, content-control data bindings, `paraId`s for comment threads, and image
   relationships. Broken links are **deferred**, not fatal: record them in a diagnostic list and re-resolve
   lazily on access, so that a document with one dangling `numId` still opens.
7. **Diagnostics** — one structured report: per-stage timings, part sizes, unknown markup counts, unknown
   parts, broken references, invalid invariants (MOD-09 `validate()`), and every FL3 loss. Emitted once at the
   end of `load()` and available on demand.

- **Error recovery policy**: never throw away a document that Word would open. A document that fails an
  invariant is loaded with a warning; a document that fails XML well-formedness in a *non-essential* part
  (a header, a comment part, the glossary) loads with that part **preserved as opaque bytes** (FL0) and the
  rest usable — because that is exactly the file the user must be able to save back unharmed.
  Only an unreadable container, a missing main part, or a main-document XML error is fatal — and even then,
  the container is retained so that a `repair` mode could be offered later.
- **Fatal error type**: `DocierParseError` with a stable `code`, a human message, the part name, and a byte
  offset where known.

**OOXML.** All parts.
**Edge cases.** A part with an XML declaration claiming a different encoding than the actual bytes (trust the
BOM/declaration order per the XML spec, warn on mismatch); a part with a truncated final element (report the
offset, treat the part as opaque); an entity reference to an undeclared entity (fatal per XML, but tolerate by
preserving the raw text and warning — Word is lenient here and we must not be stricter than Word);
a 40 MB `document.xml` (SER-02); duplicate part names in the zip.

### SER-02 — Streaming versus full parse, and the memory budget
**Priority:** important · **Effort:** XL

**Behaviour.**
- **Default: full parse of the main document, lazy parse of everything else.** Parts other than
  `document.xml` are inflated and parsed on first access (`await doc.styles`, `await doc.header(1)`), behind a
  promise-returning accessor. This is what makes opening a 20 MB contract with 40 embedded screenshots fast:
  we never touch `word/media/*`.
- **Large main documents: chunked, incremental parse.** Above a configurable threshold
  (`parse.lazyBlockThresholdBytes`, default 8 MB of `document.xml`), the body is parsed **block by block**
  into the tree, with paragraph-level handlers running as blocks are completed. The model is exposed as a
  fully-populated tree once parsing finishes; the incrementality is about memory peaks and about the UI
  painting the first page without waiting for the whole file. Concretely: the parser must not require the
  whole inflated XML string to be resident — it consumes the decompressed stream and releases consumed
  input.
- **Streaming zip read**: inflate entries as streams, not by materialising the whole uncompressed archive.
  Peak memory target: O(main document model) + O(largest single part), not O(archive).
- **Streaming write** (optional, for the server path): write parts to a `ReadableStream`/`WritableStream` so a
  200 MB document can be produced without holding the output in memory. The browser `Blob` sink is the
  default because `Blob` parts can be produced lazily by the platform.
- **Decompression must be off the main thread where the host allows it**: the pipeline takes a `Worker`-like
  injectable (`config.transport.decompress`) so a browser host can pass a worker-backed inflater and keep the
  UI responsive. Core must work with a synchronous fallback (Node, tests).
- **Explicit budget reporting**: `load()` reports peak and current retained bytes per part class, so a host
  can show "this document uses 340 MB" and offer to degrade.
- **Never silently truncate.** If a configured memory ceiling would be exceeded, fail with a typed
  `DOCUMENT_TOO_LARGE` error listing the largest parts — a partially loaded document that the user can save
  is a data-loss machine.

**OOXML.** `word/document.xml` primarily; media and `word/glossary/document.xml` are the other large parts.
**Edge cases.** A `document.xml` that is a single 30 MB paragraph (chunking must still make progress — chunk
by byte budget, not by element count); a document whose media parts are larger than the document (lazy media
is the win — never decode them to measure them); a zip entry that is stored uncompressed (no inflate step —
the stream passes through); a part that must be re-read after being released (re-inflate from the retained
original bytes).

### SER-03 — Serialise pipeline and dirty tracking
**Priority:** core · **Effort:** XL

**Behaviour.** The mirror of SER-01, with the passthrough rule (PKG-05, R3) as its core:

1. **Dirty set** — the transaction (MOD-09) records which parts changed. Plus explicit dirtiness for parts
   changed outside a transaction (property writes, settings writes). Nothing else is touched.
2. **Dependency closure** — a dirtied part may force others: editing a style dirties `styles.xml` only;
   removing a style's last reference dirties `document.xml`; adding a header reference dirties `document.xml`
   **and** creates a header part **and** its `.rels` **and** `[Content_Types].xml` **and** the document's
   `.rels`. This closure is computed declaratively from a dependency table, not ad hoc, so no path forgets an
   edge.
3. **Serialise each dirty part** — model → XML text, with: preserved prefixes and prefixes' declarations,
   preserved attribute order, schema-order element insertion, `xml:space="preserve"` emission (MOD-01),
   entity escaping minimal (`&`, `<`, `>`, `"` in attributes only where required — do **not** escape `'` or
   non-ASCII, and do not emit numeric character references for characters that can be literal UTF-8),
   no pretty-printing changes to a part we did not modify, and indentation matching the original where the
   part is touched (critical: Word writes parts without indentation; adding pretty-print indentation to
   `document.xml` inflates the file and creates a giant diff).
4. **Membership reconciliation** — parts to add (PKG-06 naming), parts to remove, `[Content_Types].xml`
   (PKG-03), and every `.rels` (PKG-04) updated consistently. Removal of a part must remove its `Override`,
   its `.rels`, and any relationship pointing at it.
5. **Container write** — PKG-02.

- **Invariant: a clean part is never parsed and never re-serialised.** Even for a dirty part, we remember the
  original bytes so a "revert" is possible.
- **Serialisation must be independent of load order.** Because the model keeps explicit order, the output for
  a given model is deterministic regardless of how the model was built (R6).
- **`save()` never mutates the model** — the dirty set is cleared after a successful write, and the newly
  written bytes become the new clean baseline (so a second save with no edits is byte-identical to the first,
  which is FL1's cycle-stability requirement).

**OOXML.** All parts.
**Edge cases.** A part serialised to bytes identical to its original (still counts as clean for the *next*
save — set the baseline to the new bytes, which happen to equal the old); a part that must be created but
whose relationship cannot be added (fail loudly — a part with no relationship is a Word repair prompt);
a dirty part in a `w:settings` subtree that we do not model (serialise from the tree, not from a template);
an edit that dirties a part we decided to leave as opaque (the opaque subtree must still serialise correctly —
opaque nodes are part of the tree and can be the *only* content of a dirty part).

### SER-04 — Schema conformance, strict/transitional, and validation
**Priority:** important · **Effort:** L

**Behaviour.**
- **Two conformance namespaces**: Transitional
  (`http://schemas.openxmlformats.org/wordprocessingml/2006/main`) and Strict
  (`http://purl.oclc.org/ooxml/wordprocessingml/main`), plus the analogous pairs for DrawingML, the package
  namespaces, and the relationship types. Word writes Transitional by default; Strict is used in some
  government/archival workflows.
- **Internal canonical form is Transitional.** On load, a Strict document is converted
  (namespace URIs and relationship type URIs remapped) and the source conformance is remembered so the same
  document can be saved back as Strict. Conversion must be complete for the parts we model; for parts we do
  not model, remapping must still be applied textually or the part must be passed through unchanged with a
  warning (a Strict part emitted into a Transitional package mixed-namespace is legal per the spec but
  confusing and can be rejected).
- **Output conformance is configurable** (`ooxml.conformance: 'transitional' | 'strict' | 'preserve'`,
  default `'preserve'`), and `preserve` means: emit what came in.
- **Child-order validation is mandatory on write** for the four elements whose order Word enforces most
  strictly: `w:sdtPr`, `w:pPr`, `w:rPr`, `w:sectPr`, plus `w:tblPr`/`w:trPr`/`w:tcPr`. Implement as a
  schema-order table used by insertion (MOD-01) *and* asserted by `validate()` — the two must share the same
  table or they will disagree.
- **`validate()`** runs on demand and in tests:
  - every `.rels` target exists; no duplicate `Id` per source part;
  - every `w:pStyle`/`w:rStyle`/`w:tblStyle` resolves; every `w:numId` resolves; every header reference
    resolves;
  - bookmark ranges balanced; comment ranges balanced; field begin/separate/end balanced per story;
  - table grid invariant (MOD-07); content-control content non-empty (SC-01); revision ids unique;
  - child order valid for the enforced elements; `mc:Ignorable` names all declared prefixes.
  Output is a structured finding list with severity, never a boolean.
- **Relationship type and content type completeness**: on write, assert every relationship type we emit is
  one Word knows, and every part has a content type. These two checks alone prevent most "Word found
  unreadable content" prompts.
- **A validation corpus test** (INT-01) opens every output in Word itself and asserts no repair dialog. This
  is the only true acceptance test for this feature and is a manual/CI-with-Word step, not a unit test.

**OOXML.** All namespaces and relationship types; the enforced child-order elements.
**Edge cases.** A document with a mix of Strict and Transitional namespaces (illegal — normalise);
a relationship type in a namespace we do not know (preserve, do not remap); `mc:Ignorable` listing a prefix
that is not declared (fix on write by declaring or removing the prefix from the list, and warn);
a Strict document containing an element that does not exist in Strict (preserve, warn).

---

## 12. DOCX export

### EXD-01 — Export API and sinks
**Priority:** core · **Effort:** M

**Behaviour.**
- A single command family with a uniform shape, framework-agnostic (R5):
  - `save()` → the host's default sink.
  - `exportDocx(options)` → `Blob` (browser default), `ArrayBuffer`, `Uint8Array`, `Buffer` (Node), or a
    `WritableStream` (streaming, SER-02).
  - `exportPdf(options)`, `exportHtml`, `exportMarkdown`, `exportPlainText` — each with its own options type
    (EXP-*, EXO-*).
  - `print(options)` — EXP-03.
- Every export is a **command** (the library-wide rule) and emits the standard event pair:
  `exportStarted { format, options }` and `exportCompleted { format, bytes, durationMs, fidelity, losses[] }`
  (or `exportFailed { format, error }`). The `losses` array is the machine-readable form of the loss ledger
  (EXD-02) — a host can show "12 comments were not included in the PDF".
- Options common to every export: `pageRange` (EXP-02), `annotations` (ANN-05 policy), `metadata`
  (include/omit/overwrite), `deterministic` (default `true`), `signal` (an `AbortSignal` — every export must
  be cancellable, and a cancelled export must leave no partial state and no leaked object URLs).
- Exports run off the main thread when the host provides a worker transport (SER-02), with automatic
  fallback; the API is identical either way (all exports return promises).
- No export may require the DOM. `Blob` creation is behind a sink adapter; in Node the sink is a Buffer.
- Object URLs created for downloads are owned by the caller, never leaked by the library; the library offers
  `downloadExport(result, filename)` as an optional convenience that creates **and revokes** the URL.

**OOXML.** n/a (API surface).
**Edge cases.** An export requested while a previous one is in flight (queue, or reject with `EXPORT_IN_FLIGHT`
— pick one and document; queue is friendlier for print); an export of a document with no loaded layout
(PDF/HTML need layout; DOCX does not — the API must not require layout for DOCX export, which is what makes
"save without an editor mounted" work); cancellation mid-serialisation (must abort cleanly).
**Cross-ref.** Command/event naming conventions live in spec 03; this feature only fixes the export-specific
shape.

### EXD-02 — Fidelity contract and loss ledger
**Priority:** core · **Effort:** M

**Behaviour.** The written, testable statement of what "faithful round-trip" means for each part. It is
published as documentation *and* enforced by tests (INT-01/02).

- **FL0 (never touched, byte-identical)** — the default for every part the user did not edit:
  `word/media/*`, `word/embeddings/*`, `word/charts/*`, `word/diagrams/*`, `word/fonts/*`,
  `word/customXml/*`, `word/glossary/document.xml`, `word/comments*.xml`, `word/people.xml`,
  `word/footnotes.xml`, `word/endnotes.xml`, `word/header*.xml`/`footer*.xml`, `word/printerSettings/*.bin`,
  `word/afchunk.mht`, `word/vbaProject.bin`, `word/activeX/*`, unknown/vendor parts, and any of the above
  `.rels` files.
- **FL1 (semantically equivalent, cycle-stable)** — for parts we touch: `word/document.xml`,
  `word/styles.xml`, `word/numbering.xml`, `word/settings.xml`, `docProps/*.xml`, and the `.rels` and
  `[Content_Types].xml` files when the part set changed. Cycle stability is tested over **three** cycles, not
  one.
- **FL2 (structurally preserved)** — any part containing opaque markup (MOD-02): the marked-up subtrees are
  emitted verbatim, everything around them is FL1.
- **FL3 (declared loss)** — the complete list, each of which must appear in `losses[]` when it occurs:
  1. Digital signatures (`_xmlsignatures/*`) after any edit (PKG-07).
  2. Any part dropped by `pruneUnusedParts`.
  3. `altChunk` flattening (SC-07).
  4. Accept/reject of revisions (ANN-04).
  5. Image transcoding on insert of an unsupported format (MED-01) — the original bytes are gone from the
     document.
  6. Font substitution at render time (it is a *render* loss, not a file loss — must not be reported as a
     file loss, and must be reported in PDF export's `losses`).
  7. Anything the config explicitly disables (`annotations.comments = 'omit'`).
  8. Non-UTF-8 part encodings we transcoded.
- **Rule: a loss that is not in this list is a bug.** Any code path that drops an element, an attribute, a
  string, or a part must either add itself to the ledger or not exist. Enforcement: the serialiser counts
  nodes in the model and elements in the output for every dirty part and asserts equality (minus nodes the
  transaction explicitly removed) — a cheap, mechanical check that catches accidental drops.

**OOXML.** n/a (contractual).
**Edge cases.** A part that is dirty but whose only change is a no-op (still counts as FL1, not FL0 — do not
claim byte identity we cannot prove); a document that fails to open in Word for reasons unrelated to us (the
corpus must record the baseline behaviour of Word for that file, so we do not chase a pre-existing bug).

### EXD-03 — Word repair safety and compatibility mode
**Priority:** core · **Effort:** L

**Behaviour.**
- The acceptance criterion is behavioural, not structural: **Word opens our output with no repair prompt, and
  every subsequent Word save/open cycle is also clean.** Structural correctness is necessary but not
  sufficient (Word is lenient about some things and strict about others in ways the schema does not express).
- The specific fixes that prevent most repair prompts, all of which are validated by SER-04 and by the corpus:
  - relationship `Id` uniqueness per source part and no dangling `r:id` (PKG-04);
  - content type present for every part (PKG-03);
  - `w:tblGrid` present with the right number of `gridCol` (MOD-07);
  - `w:vMerge` continuation cells carrying `w:tcPr`/`w:tcW` and a paragraph (MOD-07);
  - `w:delText` (never `w:t`) inside `w:del` (ANN-04);
  - `w:sdtPr` child order (SC-01);
  - `w:sectPr` placement: body-level only as the last child of `w:body` (SEC-02);
  - every `.rels` target present, and every part that has a `.rels` present (PKG-04);
  - `w:numId`/`w:abstractNumId` resolvable (NUM-02);
  - `w:pStyle`/`w:rStyle` resolvable (STY-01);
  - no empty `w:sdtContent` (SC-01);
  - `w:instrText` with `xml:space="preserve"` (SC-05).
- **Compatibility mode**: `w:compat/w:compatSetting[@w:name="compatibilityMode"]` is preserved exactly
  (SET-01). When the config asks for a specific mode (`'word2007'` = 12, `'word2010'` = 14, `'word2013plus'` =
  15), we set it and ensure the elements we emit are legal in that mode — notably, `w14`/`w15`/`w16`
  extension elements must not be *newly introduced* into a document whose mode is 12, and if they exist we
  keep them (Word tolerates them under `mc:Ignorable`) rather than stripping them.
- **Downlevel safety**: never emit an element or attribute whose namespace prefix is not declared on the root
  and not listed in `mc:Ignorable` (MOD-01/SER-06). This one rule prevents the most common "Word 2010 chokes
  on a 2016 file" class of failures.
- **`w:settings/w:updateFields`** is set when we have deliberately left stale field results (SC-05) so Word
  agrees with what the user saw.
- **Empty-part policy**: a story part (a header) containing a single empty paragraph is written as such;
  never write a part with an empty root.

**OOXML.** `w:compat`, `w:compatSetting`, `w:settings/w:updateFields`, plus every structural invariant listed.
**Edge cases.** A document authored in Word 2003 XML (`wordml` namespace — *not* OOXML; reject with a clear
message); a document whose compat mode is 12 but which contains `w15` elements (preserve, do not downgrade);
a document with `w:compat` children in an order we rewrite (preserve order; some `w:compat` children are
order-sensitive in older Word builds).
**Test dependency.** INT-01's Word corpus is the only real verification.

---

## 13. PDF export

### EXP-01 — PDF engine architecture and the client/server split
**Priority:** core · **Effort:** XL

**Behaviour.** The decision this spec fixes, with the honest tradeoffs stated:

- **We write PDF ourselves, from our own layout.** Spec 02 produces a paginated, positioned layout result
  (glyph runs with positions, line boxes, page boxes, floats, table cell rectangles). The PDF writer consumes
  that plus the model's resources (fonts, images, annotations) and emits PDF. This is the only option that is
  deterministic (R6), works offline in a browser, needs no server, and can honour `annotations` policy,
  tagged structure, and PDF/A — because it is the only option where we control every byte.
- **Rejected alternatives, with reasons** (so this is not re-litigated):
  - *LibreOffice headless conversion*: the best third-party fidelity, but requires a server, is slow
    (seconds per document), is not deterministic across versions, and cannot be shipped in the browser. Kept
    as **EXP-12's server path**, not the primary.
  - *HTML + `window.print()`*: browser pagination is not Word pagination — different line breaking, no
    section breaks, no per-section headers/footers, no widow/orphan control matching Word, and no way to
    select page ranges or set metadata. It is a preview convenience at best.
  - *Chromium print-to-PDF via a headless browser*: server-side, non-deterministic across versions, and
    inherits all of the HTML pagination problems.
  - *pdf-lib / jsPDF as the writer*: they are PDF *assemblers* (good at objects and streams) but have no
    layout engine, no font subsetting beyond the basics, no PDF/A or tagging support, and put us at their
    mercy for determinism. We may borrow a low-level object/stream writer if it earns its place, but the
    document structure, fonts, tagging and archival layers are ours.
  - *MuPDF/PDFium/Poppler compiled to WASM*: useful for **rendering** and for verification, and worth
    shipping as a dev/test dependency (INT-01 can rasterise our PDF and compare against our own render), but
    not as a producer.
- **Module shape**: `@docier/pdf` is a separate entry point, dynamically importable, with its own weight
  budget. Core never imports it. The PDF writer is pure TypeScript + `Uint8Array`; it requires no DOM and
  runs in Node and in a worker.
- **What we accept as a consequence**: our layout is not Word's layout. Edge cases (complex script shaping,
  East Asian line breaking, `w:compat` mode differences, floating table positioning, hyphenation) can produce
  different page breaks from Word. This must be (a) measured by the corpus (INT-01) with a per-document
  difference report, (b) stated in the docs, and (c) mitigated by EXP-12 for customers who need archival
  fidelity. Silently shipping a PDF that differs from what Word would print, without saying so, is the
  failure mode this point exists to prevent.
- **Progress and cancellation** are mandatory: a 500-page PDF export must report progress and honour
  `AbortSignal` (EXD-01).

**OOXML.** n/a (consumes the model and spec 02's layout result).
**Edge cases.** A document whose layout has not been computed (compute it on demand, or reject with
`LAYOUT_REQUIRED` — computing on demand is the friendlier default); a document larger than the browser's
memory (streaming writer, SER-02); an export from a worker with no fonts available (font loading is an
injected resource provider, EXP-04).

### EXP-02 — Page ranges and selection
**Priority:** core · **Effort:** M

**Behaviour.**
- Grammar, matching Word's print dialog: `"1-3,5,8-"` — single pages, inclusive ranges, open-ended ranges,
  any order, duplicates ignored, whitespace tolerated. Word also supports `"1-10"` with the odd/even filter
  and a reverse range (`"10-1"` prints in reverse order) — support all three.
- Range semantics operate on **logical document pages** (the pages our layout produced), not on layout
  indices, and they must respect section page numbering when the user asks for "pages 1-3" — Word's print
  dialog uses physical page positions, not the `PAGE` field values, and this must be documented because the
  two differ in a document with a restarted section.
- Out-of-range pages are a validation error (`INVALID_PAGE_RANGE`) listing the valid maximum — never silently
  clamped, because a silently short PDF is a legal-document hazard.
- The exported PDF's **page numbering inside the file** follows the selection: page 1 of the output is the
  first selected page. An option `preservePageLabels` writes PDF page labels (`/PageLabels` number tree)
  carrying the original document's numbering, so a reader shows "Section 2, page 14" — this is what makes a
  ranged export still navigable, and it pairs with EXP-11's outline.
- Fields in headers/footers showing `PAGE`/`NUMPAGES` are evaluated **for the selected range** or for the
  whole document, configurable (`fieldScope: 'selection' | 'document'`). Word's own behaviour is
  document-scoped; default to that, and document the alternative because "print pages 5-8" often means "show
  the numbers those pages would have".
- Printing to PDF from a range must still lay out the whole document (pagination is global), so a range
  export costs the same as a full export plus a filter. Say so in the progress reporting.

**OOXML.** `w:pgNumType` (for page labels), `w:sectPr` (page size per section — a ranged export may span
sections with different page sizes, which PDF supports natively).
**Edge cases.** A range entirely outside the document; a range crossing a section with a different page size
or orientation (legal, produces mixed-size PDF pages — correct, and worth a warning for print shops);
`"odd"`/`"even"` filters combined with a range; a document of 0 pages (impossible — never emit an empty PDF,
fail instead).

### EXP-03 — Print and print preview
**Priority:** core · **Effort:** L

**Behaviour.**
- **Print preview is our own renderer**, not the browser's print dialog: preview must show real Word-faithful
  pagination, per-section headers and footers, first/even/odd variants, page numbers as they will print, and
  the effect of the page range and the annotations policy. This is a rendering concern shared with spec 02,
  but the *controls* (range, copies, which annotation classes, grayscale, print-background) belong to this
  feature.
- **Printing** has two paths, and the honest statement of their limits is part of the spec:
  1. **PDF path (default, recommended).** Generate the PDF (EXP-01) and print it. Gives exact pagination,
     exact page ranges, exact headers/footers, and PDF/A-consistent output. Implementation in a browser: an
     `<iframe>`/`<embed>` of the blob URL plus `print()` — with the caveat that the browser's dialog may not
     let us preselect the range, so we offer our own range selection *and* generate a pre-ranged PDF file.
     This is the only path that can print "pages 5-8" correctly.
  2. **CSS path (fast preview).** Render our pages as positioned DOM with `@page` rules (`size`, `margin`,
     `@page :first`, `@page :left`/`:right` for mirrored margins and even/odd headers) and call
     `window.print()`. Honest limits, stated in the docs and in a runtime event: the browser re-rasterises and
     may re-break lines, `counter(page)`/`counter(pages)` cannot reproduce DOCX `PAGE`/`NUMPAGES` field
     formatting (we must substitute the literal values from our layout before printing), `@page` margin boxes
     are not universally supported, and arbitrary page ranges are not programmable. Use it for "print this
     invoice quickly", not for archival output.
- Config: `print({ mode: 'pdf' | 'css', pageRange, copies, annotations, background: boolean,
  grayscale: boolean, quality })`. Grayscale and background suppression are applied by the PDF writer (a
  colour transform on fills/text and a skip of `w:background`/shading) — the CSS path cannot do either
  reliably, which is another reason the PDF path is the default.
- **Print date fields**: `PRINTDATE` is evaluated at print time and never cached into the document
  (SC-06). This is a real, user-visible behaviour: printing twice on different days yields different text,
  which is correct and must not be "fixed" by caching.
- Duplex and paper source come from `word/printerSettings/*.bin` (SEC-01) when present, and are a hint only —
  the browser cannot honour them, and the server path partly can.

**OOXML.** `w:pgSz`, `w:pgMar`, `w:pgBorders`, `w:cols`, `w:headerReference`/`w:footerReference`,
`w:settings/w:printTwoOnOne`, `w:settings/w:displayBackgroundShape`, `w:printerSettings`.
**Edge cases.** A section with a page size the printer does not have (scale or crop per config, and warn);
`w:pgBorders` with `w:offsetFrom="page"` (borders must be placed relative to the paper, not the text, and
print-shop trimming differs); two pages per sheet (`w:printTwoOnOne` in settings — honoured in the PDF path,
ignored with a warning in the CSS path); printing a document with a landscape section in the middle of a
portrait document (each PDF page carries its own size — correct, and it must be exercised in tests).

### EXP-04 — Font embedding, subsetting and text extraction
**Priority:** core · **Effort:** XL

**Behaviour.**
- **Every font used in the PDF is embedded.** No exceptions, no "standard 14" reliance: a PDF that references
  Helvetica without embedding it renders differently on every machine, and PDF/A forbids it outright
  (EXP-09).
- **Encoding.** Use **Identity-H** with a CIDFontType2 (TrueType) or CIDFontType0 (CFF/OpenType CFF)
  descendant, always, with a `ToUnicode` CMap. This is not a preference: **WinAnsiEncoding cannot represent
  U+0218–U+021B (`Ș ș Ț ț`, Romanian) or Cyrillic at all** — a document with either in WinAnsi comes out
  as a row of wrong glyphs or question marks. Identity-H with an embedded font is the only correct choice for
  this product's languages.
- **Subsetting** is required for size (a full Cyrillic+Latin font is 300–800 KB; a subset is 10–40 KB):
  - TrueType (`glyf`/`loca`): keep the glyphs used plus `.notdef`, composite glyph components, and the
    glyphs reachable from them; rebuild `loca`, `glyf`, `hmtx`, `cmap` (a minimal format 4 or 12 subtable is
    acceptable but not required when Identity-H is used), and keep `head`, `hhea`, `maxp`, `OS/2`, `name`,
    `post` (3.0 is acceptable). `glyf` offsets must be 4-byte aligned in the new table or some readers reject
    the font.
  - CFF/OpenType: CFF subsetting requires rewriting the CharStrings index, the charset, and the private
    dict, and re-indexing — this is the hard case; if a correct, tested CFF subsetter is not available, embed
    the **full** CFF font (larger but correct) and record it in the export report. Do not ship a CFF subsetter
    that has not been verified against a rasterised comparison.
  - The glyph set must include everything **we generate**: list bullets, list numbers (including
    `russianLower` Cyrillic letters), page numbers in headers/footers, and any `w:sym` characters rendered
    from a symbol font. A subset that omits the bullet glyph produces empty bullets — a classic and
    embarrassing bug.
- **`ToUnicode`** must be emitted for every embedded font, mapping every used CID to its Unicode code point,
  including `w:sym` private-use characters (map them to the private-use code point so that copy/paste is at
  least faithful) and generated content. Without it, text extraction and search return garbage, and PDF/A
  validation fails.
- **Widths**: emit `/W` (`/DW` of 1000) with real advance widths per CID from the font's `hmtx` (or CFF
  widths), so that a reader can do text selection and reflow correctly.
- **Font descriptor flags**: `/Flags` (symbolic vs non-symbolic, serif, fixed-pitch, italic), `/FontBBox`
  from `head`, `/ItalicAngle`, `/Ascent`/`/Descent`/`/CapHeight` from `hhea`/`OS/2`, `/StemV` and
  `/MissingWidth`.
- **Licence bits** (`OS/2.fsType`, THM-02): `0x0002` (restricted) → do not embed; the export **fails**
  with a clear error naming the font rather than producing a non-compliant or infringing PDF. `0x0200` (no
  subsetting) → embed the full font. `0x0100` (preview & print only) → embed, but flag it in the report.
- **Fonts loaded by the host**: the PDF module takes a `FontProvider` (bytes for a family/style, or a
  pre-parsed font) — core ships none. The default provider for the browser path can load from
  `document.fonts`/URLs; the server path from a configured directory. Font files must be cached across
  exports (parsing a 700 KB font per paragraph is the obvious performance trap).
- **`w:embedSystemFonts`/`w:saveSubsetFonts`** in settings (SET-01) inform whether we *write* embedded fonts
  back into DOCX export (THM-02) — that is a separate, opt-in path and is off by default.

**OOXML.** `w:rFonts`, `word/fontTable.xml`, `word/fonts/*.odttf`, `w:settings/w:saveSubsetFonts`,
`w:settings/w:embedSystemFonts`.
**Edge cases.** A font with no `cmap`; a font whose `fsType` is absent (assume permissive, and report);
a variable font (instance it at the used weight/axis, or embed the default instance and report);
a font with more than 65,535 glyphs (needs CIDFontType2 with a 16-bit CID space — supported, but the
subset index must be built carefully); a font used only for a single space; two fonts with the same family
name and different files (embed both, distinct `/BaseFont` names with a suffix); an embedded ODTTF whose
permission bits forbid embedding (honour the file's own bytes but honour `fsType` for our PDF).

### EXP-05 — Font substitution and metric compatibility
**Priority:** core · **Effort:** L

**Behaviour.**
- A document names fonts we may not have: Calibri, Cambria, Times New Roman, Arial, Segoe UI, PT Sans,
  Times New Roman Cyr, Arial Narrow, and (in this product's market) fonts like `Times New Roman` with Cyrillic
  coverage, plus whatever the customer's HR staff use.
- **Substitution must be metric-compatible where possible.** Map to the metric-compatible clones and embed
  those: Calibri→Carlito, Cambria→Caladea, Times New Roman→Liberation Serif, Arial→Liberation Sans,
  Courier New→Liberation Mono, and for Cyrillic coverage the same family list plus DejaVu/Liberation with
  confirmed Cyrillic and Romanian coverage. Metric-compatible means **the same advance widths**, which is
  what keeps line breaks and therefore pagination identical to Word's. A non-metric-compatible substitute
  silently repaginates the document.
- Substitution table is configurable and overridable (`fonts.substitutions`, `fonts.aliases`), and every
  substitution is reported in `exportCompleted.losses` with the original and substituted family names — this
  matters because "your contract printed in a different font" is a customer complaint we must be able to
  explain.
- Behaviour when **no** substitute exists (a customer's private font, a barcode font, a rare Cyrillic face):
  options are `'fallback'` (render with a configured default and report), `'fail'` (refuse — correct for a
  print shop), or `'blank'` (render with a visible marker) — default `'fallback'`, and a barcode font must
  be a hard failure because a blank barcode is a business incident.
- **`w:altName`** in `w:fontTable.xml` (THM-02) names a substitute and must be consulted before the generic
  table — it is the document's own stated preference.
- `w:panose1`, `w:charset`, `w:family`, `w:pitch`, `w:sig` in the font table are used to pick a closer
  substitute when the name is unknown (`w:panose1` is the most informative; use it before giving up).
- The `w:hint` attribute and the `cs`/`eastAsia` slots affect which font a character uses (THM-02), so
  substitution is applied **per resolved font slot**, not per run.
- Substitution affects **pagination**: the substitute's metrics feed back into layout, so the PDF must be laid
  out with the substituted font already chosen. Layout must therefore query the font provider, which means
  the PDF path's font set must be resolved before pagination, not during writing. Getting this backwards
  produces a PDF whose page breaks match neither Word nor our own preview.

**OOXML.** `w:rFonts`, `word/fontTable.xml` (`w:altName`, `w:panose1`, `w:charset`, `w:family`, `w:pitch`,
`w:sig`), `w:themeFontLang`, `w:lang`.
**Edge cases.** A font present in the document but not in the provider and not substituted (report and
fallback); a font substitution that changes pagination versus Word (measured by the corpus, reported per
document); a document mixing Calibri (Latin) and a Cyrillic font in one paragraph (two embedded fonts, one
run — correct); a symbolic font (`w:sig` with the symbolic bit and characters in the F0xx range) which must
**not** be treated as needing Unicode substitution — `w:sym` characters must resolve to the named font's
glyphs.

### EXP-06 — Image handling in PDF
**Priority:** core · **Effort:** L

**Behaviour.** Word's formats and PDF's capabilities are not the same set. The mapping, with the policy for
each:

| Source | Policy |
|---|---|
| PNG | Embed as `/FlateDecode` with `/Predictor 15` for 8-bit RGB/gray/indexed. Alpha → soft mask (`/SMask`) built from the alpha channel; never flatten onto white (it would break on coloured backgrounds and in print). 16-bit → downsample to 8-bit (report). Interlaced → de-interlace or re-encode. |
| JPEG | Embed the **original compressed stream** (DCTDecode) with `/ColorSpace` from the JFIF header. No re-encoding — this is the one place where lossless passthrough is free. Baseline and progressive both supported; CMYK JPEG → `/DeviceCMYK` with an optional ICC; YCCK CMYK JPEG needs the Adobe APP14 marker interpreted or the colours invert (a classic bug). EXIF orientation must be applied via the transform (MED-01), not by re-encoding. |
| GIF | First frame as an indexed image with `/Indexed` + `/LookupTable`; transparency via `/SMask`; animation is lost (report it). |
| BMP | Re-encode to Flate RGB(A); 1/4/8-bit palettes → indexed. RLE-compressed BMP must be decoded. |
| TIFF | PDF supports it only via the `/CCITTFaxDecode`/`/JBIG2Decode`/`/FlateDecode`/`/LZWDecode` filters. Policy: **decode and re-encode** to Flate (8-bit RGBA/RGB) or, for 1-bit bilevel scans, to `CCITTFaxDecode` (which keeps a scanned legal document small — worth the implementation). Multi-page TIFF → first page only (report); 16-bit/float → 8-bit (report). |
| EMF / WMF | **PDF cannot embed them.** Two options: (a) parse the metafile and replay its records into PDF vector operators (GDI records → lines, curves, fills, bitmaps, text; WMF has a documented record set, EMF too) — the right answer for quality and size; (b) rasterise at a configurable DPI (default 300 for print, 150 for screen) via an injected rasteriser. Ship (b) first, (a) later; report which was used, because a 300 DPI raster of a chart is visibly worse than vectors. |
| SVG | Parse to PDF vector operators when the SVG subset is supported (paths, transforms, basic fills/strokes/gradients/clip); otherwise rasterise. Use the `mc:AlternateContent` PNG fallback only if parsing fails, and report. |
| WEBP / HEIC / AVIF / JPEG XL | PDF cannot embed them. Transcode to JPEG (lossy, quality configurable) or PNG (if alpha). Report the transcode. |
| Animated formats | First frame; report. |
| Very large images | Downsample to a configurable maximum effective DPI (default 300) with a report, since a 6000×4000 phone photo embedded in every contract page inflates the PDF to tens of MB. Do **not** downsample below the source DPI if the placement is small — compute the effective DPI from the placement size, which is the only correct way. |
| Image referenced but missing (`a:blip` with a dangling `r:embed`) | Draw the DOCX-faithful placeholder box (Word draws a red X) and report. Never omit silently — a missing signature scan must be visible. |
| Cropping (`a:srcRect`) | Translate to a PDF clipping path plus an offset transform. Do not flatten the crop into new pixels. |
| Rotation/flip (`a:xfrm/@rot`, `@flipH`, `@flipV`) | Apply as a PDF transformation matrix, composed in the correct order (crop, flip, rotate, translate — MED-02's note). |
| Transparency effects (`a:alphaModFix`, `a14:lum` etc.) | `/ExtGState` with `/ca`/`/CA`; duotone/recolor via a `/Separation` or an `/SMask`-based approximation; unsupported artistic effects render the base image and report. |

- Images are embedded **once** and referenced by multiple `/XObject`s or by reusing the same object — a logo
  in the header of 200 pages must be one image object. This is both a size and a determinism requirement.
- Image colour management: preserve the source ICC profile where present and cheap (JPEG APP2, PNG iCCP) by
  embedding the profile and referencing it; otherwise treat as sRGB (EXP-09 requires an sRGB OutputIntent for
  PDF/A, which makes untagged images well-defined).

**OOXML.** `word/media/*`, `a:blip`, `a:srcRect`, `a:xfrm`, `pic:spPr`, `v:imagedata` (VML images),
`a14:imgEffect`/`a14:imgLayer`, `wp:extent`.
**Edge cases.** A 1×1 pixel image stretched to a page (legal); an image with a 0-width or 0-height placement
(skip, report); an EMF containing text in a font we do not have (rasterise — do not attempt to substitute
inside a metafile); an image whose `/SMask` would be enormous (a 4000×4000 alpha channel) — downsample the
mask with the image; two images that are byte-identical (one object, EXP-07's determinism requirement);
an image inside a `v:textbox` inside a header (MED-03 — the VML path must feed the same image pipeline).

### EXP-07 — PDF metadata, outline and internal links
**Priority:** important · **Effort:** M

**Behaviour.**
- **Info dictionary** from `docProps/core.xml` (PRO-01): `/Title`, `/Author` (`dc:creator`), `/Subject`,
  `/Keywords`, `/Creator` (the authoring application, i.e. the customer's app or ours), `/Producer`
  (always `docier` + version — never claim to be Word), `/CreationDate`, `/ModDate`. Dates are PDF date
  strings `D:YYYYMMDDHHmmSS+hh'mm'` and must be derived from the document's own `dcterms:created`/
  `modified`, **not** from the wall clock, when `deterministic` is true (EXP-10).
- **XMP metadata** (`/Metadata` stream) must be present and must agree with the Info dictionary — a
  mismatch is both a lie and, for PDF/A, a validation failure. Emit `dc:title`, `dc:creator`,
  `dc:description`, `xmp:CreatorTool`, `xmp:CreateDate`, `xmp:ModifyDate`, `pdf:Producer`, `pdf:Keywords`,
  and an `xmpMM:DocumentID`/`InstanceID` derived deterministically from content (EXP-10). Custom document
  properties (PRO-02) go into an XMP extension schema (`pdfx:`-style) if the config asks for it, with the
  required `pdfaExtension:schemas` description — otherwise they are omitted and reported.
- **Outline (bookmarks)**: build `/Outlines` from the document's structure, configurable source:
  `'headings'` (default — paragraphs whose effective style is a heading or whose `w:outlineLvl` is set, which
  is the same information EXP's outline and Word's navigation pane use), `'toc'` (the `TOC` field's entries),
  or `'none'`. Level = the heading level (`w:outlineLvl` + 1, or the style's level via STY-06), so the outline
  nests correctly; a document with `Heading 1` then `Heading 3` nests the 3 under the 1 (Word's navigation
  does this) but never skips more than the available depth.
  - Each item: `/Title` (the paragraph's text as rendered, with list labels if it is numbered), `/Parent`,
    `/Prev`, `/Next`, `/First`/`/Last`/`/Count` (`/Count` negative = closed), and `/Dest` — a destination
    array `[pageRef /XYZ left top zoom]` or `/Fit`/`/FitH`. Use `/XYZ` with the heading's baseline y and
    `null` zoom for fidelity.
  - Bold/italic outline entries (`/F 2`, `/F 1`) from the heading's resolved `w:b`/`w:i` — a small touch that
    makes the outline match Word's.
  - Colour: `/C [r g b]` from the heading's resolved colour. Optional; on by default for `'headings'`.
  - An explicit `w:bookmarkStart` used as a `PAGEREF` target should also appear as a named destination so
    internal links resolve (below), even if it is not in the outline.
- **Named destinations**: emit a `/Dests` name tree (or `/Names`) mapping bookmark names (MOD-08) to
  destinations, so `PAGEREF`-based links and cross-references from external documents resolve. Word-managed
  bookmarks (`_Toc*`, `_Ref*`) are included because that is what `TOC` links point at.
- **Internal links**: `w:hyperlink w:anchor` → a `/Link` annotation whose `/Dest` is the named destination;
  the link rectangle is the union of the runs' boxes from layout. A link whose anchor does not resolve is
  emitted as plain text and reported (never a dead link).
- **External links**: `w:hyperlink r:id` → `/Link` with `/A << /S /URI /URI (…) >>`. The URI must be
  normalised (percent-encoding preserved, `mailto:` and `#` fragments preserved). Optional
  `/Border [0 0 0]` to match Word's invisible link borders.
- **Navigation options**: `outline: { enabled, source, maxLevel, openDepth, includeNumbering }`,
  `links: { internal, external }`, `pageLabels` (EXP-02).
- Outline and link annotations must be **tagged** when tagging is on (EXP-08): a `Link` must have a `/StructParent`
  and an `/OBJR` in the structure tree, or it is inaccessible.
- **Bookmarks in a ranged export** (EXP-02): destinations must point at pages that exist in the output, or
  the outline must be pruned to the exported range — otherwise readers show a broken outline. Prune, and
  report.

**OOXML.** `w:bookmarkStart`/`w:bookmarkEnd`, `w:hyperlink`, `w:fldSimple`/`PAGEREF`, `w:outlineLvl`,
`w:pStyle`, `w:toc`-produced bookmarks, `docProps/core.xml`, `docProps/custom.xml`.
**Edge cases.** Two headings with identical text (titles need not be unique — that is fine); a heading inside
a table cell (included, and Word includes it too); a heading on a page that the outline's level skips
(interpolate the parent, do not drop the item); a bookmark on a hidden or deleted paragraph (skip, report);
a 3000-item outline (fine, but the writer must not be O(n²)); a document with no headings and no TOC
(`outline: 'none'` effectively — no `/Outlines` object at all, not an empty one).

### EXP-08 — Determinism of PDF output
**Priority:** important · **Effort:** M

**Behaviour.** R6, made concrete. Given the same model, config, font set and library version, `exportPdf()`
produces byte-identical output. Achieved by removing every source of nondeterminism:

- **No wall-clock time.** `/CreationDate`/`/ModDate` and the XMP `xmp:CreateDate`/`xmp:ModifyDate` come from
  the document's own properties (PRO-01) under `deterministic: true`. If the document has no dates, use a
  fixed epoch (or omit the entries — omitting is cleaner). With `deterministic: false`, use "now" and stamp
  it as such.
- **`/ID`** (the file identifier) is computed as a hash of the document content (the serialised model plus the
  config's identity-relevant parts), **not** random. Two exports of the same document from two machines must
  produce the same `/ID`, because a PDF's `/ID` is what a DMS uses to detect change.
- **Object ordering and numbering** are derived from a deterministic traversal of the document structure
  (page order, then resource order within a page, then document-level objects), never from a hash map's
  iteration order or an allocation counter racing with an async font load.
- **Compression** must be deterministic: a pure-TypeScript DEFLATE (or a configured zlib level with a
  version-pinned implementation) — do not use a native `CompressionStream` whose output can differ across
  browser versions, or determinism becomes browser-dependent. Preserve the choice in the config
  (`pdf.deflate: 'pinned' | 'native'`), and default to the pinned implementation.
- **Font subsetting** output must be deterministic (stable glyph ordering — sort by glyph id, not by first
  use).
- **No random/hashed names** anywhere: no `/UUID`-style names, no `Math.random`, no `Date.now` outside the
  two date fields above. A lint rule in the PDF module forbidding `Date.now`/`Math.random`/`crypto.randomUUID`
  outside an allowlisted function is the mechanical enforcement.
- **Async ordering**: font and image loading complete before writing begins (or the writes are buffered in a
  deterministic order). A race that changes object numbering changes the bytes — the writer must be a
  two-phase design (resolve everything, then emit).
- The determinism guarantee excludes: PDF encryption (random keys, EXP-09's sibling), and any
  `deterministic: false` export.

**OOXML.** n/a.
**Edge cases.** A document with a `PRINTDATE` field (excluded from determinism — it is inherently time-based;
use the configured print time and document it); a font subset whose output depends on a hash map (fix by
sorting); a multi-threaded image downsampler (make the result order-independent); a host that passes a
`Date` in config (it is part of the input, so determinism holds for a fixed input).

### EXP-09 — PDF/A, legal archiving, and encryption
**Priority:** later · **Effort:** XL

**Behaviour.**
- **PDF/A-1b, A-2b, A-3b** are the targets. A-1b is the most widely demanded by archiving systems; A-2b is the
  modern default; **A-3b is the one that matters for the hybrid invoice/document workflows** (Factur-X /
  ZUGFeRD are PDF/A-3 with an embedded XML file) and for embedding source files alongside a rendered
  document. Also support **A-2u/A-3u** — note that "u" (Unicode) requires `ToUnicode` on every font, which
  EXP-04 already mandates, so **A-2u is nearly free for us** once embedding and ToUnicode are correct; offer
  it, because "u" is what an accessibility-minded archive asks for.
- Requirements the writer must satisfy, all of them checked by a validator (ship `verapdf`-compatible output;
  verify with veraPDF in CI, not by hand):
  - every font embedded, no `/Helvetica`/`/BaseFont` without a font file; `ToUnicode` on all **except**
    symbolic fonts used only for bullets (A-1b exempts them — but emit it anyway, because it is easier than
    the exemption);
  - `/OutputIntents` with an sRGB ICC profile (`/GTS_PDFA1`, `/DestOutputProfile`) and the profile's
    `N` = 3; identify by `/OutputConditionIdentifier` with the standard sRGB string, or, to be more precise
    and more portable, embed the ICC;
  - XMP with `pdfaid:part` and `pdfaid:conformance` **and** a well-formed `pdfaExtension`/`pdfaSchema`
    declaration for any custom metadata we emit (PRO-02) — a malformed extension schema is the most common
    PDF/A validation failure;
  - **no encryption**, no `/Encrypt`; no `/JavaScript`; no external content references
    (`/F`, `/UF` file specs pointing outside, `/EmbeddedFile` outside the archive); no `/Launch` actions;
    no audio/video `RichMedia` annotations; no `/NeedAppearances`;
  - **A-1 forbids transparency**: any `/ExtGState` with `/ca` or `/CA` < 1, any `/SMask`, any `/BM` other
    than `/Normal`/`/Compatible` must be **flattened** (composite the image against a defined background —
    white is the wrong default for a document with a coloured background; use the resolved background colour
    and report the flattening). A-2/A-3 permit transparency, so prefer A-2b and say why. Notice that the
    document model itself may carry transparency (a `a:alphaModFix` image, a shaded shape) — so the A-1 path
    must be **decided before layout**, because flattening changes what layout renders.
  - A-3 additionally permits `/EmbeddedFile` attachments (the source DOCX, an XML payload) with a proper
    `/Filespec` and an `/AFRelationship` — that is the Factur-X shape; expose it as
    `pdf: { attachments: [{ name, bytes, mime, relationship }] }`.
- **Colour**: every colour must be device-independent for A-1 (no `/DeviceRGB`, use `/ICCBased` with sRGB);
  A-2/A-3 are more permissive, but emitting ICCBased always is simpler and better. Grayscale and spot colours
  need their own definitions.
- **Encryption and permissions** (not PDF/A-compatible, so a separate mode): RC4-128 (PDF 1.4) and AES-128
  (PDF 1.6) and AES-256 (PDF 2.0 / R6). Options: user password, owner password, `/P` permission bits
  (print, modify, copy, annotate, form fill, accessibility extraction, assembly). Two honest notes to put in
  the docs: (1) `/P` bits are advisory — any competent reader can be made to ignore them, so they are a
  policy signal, not a security control; (2) AES-256 requires a cryptographic implementation we must be
  confident in; if we cannot ship one that is vetted and testable, ship AES-128 and say so rather than
  shipping a broken 256.
- **Legal archiving specifics**: the technical requirements above are what standards bodies specify; the
  *policy* requirements (retention, what counts as an original, whether a PDF/A-3 with embedded XML is
  accepted, whether a digital signature is required) differ between Romanian and Russian archiving regimes
  and between customers. This feature therefore ships the technical capabilities plus a
  `complianceReport` output (which profile, which fonts embedded, which images flattened, which features
  dropped) and does **not** claim to make a document legally compliant. Open question: the specific national
  profiles must be confirmed with the customer's archiving authority before we claim support for them.

**OOXML.** Indirectly: `w:settings/w:embedSystemFonts` (THM-02), image transparency effects (MED-02),
`docProps/core.xml` and `docProps/custom.xml` (metadata), `w:pgSz` (archival page-size conventions).
**Edge cases.** A PDF/A-1 export of a document containing a transparent PNG (flatten and report);
a document whose only content is an image in a format requiring re-encoding (fine); a custom property whose
type has no XMP mapping (omit and report, or refuse if the caller demanded strict fidelity);
an A-3 attachment whose file name has non-ASCII characters (encode per the PDF spec, do not mangle);
encryption plus `deterministic: true` (mutually exclusive — reject the combination explicitly).

### EXP-10 — Tagged PDF and accessibility (PDF/UA)
**Priority:** later · **Effort:** XL

**Behaviour.**
- **PDF/UA-1 (ISO 14289-1)** conformance, because it is increasingly a legal requirement for published
  documents and because a document-template product that emits HR contracts and official letters will be
  asked for it. Tagged output is opt-in (`pdf: { tagged: true, pdfua: true }`) because it costs time and
  increases file size.
- Structure tree derived from the model, not guessed from geometry:
  - `/StructTreeRoot` with `/K` children, a `/ParentTree` (number tree mapping `/StructParent` keys to
    structure elements), and a `/RoleMap` for any non-standard role names.
  - Tags: `Document` (root), `Sect` per section, `P` per paragraph, `H1`–`H6` from the heading level
    (`w:outlineLvl` + 1 or the style's level, STY-06), `L`/`LI`/`Lbl`/`LBody` for lists (the `Lbl` holds the
    **generated** list marker, which is why NUM-03's rendered label must be a first-class object and not just
    a string drawn on the page), `Table`/`TR`/`TH`/`TD` with `Scope`/`Headers` for header cells (from
    `w:tblHeader` and `w:tcPr`), `Span` for inline formatting changes, `Figure` for images (with `/Alt` from
    `wp:docPr/@descr`, `/ActualText` where needed, and `/BBox`), `Link` for hyperlinks (with `/OBJR` and a
    `/StructParent`), `TOC`/`TOCI` for a table of contents, `Note` for footnotes/endnotes, `Quote`,
    `Caption`, `Artifact` for headers, footers, page numbers, borders and other decoration.
  - **Headers and footers are artifacts, not content** — this is the single most important tagging rule for a
    document like a contract, whose header repeats on every page and would otherwise be read aloud 40 times.
    Page numbers in the footer are artifacts too.
  - **Reading order** comes from document order, which the model already has (MOD-03) — this is a real
    advantage over an HTML-derived pipeline. Multi-column sections (`w:cols`) must be ordered column by
    column within a page, then page by page, which is a layout-order concern.
  - Tables: `w:gridSpan`/`w:vMerge` map to `ColSpan`/`RowSpan` attributes on `TD`/`TH` (PDF 1.7/2.0
    structure attributes) — and the merged cell's content lives in the first cell of the span, with the
    continuation cells contributing nothing (they must not produce empty `TD`s, or a screen reader announces
    phantom cells).
- `/MarkInfo << /Marked true >>`, `/Lang` from the document's language (`w:lang` dominant value, or the
  host's locale config — a Romanian contract must declare `ro-RO`, and Russian `ru-RU`), `/ViewerPreferences
  << /DisplayDocTitle true >>`, and a document `/Title` (EXP-07) — a missing title is a PDF/UA failure.
- Alt text is required for meaningful images: a document with an image lacking `wp:docPr/@descr` is a
  finding in the `complianceReport`, not a hard failure — but the report must name the image and its location
  so the author can fix it. The editor should surface the same finding.
- Tables that are used for **layout** (a two-cell table positioning a signature block) are tagged as
  `Table` per the model, which is technically correct but bad for accessibility; offer
  `tagging: { layoutTablesAsArtifact: true }` and document that it can only be decided heuristically
  (no cell borders, single row, no header row) — and that the heuristic will sometimes be wrong.
- Decorative images (`wp:docPr/@descr` absent and the image is a rule or a spacer) → `Artifact`.
- Verification: PDF/UA output must be checked with a real validator (`veraPDF` with the UA profile,
  PAC) in CI, and a round-trip check that text extraction still returns the document's text (EXP-04's
  `ToUnicode` is what makes tagging and extraction mutually reinforcing rather than competing).

**OOXML.** `w:pStyle`, `w:outlineLvl`, `w:numPr`/NUM-03's label, `w:tbl`/`w:tr`/`w:tc`/`w:gridSpan`/
`w:vMerge`/`w:tblHeader`, `w:hyperlink`, `w:bookmarkStart`, `w:drawing`/`wp:docPr/@descr`,
`w:footnoteReference`, `w:endnoteReference`, `w:headerReference`/`w:footerReference`, `w:sectPr/w:cols`,
`w:lang`, `docProps/core.xml`.
**Edge cases.** A table with `w:gridSpan` and `w:vMerge` in the same cell (both attributes on one `TD`);
a list whose levels skip (nested `L` with a missing parent — nest under the nearest ancestor); a paragraph
inside a textbox inside a header (the textbox is content, its header is an artifact — the structure must
reflect that); a heading inside a table cell; an inline image inside a hyperlink (two tags, correct nesting);
a document with two languages alternating in one paragraph (`/Lang` on the `Span`, not just the document);
a `TOC` field whose generated entries are tagged as `TOC`/`TOCI` with `Link`s to the headings' pages;
tagging combined with a page range (structure must be pruned with the outline, EXP-02/07).

### EXP-11 — Server-side rendering path
**Priority:** important · **Effort:** XL

**Behaviour.**
- A server path exists because three real requirements cannot be met in a browser: (1) customers who demand
  PDF that matches Word's own pagination for archival; (2) batch generation of thousands of contracts without
  a browser; (3) cryptographic signing with a server-held key.
- **Shape**: a small, optional service (`docier-render`) that accepts a DOCX (or our serialised model) plus
  render options and returns a PDF. It is a separate package with no dependency on the browser build. The
  client library gets `config.render.server = { url, auth }` and the PDF command transparently routes to it
  when configured, reporting which engine produced the output (`engine: 'docier' | 'server:<name>'`) in
  `exportCompleted` — never hiding the provenance, because it determines whether the pagination matches Word.
- **Engines**, honestly assessed:
  - *LibreOffice headless* (`soffice --convert-to pdf`): nearest thing to a general-purpose server engine,
    handles almost every document, produces good PDFs; but the layout differs from Word's in non-trivial
    cases, conversion takes 0.5–3 s per document and is not thread-safe per profile (needs a pool of
    profiles or a supervisor), and the output is not deterministic across LibreOffice versions — so it must
    be **version-pinned** and the version recorded in the output's `/Producer`.
  - *Microsoft Word via COM / Office Scripts / Graph API*: the only engine that is Word. Requires Windows or
    a Microsoft 365 licence, is slow, and has scaling and licensing constraints. Offer it as a pluggable
    engine for customers who will pay for exactness — do not build the primary path on it.
  - *Our own headless layout + PDF writer*: the same code as the browser path, run in Node. This is the
    recommended server default, because it is the same engine as the preview the user approved, which means
    **what the user saw is what the archive contains**, and it is deterministic. Its limit is the same as the
    browser path's: not Word's layout.
- **What the server path must additionally provide**: font availability from a controlled directory
  (EXP-04/05 — this is the real win: the server has the customer's licensed fonts, so no substitution and no
  metric drift), long-running jobs with progress, a job queue, idempotent requests (a content hash as the job
  key), and a result cache keyed by (document hash, options hash, engine version) — which is what makes batch
  generation of 10,000 contracts tractable.
- **Signing** (later, same path): PAdES/CMS detached signature via a server-held key, with the document
  byte-range digest computed by the PDF writer. This is the reason many HR archives want the server path at
  all; it also invalidates PDF/A-1 conformance unless done properly (an LTV-enabled signature with a
  Document Timestamp is required for long-term validity).
- **The hybrid recommendation** (the answer to "which do we ship?"): client-side for preview, WYSIWYG print
  and instant export; server-side for archival, batch and signing; and a documented, measured statement of
  when the two disagree. `exportCompleted.engine` and a corpus report (INT-01) are what make that statement
  honest.

**OOXML.** n/a (consumes the model and DOCX).
**Edge cases.** A document that LibreOffice renders differently from our engine (the corpus must record both,
and the difference must be visible in the report rather than discovered by the customer); a customer font
installed only on the server (the browser path substitutes, the server path does not — a real
inconsistency that must be surfaced, because the user's preview and the archived PDF will paginate
differently); a job that times out mid-conversion (idempotent retry); a 5,000-page document (the server path
must stream, SER-02).

---

## 14. Other export targets

### EXO-01 — Plain text
**Priority:** important · **Effort:** S

**Behaviour.**
- Paragraphs separated by a newline (CRLF by default, configurable), `w:tab` as `\t`, `w:br` as `\n`,
  table rows as tab-separated cells with one row per line (Word's own "Unformatted Unicode Text" behaviour),
  a table followed by a blank line.
- **List numbering is rendered as literal text** (NUM-03's label plus its `w:suff`), because there is no
  other way to represent it — this is the one place where derived numbering becomes content, and it is
  correct here.
- Field results are emitted (the cached result, or the evaluated one per SC-06), never the instruction.
  Configurable: `fields: 'result' | 'instruction' | 'both'`.
- Notes: omitted by default, or appended as `[1] text` at the end of the paragraph that references them, or
  collected at the end of the document (`notes: 'omit' | 'inline' | 'end'`). Footnote/endnote characters in
  the body are emitted as `[n]` when inline.
- Comments, revisions, headers/footers, textboxes, and content-control markup are omitted by default;
  revisions can be rendered per the visibility state (ANN-05). Headers/footers can be included per section
  (`includeHeaders`), which is important for letter templates where the letterhead carries the sender.
- **Encoding**: UTF-8 (default) with an optional BOM (`﻿`) for Windows consumers, and an optional
  `utf-16le` for legacy systems that misread UTF-8 — a real requirement in this market, where documents are
  read by Russian and Romanian office software. Romanian combining-vs-precomposed (`ș` as U+0219 vs
  `s`+U+0326) and Cyrillic must survive byte-for-byte; add a configurable NFC/NFD normalisation option and
  default to **preserving what the document contains**, not normalising (normalising changes a document's
  bytes and could change a legal string).
- Non-breaking spaces, soft hyphens, and `w:noBreakHyphen` are preserved as their characters; `w:sym`
  private-use characters are emitted as their code point (with an option to substitute a configured
  replacement, since a private-use bullet is meaningless in plain text).
- Empty paragraphs produce empty lines (they are meaningful in a document's structure).
- `w:lastRenderedPageBreak` is not a newline (it is a cache — MOD-05), but an optional
  `pageBreaks: 'formFeed' | 'none'` inserts `\f` for real page breaks from layout.

**OOXML.** `w:t`, `w:tab`, `w:br`, `w:noBreakHyphen`, `w:softHyphen`, `w:sym`, `w:numPr` (via NUM-03),
`w:tbl`, fields, notes, content controls.
**Edge cases.** A paragraph with no text but with a `w:drawing` (emit nothing, or an image placeholder
marker if configured); a table cell containing a nested table (flatten with an inner separator, and document
what it looks like); a row with merged cells (repeat the value across the spanned columns, matching Word);
an empty document (empty string, not an error); text in a `v:textbox` (included, in document order at the
anchor position).

### EXO-02 — HTML
**Priority:** important · **Effort:** L

**Behaviour.**
- Output as a single self-contained HTML5 document (default) or as an HTML + assets pair; images embedded as
  `data:` URIs by default (a self-contained file is what an HR manager needs to email or paste into a portal).
- **Two rendering strategies**, selectable:
  - `'semantic'` (default): `w:p` → `<p>`, headings → `<h1>`–`<h6>` via STY-06, `w:tbl` → `<table>` with
    `colspan`/`rowspan`, lists → `<ol>`/`<ul>` with `start`/`type` and `list-style-type` (the CSS value for
    `w:numFmt`, including `lower-russian`-style caveats — CSS has no Cyrillic counter style unless
    `@counter-style` is emitted, which is the correct answer: emit an `@counter-style` rule for `russianLower`
    and `russianUpper` and use `list-style-type: docier-russian-lower`), `w:hyperlink` → `<a>`, revisions →
    `<ins>`/`<del>`, footnotes → `<sup>` + an ordered list, content controls → `<span data-sdt-tag="…"
    data-sdt-alias="…" data-sdt-lock="…">`.
  - `'positioned'`: our own layout output as absolutely-positioned `<div>`s with exact text runs — visually
    near-identical to the PDF, useless for editing or copying. Offered for "HTML that looks like the print
    version"; documented as the accessibility-hostile option (which is why it is not the default).
- Styles: a `<style>` block generated from the document's own styles (a class per used `w:styleId`, with the
  resolved properties laid out as CSS) plus the direct formatting as inline styles. Not all OOXML maps:
  `w:spacing/@w:line` with `lineRule="auto"` (a multiple) vs `"exact"`/`"atLeast"` (a length) map to
  `line-height` differently; `w:kern`, `w:position`, `w:fitText`, `w:em`, `w:textAlignment` have no faithful
  CSS equivalent and are dropped **with a report**; `w:shd` `w:val` patterns map to `background-image`
  gradients (approximate) or to a solid colour with a report.
- Page geometry: `@page { size: A4; margin: … }` from the first (or configured) section, plus `@page :first`
  and `:left`/`:right` for first/even/odd headers — and an explicit note that **CSS pagination is not Word
  pagination**, so an HTML export used for printing will paginate differently (this is EXO's honest version
  of EXP-01's point; anyone who needs exact pages must use the PDF path).
- Headers and footers: emitted as `<header>`/`<footer>` per section (semantic strategy), which is the best
  CSS can do, with `position: running(...)` where supported — and the fields inside them rendered as their
  evaluated values (a `PAGE` field cannot be a live counter in portable CSS, so substitute the literal value
  or omit, configurably).
- Accessibility of our own output: `lang` from `w:lang`, `<table>` with `<th scope>` from `w:tblHeader` and
  the header-cell style, `<img alt>` from `wp:docPr/@descr`, and heading levels from `w:outlineLvl` — the
  same information EXP-10 uses, which is a good consistency check across the two exporters.
- **What HTML export is not**: it is not a round-trip format and never will be. A `docier` HTML file cannot
  be turned back into the original DOCX, and the docs must say so plainly, because the whole premise of the
  library is that HTML is not the model (R1).

**OOXML.** The whole modelled vocabulary; `w:pStyle`/STY-06 for semantics, `w:numPr`/NUM-03 for lists,
`w:tbl`, `w:hyperlink`, `w:bookmarkStart`, fields, notes, content controls, `w:drawing`.
**Edge cases.** A document with only direct formatting and no styles (semantic mapping falls back to
`w:outlineLvl` and then to plain `<p>`); a table with `w:tblLayout w:type="fixed"` and explicit column widths
(map to `<colgroup>`); a section with columns (`column-count`, which is a fair CSS approximation);
a list with `w:numFmt="none"` (no marker); an image with a crop (`object-fit`/`object-position` or a
`clip-path`); a hyperlink containing an image (nest correctly); a content control containing a table;
a document whose text contains `<`, `&`, ` ` (escape the first two, emit the last as `&nbsp;` or a
literal — pick one and be consistent, because a stray `&nbsp;` in a copy-paste to Word is a familiar
annoyance).

### EXO-03 — Markdown
**Priority:** important · **Effort:** M

**Behaviour.**
- GitHub-Flavoured Markdown (default) with a documented, chosen dialect; a `dialect` option for
  `'commonmark'` and (later) `'pandoc'`-compatible output.
- Mapping: `Heading1`–`Help6`/`w:outlineLvl` → `#`–`######`; **bold**/**italic**/`~~strike~~` from the
  resolved `w:b`/`w:i`/`w:strike` (resolved, not direct — a run bold through a character style must still be
  `**`); `` `code` `` from `w:rFonts` being a monospace family; `[text](url)` from `w:hyperlink`
  (external → the URI, internal → `#bookmark-name`, and a bookmark name that is not a valid fragment is
  normalised with the same rule applied to the emitted anchor, or the link breaks); images →
  `![alt](path)` with the option to write the images to files (returned alongside the Markdown, since a
  self-contained Markdown with `data:` URIs is unreadable) or to inline them as data URIs; tables → GFM pipe
  tables, with merged cells **flattened by repetition** and a report (GFM has no `colspan`/`rowspan`);
  lists → nested `-`/`1.` with two-space indentation, using the rendered label for ordered lists whose
  numbering is not plain decimal (a `russianLower` list becomes a literal `а.` rather than a Markdown
  ordered list — the honest choice, reported); block quotes from `Quote`/`IntenseQuote` and `w:pBdr` with a
  left border; horizontal rules from a paragraph with a bottom border only; footnotes as GFM footnote syntax
  (`[^1]`) when the target dialect supports it, else as an inline `^(note)`.
- Content controls: `{{tag}}` placeholder syntax (configurable), which is exactly what the template product
  wants in a Markdown context, or the plain content (configurable) — a repeating section becomes repeated
  blocks.
- Escaping: `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`, `>`, `#` at line start, `-`/`+`/`1.` at line start, `|`
  in tables, and leading whitespace. Escaping must be applied to **document text**, never to the markup we
  generate. Over-escaping is the most common Markdown-exporter defect and makes the output unreadable.
- Revisions, comments and field instructions are omitted by default; revisions per ANN-05.
- Nothing that Markdown cannot express is silently dropped: colours, fonts, sizes, alignment, columns,
  page geometry, borders, shading, floating images, textboxes (their text is emitted as a block quote, which
  is a judgement call and must be documented), and content-control lock semantics all produce report entries
  (or, for textboxes, an inline note if configured).

**OOXML.** `w:pStyle`/`w:outlineLvl`, `w:b`/`w:i`/`w:strike` (resolved), `w:rFonts`, `w:hyperlink`,
`w:bookmarkStart`, `w:tbl`, `w:numPr`, `w:pBdr`, content controls, images.
**Edge cases.** A heading level beyond 6 (clamp, report); text that is both a list item and a heading;
a table with no header row (GFM requires one — synthesise an empty header row and report, or emit an HTML
table when the dialect allows); a paragraph containing a single image (emit the image on its own line);
a run with a monospace font inside a heading (`` ` `` inside `#` is legal and must be escaped correctly);
a document with Windows-1251-era mojibake (it is already broken — pass it through faithfully rather than
guessing an encoding, because guessing destroys the evidence).

---

## 15. Interop with Microsoft Word and other producers

### INT-01 — Round-trip harness, corpus and the Word acceptance test
**Priority:** core · **Effort:** L

**Behaviour.**
- A corpus of real documents, versioned in the repo (or in an LFS/artifact store), grouped by provenance:
  Word 2010/2013/2016/2019/365-authored; Word for Mac; LibreOffice; Google Docs; Apple Pages;
  python-docx/docx4j/Apache POI generated; ONLYOFFICE; a customer's own templates; deliberately hostile
  cases (Strict-mode, macro-enabled, ALTChunk, embedded fonts, 30 sections, nested tables, tracked changes
  from three authors, RTL, CJK, footnotes in every paragraph, a 60 MB scan-heavy file, a file with a
  dangling `rId` from a bad producer).
- **Per-file assertions**, run in CI:
  1. load succeeds (or fails with the *expected* typed error for the deliberately-broken files);
  2. no-edit save is FL0 for every part and byte-identical for the whole archive (PKG-05);
  3. edit → save → load → save is FL1 and cycle-stable over three cycles (EXD-02);
  4. the node-count invariant holds for every dirty part (EXD-02);
  5. `validate()` reports no new findings versus the baseline recorded for that file;
  6. text projection is unchanged by a no-edit round-trip (a cheap, powerful check that catches dropped
     `w:t`, lost whitespace, and mangled `xml:space`);
  7. PDF export produces a file that a validator accepts and whose extracted text matches the text
     projection;
  8. (the real acceptance test, run on a Word-equipped machine or in a scheduled job) **Word opens every
     output with no repair prompt**, and a Word save/reopen cycle is also clean. This must be automated where
     possible via the same COM/Graph path as EXP-11's Word engine, and recorded per file.
- **Per-file baseline records** capture what Word itself does with the file (page count, word count,
  whether Word's own save changes the file) so that we do not chase pre-existing Word behaviour as our bug.
- **Differential PDF comparison**: rasterise our PDF and Word's PDF of the same document (via the Word
  engine in EXP-11) at a fixed DPI, compute a per-page pixel-difference metric, and **record it as a
  regression budget** rather than an absolute requirement. The budget makes layout regressions visible
  ("this change made page 7 diverge from Word by 4%") without pretending we can match Word exactly.
- Every finding becomes a numbered case in the report, and the harness is runnable locally against a single
  file (`npm run corpus -- file.docx`) for debugging — a corpus that can only run in CI is a corpus nobody
  uses.

**OOXML.** Everything.
**Edge cases.** A file that Word itself repairs on open (record it; we are not required to fix Word's bugs,
but we must not make them worse); a file whose behaviour is version-dependent (record the Word version);
a 200 MB file (the harness must have a fast lane and a nightly lane); non-deterministic test failures caused
by a real nondeterminism bug in us (must be fixed, not retried).

### INT-02 — Fidelity levels as executable assertions
**Priority:** core · **Effort:** M

**Behaviour.**
- Each of FL0–FL3 (section 0.1) has an executable definition, so that "faithful" is testable rather than
  asserted:
  - **FL0**: for each part, compare the **decompressed bytes** of the output entry with the input entry.
    Fail if they differ. Also assert the compressed bytes when `zipDeterministic` is on.
  - **FL1**: a canonicalising comparator that parses two XML parts into namespace-aware trees and compares:
    element sequence (namespace URI + local name), attribute **sets** (namespace URI + local name + value),
    text content with `xml:space` handling, and node order — deliberately ignoring attribute order, prefix
    spelling, and the order of `w:rsid`-like attributes. Two parts are FL1-equal iff the canonical forms
    are deep-equal. The comparator must be strict enough to catch a dropped element and permissive enough not
    to fail on prefix renaming.
  - **FL2**: FL1 on the modelled skeleton plus byte-equality on each opaque subtree.
  - **FL3**: the loss list emitted by the operation must equal the expected loss list for that test case —
    i.e. we assert **what we say we lose**, which is what turns the ledger from documentation into a test.
- **Cycle stability** is a first-class assertion: `parse→save` three times, asserting FL1 between cycle 1→2
  and **byte-identity** between cycle 2→3 (the first cycle may normalise; every cycle after must be a fixed
  point). A document that drifts every save is the worst possible failure for a template product and this
  assertion is what prevents it.
- **Idempotence of derived state**: layout, field evaluation and numbering must produce the same result
  before and after a save/load cycle — a check that catches derived state accidentally being written back
  (the ANN-04/SC-05 trap).
- The comparator is exported (or available in a `@docier/testing` entry point) so that integrators can assert
  fidelity for their own templates.

**OOXML.** n/a.
**Edge cases.** Two parts that are FL1-equal but not FL0 (the test must say which it asserted); a
legitimately-changed part (an edit test asserts the *intended* difference, not "no difference"); an
attribute appearing twice (illegal XML; the parser must keep both for the comparison to be meaningful).

### INT-03 — Third-party producer quirks and interop with Word itself
**Priority:** important · **Effort:** L

**Behaviour.** A documented, tested list of the real-world deviations we must tolerate and the ones we must
not propagate. Each is a corpus case and a named tolerance:

- **LibreOffice**: writes `w:styleId` values with different casing (`Heading1` vs `heading1`); omits
  `w:sectPr` defaults (relying on Word's); writes `w:tblGrid` inconsistently for merged tables; emits
  `w:rsid` values that collide; writes `w:compat` differently; produces `w:pPr` children out of schema order
  in some versions; wraps images in `w:pict` more often. **Tolerate on read; preserve on write; never
  "correct" a file we did not edit.**
- **Google Docs / Pages export**: flat style sets with `w:styleId` collisions, images referenced by
  `w:drawing` with a `wp:docPr/@id` reused across headers, hyperlinks with percent-encoding differences,
  `<w:p/>` runs with no `w:rPr` at all, and (Pages) `w:sectPr` placements that Word rejects. Tolerate.
- **python-docx / POI / docx4j generated**: minimal `styles.xml` missing `w:docDefaults`,
  `w:latentStyles` absent, `w:pPr` with an empty `w:pStyle`, `w:tbl` with no `w:tblGrid`, and `w:del` with
  `w:t` instead of `w:delText`. Tolerate on read; when one of these is edited, repair **only the touched
  subtree** (a read-time repair of the whole document would rewrite a file the user did not ask us to
  change — R3/PKG-05's rule applies to structurally broken input too).
- **ONLYOFFICE**: the document is largely OOXML-compatible; the quirk is that it may regenerate parts
  eagerly, so our "untouched is untouched" rule still holds, and we should verify that its own round-trip of
  our output is stable.
- **Word itself, as the originator** — the behaviours we must reciprocate rather than fight:
  - Word rewrites `w:rsid`s on every save; our preservation of them is not an obstacle.
  - Word adds `w:lastRenderedPageBreak` on save; we preserve it and regenerate it only on request (MOD-05).
  - Word **replaces** our `w:fldChar` cached results on open when a field is dirty; that is desirable and is
    why SC-05's `w:dirty` policy matters.
  - Word rewrites `w:tblGrid` and cell widths in some operations (autofit); we must not fight it — our
    `w:tblLayout w:type="fixed"` preservation is the correct posture.
  - Word may add `w:proofErr`; we preserve and never reorder around them.
  - Word's "compatibility mode" changes its own layout; our layout must read `w:compat` (SET-01) and, where
    feasible, adjust (spec 02's concern, but this feature owns the contract that the value is available and
    round-tripped).
- **The interop statement for the product**: docier's promise is **never to damage a document**. That means:
  a file we only opened and saved is unchanged (FL0); a file we edited differs only in what the user edited
  (FL1) plus declared losses (FL3); and everything Word wrote that we do not understand is still there
  (FL2). Any behaviour that violates one of those three is a bug against this spec, regardless of how
  convenient it is.

**OOXML.** All of the above, plus `w:compat`.
**Edge cases.** A file with two different quirks that conflict (a `w:del` using `w:t` inside a table with no
`w:tblGrid`) — the tolerances must compose, which is a test in itself; a quirk that Word itself repairs on
open (we match Word's leniency only where matching it does not require rewriting the file).

---

## 16. Cross-cutting notes, dependencies and open questions

### Dependencies on sibling specs
- **Spec 02 (layout)** consumes: the block model (MOD-03/04/07), the property cascade (MOD-06), numbering
  labels (NUM-03), section geometry (SEC-01/02), header/footer stories (SEC-03/04), notes (ANN-01/02),
  textbox stories (MED-03), and `w:docGrid`/`w:compat`/`w:hyphenationZone` from SET-01. It must **not**
  mutate the model (R4), and it must accept opaque nodes it is told to skip.
- **Spec 03 (commands/events/API)** owns the command and event envelope; this spec fixes only the export
  command's option and event shape (EXD-01) and the mutation transaction contract (MOD-09).
- **Spec 04 (tokenization/templating)** sits on top of text addressing (MOD-09) and content controls
  (SC-01–SC-04). The tokenizer must see rendered text positions, not markup; this spec's obligation is that
  those positions are stable and complete (including inside content controls, textboxes, and field results).
  `MERGEFIELD` instruction parsing is shared with SC-06.
- **Spec 05 (editor surface)** consumes everything above and owns lock-state enforcement (SC-02) at the
  interaction level.

### Performance targets this spec is accountable for
- `load()` of a 5 MB / 40-page document with 20 images: under 400 ms on a mid-range laptop, in a worker.
- No-edit `save()`: under 150 ms (it is a zip copy — if it is slower, PKG-05 is being violated).
- `exportPdf()` of the same document: under 1.5 s.
- Memory: peak under 6× the compressed document size for the default configuration.
- These targets are what make the streaming/lazy decisions (SER-02) non-optional rather than nice-to-have.

### Open questions (unresolved here, needing a decision before implementation)
1. **PDF writer dependency posture.** Do we write the PDF object/stream layer entirely in TS, or adopt a
   minimal assembler and own only fonts/structure/tagging? Related: whether we vendor a pinned DEFLATE
   implementation (EXP-08's determinism) or accept native `CompressionStream` and weaken the determinism
   claim. Recommendation: own the writer, vendor a pinned DEFLATE.
2. **CFF/OTF subsetting.** Whether we build and verify a CFF subsetter or embed full CFF fonts initially.
   Affects size for customers using OpenType CFF fonts. Recommendation: full CFF at first, subsetter later.
3. **EMF/WMF strategy.** Rasterise first (simple, worse quality) or implement a record-replay vector path
   (better, large effort). This is the biggest quality/size lever in PDF export for documents with pasted
   charts and signatures.
4. **Strict OOXML.** Whether the initial release supports Strict-mode input/output or only detects and
   preserves it. Affects archival customers.
5. **`normalizeText` default** in plain-text/HTML/Markdown export (NFC vs preserve). Recommendation:
   preserve, with an opt-in normalise — but it must be confirmed with the customer, because it is a legal
   text-fidelity question, not a technical one.
6. **PDF/A profile specifics for the target market.** The technical requirements are fixed; the *accepted*
   profile (A-1b vs A-2b vs A-3b), whether an embedded XML payload is expected (Factur-X/e-Factura), and
   whether a qualified signature is required differ between Romanian and Russian regimes and between
   customers. Must be confirmed with the customer's archiving authority before we claim compliance.
7. **`altChunk` flattening.** Whether the template product needs it at all (some customer templates arrive
   from other systems as `.docx` with altChunks). If yes, it is a whole import pipeline (SC-07) that must be
   scoped separately.
8. **Where the tokenization module's interface boundary sits** (spec 04): whether the tokenizer consumes
   rendered-text offsets only (my recommendation, MOD-09) or also needs element-level addressing.

---

## Appendix A — Part inventory and round-trip guarantee

Every part we expect to encounter, its mutability, and its guarantee. **This table is normative**: a part not
listed here is treated as an unknown passthrough part (FL0) and reported.

| Part | Role | Guarantee |
|---|---|---|
| `[Content_Types].xml` | Content types | FL1 when the part set changes, FL0 otherwise |
| `_rels/.rels` | Package relationships | FL1 when the part set changes, FL0 otherwise |
| `docProps/core.xml` | Core properties | FL1 when edited, FL0 otherwise |
| `docProps/app.xml` | Extended properties | FL0 (FL1 only on explicit regeneration) |
| `docProps/custom.xml` | Custom properties | FL1 when edited, FL0 otherwise |
| `docProps/thumbnail.jpeg` | Thumbnail | FL0 (regenerated only on request) |
| `word/document.xml` | Main body | FL1 (the primary edit target) |
| `word/_rels/document.xml.rels` | Body relationships | FL1 when references change, FL0 otherwise |
| `word/styles.xml` | Styles | FL1 when styles change, FL0 otherwise |
| `word/stylesWithEffects.xml` | Legacy style effects | FL0 (passthrough, kept in sync only if we must) |
| `word/numbering.xml` | Lists | FL1 when numbering changes, FL0 otherwise |
| `word/settings.xml` | Settings | FL1 when settings change, FL0 otherwise |
| `word/webSettings.xml` | Web settings | FL0 |
| `word/fontTable.xml` | Fonts | FL0 (FL1 only if we write embedded fonts) |
| `word/fonts/*.odttf` | Embedded fonts | FL0 |
| `word/theme/theme1.xml` | Theme | FL0 (FL1 only if a command changes it) |
| `word/headerN.xml`, `word/footerN.xml` (+ `.rels`) | Headers/footers | FL1 when edited, FL0 otherwise |
| `word/footnotes.xml`, `word/endnotes.xml` (+ `.rels`) | Notes | FL1 when edited, FL0 otherwise |
| `word/comments.xml` (+ `.rels`) | Comments | FL1 when comments change, FL0 otherwise |
| `word/commentsExtended.xml`, `commentsIds.xml`, `people.xml` | Threaded comments | FL1 when comments change, FL0 otherwise |
| `word/glossary/document.xml` (+ `.rels`) | Building blocks | FL0 (FL1 only if building blocks are edited) |
| `word/customXml/itemN.xml`, `itemPropsN.xml` (+ `.rels`) | Custom XML | FL1 when a binding writes, FL0 otherwise |
| `word/media/*` | Images | FL0 (FL1 only for a generated fallback or a transcode) |
| `word/embeddings/*` | OLE/embedded packages | FL0 |
| `word/charts/*`, `word/diagrams/*` | Charts, SmartArt | FL0 |
| `word/activeX/*`, `word/vbaProject.bin`, `word/vbaData.xml` | Macros, controls | FL0 |
| `word/afchunk.mht` and other altChunk parts | altChunk | FL0 (FL3 only if flattened on request) |
| `word/printerSettings/printerSettingsN.bin` | DEVMODE | FL0 |
| `word/people.xml` | Comment authors | FL1 when comments change, FL0 otherwise |
| `_xmlsignatures/*` | Digital signatures | FL0 when nothing changed; FL3 (dropped, warned) after any edit |
| any other part | Unknown/vendor extension | FL0, and reported as an unknown part |

## Appendix B — OOXML namespace prefixes referenced

`w` = `http://schemas.openxmlformats.org/wordprocessingml/2006/main` ·
`r` = `http://schemas.openxmlformats.org/officeDocument/2006/relationships` ·
`wp` = `…/drawingml/2006/wordprocessingDrawing` · `a` = `…/drawingml/2006/main` ·
`pic` = `…/drawingml/2006/picture` · `wps`/`wpg` = `…/drawingml/2010/wordprocessingShape`/`Group` ·
`mc` = `http://schemas.openxmlformats.org/markup-compatibility/2006` ·
`w14` = `http://schemas.microsoft.com/office/word/2010/wordml` ·
`w15` = `http://schemas.microsoft.com/office/word/2012/wordml` ·
`w16` = `…/word/2016/wordml` · `w16cid` = `…/word/2016/commentId` · `w16du` = `…/word/2018/durableId` ·
`v` = `urn:schemas-microsoft-com:vml` · `o` = `urn:schemas-microsoft-com:office:office` ·
`m` = `http://schemas.openxmlformats.org/officeDocument/2006/math` ·
`c` = `…/drawingml/2006/chart` · `dgm` = `…/drawingml/2006/diagram` ·
`cp`/`dc`/`dcterms`/`xsi`/`vt`/`ds` as per the OPC, Dublin Core and XML-Schema-datatypes namespaces.

Strict-mode equivalents replace `http://schemas.openxmlformats.org/wordprocessingml/2006/main` with
`http://purl.oclc.org/ooxml/wordprocessingml/main` (SER-04).
