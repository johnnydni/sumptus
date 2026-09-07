import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Plus, UserPlus } from 'lucide-react'
import type { GroupIconId } from '@/types'
import { useAppStore } from '@/store/appStore'
import { spentTickets } from '@/lib/calculations'
import { FREE_GROUP_TICKETS, MAX_TRIP_DAYS, PLAN_CURRENCY, tripTierFor } from '@/data/plans'
import { dayKey, tripLengthInDays } from '@/lib/dates'
import { formatMoney } from '@/lib/formatting'
import { usePeople } from '@/hooks/usePeople'
import { PageHeader } from '@/components/navigation/PageHeader'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Avatar } from '@/components/ui/Avatar'
import { GroupIcon } from '@/components/expenses/CategoryIcon'
import { Sheet } from '@/components/ui/Sheet'
import { CoverPicker } from '@/components/groups/CoverPicker'
import { DEFAULT_COVER_OFFSET } from '@/lib/images'
import { useToast } from '@/components/ui/toastContext'
import { cn } from '@/lib/cn'

const ICON_OPTIONS: Array<{ id: GroupIconId; label: string }> = [
  { id: 'travel', label: 'Travel' },
  { id: 'food', label: 'Food' },
  { id: 'home', label: 'Home' },
  { id: 'sports', label: 'Sports' },
  { id: 'event', label: 'Event' },
  { id: 'custom', label: 'Custom' },
]

const EMOJI_CHOICES = ['🎿', '🎬', '🏝️', '🎸', '🚲', '☕️', '🐕', '🎂']

