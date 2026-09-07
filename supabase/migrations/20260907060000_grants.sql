-- sumptus — make the grants say what the app actually allows
--
-- A Supabase project ships with default privileges that hand every new table in
-- `public` to anon, authenticated and service_role:
--
--   alter default privileges in schema public grant all on tables
--     to postgres, anon, authenticated, service_role;
--
-- So the careful, narrow grants at the foot of the RLS migration never narrowed
-- anything. They added privileges the tables already had, and the ones
-- deliberately left out — no update on settlements, nothing at all for anon —
-- were granted regardless. The first verification run against a real project
-- caught it; the local suites could not, because the stub has no such defaults.
--
-- Nothing leaked. Row level security denies by default, every policy is `to
-- authenticated`, and there is no update policy on entitlements — which is why
-- the symptom was an odd one: an update that is neither refused nor effective,
-- silently touching zero rows.
--
-- That is still the wrong place to be standing. The privilege was one forgotten
-- policy away from being real, and a grant that overstates what is allowed is a
-- grant nobody can review. So: revoke first, then grant exactly what the
-- policies expect, and let the verification pin it down from here on.
--
-- service_role is deliberately untouched. Entitlements are written by the
-- payment webhook running under it, and that path must keep working.

revoke all on
  public.profiles, public.identities, public.groups, public.group_members,
  public.expenses, public.expense_participants, public.settlements,
  public.invitations, public.entitlements, public.group_passes
from anon;

revoke all on
  public.profiles, public.identities, public.groups, public.group_members,
  public.expenses, public.expense_participants, public.settlements,
  public.invitations, public.entitlements, public.group_passes
from authenticated;

-- Re-granted in full here rather than left to the RLS migration, so this file
-- is the whole truth about who may touch what.

grant select, update                    on public.profiles             to authenticated;
grant select, insert, update, delete    on public.identities           to authenticated;
grant select, insert, update, delete    on public.groups               to authenticated;
grant select, insert, update, delete    on public.group_members        to authenticated;
grant select, insert, update, delete    on public.expenses             to authenticated;
grant select, insert, update, delete    on public.expense_participants to authenticated;

-- A recorded payment is history: correcting one means deleting it and recording
-- the right one, so there is no update policy and now no update grant either.
grant select, insert, delete            on public.settlements          to authenticated;

-- The secret lives in the link and only its hash is stored; an invitation is
-- created or revoked, never edited.
grant select, insert, delete            on public.invitations          to authenticated;

-- Read-only, in every case. A client that could write here could grant itself
-- Pro, and the only thing that stopped it before was the absence of a policy.
grant select                            on public.entitlements         to authenticated;
grant select                            on public.group_passes         to authenticated;
