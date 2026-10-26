# Changelog

Notable changes to the published packages. This project follows
[semantic versioning](https://semver.org/).

While the major version is `0`, the API may change in a minor release. Every
such change will be listed here with a migration note.

## 0.1.0

First public release.

### Added

- **Model loading** — DMN 1.1 through 1.5, detected from the namespace and
  normalized into one internal model. DTDs are rejected outright, with size and
  depth limits, no network access and no filesystem access. Source positions are
  preserved for diagnostics.
- **Decision tables** — all seven hit policies, `COLLECT` aggregations, default
  output entries, `outputValues` priority ordering, irrelevant and negated
  entries.
- **Boxed expressions** — literal expressions, contexts, lists, invocations and
  function definitions.
- **Business knowledge models** — invoked from a boxed `<invocation>` with named
  bindings or from FEEL as `Name(args)`, with bounded recursion.
- **Decision services** — with real encapsulation: an `inputDecision` is a
  parameter supplied by the caller and is never evaluated.
- **FEEL** — arithmetic, comparison, three-valued boolean logic, `if`/`then`/
  `else`, lists, ranges, contexts, `instance of`, `in`, `between`, path access,
  names containing spaces, and about 45 built-in functions.
- **Temporal types** — date, time, date-and-time and both duration types, with
  literals, comparison, arithmetic and property access.
- **Execution tracing** — five levels with a redaction policy. Traces record the
  shape of an evaluation and carry no values unless you opt in.
- **`@smarthorizon-labs/dmn`** — one-install facade re-exporting the runtime, the
  FEEL engine, the model types and the XML loader.

### Supported runtimes

Node.js 22.12 or later — every Node.js LTS line still receiving security
fixes. Dual ESM and CommonJS entry points, with TypeScript declarations.

### Numeric semantics

Arithmetic is `MathContext.DECIMAL128` — 34 significant digits, `HALF_EVEN`,
unbounded exponent — matching Drools, IBM BAMOE, jDMN and Camunda's FEEL-Scala.
There is one numeric mode and no binary-double alternative. See
[ADR-0001](docs/adr/0001-numeric-semantics.md).

### Conformance

2391 of 3495 DMN TCK assertions pass; 122 of 126 at compliance level 2. All four
level-2 failures are the same compound-interest formula, where this runtime and
Drools 10.2.0 produce identical values to all 34 significant digits and the TCK's
recorded expectation matches neither. Full breakdown in the
[TCK report](docs/tck-report.md).

No DMN conformance level is claimed.

### Not implemented

Iteration and filters (`for`, `some`, `every`, `list[condition]`), the built-in
long tail (regular expressions, `sort`, `context put`, range functions),
decision-table list semantics, DMN 1.5 boxed conditional/filter/iterator,
imports, and a validation module. See the
[roadmap](README.md#roadmap).

`functionKind="Java"`, PMML and FEEL `external` bindings are excluded by design,
not merely missing. `now()` and `today()` are absent until a clock can be
injected, because they would make evaluation non-reproducible.
