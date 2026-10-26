# Checks

```bash
npm test              # every suite
npm test cash fy      # only suites whose name contains "cash" or "fy"
```

A green run is one line per suite. A failure prints the assertion that broke
and exits non-zero.

## What these are

There is no test runner in this project. Each suite is a TypeScript file that
imports the app's own modules, asserts against them, and prints a line per
assertion. `tests/run.mjs` bundles each one with esbuild — which resolves the
`@/` alias and strips the types — and runs it under node.

They are not unit tests in the usual sense and they do not aim at coverage.
Each one exists because something specific went wrong, or was about to:

| Suite | What it guards |
| --- | --- |
| `assetcheck` | Depreciation: the three methods, business-use share, part-year, disposal |
| `attncheck` | The attention list, and overdue scheduled payments reaching it |
| `calfincheck` | Finished jobs staying on the calendar, and only in the past |
| `cashcheck` | Cash is not deductible and cash income is off the books |
| `duecheck` | Scheduled payments pending and overdue, cash jobs included |
| `fycheck` | The Australian financial year, and BAS quarters inside it |
| `helpcheck` | Every Dashboard KPI explains itself |
| `hourscheck` | The labour hours budget, and what is left of it |
| `hoursreadcheck` | Reading a message into logged hours |
| `jobpagecheck` | The job page's headline and its table agree; cost is never charge |
| `keycheck` | No two queries share a cache key while returning different columns |
| `labourtilescheck` | Only hourly work counts as billable; fixed-quote hours do not |
| `linecheck` | Invoice lines, and add-ons becoming lines without being billed twice |
| `partlabourcheck` | Pinning a process step's labour to a part of a split quote |
| `payschedcheck` | Building a payment schedule, and its milestones |
| `depositcheck` | The booking deposit percentage, and what it comes to |
| `suggestcheck` | What the invoice modal offers, and the deposit counted once |

An earlier set covering the quote builder, the agent and the quote PDF was
lost when a temp directory was swept. That is why these live in the repo now.

## Writing one

Copy the shape of any existing suite:

```ts
import { thing } from '@/lib/thing'

let fail = 0
const ok = (c: boolean, m: string) => { if (!c) { fail++; console.log('FAIL', m) } else console.log('ok  ', m) }

ok(thing(2) === 4, 'two doubles to four')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
```

Rules the runner depends on:

- The filename ends in `check.ts`, which is how it is found.
- The last line printed is `all passed` or `N FAILED`.
- The exit code is 0 or 1 to match.
- Failing assertions start their line with `FAIL`, which is what gets echoed.

Two conventions worth keeping:

**Write the message as the claim, not the function name.** `'a cash purchase
claims no GST credit'` tells you what broke; `'testGstCredit'` does not.

**Assert against figures worked out by hand.** A test that recomputes the
thing it is testing agrees with any bug the code has.

## Rules this runner enforces

**Always rebuild.** A stale bundle once reported "all passed" against a
version of the code that no longer existed, hiding nineteen real failures.
Nothing is reused between runs, and the bundles go to a temp directory rather
than into the repo.

**Fail loudly.** A suite that will not bundle, or that falls over before it
can report, is a failure and not a skip.

## What they cannot see

These run under node with a fake Supabase URL and key, so nothing talks to the
database and nothing renders. A suite can read the app's source as text —
`keycheck` and `helpcheck` both do, because the fault they look for is in how
the code is written rather than what it computes — but it cannot click
anything. `npm run build` is still the gate that catches type errors, and the
browser is still the only thing that proves a page works.
