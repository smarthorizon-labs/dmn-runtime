# `@smarthorizon-labs/dmn`

A TypeScript engine for [DMN](https://www.omg.org/dmn/) decision models: load
DMN XML, resolve the decision graph, evaluate FEEL and decision tables, and get
a structured result with an audit trace.

This is the one-install entry point — it re-exports the runtime, the FEEL
engine, the model types and the XML loader, and adds nothing of its own.

> **Early release (0.x).** Usable for decision models that stay inside the documented
> feature set. See [what works today](https://github.com/smarthorizon-labs/dmn-runtime#what-works-today) for the exact
> boundary, and [the TCK report](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/docs/tck-report.md) for
> measured conformance.

## Install

```bash
npm install @smarthorizon-labs/dmn
```

## Usage

```ts
import { readFileSync } from 'node:fs';
import { compileModel, evaluateModel, loadDmnXml, toFeelNumber, describeValue } from '@smarthorizon-labs/dmn';

// Compile once, then reuse. Nothing is parsed again per request.
const compiled = compileModel(loadDmnXml(readFileSync('pricing.dmn', 'utf8')));

const result = evaluateModel(compiled, {
  // Pass money as a *string*. A JavaScript number has already lost precision.
  Order: { Total: toFeelNumber('1499.99'), Country: 'PT' },
});

for (const [name, decision] of result.decisions) {
  console.log(name, describeValue(decision.value));
}
```

Arithmetic is decimal — `MathContext.DECIMAL128`, 34 significant digits,
`HALF_EVEN` — matching every DMN engine with demonstrated conformance. `0.1 +
0.2` equals `0.3`.

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
