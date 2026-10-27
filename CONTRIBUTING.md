# Contributing

Thanks for considering a contribution. This project executes decision models
that people use to make lending, pricing and compliance decisions, so it
values being provably correct over being feature-complete.

## Before you start

Read the [README](README.md), particularly its design commitments, and
[ADR-0001](docs/adr/0001-numeric-semantics.md) on numeric semantics. Between
them they answer most "why is it like this?" questions. Where the DMN
specification is ambiguous, this project follows Apache KIE Drools — see
[differential testing](docs/differential-testing.md).

Decisions with lasting consequences are recorded in
[docs/adr](docs/adr/README.md). If your change contradicts one, that is not
necessarily wrong — but it needs an ADR that supersedes it, not a quiet
divergence.

## Ground rules

**Correctness is measured, not asserted.** Where FEEL or DMN behaviour is
ambiguous, we match Apache KIE Drools as the reference and record the
observation. "I believe FEEL does X" is not a basis for a change; "Drools
returns X, and here is the test" is.

**Report unsupported rather than approximate.** A construct we cannot evaluate
correctly must produce a `FEEL_UNSUPPORTED_CONSTRUCT` diagnostic and a null
value. Silently returning a plausible answer is the worst outcome available.

**No arbitrary code execution, ever.** No `eval`, no `new Function`, no dynamic
import driven by model content. Model content is data.

**Determinism.** No ambient clock, no network, no filesystem, no mutable global
state in the core packages. Core packages must not import `node:*`.

**Numbers are decimals.** Never use a JavaScript `number` for a FEEL value.

## Provenance

Every source file must make clear whether it is original work or adapted
from a third-party implementation.

- Original work needs no marker beyond the file's own header comment.
- Code adapted from an MIT-licensed source must retain that source's copyright
  notice, be confined to clearly marked files, and be listed in
  [NOTICE](NOTICE) **in the same commit**.

This matters because the project implements FEEL in the vicinity of an existing
MIT-licensed implementation. Recording provenance costs a minute at authoring
time and is unreliable to reconstruct afterwards.

## Working on the code

```bash
npm install
```

```bash
npm run check
```

Tests live in `packages/*/test`, with repository-level checks — such as the
README example, which is executed — in `test/`. They use
[Vitest](https://vitest.dev). Add a test with every behavioural change; a test
that would have failed before your change is the minimum bar.

For anything touching FEEL semantics, add a case to the conformance suite with
the value the reference engines produce, not only the value you expect.

The [DMN TCK](https://github.com/dmn-tck/tck) is fetched at a pinned commit,
named in [`tck-version.json`](packages/tck-runner/tck-version.json):

```bash
npm run tck:fetch && npm run tck
```

If your change moves the TCK baseline, regenerate both the baseline and the
published report — CI compares the committed report against a live run and
fails if they disagree:

```bash
npm run tck:update && npm run tck:report
```

### Moving the TCK pin

The baseline, the published report and the recorded Drools output were all
produced against the pinned commit, so the pin only moves deliberately, in one
pull request that does all of this:

1. Set the new commit and its date in
   [`tck-version.json`](packages/tck-runner/tck-version.json), then
   `npm run tck:fetch`.
2. `npm run tck:update && npm run tck:report`, and explain in the pull request
   every test that appeared, disappeared or changed category.
3. Re-record Drools against the same commit — see
   [differential testing](docs/differential-testing.md#regenerating-the-recording).
   A recording from another commit would compare this runtime with Drools on
   different tests.

The tooling refuses to run against any other commit, so a newer TCK cannot
show up as a wall of unexpected failures.

### Examples

The examples in [`examples/`](examples/README.md) are executed by the test
suite. Adding a model there is a good way to cover a construct end to end, in
the shape someone would actually write it.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`,
`fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

A pull request should explain what behaviour changed and how it was verified.
If it changes evaluation results, say so explicitly: that is a breaking
change — see [Compatibility](README.md#compatibility).

## Releases

The five packages are released together, at one version, and pin each other
exactly. Maintainers set it with:

```bash
npm run version:set -- 0.2.0
```

That moves every manifest, every internal dependency pin and the version the
FEEL engine reports in its traces; `verify-packaging` fails the build if any of
them disagree.

Publishing happens only from CI, on a GitHub release, through an npm
[trusted publisher](https://docs.npmjs.com/trusted-publishers). No maintainer
holds an npm token for these packages, and every version carries a
[provenance attestation](https://docs.npmjs.com/generating-provenance-statements)
linking the tarball to the commit and workflow run that built it:

```bash
npm audit signatures
```

## Reporting FEEL or DMN defects

The most useful report contains the expression or model, the input, what this
engine returned, and what a reference engine returned. The last part is what
turns an opinion into a bug.

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
