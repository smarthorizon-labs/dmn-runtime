# `@smarthorizon-labs/dmn-xml`

Secure, version-aware DMN XML loading. DMN 1.1 through 1.5 are detected from
the namespace and normalized into one internal model, so nothing downstream
branches on version.

Security is the point of the package: DTDs are rejected outright — no entity
expansion, no billion laughs — with size and depth limits, no network access
and no filesystem access. Source positions are preserved so diagnostics can
point at the line that caused them.

> **Early release (0.x).** Usable for decision models that stay inside the documented
> feature set. See [what works today](https://github.com/smarthorizon-labs/dmn-runtime#what-works-today) for the exact
> boundary, and [the TCK report](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/docs/tck-report.md) for
> measured conformance.

## Install

```bash
npm install @smarthorizon-labs/dmn-xml
```

## Usage

```ts
import { loadDmnXml, detectDmnVersion } from '@smarthorizon-labs/dmn-xml';

const model = loadDmnXml(xml);
console.log(model.dmnVersion, model.decisions.length);
```

Loading an untrusted model is safe; *evaluating* one is not yet — see the
[security policy](https://github.com/smarthorizon-labs/dmn-runtime/blob/main/SECURITY.md).

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
