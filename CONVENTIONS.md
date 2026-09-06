# Conventions

- This project is the hard-gate layer of an agent harness: enforce explicit engineering constraints through native builds and return immediate, actionable feedback. Agent runtime, planning, context management and session recovery are outside its scope.
- Keep native integrations independent of the auxiliary CLI. A normal consumer build must run required static checks.
- Attach checks to the earliest build phase that has their required inputs. Preserve useful rule diagnostics and nonzero failure exits; evaluate changes by feedback quality, latency and enforcement correctness.
- Shared rules are parameterized libraries. Never infer a business architecture and silently enforce it.
- Use native parsers and build dependency models where available. Document unsupported analysis instead of reporting it as passed.
- Preserve existing consumer build commands and configuration; initialization produces a reviewable patch.
- Reports use versioned JSON and distinguish pass, fail, skipped, and error. Required checks fail closed.
- Test published artifacts in independent consumer projects, including a deliberate violation.
- TypeScript packages use ESM and strict compilation. Java/Swift integrations follow their native conventions.
- Keep commits focused and describe behavior and validation. Do not publish artifacts or create releases as part of local verification.
