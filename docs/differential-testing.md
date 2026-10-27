# Differential testing against Drools

Where the DMN specification is ambiguous, this project follows Apache KIE
Drools. That only means something if
"what Drools does" is executable rather than asserted, which is what this
harness provides.

Drools 10.2.0 is pinned deliberately: it is the version whose
[TCK results](https://dmn-tck.github.io/tck/) are published, so recorded values
correspond to a known conformance result rather than to whatever was latest.

## How it is arranged

The harness runs in two halves so that **CI never needs a JVM**. The recorded
Drools output is committed; the everyday check compares against the recording,
and regenerating it is a deliberate act reviewed like any other change.

```
npm run diff:export   ->  reference/differential-cases.json   (inputs)
npm run diff:record   ->  reference/drools-results.json       (Drools output)
npm run diff          ->  the comparison report
```

Both engines are handed the **same exported inputs**, in the shared wire format
from `src/wire.ts`. Neither re-parses the TCK test XML for itself, so a
difference in the report is a difference in evaluation rather than in reading
the question.

Numbers travel as strings. A JSON number is an IEEE-754 double, and sending a
34-digit decimal through one would corrupt exactly the values being compared.

Temporal values are carried through even though this runtime cannot evaluate
them yet. Drools can, so the recording captures reference values for dates,
times and durations before the feature that consumes them exists — which is
most of the point of recording them early.

## Reading the report

Each comparison has two axes. The first is whether the engines agree:

| Agreement | Meaning |
|---|---|
| `AGREE` | Same value. |
| `DIFFER` | Both produced a value and they differ. The interesting one. |
| `BOTH_ERROR` | Both failed. Counted as agreement in substance. |
| `OURS_UNSUPPORTED` | Drools evaluated it; we cannot yet. This is the work queue. |
| `DROOLS_ERROR` | We evaluated it; Drools reported an error. |

The second axis only applies to `DIFFER`, and is what makes the report
actionable — the TCK expectation arbitrates:

| Arbitration | Meaning | What to do |
|---|---|---|
| `DROOLS` | The TCK backs Drools | **Our defect.** Fix it. |
| `OURS` | The TCK backs us | Investigate; likely a Drools extension or a known deviation. |
| `NEITHER` | The TCK backs neither | The expectation is suspect, or all three implement something different. Investigate before changing anything. |
| `BOTH` | Both match the TCK but not each other | Only possible under the recorded-precision rule; means the values agree to the digits the TCK records. |

Knowing that two engines disagree is mildly interesting. Knowing which one the
TCK agrees with tells you who is wrong.

```bash
npm run diff -- --report ourDefects
```

`--report` also accepts `droolsDefects`, `unexplained` and `all`.

## Regenerating the recording

The recording is tied to the pinned TCK commit in
[`tck-version.json`](../packages/tck-runner/tck-version.json): fetch it with
`npm run tck:fetch` before exporting, and re-record whenever the pin moves.

Requires Docker. The Java tool is built and run in containers, so no JDK or
Maven installation is needed.

```bash
npm run diff:export && npm run diff:record
```

The first run pulls a Maven image and downloads the Drools dependency tree into
a named volume (`dmn-m2`); later runs reuse both.

Review the diff to `drools-results.json` before committing. It is the project's
reference oracle, and a change to it means either the case set changed or Drools
changed — both worth understanding rather than absorbing.

## Scope, and what this does not do

The harness **reports; it does not gate**. Divergence from another engine is
evidence to be reviewed, not automatically a build failure — that is what the
TCK baseline is for. An engine disagreeing with Drools may be right.

It also does not settle questions the TCK does not cover. Where neither the TCK
nor Drools speaks to a behaviour, it stays on
[unverified-semantics.md](unverified-semantics.md) until something does.
