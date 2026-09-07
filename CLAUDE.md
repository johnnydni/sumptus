# Working on sumptus

## Shipping

Merging to `main` is pre-authorised — no need to ask. `main` deploys straight to
GitHub Pages, so a merge is a production release.

Merge only when all four are true. If any one of them fails, stop and say so
rather than merging:

```bash
npm run lint
npm test -- --run          # every test green, none skipped
npm run build              # type-checks first
cmp dist/index.html dist/404.html   # the Pages SPA fallback
```

Work on `claude/sumptus-expense-app-53l0gn`, push there, then fast-forward
`main` onto it. Rebase rather than merge-commit when `main` has moved on, and
check that nothing would be lost first:

```bash
git log --oneline HEAD..origin/main   # must be empty
```

Confirm a push landed by comparing refs, not by the command looking fine. A
pipe hands back the exit code of its *last* stage, so `git push … | tail -1`
reports success no matter how the push went — which once left the feature
branch six commits behind `main` without a word:

```bash
git push origin <branch>; echo "exit=$?"
git fetch origin
git rev-parse --short <branch> refs/remotes/origin/<branch>   # must match
```

No pull request unless asked for one.

## Money

Three rules the test suite exists to protect. Breaking one silently produces
wrong balances, which is the one failure this app cannot afford.

1. **Integers only.** Every amount is an integer in the currency's minor unit.
   No floats, and never parse a formatted string back into a calculation.
2. **Splits reconcile exactly.** `allocate()` uses largest-remainder allocation
   with ties broken by index, so the parts always sum to the total and the same
   inputs give the same cents on every device.
3. **One debt graph.** Balances are net positions per group; suggested payments
   come from `settleBalances()`. A pairwise ledger cannot absorb a simplified
   payment — that bug shipped once and the tests now pin it down.

Prices belong to this too: `src/data/plans.ts` holds them in minor units and
they render through `formatMoney`.

Components never do arithmetic on money. They read derived values from
`useLedger`; the maths lives in `src/lib/calculations`.

## Checking UI changes

Look at the screen before claiming it works. Playwright is deliberately not a
dependency — drive the pre-installed Chromium over CDP instead
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--no-proxy-server`,
`--remote-debugging-port`). Seed an onboarded state with
`Page.addScriptToEvaluateOnNewDocument` writing `sumptus.state.v1`, since most
routes sit behind the onboarding guard.

Two traps that make a sound layout look broken:

- `Page.getLayoutMetrics().cssContentSize` drops the trailing margin the bottom
  nav needs. Use `document.documentElement.scrollHeight`.
- Set the viewport *before* scrolling. Resizing afterwards resets the position.

Screens fade in; they do not move. Entry animations that translate content
(`y: 8` on the route wrapper, staggered `y: 10` on a page's own sections) look
like polish in a screenshot and like an app that cannot hold still by the
fiftieth tap — and they compound, because the shell and the page both animate.
Opacity carries "new screen" on its own. Sliding is reserved for things that
genuinely arrive from an edge: the toast, and a newly added row.

`npm run preview` does its own SPA fallback, so it hides exactly the Pages
routing bugs worth catching. Serve `dist/` under a `/sumptus/` path with a
plain static server instead.

That path is the repository name, not the product name: the app is called
sumptus, and so is the repository now. The deploy workflow reads the real
name from GitHub, so renaming the repository moves the live site on its own —
`REPO` in `vite.config.ts` is the local build's copy of it and has to be changed
by hand at the same time.

## Plans

The pricing model is copy, not behaviour: nothing enforces the Free tier's
group tickets or the trip length, because there is no billing to lift a limit
once hit and a cap in local storage is one a user can edit. Both belong with
entitlements. `CURRENT_PLAN_ID` is a constant for the same reason.

The tier boundary is drawn on cost, not on feature value: anything with no
per-use cost can live in a one-time plan, anything with a recurring third-party
bill has to sit behind a subscription. Check new features against that before
adding them to `ONE_TIME_PLANS`.

Selling happens through the stores, which cannot price anything at runtime:
every amount has to exist as a registered product first. So a rule like "a euro
per further week" becomes a short ladder of fixed prices — `TRIP_TIERS` — and
not a formula. Keep any ladder to a handful of rungs; each one is a product to
keep in step across two stores.
