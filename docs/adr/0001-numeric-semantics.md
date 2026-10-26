# ADR-0001 — Numeric semantics

- **Status:** Accepted
- **Date:** 2026-07-27
- **Supersedes:** —
- **Related:** [differential testing](../differential-testing.md), [unverified semantics](../unverified-semantics.md)

## Context

FEEL specifies `number` as a decimal type with precision equivalent to IEEE
754-2008 decimal128 — 34 significant digits with decimal rounding.

`feelin`, the most capable JavaScript FEEL interpreter, represents numbers as
plain IEEE-754 binary doubles, reading literals through `parseInt` and
`parseFloat`, with no decimal library among its dependencies. The consequence is
visible in ordinary arithmetic: `1.1 + 1.3` evaluates to `2.4000000000000004`.
This is recorded upstream as `nikku/feelin` issue #109, labelled `bug`,
`wontfix`, `tck`, `backlog`.

We surveyed every engine with published DMN TCK results:

| Engine | Language | TCK | `number` representation |
|---|---|---|---|
| Goldman Sachs jDMN 10.0.0 | Java | 3391/3391 | `BigDecimal` |
| Trisotech DES 12.12.4 | Java | 3390/3391 | decimal |
| IBM BAMOE 9.5.0 | Java | 3388/3391 | `BigDecimal`, `MathContext.DECIMAL128` |
| Apache KIE Drools 10.2.0 | Java | 3388/3391 | `BigDecimal`, `MathContext.DECIMAL128` |
| DecisionToolkit 0.3.0 | Rust | 3374/3391 | Intel Decimal FP library |
| Camunda DMN-Scala 1.9.0 | Scala | 2850/3391 | `BigDecimal`, DECIMAL128 `MathContext` |
| `feelin` | JavaScript | never submitted | binary double |
| `dmn-eval-js` | JavaScript | never submitted | binary double |

## Decision

**Replicate `java.math.MathContext.DECIMAL128`:** 34 significant decimal
digits, `HALF_EVEN` rounding, unbounded decimal exponent. Invalid results are
FEEL `null`; there is no `NaN` and there are no infinities.

**One numeric semantics.** No opt-in binary-double mode.

**Implementation:** reuse `lezer-feel` for parsing; implement evaluation in this
project over `decimal.js`, configured through a cloned constructor so that host
applications using `decimal.js` are unaffected.

### Why the Java form rather than strict IEEE decimal128

All six engines agree on 34 digits, `HALF_EVEN`, and null-for-invalid. They
diverge on one point: the Java-family engines leave the exponent unbounded,
while DecisionToolkit applies the IEEE exponent range. The difference is
observable only near 10<sup>±6144</sup>, which no business decision model
reaches.

We follow the five-engine majority. It maximises agreement with the engines
users compare against, and `decimal.js` provides it natively — emulating the
IEEE exponent bound would add machinery whose only effect would be to introduce
defects at magnitudes nobody evaluates.

The divergence is recorded as a known deviation in the support matrix and
pinned by a test.

### Why not reuse `feelin`'s interpreter

`feelin` applies JavaScript arithmetic operators to primitive numbers directly.
A decimal type cannot be injected through the evaluation context: `a + b` over
two decimal objects would concatenate rather than add. With the defect marked
`wontfix` upstream, an upstream fix is not a schedulable dependency.

We will still propose a pluggable numeric backend upstream, because that
outcome would serve the wider ecosystem — but the plan does not depend on its
acceptance.

## Consequences

**Accepted cost.** The project owns a FEEL evaluator, which is a materially
larger scope than wrapping one, and means owning FEEL's edge cases rather than
inheriting another implementation's handling of them.

**Mitigation.** Every construct is measured against two independent
references — the DMN TCK and Drools — from the pull request that introduces
it, rather than after months of accumulated divergence.

**Gained.** Parsing and evaluation separate natively, so a compiled model
parses zero FEEL per request. Conformance positioning stays open. The engine
becomes usable for the monetary calculations that motivate DMN adoption.

**Public claims.** Conformance and monetary-suitability claims are made only
for the semantics implemented here, and only against measured results.

## Reversal conditions

Revisit if `feelin` adopts a decimal or pluggable numeric representation, or if
any engine demonstrates DMN conformance on binary floating-point arithmetic.
