## What this changes

<!-- One paragraph. What behaviour is different after this PR. -->

## Why

<!-- The problem, not the patch. If it fixes an issue, link it. -->

## Checklist

- [ ] `npm run check` passes (hygiene, types, tests).
- [ ] If FEEL or DMN behaviour changed: verified against a reference engine
      rather than asserted. `npm run diff` says which engine the TCK backs —
      see [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] If the TCK baseline moved: `npm run tck:update` and
      `npm run tck:report` were run, and the diff in
      `packages/tck-runner/tck-baseline.json` is explained above. A test that
      *starts* passing needs an explanation too.
- [ ] If this adapts third-party source: the file carries the originating
      copyright and license, and `NOTICE` is updated in the same commit.
- [ ] If the public API changed: `CHANGELOG.md` has an entry.
