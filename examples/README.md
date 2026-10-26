# Examples

Ten DMN 1.5 models, from a two-line greeting to transaction fraud triage, each
with worked scenarios and expected results.

Every model is hand-authored for execution: no diagram interchange, no vendor
extensions, and nothing that this runtime cannot evaluate. All of them are
asserted by [`examples.test.ts`](examples.test.ts) on every `npm test`, so the
outputs below cannot drift away from what the engine actually does.

```bash
npm run build
```

```bash
node examples/run.mjs
```

```bash
node examples/run.mjs 08-fraud-risk --trace
```

## The models

| | Model | Complexity | Domain | What it shows |
|---|---|---|---|---|
| 01 | [Greeting](models/01-greeting.dmn) | Introductory | Anything | The load, compile and evaluate loop; string concatenation |
| 02 | [Shipping cost](models/02-shipping-cost.dmn) | Simple | Retail / logistics | A `UNIQUE` decision table, numeric ranges, structured inputs |
| 03 | [VAT classification](models/03-vat-classification.dmn) | Simple | Tax / finance | `FIRST` versus `UNIQUE`, two outputs, default output entries |
| 04 | [Insurance premium](models/04-insurance-premium.dmn) | Moderate | Insurance | Business knowledge models, dependency ordering, boxed contexts |
| 05 | [Employee leave](models/05-employee-leave.dmn) | Moderate | HR | Dates and durations, date properties, reproducibility |
| 06 | [Clinical triage](models/06-clinical-triage.dmn) | Moderate | Healthcare | `PRIORITY`, `outputValues` ordering, rule order not mattering |
| 07 | [Subscription renewal](models/07-subscription-renewal.dmn) | Moderate | SaaS / billing | `COLLECT` with `SUM`, list inputs, aggregation built-ins |
| 08 | [**Fraud risk triage**](models/08-fraud-risk.dmn) | Complex | **Compliance / fraud** | Decision tables inside BKMs, additive scoring, banding, a service |
| 09 | [Credit decisioning](models/09-credit-decisioning.dmn) | Complex | Lending | Decision-service encapsulation, shown both ways |
| 10 | [Customs clearance](models/10-customs-clearance.dmn) | Complex | Trade compliance | `RULE ORDER`, nested contexts, string built-ins, temporal comparison |

Model 09 appears twice in the runner — once evaluated whole, once through its
decision service — because that contrast is the point of the example.

## Start here

**New to DMN**: 01, then 02, then 03. Between them they cover the shape of
almost every rule a business writes down.

**Evaluating the engine**: 08. It exercises most of the runtime in a single
model and is the closest to production-shaped work.

**Understanding hit policies**: 02 (`UNIQUE`), 03 (`FIRST`), 06 (`PRIORITY`),
07 (`COLLECT SUM`), 10 (`RULE ORDER`). Each comment explains why that policy
and not another — the choice is a modelling decision, not a formality.

## Fraud risk triage, in more detail

Model 08 is built the way a fraud or financial-crime function needs it, and the
comments in the file explain each choice. In short:

- **Screening is not scoring.** A sanctions hit blocks. It is on a separate
  path from the risk score, so no amount of good behaviour elsewhere can dilute
  it — the model makes that structural rather than relying on a large number.
- **Scores are additive, one reason per rule.** `COLLECT SUM` means a score
  always decomposes back into the rules that produced it, which is what an
  analyst has to explain and what the trace records.
- **Banding uses `PRIORITY`.** Reordering the band table cannot change an
  outcome.
- **Thresholds are rules, not code.** Retuning is a model change, not a
  deployment.
- **No clock is read.** The transaction timestamp is an input, so a case can be
  replayed years later and reproduce the decision that was actually made.

Run it with a trace to see the audit record:

```bash
node examples/run.mjs 08-fraud-risk --trace
```

The runner asks for raw values so the output is readable. In production you
would leave the default in place, which records which rules fired and none of
the cardholder's data — see [Auditability](../README.md#auditability).

## Writing your own

Add a `.dmn` file to `models/`, add an entry to
[`scenarios.mjs`](scenarios.mjs) with inputs and expected renderings, and it is
picked up by both the runner and the test suite automatically.

Inputs are built with the helpers in [`values.mjs`](values.mjs): `n()` for
numbers, `d()` for dates, `dt()` for date-and-times, `dur()` for durations.
Always pass money to `n()` as a **string** — a JavaScript number has already
lost precision before the runtime sees it.
