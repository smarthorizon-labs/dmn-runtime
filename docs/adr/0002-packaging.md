# ADR-0002 — Module format and supported runtimes

- **Status:** Accepted; Node.js floor amended 2026-10-26
- **Date:** 2026-07-27
- **Related:** [Compatibility](../../README.md#compatibility)

## Context

The runtime is meant to be straightforward for TypeScript applications to
install and use. Packaging is the first thing every adopter encounters, and a
wrong choice is felt immediately.

`feelin` 7 is ESM-only and requires Node.js ≥ 20.12, which pushed towards
publishing ESM-only. [ADR-0001](0001-numeric-semantics.md) replaces that direct
dependency with `lezer-feel`, which itself publishes dual ESM and CommonJS, so
the constraint no longer applies.

Goldman Sachs' `jdmn-js-runtime` — the closest comparable package — publishes
`main` for CommonJS, `module` for ESM and `browser` for the web build, behind a
conditional `exports` map.

## Decision

Publish **dual ESM and CommonJS entry points plus a browser build**, behind a
conditional `exports` map, with TypeScript declarations for each.

Support **every Node.js LTS line that still receives security fixes**: the
floor is the oldest such line, not the newest release. As of the amendment
below that is Node.js 22, declared as `>=22.12.0` — the release from which
`require()` of an ES module works without a flag, and the floor of the
current build and test toolchain.

Core packages — model, xml, feel-adapter, runtime, validation, tracing — must
not import `node:*`. Filesystem access, worker creation and process control
belong to the CLI, the TCK runner and host adapters.

## Consequences

A CommonJS service can evaluate a decision without restructuring itself, which
is the point.

Dual packaging is easy to declare and easy to get subtly wrong, so CI must run
an install-and-import smoke test against both entry points rather than trusting
the manifest.

The `node:*` prohibition is what makes the browser target achievable rather
than aspirational, and it must be enforced by a lint rule rather than by
convention.

## Amendment — 2026-10-26: Node.js 20 → 22

The original decision set the floor at Node.js 20 as "an active LTS line".
Node.js 20 reached end of life on 2026-04-30, before the first public
release, so it no longer met the rule it was chosen by. The rule is restated
above in the form the Node.js ecosystem commonly uses — every line still
receiving security fixes — and the floor moves to Node.js 22.

The immediate trigger was a dependency audit: the patched releases of the
test toolchain require Node.js 22, and holding a floor on an unsupported
runtime would have meant keeping development tooling on older majors to
test it.

No published version ever declared Node.js 20, so this breaks no user.

The floor will move again when Node.js 22 reaches end of life (April 2027).
While the major version is `0`, that is a minor release, listed in the
changelog.

## Reversal conditions

Revisit if the Node.js ecosystem's CommonJS usage declines to the point where
dual publishing costs more than it returns, or if a dependency becomes
ESM-only and cannot be bundled.
