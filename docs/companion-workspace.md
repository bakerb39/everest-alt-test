# Everest Companion workspace

Built on Brian's `bakerb39/everest-alt-test` main at `7c0eda6a24b065152d082f6425ea28f624d6169c`, on `feature/companion-workspace`. No changes to Josh's repository or deployment.

The Companion adds Dashboard, Reminders & ideas, and Gift gallery tabs. The existing standalone gallery remains available and shares its photo/filter renderer with the panel. Photos load automatically. Account reminders and ideas retain completed/dismissed history, support restoration, and use revision numbers to reject stale responses. Saving and browsing do not place orders or spend budget.

New tools: `show_everest_panel`, `save_everest_item`, `update_everest_item`, and app-only `get_panel_gifts`. Resources are bundled into generated templates at build time. The Save button works in an iframe sandbox without `allow-forms`.

## Development

Run `npm ci` and `npm run dev`. The preview uses disposable in-memory fixtures and an MCP Apps host bridge. Width controls cover 320, 420 and 820 pixels. Dashboard links and display-mode requests are recorded by the host mock, not executed against a real account.

Run `npm test` for existing regressions, account isolation, full history, revisions, bundled resources, and serverless persistence. Existing stale tool-count and unauthenticated-resource test expectations were corrected; production authentication behavior was not changed.

Browser checks covered reminder save/complete/dismiss/restore, stale-response replay, history, recipient handoff to gallery, automatic photos, saved gift ideas, retained filters, dashboard counts, and no horizontal overflow at 320px. The 420px view was visually reviewed. Actual ChatGPT placement and live authenticated connector behavior still require a later deployment and client acceptance test.

Before transferring this feature to Josh's application, map the account/storage/catalog interfaces and verify both the standalone and embedded galleries. This branch is for review, not production deployment.
