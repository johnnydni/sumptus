import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { usePeople } from "@/hooks/usePeople";
import { useActivity, useOverallLedger } from "@/hooks/useLedger";
import { calculateGroupBalances } from "@/lib/calculations";
import { greeting } from "@/lib/dates";
import { BalanceCard } from "@/components/balance/BalanceCard";
import { GroupCard } from "@/components/groups/GroupCard";
import { ActivityRow } from "@/components/activity/ActivityRow";
import { EmptyState, List, SectionHeader } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export default function Overview() {
  const user = useAppStore((s) => s.user);
  const groups = useAppStore((s) => s.groups);
  const expenses = useAppStore((s) => s.expenses);
  const settlements = useAppStore((s) => s.settlements);
  const preferences = useAppStore((s) => s.preferences);
  const people = usePeople();
  const ledger = useOverallLedger();
  const activity = useActivity(5);
  const reduced = useReducedMotion();

  /** Per-group totals and the user's position in each, computed once. */
  const groupSummaries = useMemo(
    () =>
      groups
        .filter((group) => !group.pairWith)
        .map((group) => {
          const groupExpenses = expenses.filter((e) => e.groupId === group.id);
          const groupSettlements = settlements.filter(
            (s) => s.groupId === group.id,
          );
          const memberIds = group.members.map((m) => m.personId);
          const balances = calculateGroupBalances(
            groupExpenses,
            groupSettlements,
            memberIds,
          );
          return {
            group,
            members: memberIds.map((id) => people.get(id)),
            expenseCount: groupExpenses.length,
            totalMinor: groupExpenses.reduce(
              (sum, e) => sum + e.amountMinor,
              0,
            ),
            yourNetMinor:
              balances.find((b) => b.personId === people.me)?.netMinor ?? 0,
          };
        }),
    [groups, expenses, settlements, people],
  );

  /* Fades, not lifts. A section that slides up into place moves the line the
     eye is already reading, and four of them staggered turn arriving on the
     overview into half a second of drift. */
  const section = (index: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: {
            duration: 0.35,
            delay: index * 0.06,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <div className="space-y-10">
      <motion.header {...section(0)}>
        <h1 className="display text-[26px] leading-tight">
          {greeting()}, {user?.name ?? "there"}.
        </h1>
      </motion.header>

      <motion.div {...section(1)}>
        <BalanceCard
          netMinor={ledger.netMinor}
          owedToYouMinor={ledger.owedToYouMinor}
          youOweMinor={ledger.youOweMinor}
          currency={preferences.currency}
        />
      </motion.div>

      <motion.section {...section(2)}>
        <SectionHeader
          title="Recent activity"
          action={
            activity.length > 0 && (
              <Link
                to="/activity"
                className="text-[13px] font-medium text-navy hover:opacity-70"
              >
                See all
              </Link>
            )
          }
        />
        {activity.length === 0 ? (
          <EmptyState
            title="Nothing yet."
            body="Your expenses and settlements will show up here as they happen."
          />
        ) : (
          <List className="border-t border-line">
            {activity.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </List>
        )}
      </motion.section>

      <motion.section {...section(3)}>
        <SectionHeader
          title="Your groups"
          action={
            groups.length > 0 && (
              <Link
                to="/groups"
                className="text-[13px] font-medium text-navy hover:opacity-70"
              >
                See all
              </Link>
            )
          }
        />
        {groups.length === 0 ? (
          <EmptyState
            title="Nothing shared yet."
            body="Create your first group and start splitting expenses."
            action={
              <Button asChild>
                <Link to="/groups/new">
                  <Plus size={16} strokeWidth={2} />
                  Create group
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {groupSummaries.slice(0, 4).map((summary) => (
              <GroupCard
                key={summary.group.id}
                group={summary.group}
                members={summary.members}
                expenseCount={summary.expenseCount}
                totalMinor={summary.totalMinor}
                yourNetMinor={summary.yourNetMinor}
                currency={summary.group.currency}
              />
            ))}
          </div>
        )}
      </motion.section>
    </div>
  );
}
