-- sumptus — one paste into the Supabase SQL editor, one table back.
--
-- Everything here happens inside a transaction that rolls back, so the project
-- is left exactly as it was. Run it after the migrations. Every row should say
-- PASS; anything else is a difference between the real platform and the stub
-- the local suites run against, and worth sending back.
--
-- If the editor shows no table, the fallback is:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/verify.sql

begin;

create temporary table verification (
  seq     serial,
  area    text,
  result  text,
  detail  text
) on commit drop;

-- The isolation checks run after `set role authenticated`, and that role owns
-- nothing here. Without these it fails on the scratch table rather than on
-- anything worth reporting.
grant all on verification to authenticated;
grant usage on sequence verification_seq_seq to authenticated;

create or replace function pg_temp.check(area text, cond boolean, detail text default '')
returns void language plpgsql as $$
begin
  insert into verification (area, result, detail)
  values (area, case when cond then 'PASS' else 'FAIL' end, detail);
end $$;

/** Records whether a statement was refused, which is the expected outcome. */
create or replace function pg_temp.check_denied(area text, stmt text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
    set constraints all immediate;
    insert into verification (area, result, detail) values (area, 'FAIL', 'was allowed');
  exception when others then
    insert into verification (area, result, detail) values (area, 'PASS', sqlstate);
  end;
end $$;

-- --- the signup trigger, against the real auth.users ------------------------
-- The likeliest place for the real platform to differ from the local stub:
-- GoTrue's table has columns and triggers of its own.

insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'verify-anna@sumptus.invalid',
   '{"full_name":"Verify Anna"}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'verify-ben@sumptus.invalid',
   '{"full_name":"Verify Ben"}',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

select pg_temp.check('signup: profile created',
  (select count(*) from public.profiles
   where id in ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002')) = 2);

select pg_temp.check('signup: identity created and claimed',
  (select count(*) from public.identities
   where user_id in ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002')) = 2);

select pg_temp.check('signup: entitlements row created, plan free',
  (select count(*) from public.entitlements
   where user_id in ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002')
     and plan = 'free') = 2);

select pg_temp.check('signup: handles are distinct',
  (select count(distinct handle) from public.profiles
   where id in ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002')) = 2);

-- --- fixtures ---------------------------------------------------------------

do $$
declare
  anna uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  ben  uuid := 'bbbbbbbb-0000-4000-8000-000000000002';
  anna_i uuid; ben_i uuid; tom_i uuid; g_anna uuid; g_ben uuid; e uuid;
begin
  select id into anna_i from public.identities where user_id = anna;
  select id into ben_i  from public.identities where user_id = ben;

  insert into public.identities (created_by, display_name) values (anna, 'Verify Tom')
  returning id into tom_i;

  insert into public.groups (name, currency, created_by) values ('Verify Trip', 'EUR', anna)
  returning id into g_anna;
  insert into public.group_members (group_id, identity_id, role)
  values (g_anna, anna_i, 'owner'), (g_anna, tom_i, 'member');

  insert into public.groups (name, currency, created_by) values ('Verify Other', 'EUR', ben)
  returning id into g_ben;
  insert into public.group_members (group_id, identity_id, role) values (g_ben, ben_i, 'owner');

  insert into public.expenses (group_id, title, amount_minor, currency, paid_by, split_method, created_by)
  values (g_anna, 'Verify dinner', 10001, 'EUR', anna_i, 'equal', anna) returning id into e;
  insert into public.expense_participants (expense_id, identity_id, share_minor)
  values (e, anna_i, 5001), (e, tom_i, 5000);

  perform set_config('v.anna', anna::text, true);
  perform set_config('v.ben', ben::text, true);
  perform set_config('v.anna_i', anna_i::text, true);
  perform set_config('v.ben_i', ben_i::text, true);
  perform set_config('v.tom_i', tom_i::text, true);
  perform set_config('v.g_anna', g_anna::text, true);
  perform set_config('v.g_ben', g_ben::text, true);
end $$;

-- --- money invariants -------------------------------------------------------

select pg_temp.check_denied('money: a split must reconcile',
  format($f$
    insert into public.expenses (group_id, title, amount_minor, currency, paid_by, split_method, created_by)
    values (%L, 'Verify bad split', 10000, 'EUR', %L, 'equal', %L);
    insert into public.expense_participants (expense_id, identity_id, share_minor)
    select id, %L, 9999 from public.expenses where title = 'Verify bad split';
  $f$, current_setting('v.g_anna'), current_setting('v.anna_i'),
       current_setting('v.anna'), current_setting('v.anna_i')));

select pg_temp.check_denied('money: payer must be in the group',
  format($f$
    insert into public.expenses (group_id, title, amount_minor, currency, paid_by, split_method, created_by)
    values (%L, 'Verify outsider', 500, 'EUR', %L, 'equal', %L);
  $f$, current_setting('v.g_anna'), current_setting('v.ben_i'), current_setting('v.anna')));

-- --- grants ----------------------------------------------------------------
-- Behaviour cannot see these: a privilege nothing exercises looks exactly like
-- a privilege that was never granted. A Supabase project grants every new table
-- in `public` to anon and authenticated by default, which is how the narrow
-- grants in the RLS migration came to mean nothing.

select pg_temp.check('grants: anon reaches nothing',
  not has_table_privilege('anon', 'public.groups',   'SELECT')
  and not has_table_privilege('anon', 'public.expenses', 'SELECT')
  and not has_table_privilege('anon', 'public.profiles', 'SELECT'));

select pg_temp.check('grants: entitlements and passes are read-only to clients',
  not has_table_privilege('authenticated', 'public.entitlements', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.entitlements', 'INSERT')
  and not has_table_privilege('authenticated', 'public.entitlements', 'DELETE')
  and not has_table_privilege('authenticated', 'public.group_passes', 'UPDATE'));

select pg_temp.check('grants: a settlement cannot be edited into something else',
  not has_table_privilege('authenticated', 'public.settlements', 'UPDATE'));

-- --- isolation, as a signed-in user ----------------------------------------
-- BYPASSRLS lives on the current role, so switching to `authenticated` makes
-- the policies apply even from the dashboard's superuser connection.

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('v.anna'))::text, true);

select pg_temp.check('rls: Anna sees only her own group',
  (select count(*) from public.groups) = 1);

select pg_temp.check('rls: no recursion reading memberships',
  (select count(*) from public.group_members) = 2);

select pg_temp.check('rls: Ben''s group is invisible',
  (select count(*) from public.groups where id = current_setting('v.g_ben')::uuid) = 0);

select pg_temp.check('rls: strangers'' profiles are invisible',
  not exists (select 1 from public.profiles where id = current_setting('v.ben')::uuid));

select pg_temp.check_denied('rls: cannot write into a foreign group',
  format($f$
    insert into public.expenses (group_id, title, amount_minor, currency, paid_by, split_method, created_by)
    values (%L, 'Verify intruder', 100, 'EUR', %L, 'equal', %L);
  $f$, current_setting('v.g_ben'), current_setting('v.ben_i'), current_setting('v.anna')));

/*
 * Not check_denied, however much it looks like its twin above.
 *
 * There is no update policy on entitlements, and an update against rows no
 * policy exposes matches nothing and *succeeds* — zero rows, no error. Once the
 * grants are tightened it is refused outright instead. Both outcomes are
 * correct and only one of them raises, so asking "was it refused" measures the
 * wrong thing; the first run against a real project reported a failure here
 * while the plan was never in any danger.
 *
 * The question worth asking is whether the plan changed.
 */
do $$
begin
  update public.entitlements set plan = 'pro' where user_id = current_setting('v.anna')::uuid;
exception when others then
  null; -- refused outright: also a pass, and what the grants now produce
end $$;

select pg_temp.check('rls: cannot grant itself a plan',
  (select plan from public.entitlements where user_id = current_setting('v.anna')::uuid) = 'free',
  'plan after trying to set it to pro');

select pg_temp.check_denied('rls: cannot claim another account''s identity',
  format($f$
    insert into public.identities (user_id, created_by, display_name)
    values (%L, %L, 'Verify stolen');
  $f$, current_setting('v.ben'), current_setting('v.anna')));

-- --- the expense write path -------------------------------------------------

do $$
declare made uuid; parts int; total bigint;
begin
  made := public.create_expense(
    current_setting('v.g_anna')::uuid, 'Verify rpc', 301, 'EUR',
    current_setting('v.anna_i')::uuid, 'equal',
    jsonb_build_array(
      jsonb_build_object('identity_id', current_setting('v.anna_i'), 'share_minor', 151),
      jsonb_build_object('identity_id', current_setting('v.tom_i'),  'share_minor', 150)
    ));
  select count(*), sum(share_minor) into parts, total
  from public.expense_participants where expense_id = made;
  perform pg_temp.check('rpc: create_expense writes both halves, odd cent included',
    parts = 2 and total = 301, format('%s participants, %s total', parts, total));
end $$;

select pg_temp.check_denied('rpc: refuses a split that does not add up',
  format($f$ select public.create_expense(%L, 'Verify rpc bad', 300, 'EUR', %L, 'equal',
    jsonb_build_array(jsonb_build_object('identity_id', %L, 'share_minor', 299))); $f$,
    current_setting('v.g_anna'), current_setting('v.anna_i'), current_setting('v.anna_i')));

-- --- account deletion -------------------------------------------------------

select public.delete_my_account();

reset role;

select pg_temp.check('delete: the account is gone',
  not exists (select 1 from auth.users where id = current_setting('v.anna')::uuid));

select pg_temp.check('delete: the person stays, unclaimed and named',
  (select display_name from public.identities where id = current_setting('v.anna_i')::uuid) = 'Verify Anna'
  and (select user_id from public.identities where id = current_setting('v.anna_i')::uuid) is null);

select pg_temp.check('delete: the ledger survives',
  (select count(*) from public.expenses where group_id = current_setting('v.g_anna')::uuid) >= 1);

-- --- the result -------------------------------------------------------------

select
  case when result = 'PASS' then '✓' else '✗ FAIL' end as status,
  area,
  detail
from verification
order by seq;

rollback;
