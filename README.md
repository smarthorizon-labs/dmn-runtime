# `@smarthorizon-labs/dmn`

[![CI](https://github.com/smarthorizon-labs/dmn-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/smarthorizon-labs/dmn-runtime/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@smarthorizon-labs/dmn)](https://www.npmjs.com/package/@smarthorizon-labs/dmn)
[![license](https://img.shields.io/npm/l/@smarthorizon-labs/dmn)](LICENSE)

Run [DMN](https://www.omg.org/dmn/) decision models inside your TypeScript
application — no JVM, no rules server, no framework. Load a DMN 1.1–1.5 model,
exported from a modeller or written by hand; evaluate its decision tables and
FEEL expressions with the decimal arithmetic the standard requires; and get
back every decision's result together with an audit trace of which rules fired
— with none of your customers' data in it unless you ask. It is built for the
decisions someone will later have to explain: pricing, eligibility, credit,
fraud and compliance.

**Early release (0.x).** It covers the decision logic most business models use.
See [what works today](#what-works-today), and what is [not there yet](#roadmap).

---

## Install

Requires Node.js 22.12 or later.

```bash
npm install @smarthorizon-labs/dmn
```

Dual ESM and CommonJS, with TypeScript declarations. Every version is published
from CI with an [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
attestation, so you can verify a tarball was built from this repository.

---

## Example

A discount policy. A decision table picks the rate from the customer's tier and
the order total; a FEEL expression applies it.

<!-- readme-example:table -->
| Customer Tier | Order Total | Discount Rate |
|---|---|---|
| `"Gold"` | `>= 1000` | `0.15` |
| `"Gold"` | `< 1000` | `0.10` |
| `"Silver"` | `-` | `0.05` |
| `not("Gold", "Silver")` | `-` | `0` |

<details>
<summary><code>discount.dmn</code> — the complete DMN 1.5 model</summary>

<!-- readme-example:model -->
```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20230324/MODEL/"
             id="discount" name="Order Discount"
             namespace="https://example.com/dmn/discount">

  <inputData id="customer-tier" name="Customer Tier">
    <variable name="Customer Tier" typeRef="string"/>
  </inputData>

  <inputData id="order-total" name="Order Total">
    <variable name="Order Total" typeRef="number"/>
  </inputData>

  <decision id="discount-rate" name="Discount Rate">
    <variable name="Discount Rate" typeRef="number"/>
    <informationRequirement id="ir-1"><requiredInput href="#customer-tier"/></informationRequirement>
    <informationRequirement id="ir-2"><requiredInput href="#order-total"/></informationRequirement>
    <decisionTable id="discount-table" hitPolicy="UNIQUE">
      <input id="in-tier"><inputExpression typeRef="string"><text>Customer Tier</text></inputExpression></input>
      <input id="in-total"><inputExpression typeRef="number"><text>Order Total</text></inputExpression></input>
      <output id="out-rate" typeRef="number"/>
      <rule id="gold-large">
        <inputEntry><text>"Gold"</text></inputEntry>
        <inputEntry><text>&gt;= 1000</text></inputEntry>
        <outputEntry><text>0.15</text></outputEntry>
      </rule>
      <rule id="gold-small">
        <inputEntry><text>"Gold"</text></inputEntry>
        <inputEntry><text>&lt; 1000</text></inputEntry>
        <outputEntry><text>0.10</text></outputEntry>
      </rule>
      <rule id="silver">
        <inputEntry><text>"Silver"</text></inputEntry>
        <inputEntry><text>-</text></inputEntry>
        <outputEntry><text>0.05</text></outputEntry>
      </rule>
      <rule id="standard">
        <inputEntry><text>not("Gold", "Silver")</text></inputEntry>
        <inputEntry><text>-</text></inputEntry>
        <outputEntry><text>0</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>

  <decision id="final-price" name="Final Price">
    <variable name="Final Price" typeRef="number"/>
    <informationRequirement id="ir-3"><requiredDecision href="#discount-rate"/></informationRequirement>
    <informationRequirement id="ir-4"><requiredInput href="#order-total"/></informationRequirement>
    <literalExpression id="final-price-expr">
      <text>Order Total * (1 - Discount Rate)</text>
    </literalExpression>
  </decision>
</definitions>
```

</details>

<!-- readme-example:code -->
```ts
import { readFileSync } from 'node:fs';
import { compileModel, describeValue, evaluateModel, loadDmnXml, toFeelNumber } from '@smarthorizon-labs/dmn';

// Compile once, at startup. Evaluating parses nothing.
const model = compileModel(loadDmnXml(readFileSync('discount.dmn', 'utf8')));

const result = evaluateModel(
  model,
  {
    'Customer Tier': 'Gold',
    // Money goes in as a string: a JavaScript number has already lost precision.
    'Order Total': toFeelNumber('1499.99'),
  },
  { trace: { level: 'RULES' } },
);

for (const [name, decision] of result.decisions) {
  console.log(`${name}: ${describeValue(decision.value)}`);
}

// The audit record says which rule decided — and holds no customer data.
for (const event of result.trace?.events ?? []) {
  if (event.type === 'rule-matched') {
    console.log(`${event.decision} matched rule ${event.ruleIds?.join(', ')}`);
  }
}
```

<!-- readme-example:output -->
```text
Discount Rate: 0.15
Final Price: 1274.9915
Discount Rate matched rule gold-large
```

This example is executed by the test suite, so the output above is what the
engine actually prints. Worked examples across other domains and every hit
policy are in [`examples/`](examples/README.md).

---

## What works today

**Model loading**

- DMN 1.1 through 1.5, detected from the namespace and normalized into one
  internal model.
- Secure XML: DTDs rejected outright, size and depth limits, no network or
  filesystem access, source positions kept for diagnostics.
- The decision requirement graph, evaluated in dependency order.

**Decision logic**

- **Decision tables** — all seven hit policies (`UNIQUE`, `FIRST`, `PRIORITY`,
  `ANY`, `COLLECT`, `RULE ORDER`, `OUTPUT ORDER`), `COLLECT` aggregations,
  default output entries, `outputValues` priority ordering, irrelevant and
  negated entries.
- **Boxed expressions** — literal expressions, contexts, lists, invocations and
  function definitions.
- **Business knowledge models** — invoked from a boxed invocation or from FEEL
  as `Name(args)`, with bounded recursion.
- **Decision services** — with real encapsulation: an input decision is a
  parameter supplied by the caller, never evaluated.

**FEEL**

- Arithmetic, comparison, three-valued boolean logic, `if`/`then`/`else`.
- Lists, ranges, contexts, `instance of`, `in`, `between`, path access, and
  names containing spaces.
- **Temporal types** — date, time, date and time, and both duration types, with
  literals, comparison, arithmetic and property access.
- The common **built-in functions**: boolean, numeric, rounding, aggregation,
  string, list and temporal.

**Operations**

- **Execution tracing** with a redaction policy — see [Auditability](#auditability).
- Structured diagnostics with stable codes, anchored to the model source.
- Compiled models are immutable and safe to evaluate concurrently.

---

## Auditability

Tracing is built around one rule: **a trace never carries your data unless you
ask it to.**

The default records the *shape* of an evaluation — which decisions ran, in what
order, which rules matched, which hit policy applied, what failed and why — and
none of the values flowing through it. That is the record an auditor wants, and
not one a data protection officer has to worry about finding in a log.

| Level | Records |
|---|---|
| `NONE` | Nothing; no trace object is built. |
| `SUMMARY` | Start, end, outcome. |
| `DECISIONS` | Every decision evaluated, in order, with its status. |
| `RULES` | Matched rule IDs and the hit policy applied. |
| `FULL` | Function invocations as well. |

Values can be recorded when you choose to, per request: `omit` (the default),
`type`, `mask`, `hash` or `raw`, with `allow` and `deny` lists. **Deny beats
allow beats policy**, so no combination of settings leaks a denied field. The
policy in force is recorded in the trace, so an absent value is unambiguous.
Events carry monotonic sequence numbers and are bounded; truncation is flagged.

Traces are plain data. Where they are stored, and for how long, is your
decision.

---

## Design commitments

| | |
|---|---|
| **Decimal arithmetic** | `MathContext.DECIMAL128` — 34 significant digits, `HALF_EVEN` — as used by the reference DMN engines, so `0.1 + 0.2` is `0.3`. One numeric mode; no binary floating-point option. Recorded, with the evidence, in [ADR-0001](docs/adr/0001-numeric-semantics.md). |
| **Determinism** | No ambient clock, no network, no filesystem. The same model and inputs give the same result. |
| **Models are data** | No `eval`, no `new Function`. Models cannot name host code to run: `functionKind="Java"` and FEEL `external` are refused. |
| **Compile once** | FEEL is parsed when the model is compiled. A thousand-rule decision table parses nothing per request. |
| **Honest failure** | A construct the engine cannot evaluate yields a diagnostic and a null — never a plausible guess. |
| **No framework** | No HTTP server, no persistence, no dependency-injection container. |

---

## Conformance

Every change is measured against the [DMN TCK](https://github.com/dmn-tck/tck),
and compared case by case with recorded output from Apache KIE Drools — the
reference this project follows where the DMN specification is ambiguous.

The [TCK report](docs/tck-report.md) is generated from a run of the suite, never
written by hand, and lists every failing assertion grouped by cause. CI fails if
the published report disagrees with the measurement. Behaviour not yet confirmed
against a reference engine is tracked in
[unverified semantics](docs/unverified-semantics.md).

No DMN conformance level is claimed. Conformance levels are defined by the OMG
specification, not by a pass rate.

---

## Roadmap

Not supported yet:

| | |
|---|---|
| **Iteration and filters** | `for`, `some`, `every`, `list[condition]`. |
| **More built-in functions** | Regular expressions (`matches`, `replace`), `sort`, `context put`, range functions. |
| **Decision-table list semantics** | Where a table input is a list, matching differs from the reference engines. |
| **DMN 1.5 boxed forms** | Boxed conditional, filter and iterator. |
| **Imports** | Models that import other models. |
| **Resource limits and worker isolation** | Required before evaluating models from **untrusted** sources — see [SECURITY.md](SECURITY.md). |

Deliberately excluded, not merely missing:

- `functionKind="Java"`, PMML and FEEL `external` bindings. A model must never
  name host code for the engine to execute.
- `now()` and `today()`, until the clock can be supplied by the caller — reading
  the host clock would make evaluation impossible to reproduce.

---

## Compatibility

Versions follow [semantic versioning](https://semver.org/). While the major
version is `0`, a minor release may break compatibility; every such change is
listed in the [changelog](CHANGELOG.md) with a migration note.

For a decision engine, *breaking* reaches beyond the API. Each of these is a
breaking change:

- a different result from the same model and inputs, numeric results included;
- a change to the shape of results or traces;
- a change to a diagnostic code;
- dropping a supported DMN or Node.js version.

---

## Packages

| Package | |
|---|---|
| [`@smarthorizon-labs/dmn`](packages/dmn) | **Start here.** Everything below, one install. |
| [`@smarthorizon-labs/dmn-runtime`](packages/runtime) | Decision graph, decision tables, tracing. |
| [`@smarthorizon-labs/dmn-feel`](packages/feel-adapter) | FEEL parsing and evaluation — usable on its own. |
| [`@smarthorizon-labs/dmn-xml`](packages/xml) | Secure DMN XML loading. |
| [`@smarthorizon-labs/dmn-model`](packages/model) | Normalized model types. |

They are released together, at one version.

---

## Contributing

```bash
npm install && npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) — particularly its first rule: where FEEL
or DMN behaviour is in question, the answer is what a reference engine does,
backed by a test. Report vulnerabilities privately, as described in
[SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Third-party attributions are in [NOTICE](NOTICE).
