# Architecture decision records

Each record states a decision, the evidence behind it, its consequences, and
**what would reopen it**. A decision with no stated reversal condition tends to
get defended rather than revisited.

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-numeric-semantics.md) | Numeric semantics: replicate `MathContext.DECIMAL128`; own the evaluator over `lezer-feel` and `decimal.js`; one numeric mode | Accepted |
| [0002](0002-packaging.md) | Dual ESM/CJS plus browser build; Node.js floor at the oldest supported LTS line (22) | Accepted |
| 0003 | Parse at compile time, evaluate the tree per request | Accepted, folded into 0001 |
| 0004 | Temporal: TC39 Temporal internally, re-exported rather than exposing the polyfill | Decided; record not yet written |
| 0005 | Error policy: `propagate-null` by default | Decided; record not yet written |
| 0006 | Imports: host-supplied resolver, compile-time resolution, no I/O by default | Decided in shape; record not yet written |
| 0007 | Whether a formal DMN CL3 claim is supportable | Open by design |

Where a decision has an option the field has converged on, we take that option.
Novelty is a cost: an open-source runtime is judged against engines that
already exist, and every place it behaves differently is a place it has to
defend.
