# Unverified semantics

Behaviours this runtime implements from a reading of the OMG DMN specification,
but has **not yet confirmed against a reference engine**.

Apache KIE Drools is this project's tie-breaker where the DMN specification
is ambiguous. Since the
[differential harness](differential-testing.md) exists, an entry here should be
short-lived: run it, read the arbitration, and either fix the runtime or record
a deviation.

Entries are removed when verified, not when they feel obvious.

## Open

| # | Question | Current behaviour | How to settle it |
|---|----------|-------------------|------------------|
| 2 | Result shape of a decision table with exactly one **named** output | Scalar — the output value, not a context keyed by name | No TCK case exercises it directly. Construct a model with one named output and record what Drools returns. |
| 3 | String ordering for `<`, `<=`, `>`, `>=` | JavaScript code-unit order | No TCK case uses non-ASCII ordering, so the differential run says nothing. Add a case comparing against Java's `compareTo`. |

## Settled

### 1 — `+` concatenates strings — **confirmed**

`compliance-level-2/0001-input-data-string` evaluates `"Hello " + Full Name`
and passes against both the TCK and Drools.

### 4 — precision of `**` — **confirmed correct**

This was the entry flagged as material, and the differential run resolved it in
the runtime's favour.

For `0008-LX-arithmetic` case 002, where `rate/12` does not terminate in decimal
and is then raised to the −60th power:

| Source | Value |
|---|---|
| Exact, computed at 80 significant digits | `562.70735937326592716…` |
| **This runtime** | `562.7073593732659271562143285576524` |
| **Drools 10.2.0** | `562.7073593732659271562143285576524` |
| TCK expectation | `562.707359373292` |
| IEEE-754 binary double | `562.7073593732719` |

Our result is **digit-for-digit identical to Drools across all 34 significant
digits**, and both agree with the mathematically exact value. The same holds for
case 003.

So the divergence is in the recorded TCK expectation, not in either engine. The
concern that "replicate the reference" and "be arithmetically correct" might
pull apart does not arise here: they coincide.

Two consequences:

- **ADR-0001 is validated at full precision.** The decimal implementation
  reproduces the reference engine exactly on the hardest arithmetic the TCK
  contains, which is the strongest available evidence that the numeric model is
  right.
- The affected cases **stay in the TCK baseline as `VALUE_MISMATCH`**. We do
  fail the TCK as written, and inventing a category to excuse it would be
  grading our own homework. The reason is documented here instead.

### 5 — singleton-list coercion — **implemented, and stricter than Drools**

`compliance-level-3/0082-feel-coercion` shows the rule runs in both directions
and, crucially, that it is **conditional on conformance**. The case
descriptions say so outright: "non-conforming singleton list — coercion to
null".

| Case | Declared type | Value | TCK | Drools | Ours |
|---|---|---|---|---|---|
| `literal_005` | `number` | `[10]` | `10` | `10` | `10` |
| `literal_006` | `number` | `["foo"]` | **null** | `"foo"` | **null** |
| `decision_007` | `string` | `["foo"]` | `"foo"` | `"foo"` | `"foo"` |
| `decision_006_a` | list of number | `"foo"` | **null** | `["foo"]` | **null** |

The last two rows are notable: **the TCK and Drools disagree**, and this
runtime follows the TCK. Coercion succeeds only when the value belongs to the
declared type; otherwise the result is null.

Conformance is only ever asserted, never guessed. Where the declared type is
structured, temporal, or unresolvable, the value is accepted — rejecting it
would mean claiming knowledge the type table does not have. A list of lists
keeps its elements unchecked for the same reason.

### 6 — decision-table list semantics — **confirmed missing**

`compliance-level-3/0039-dt-list-semantics`: where the input is a list, we match
fewer rules than Drools and the TCK. Both agree with each other, so this is our
defect.

## Defects the harness confirmed

### Fixed

- **FEEL equality across types returned `false`, should be `null`.**
  `0068-feel-equality`. `feelEquals` now returns `boolean | null`: a comparison
  involving null stays decided, but values of different types are incomparable
  rather than unequal. `!=` propagates the null.
- **Decision-service encapsulation was ignored.** `0085-decision-services`.
  `evaluateDecisionService` now applies the boundary: an `inputDecision` is a
  parameter supplied by the caller and is never evaluated, only decisions
  reachable from the outputs are run, and undeclared inputs are ignored and
  reported. The TCK runner and the Drools reference tool both honour
  `type="decisionService"` on a test case, so the recorded reference comes from
  the same API.

- **Singleton-list coercion** — item 5 above.
- **BKM invocation.** Business knowledge models are function values bound into
  the evaluation context, so a call is a name lookup followed by an invocation
  — whether written as a boxed `<invocation>` with named bindings or as FEEL
  `Name(args)`. Named arguments bind by parameter name, and a binding naming
  something the callee does not declare means the function is never invoked
  (TCK `invoke_007`). Nested invocation is bounded, so a recursive BKM produces
  a diagnostic instead of exhausting the stack.

### Outstanding

1. **Decision-table list semantics** — item 6 above.
2. **Iteration and filters** — `for`, `some`, `every`, `FilterExpression`.
3. **The long tail of built-ins** — regular expressions (`matches`, `replace`),
   `sort`, `context put`, range functions.
4. **`date + days-and-time duration`** widens to a date and time here, per the
   DMN operator table. Confirm against Drools; the differential will say.

Run `npm run diff -- --report ourDefects` for the current list, and
`--report unexplained` for divergences the TCK backs neither engine on.

**Reading `ourDefects` carefully.** The arbitration says which engine the TCK
agrees with; it cannot say whether a difference was deliberate. Of the 30
entries at the time of writing, **several are `0076-feel-external-java`** — models
invoking host Java, which this runtime refuses to execute by design
([SECURITY.md](../SECURITY.md)). Drools runs them and the TCK expects it
to, so they arbitrate as our defects. They are not. Check the construct before
treating an entry as work.

## Number scale is not preserved

FEEL numbers are backed by `decimal.js`, which normalises: `decimal(4, 2)`
yields a value equal to 4 but renders as `4`, where a `BigDecimal` would keep
scale 2 and render `4.00`. Arithmetic and comparison are unaffected; only the
lexical form differs, which matters for `string()` and for anything that
formats a result.

Hosts formatting currency should format at the boundary rather than relying on
the engine to carry scale. Confirm against Drools before deciding whether this
is worth changing — it would move the TCK baseline.

## Performance note

Compiling TCK `0100-arithmetic` — 1087 decisions in one DRG — takes about 75
seconds, essentially all of it in `lezer-feel`, because context-sensitive
parsing consults the scope's name set and that scope currently holds every name
in the model. Evaluation of the same model is 15 ms.

The fix is also a correctness improvement, which is why it is recorded here
rather than as a performance ticket: a decision's expression should only see the
names it declares as requirements, not the whole DRG. Narrowing the scope would
make a thousand-name scope a three-name one, and would additionally reject
expressions that reference decisions they never declared — which Drools treats
as invalid. It is deferred only because it would move the TCK baseline and
deserves its own change.