export default function CreateGroup() {
  const navigate = useNavigate()
  const toast = useToast()
  const createGroup = useAppStore((s) => s.createGroup)
  const addFriend = useAppStore((s) => s.addFriend)
  const friends = useAppStore((s) => s.friends)
  const people = usePeople()

  const expenses = useAppStore((s) => s.expenses)
  const settlements = useAppStore((s) => s.settlements)
  const groups = useAppStore((s) => s.groups)

  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState(() => dayKey(new Date()))
  const [endsOn, setEndsOn] = useState(() => dayKey(new Date()))
  const [icon, setIcon] = useState<GroupIconId>('travel')
  const [coverUrl, setCoverUrl] = useState<string>()
  const [coverY, setCoverY] = useState(DEFAULT_COVER_OFFSET)
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const [addOpen, setAddOpen] = useState(false)
  const [newFriendName, setNewFriendName] = useState('')

  const days = tripLengthInDays(startsOn, endsOn)

  /*
   * A ticket is spent per open group, so the question is how many are still
   * held — not how many groups exist. Settling one, or closing it by hand,
   * gives its ticket back and this drops again.
   */
  const ticketsInUse = useMemo(
    () => spentTickets(groups, expenses, settlements, people.me),
    [groups, expenses, settlements, people.me],
  )
  const noTicketLeft = ticketsInUse >= FREE_GROUP_TICKETS
  // The length is what prices the pass, so the figure is only real once the
  // dates make sense.
  const passTier = days > 0 ? tripTierFor(days) : undefined

  const toggleMember = (id: string) =>
    setMemberIds((current) =>
      current.includes(id) ? current.filter((m) => m !== id) : [...current, id],
    )

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Give the group a name.')
      return
    }
    if (days === 0) {
      setError('The end cannot come before the start.')
      return
    }
    if (days > MAX_TRIP_DAYS) {
      setError(`A trip runs up to ${MAX_TRIP_DAYS} days. This one is ${days}.`)
      return
    }
    if (noTicketLeft) return

    const group = createGroup({
      name,
      icon,
      emoji: icon === 'custom' ? emoji : undefined,
      coverUrl,
      coverY,
      memberIds,
      startsOn,
      endsOn,
    })
    toast.confirm('Group created')
    navigate(`/groups/${group.id}`, { replace: true })
  }

  const createFriend = () => {
    if (!newFriendName.trim()) return
    const friend = addFriend({ name: newFriendName })
    setMemberIds((current) => [...current, friend.id])
    setNewFriendName('')
    setAddOpen(false)
  }

  return (
    <form onSubmit={submit}>
      <PageHeader title="New group" backTo="/groups" />

      <div className="space-y-8">
        <Field label="Group name" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(undefined)
              }}
              placeholder="Japan Trip"
              autoFocus
            />
          )}
        </Field>

        {/*
          Asked for up front rather than buried in settings: the length is what
          decides whether this group fits in the free plan, so it cannot be an
          afterthought at the point of creation.
        */}
        <div>
          <p className="eyebrow mb-2">How long does it run?</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={startsOn}
                  onChange={(event) => {
                    const next = event.target.value || startsOn
                    setStartsOn(next)
                    // Dragging the start past the end would otherwise leave an
                    // impossible range on screen for the user to notice.
                    if (next > endsOn) setEndsOn(next)
                    if (error) setError(undefined)
                  }}
                />
              )}
            </Field>
            <Field label="To">
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={endsOn}
                  min={startsOn}
                  onChange={(event) => {
                    setEndsOn(event.target.value || endsOn)
                    if (error) setError(undefined)
                  }}
                />
              )}
            </Field>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {days === 0
              ? 'The end cannot come before the start.'
              : days > MAX_TRIP_DAYS
                ? `${days} days — longer than a trip can run (${MAX_TRIP_DAYS}).`
                : `${days} ${days === 1 ? 'day' : 'days'}.`}
          </p>
        </div>

        {noTicketLeft && (
          <section className="rounded-md border border-line bg-surface px-4 py-4">
            <p className="text-[15px] font-medium">
              Both of your group tickets are in use.
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Free runs {FREE_GROUP_TICKETS} groups of your own at a time. Settle one — or
              close it by hand if someone has stopped paying — and its ticket comes back.
              Groups other people start never count against you.
            </p>
            {passTier && (
              <p className="mt-3 text-sm leading-relaxed text-muted">
                A Trip Pass covers this one on its own:{' '}
                <span className="tnum text-ink">
                  {formatMoney(passTier.priceMinor, PLAN_CURRENCY)}
                </span>{' '}
                for {passTier.label.toLowerCase()}.
              </p>
            )}
            <Link
              to="/plan"
              className="mt-3 inline-flex text-sm font-medium text-navy transition-opacity hover:opacity-70"
            >
              See the plans
            </Link>
          </section>
        )}

        <CoverPicker value={coverUrl} offset={coverY} onChange={setCoverUrl} onOffsetChange={setCoverY} />

        <fieldset>
          <legend className="eyebrow mb-2">{coverUrl ? 'Icon (used in lists)' : 'Icon'}</legend>
          <div className="grid grid-cols-6 gap-2">
            {ICON_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setIcon(option.id)}
                aria-pressed={icon === option.id}
                aria-label={option.label}
                title={option.label}
                className={cn(
                  'flex h-12 items-center justify-center rounded-md border transition-colors duration-micro',
                  icon === option.id
                    ? 'border-navy bg-navy text-white'
                    : 'border-line text-muted hover:bg-surface hover:text-ink',
                )}
              >
                <GroupIcon
                  icon={option.id}
                  emoji={option.id === 'custom' ? emoji : undefined}
                  size={19}
                />
              </button>
            ))}
          </div>

          {icon === 'custom' && (
            <div className="mt-3 flex flex-wrap gap-2">
              {EMOJI_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setEmoji(choice)}
                  aria-pressed={emoji === choice}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-sm border text-lg transition-colors',
                    emoji === choice ? 'border-navy bg-navy/[0.06]' : 'border-line hover:bg-surface',
                  )}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Add people</p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-navy hover:opacity-70"
            >
              <UserPlus size={14} strokeWidth={2} />
              Add friend
            </button>
          </div>

          {friends.length === 0 ? (
            <div className="paper px-5 py-8 text-center">
              <p className="text-sm text-muted">
                No friends yet — add someone to split with.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setAddOpen(true)}
              >
                <Plus size={15} strokeWidth={2} />
                Add friend
              </Button>
            </div>
          ) : (
            <div className="paper divide-y divide-line">
              {friends.map((friend) => {
                const selected = memberIds.includes(friend.id)
                return (
                  <button
                    key={friend.id}
                    type="button"
                    onClick={() => toggleMember(friend.id)}
                    aria-pressed={selected}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-micro hover:bg-surface/60"
                  >
                    <Avatar name={friend.name} src={friend.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{friend.name}</span>
                    <span
                      className={cn(
                        'flex h-[22px] w-[22px] items-center justify-center rounded-xs border transition-all duration-micro',
                        selected ? 'border-navy bg-navy text-white' : 'border-line',
                      )}
                    >
                      {selected && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <p className="mt-2 text-[13px] text-muted">
            You&rsquo;re in the group automatically
            {memberIds.length > 0 &&
              ` — ${memberIds.length + 1} ${memberIds.length === 0 ? 'person' : 'people'} total`}
            .
          </p>
        </section>

        <div className="flex items-center gap-3 pt-2">
          {memberIds.length > 0 && (
            <span className="flex -space-x-2">
              {[people.me, ...memberIds].filter(Boolean).slice(0, 5).map((id) => {
                const person = people.get(id as string)
                return (
                  <Avatar
                    key={id}
                    name={person.name}
                    src={person.avatarUrl}
                    size="sm"
                    accent={person.isMe}
                    className="ring-2 ring-canvas"
                  />
                )
              })}
            </span>
          )}
          {/* Disabled rather than allowed-then-refused: the panel above already
              says why, and a button that accepts a tap and does nothing is
              worse than one that plainly cannot be pressed. */}
          <Button
            type="submit"
            size="lg"
            disabled={noTicketLeft}
            className="ml-auto min-w-[160px]"
          >
            Create group
          </Button>
        </div>
      </div>

      <Sheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add friend"
        description="They'll be added to your circle and this group."
        footer={
          <Button full size="lg" onClick={createFriend} disabled={!newFriendName.trim()}>
            Add
          </Button>
        }
      >
        <Field label="Name">
          {({ id }) => (
            <Input
              id={id}
              value={newFriendName}
              onChange={(event) => setNewFriendName(event.target.value)}
              placeholder="Alex Müller"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  createFriend()
                }
              }}
            />
          )}
        </Field>
      </Sheet>
    </form>
  )
}
