# Local gates — run these before every push

CI (`.github/workflows/ci.yml`) runs **five** steps on `main`, in this order. `tsc -b` alone is
**not** enough: it does not typecheck the test tree, so a test file with an unused import passes
locally and fails CI at "Typecheck tests".

Run the whole sequence in the repo root:

```
npm run typecheck        # tsc -b --noEmit            (library sources)
npm run typecheck:test   # tsc -p tsconfig.test.json  (tests + fixtures)  <- easy to forget
npm run build            # tsc -b + emit-css
npm test                 # vitest run
```

The publish workflow (`.github/workflows/publish.yml`) adds `poppler-utils` and then runs
`npm publish`; it triggers on a `v*` tag.
