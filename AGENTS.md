# Project guidance

A personal finance ledger that runs entirely on the phone (Expo / React Native), with an optional in-app AI assistant. Read README.md and docs/decisions.md before changing anything. The latest explicitly confirmed decisions supersede earlier notes.

## Priorities

DRY, logical efficiency, proportional solutions, object ownership of functionality and processes, and security.

- **No server.** The ledger is a SQLite file on the device. Do not add a backend, accounts or sync without the owner's instruction.
- **Manual use works without AI.** The assistant is optional; never make a feature depend on it.
- **One set of rules.** Every way of recording money (the editor, bookmarks, repeating entries, the assistant, balance corrections) goes through the services in `src/core`. Screens and the assistant never write SQL.
- **The assistant cannot save.** It reads through the same services and can only produce a proposal (`ChangeService.preview`). Committing takes the person's tap, and a commit refuses if the outcome would differ from what was shown. Do not give the model a tool that writes.
- **Model output and files are untrusted input.** Tool arguments, backup files and provider responses are validated before use.
- **Secrets** (sign-in tokens, API keys) live only in secure storage, never in the ledger, backups, logs or the repository. Never commit real financial data.
- Money is whole minor units; rates are exact decimals. No floating-point money.
- Every ledger command is atomic, version-checked where a screen could be stale, and recorded in the change history.

Test money and account effects, atomic transfers, retry safety (repeating entries, commits), correction and recovery, and the preview/commit guarantee. Keep incomplete features honestly documented in the README. Do not add budgets, splits or investment features merely because other apps have them.

## Structure

- `src/core` is plain TypeScript with no React, React Native or Expo imports, so it runs under Node for tests. Each service owns its tables.
- `src/assistant` depends on `src/core` and on injected platform pieces (fetch, secure storage, browser).
- `src/platform` is the only place that touches Expo device modules for storage, secrets and sign-in.
- `src/app` holds screens only; shared components live in `src/ui`.

## Commands

```bash
npm test             # vitest, on Node's built-in SQLite
npm run typecheck    # tsc --noEmit
npx expo start       # dev server
npx expo install <package>   # always use this to add packages, so versions match the SDK
```

Run tests and typecheck before declaring a task done.

## Expo

Expo ships breaking changes every SDK release; APIs you remember may be renamed or removed. Read the `expo` major version in `package.json` and check the matching docs (`https://docs.expo.dev/versions/v<major>.0.0/`, index at `https://docs.expo.dev/llms.txt`) or the package's own type definitions before using an Expo API.

- Use Expo Router; routes live in `src/app`.
- `ios/` and `android/` are generated. Never edit them by hand; configure native behaviour in `app.json`.
- Expo Go only includes its bundled native modules. `react-native-tcp-socket` (used for Sign in with ChatGPT) is not one of them, so anything that needs it must degrade cleanly in Expo Go.
- The browser build is a development preview: SQLite runs in memory there and nothing persists.
