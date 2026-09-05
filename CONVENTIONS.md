# Conventions

- Keep native integrations independent of the auxiliary CLI. A normal consumer build must run required static checks.
- Shared rules are parameterized libraries. Never infer a business architecture and silently enforce it.
- Use native parsers and build dependency models where available. Document unsupported analysis instead of reporting it as passed.
- Preserve existing consumer build commands and configuration; initialization produces a reviewable patch.
- Reports use versioned JSON and distinguish pass, fail, skipped, and error. Required checks fail closed.
- Test published artifacts in independent consumer projects, including a deliberate violation.
- TypeScript packages use ESM and strict compilation. Java/Swift integrations follow their native conventions.
- Keep commits focused and describe behavior and validation. Do not publish artifacts or create releases as part of local verification.
