# Decisions

## Confirmed by the owner (2026-11-11)

- **A new idea, in a new repository.** The earlier self-hosted app (`personal-finance`) stays as its own separate thing; this is not a migration of it.
- **Everything is local to the phone. No server.**
- **No joint or shared space.** Each person's ledger is on their own phone. The app may be shared with friends and family, each with their own copy.
- **AI inside the app, not through MCP.** The intended route is Sign in with ChatGPT, so the assistant uses the person's ChatGPT plan.
- **Expo**, so it can run on both iPhone and Android.
- **Open source** (Apache 2.0), and it may be published.
- Phone only; no desktop or browser version is needed.

## Carried over from the earlier app's principles

- Manual use must work independently of AI.
- All entry paths share the same ledger commands and validation.
- DRY, proportional solutions, object ownership, security.
- Budgets and split transactions wait for a dedicated design discussion.
- The ledger rules themselves: opening balances are not income; transfers are neither income nor spending; money back nets off its own kind; refunds never exceed the purchase; balance corrections are tagged entries; valuations are not transactions; card Payable and Outstanding are derived, not stored; a foreign entry keeps the rate it was saved with; recurring entries are generated as independent transactions, exactly once each; deletes go to a recycle bin.

## Choices made while building, for the owner to review

These were made without discussion to get a working prototype. Any of them can change.

1. **The assistant has no way to save.** In the earlier app the model called a commit tool and ChatGPT asked for confirmation. Here the model can only propose; the Approve button in the app does the commit. This is a stronger guarantee than the earlier design and suits an in-app assistant.
2. **An OpenAI API key is offered as a second way to connect.** Sign in with ChatGPT cannot run in Expo Go and is unverified against OpenAI, so without this the assistant could not be tried at all. Both use the same API. Remove it if only plan sign-in is wanted.
3. **The display name is "Pocket Ledger".** A placeholder; change `name` in `app.json`.
4. **Net worth is grouped by account group**, with a per-account "Count in net worth" switch. The earlier app had separate net worth categories, performance figures and reminders; those were not ported.
5. **A refund links to one purchase.** The earlier app's one-payment-for-several-purchases refund groups were not ported.
6. **Twelve currencies** (all two-decimal): GBP, EUR, USD, AUD, CAD, CHF, CZK, DKK, NOK, NZD, PLN, SEK. Net worth history values other currencies at today's rate, which is approximate for the past.
7. **Recurring entries run when the app opens or returns to the foreground**, since there is no server to run them on time. They are back-dated to when they fell due.
8. **Backups are a plain JSON file** shared through the phone's share sheet, not encrypted.
9. **Reference exchange rates are fetched daily by default** from frankfurter.dev (currency codes only), with a switch to turn it off.
10. **App lock is optional and off by default.**
11. **The assistant's conversation is not kept** after the app closes, and nothing is stored by OpenAI (`store: false`).
12. Work is on the `claude/friendly-tesla-estbam` branch; `main` still holds only the initial commit.

## Sign in with ChatGPT: what is known

- OpenAI documents a self-serve flow for open-source apps: dynamic client registration, PKCE, a loopback redirect (`http://127.0.0.1:<port>/auth/callback`), plan usage through the Responses API with streaming and `store: false`.
- The loopback redirect means the app must listen on a local port during sign-in. That needs a native TCP module (`react-native-tcp-socket`), so it needs a development or release build and cannot work in Expo Go.
- At least one other open-source mobile app has implemented the same flow this way.
- **Open questions:** whether OpenAI accepts a published mobile app under the open-source path (its docs describe apps running on the user's own machine; the other app planned to ask OpenAI before an app-store release), and whether the flow works end to end from this app. Neither has been tested.
- Plan usage needs ChatGPT Plus or Pro. A Free account is reported as not eligible.

## Open questions for the owner

1. Is the API-key option wanted long term, or only until plan sign-in is proven?
2. Should backups be encrypted with a passphrase?
3. Which of the "Not built yet" items in the README matter most? Money Manager import and attachments were both wanted in the earlier app.
4. iPhone distribution: TestFlight needs the paid Apple developer programme.
