# Backend

Schema, row-level security and the expense write path. This is blocks 1 and 2
of the backend work: the data model and who may see what. There is no adapter,
no auth flow and no billing yet — the app still runs entirely on `localStorage`
and none of this is wired to it.

## Files

```
migrations/20260904120000_schema.sql       tables, constraints, invariants
migrations/20260904120100_rls.sql          policy helpers, policies, grants
migrations/20260904120200_expense_rpc.sql  create_expense / replace_expense
migrations/20260907060000_grants.sql       privileges, against the project defaults
tests/00_supabase_stub.sql                 enough of Supabase to run locally
tests/01_rls.sql                           22 assertions on isolation
tests/02_expense_rpc.sql                   6 assertions on the write path
tests/run.sh                               applies everything, runs the suites
```

## A person is an identity, not an account

The app has always had one address space for people: an expense references a
person id, and the overview rolls balances up per counterpart *across* groups.
Two obvious models both break that.

- An id tied to a group membership means the same friend appears once per
  group, and the overview shows them twice.
- An id tied to an auth user cannot represent someone you typed in who never
  signs up — which is most people in most groups.

So `identities` is the person. It may be claimed by an account (`user_id` set)
or not (a placeholder someone introduced). Expenses, settlements and
memberships all reference it, the id stays stable across groups, and when a
placeholder finally signs in they take over the row and their history comes
with them.

The cost of this: two people can each introduce the same human before either
signs up, leaving two identities for one person. Whichever one gets claimed
keeps its history; the other stays a placeholder in a group they are not in.
That is the same duplication a local address book already allows, and merging
them is a question for the sharing block, not the schema.

## Invariants the database enforces

Not because the client is untrusted, but because a rounding bug that reaches
storage is a group whose balances quietly fail to sum to zero.

- Every amount is an integer in the currency's minor unit. No `numeric`, no
  floats, anywhere.
- A split must reconcile to its total. Checked by a deferred constraint
  trigger, and again up front in `create_expense` so the error names the two
  numbers.
- Everyone an expense touches — payer and participants — belongs to its group.
- Both parties to a settlement belong to its group.
- A new account gets a profile, its own identity and an entitlements row in one
  step, so the app never meets a signed-in user who is nobody yet.

## Write expenses through the functions, not the table

An expense and its split are one fact, but two REST inserts are two
transactions: if the second fails, the group keeps an expense somebody paid and
nobody owes. The reconciliation trigger cannot catch that, because it hangs off
the participants table and an expense with no participants never fires it.

`create_expense` and `replace_expense` take the split as one JSON array and
write both halves together. They run as the caller, so every policy still
applies; what they add is atomicity and an error message worth reading.

## A grant on Supabase does not start empty

A project ships with default privileges that hand every new table in `public`
to `anon`, `authenticated` and `service_role`. So the narrow grants at the foot
of the RLS migration never narrowed anything — they added privileges the tables
already had, and the ones deliberately withheld (no update on `settlements`,
nothing at all for `anon`) were granted anyway.

The local suites cannot see this: the stub has no default privileges, so there
the missing grant is what refuses the write, and the assertion passes for the
wrong reason. It took the first run against a real project to surface it, as a
failure on `rls: cannot grant itself a plan`.

Nothing leaked. RLS denies by default, every policy is `to authenticated`, and
`entitlements` has no update policy — so the surplus privilege could not be
exercised. But it was one forgotten policy away from mattering, and a grant
that overstates what is allowed is a grant nobody can review.
`20260907060000_grants.sql` revokes and re-states the lot, and then revokes the
default privileges themselves so the next table does not arrive with the same
problem. The verification asks about the privileges directly, because behaviour
cannot see them — a privilege nothing exercises looks exactly like one that was
never granted.

**So a new table in `public` now reaches no client until it is granted one.**
That includes tables made through the dashboard's table editor, where the
symptom is an API that cannot see a table that plainly exists. Every migration
that adds one has to say who may touch it, in the same file.

## The email says a code, because the app asks for one

`sendEmailCode` calls `signInWithOtp`, and the screen that follows says "we sent
six digits". Supabase ships both templates with `{{ .ConfirmationURL }}` in
them, so out of the box the mail carries a link the app has no way to use — and
a link is the wrong thing anyway: on iOS the system hands it to whichever
browser it likes, which for an installed app is not the app, and the person ends
up signed in somewhere they were not while the icon they tapped still says
signed out.

`templates/code.html` is the body, and it goes in **both** places under
Authentication → Email Templates:

- **Magic Link** — used when the address already has an account
- **Confirm signup** — used the first time an address is seen

`signInWithOtp` chooses between them by whether the user exists. Changing only
one leaves the first sign-in broken, which is the flow nobody tests twice.

The mail says the code lasts an hour, which is the default. Authentication →
Providers → Email → Email OTP Expiration is where that actually lives; if it is
changed, the sentence has to change with it.

## Verifying

```bash
# Local: needs postgres running. Creates a throwaway database and drops it.
supabase/tests/run.sh

# Against a real project — a branch, not production.
DATABASE_URL='postgres://…' supabase/tests/run.sh --remote
```

The connection string from the dashboard is fine. Supabase's `postgres` role
carries `BYPASSRLS`, which would ordinarily make an isolation suite pass while
the app leaked everything — but each suite issues `set local role
authenticated` before it checks anything, and Postgres tests that attribute
against the *current* role, not the session's. Verified: the local runs happen
as a superuser and still fail the moment a policy is wrong.

That protection ends where a suite forgets the `set local role`. Any new
assertion about who can see what belongs after one.

Two behaviours the suites pin down because they surprise people:

- An `update` or `delete` against a row a policy hides matches nothing and
  **succeeds**, affecting zero rows. It is not an error. So those assertions
  check that the row is unchanged, read back with policies off — not that the
  statement was refused. `rls: cannot grant itself a plan` was written the
  wrong way round despite this paragraph sitting above it, and reported a
  failure on a plan that was never in danger. If an assertion is about an
  `update` or a `delete`, it belongs in `check`, not `check_denied`.
- A `deferrable initially deferred` constraint fires at commit. Inside a test
  that never commits it looks like it passed; the helpers issue
  `set constraints all immediate` to force it.

## What has and has not been checked

Verified against PostgreSQL 16 with the stub in `tests/00`, connected as a
non-superuser: 28 assertions, all green — isolation between accounts, the
absence of policy recursion on `group_members`, refusal of self-granted
entitlements, and the money invariants.

Not verified, and worth doing before anything goes live:

- The real `auth` schema. The stub provides `auth.users`, `auth.uid()` and the
  three roles; a real project has more columns, GoTrue's own triggers, and
  session handling this cannot exercise.
- PostgREST. Policies are checked here through `set role authenticated` and a
  `request.jwt.claims` setting, which is what PostgREST does — but not through
  PostgREST itself.
- Realtime. Publication and replica identity are not configured yet; that
  belongs with the sync block.

## Types

Generate them, do not write them by hand:

```bash
supabase gen types typescript --project-id <ref> > src/types/database.ts
```

A hand-kept copy drifts from the schema silently, and the first symptom is a
runtime error in code the compiler said was fine.
