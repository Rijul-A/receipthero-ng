# Contributing

## Setup

```bash
pnpm install
```

This also installs a pre-commit hook (via husky + lint-staged) that lints and
formats staged files automatically.

## Common commands

Run from the repo root; `turbo` fans these out to every workspace package.

```bash
pnpm dev         # start api, worker and webapp in watch mode
pnpm build       # build all packages
pnpm typecheck   # tsc --noEmit across all packages
pnpm lint        # eslint across all packages
pnpm format      # prettier --write across all packages
pnpm test        # run all test suites
```

## Code style

- TypeScript, ESM (`"type": "module"`) everywhere.
- Formatting is enforced by Prettier (`.prettierrc.json`) — no semicolons,
  single quotes, trailing commas.
- Linting is enforced by ESLint. `apps/webapp` uses
  `@tanstack/eslint-config`; every other package uses the root
  `eslint.config.js`.
- CI (`.github/workflows/ci.yml`) runs lint, format check, typecheck and
  tests on every push/PR to `main`.
