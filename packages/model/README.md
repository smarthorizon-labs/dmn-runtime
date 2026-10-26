# `@smarthorizon-labs/dmn-model`

The normalized DMN model: the TypeScript types that DMN 1.1 through 1.5
documents are loaded into, plus indexing and type-guard helpers.

Types only — no runtime behaviour beyond `indexModel` and the guards. Depend on
this directly if you are writing a tool that inspects or transforms models
without evaluating them.

> **Early release (0.x).** Usable for decision models that stay inside the documented
> feature set. See [what works today](https://github.com/smarthorizon-labs/dmn-runtime#what-works-today) for the exact
> boundary, and [the TCK report](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/docs/tck-report.md) for
> measured conformance.

## Install

```bash
npm install @smarthorizon-labs/dmn-model
```

## Usage

```ts
import { indexModel, isDecision, type DmnModel } from '@smarthorizon-labs/dmn-model';

const index = indexModel(model);
const element = index.byName.get('Loan Pre-Qualification');

// Names defined more than once are collected rather than silently resolved.
if (index.duplicateNames.length > 0) { /* addressing by name is ambiguous */ }
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
