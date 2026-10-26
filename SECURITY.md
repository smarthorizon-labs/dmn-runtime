# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's **Report a
vulnerability** button on the Security tab, or by email to
`security@smarthorizonconsulting.com`.

Please do not open a public issue for an unfixed vulnerability.

Include the affected version, a reproduction — ideally a DMN model or FEEL
expression — and the impact you observed. We aim to acknowledge within three
working days and to agree a disclosure timeline with you.

## Threat model

This runtime is designed on the assumption that **DMN models and FEEL
expressions may be supplied by untrusted parties**. A model is data; it must
never become host code. Specifically, in scope:

- arbitrary code execution reachable from model or expression content;
- escape from the FEEL function environment into host APIs — filesystem,
  network, process, environment variables, module loading;
- prototype pollution through crafted context keys or model names;
- XML attacks during model loading: external entities, entity expansion,
  network retrieval;
- denial of service through pathological models, expressions or inputs that
  evade the documented resource limits;
- information disclosure through traces or diagnostics that expose input data
  the caller did not opt into.

Out of scope:

- vulnerabilities in host applications that pass unvalidated data through this
  runtime;
- resource exhaustion in a deployment that accepts untrusted models without the
  worker isolation the documentation requires for that scenario;
- results a caller disagrees with on FEEL semantics — those are correctness
  issues, and belong in the public tracker.

## Known enforcement limits

Stated plainly because a security policy that overpromises is worse than none.

`timeoutMs` is a **cooperative** bound. It is checked between decisions,
between decision-table rules and around invocations. It cannot interrupt a
single pathological FEEL expression mid-evaluation, because synchronous
JavaScript offers no preemption point. Hard interruption requires the worker
isolation adapter.

**Any deployment that evaluates untrusted models must run the runtime under
worker or process isolation.** Cooperative limits alone are not sufficient.

## Supported versions

The project is pre-1.0. Until a stable release, only the current `main` branch
receives fixes.
