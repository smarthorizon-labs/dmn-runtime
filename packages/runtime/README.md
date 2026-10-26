# `@smarthorizon-labs/dmn-runtime`

Decision graph compilation and evaluation for DMN: all seven hit policies,
`COLLECT` aggregations, business knowledge models, decision services with real
encapsulation, and execution tracing with a redaction policy.

Most users want [`@smarthorizon-labs/dmn`](https://github.com/smarthorizon-labs/dmn-runtime/tree/main/packages/dmn)
instead, which bundles this with the XML loader and the FEEL engine.

> **Early release (0.x).** Usable for decision models that stay inside the documented
> feature set. See [what works today](https://github.com/smarthorizon-labs/dmn-runtime#what-works-today) for the exact
> boundary, and [the TCK report](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/docs/tck-report.md) for
> measured conformance.

## Install

```bash
npm install @smarthorizon-labs/dmn-runtime
```

## Usage

```ts
import { compileModel, evaluateModel } from '@smarthorizon-labs/dmn-runtime';
import { loadDmnXml } from '@smarthorizon-labs/dmn-xml';

const compiled = compileModel(loadDmnXml(xml));
const result = evaluateModel(compiled, inputs, {
  // Traces record which decisions ran and which rules matched.
  // They carry no values unless you opt in.
  trace: { level: 'RULES', correlationId: 'case-84731' },
});
```

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
