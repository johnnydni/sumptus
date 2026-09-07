import { Link } from 'react-router-dom'
import type { CurrencyCode, Group } from '@/types'
import { DEFAULT_COVER_OFFSET } from '@/lib/images'
import { GroupIcon } from '@/components/expenses/CategoryIcon'
import { AvatarStack } from '@/components/ui/Avatar'
import { formatMoney, formatSignedMoney, pluralize } from '@/lib/formatting'
import type { Person } from '@/hooks/usePeople'
import { cn } from '@/lib/cn'

interface GroupCardProps {
  group: Group
  members: Person[]
  expenseCount: number
  totalMinor: number
  /** The current user's net position in this group. */
  yourNetMinor: number
  currency: CurrencyCode
}

export function GroupCard({
  group,
  members,
  expenseCount,
  totalMinor,
  yourNetMinor,
  currency,
}: GroupCardProps) {
  const settled = yourNetMinor === 0

  return (
    <Link
      to={`/groups/${group.id}`}
      className="paper group flex items-center gap-4 px-4 py-4 transition-colors duration-micro hover:border-ink/20 hover:bg-surface/40"
    >
      {group.coverUrl ? (
        <img
          src={group.coverUrl}
          alt=""
          className="h-11 w-11 shrink-0 rounded-sm border border-line object-cover"
          style={{ objectPosition: `50% ${group.coverY ?? DEFAULT_COVER_OFFSET}%` }}
        />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-surface text-navy">
          <GroupIcon icon={group.icon} emoji={group.emoji} size={19} />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{group.name}</span>
        <span className="mt-0.5 block truncate text-[13px] text-muted">
          {pluralize(members.length, 'person', 'people')} · {pluralize(expenseCount, 'expense')}
        </span>
      </span>

      <span className="hidden shrink-0 sm:block">
        <AvatarStack people={members} max={4} size="xs" />
      </span>

      <span className="shrink-0 text-right">
        <span className="tnum block text-[15px] font-medium">
          {formatMoney(totalMinor, currency)}
        </span>
        <span
          className={cn(
            'tnum mt-0.5 block text-[13px]',
            settled ? 'text-muted' : yourNetMinor > 0 ? 'text-positive' : 'text-negative',
          )}
        >
          {settled ? 'settled' : formatSignedMoney(yourNetMinor, currency)}
        </span>
      </span>
    </Link>
  )
}
