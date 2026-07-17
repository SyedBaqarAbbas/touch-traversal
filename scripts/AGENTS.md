# Root tooling script guide

Scripts here validate repository-wide developer contracts. They should be small, dependency-light,
non-interactive, and safe to run from the repository root.

`verify-root-tooling.mjs` checks pinned tool versions, workspace scripts, Make targets, line-ending
configuration, ignore/privacy rules, and required files. Keep its errors actionable and collect all
failures before exiting so one run explains every root problem.

When root package scripts, workspace layout, tool versions, Make targets, or privacy rules change,
update this script and its corresponding repository tests in the same change. Do not make validation
scripts install dependencies, mutate source files, contact external services, or expose environment
values.

Verify changes with:

```bash
pnpm run test:root
```
