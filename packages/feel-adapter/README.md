# `@smarthorizon-labs/dmn-feel`

A [FEEL](https://www.omg.org/spec/DMN/) parser and evaluator for TypeScript,
with the decimal arithmetic the DMN specification requires.

FEEL is DMN's expression language, but it stands on its own as a safe,
side-effect-free language for user-authored expressions — pricing formulas,
eligibility conditions, validation rules. Model content is data, never host
code: no `eval`, no `new Function`.

Numbers are `MathContext.DECIMAL128` decimals — 34 significant digits,
`HALF_EVEN` rounding — which is what Drools, IBM BAMOE, jDMN and Camunda's
FEEL-Scala all use, and
[verified against Drools digit for digit](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/docs/unverified-semantics.md).

> **Early release (0.x).** Usable for decision models that stay inside the documented
> feature set. See [what works today](https://github.com/smarthorizon-labs/dmn-runtime#what-works-today) for the exact
> boundary, and [the TCK report](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/docs/tck-report.md) for
> measured conformance.

## Install

```bash
npm install @smarthorizon-labs/dmn-feel
```

## Usage

```ts
import { createFeelEngine, toFeelNumber, describeValue } from '@smarthorizon-labs/dmn-feel';

const engine = createFeelEngine();

// Compile once, evaluate many times.
const compiled = engine.compileExpression('Total * (1 + Rate)');
const { value } = compiled.evaluate({
  Total: toFeelNumber('1499.99'),
  Rate: toFeelNumber('0.23'),
});

console.log(describeValue(value)); // 1844.9877
```

The grammar is [`lezer-feel`](https://github.com/nikku/lezer-feel) by Nico
Rehwaldt; evaluation is original work. See [NOTICE](NOTICE).

## Part of a set

| Package | Use it for |
|---|---|
| [`@smarthorizon-labs/dmn`](https://github.com/smarthorizon-labs/dmn-runtime/tree/main/packages/dmn) | **Start here.** Everything below, one install |
| [`@smarthorizon-labs/dmn-runtime`](https://github.com/smarthorizon-labs/dmn-runtime/tree/main/packages/runtime) | Decision graph, decision tables, tracing |
| [`@smarthorizon-labs/dmn-feel`](https://github.com/smarthorizon-labs/dmn-runtime/tree/main/packages/feel-adapter) | FEEL parsing and evaluation |
| [`@smarthorizon-labs/dmn-xml`](https://github.com/smarthorizon-labs/dmn-runtime/tree/main/packages/xml) | Secure DMN XML loading |
| [`@smarthorizon-labs/dmn-model`](https://github.com/smarthorizon-labs/dmn-runtime/tree/main/packages/model) | Normalized model types |

Full documentation, TCK results and design rationale are in the
[repository README](https://github.com/smarthorizon-labs/dmn-runtime#readme).

## License

[Apache-2.0](LICENSE). Third-party attributions are in [NOTICE](NOTICE).
