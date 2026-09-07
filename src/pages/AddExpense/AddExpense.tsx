import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import type { CategoryId } from '@/types'
import { useAppStore } from '@/store/appStore'
import { usePeople } from '@/hooks/usePeople'
import { CATEGORIES } from '@/data/mockData'
import { calculateExpenseShares, validateSplit } from '@/lib/calculations'
import { atSameTimeOfDay, dayKey } from '@/lib/dates'
import { minorToInput, parseAmountToMinor } from '@/lib/currency'
import { formatMoney } from '@/lib/formatting'
import { PageHeader } from '@/components/navigation/PageHeader'
import { AmountInput } from '@/components/expenses/AmountInput'
import { ParticipantPicker } from '@/components/expenses/ParticipantPicker'
import { SplitEditor, type SplitState } from '@/components/expenses/SplitEditor'
import { CategoryIcon, GroupIcon } from '@/components/expenses/CategoryIcon'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Avatar } from '@/components/ui/Avatar'
import { useToast } from '@/components/ui/toastContext'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

/**
 * Add and Edit are the same screen. The default path is amount → title →
 * "Add expense"; group, payer, participants and split all carry sensible
 * defaults and only need touching when the default is wrong.
 */
export default function AddExpense() {
  const { id: editingId } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()
  const reduced = useReducedMotion()

  const groups = useAppStore((s) => s.groups)
  const expenses = useAppStore((s) => s.expenses)
  const addExpense = useAppStore((s) => s.addExpense)
  const updateExpense = useAppStore((s) => s.updateExpense)
  const people = usePeople()

  const editing = editingId ? expenses.find((e) => e.id === editingId) : undefined

  const friends = useAppStore((s) => s.friends)
  const ensurePairGroup = useAppStore((s) => s.ensurePairGroup)
  /** Everything except the private one-to-one ledgers, which name no group. */
  const namedGroups = useMemo(() => groups.filter((group) => !group.pairWith), [groups])

  const [groupId, setGroupId] = useState<string>(
    () => editing?.groupId ?? params.get('group') ?? namedGroups[0]?.id ?? '',
  )
  const [amount, setAmount] = useState(() =>
    editing ? minorToInput(editing.amountMinor, editing.currency) : '',
  )
  const [title, setTitle] = useState(() => editing?.title ?? '')
  const [paidBy, setPaidBy] = useState(() => editing?.paidBy ?? people.me ?? '')
  const [category, setCategory] = useState<CategoryId>(() => editing?.category ?? 'food')
  const [spentOn, setSpentOn] = useState(() => dayKey(editing?.createdAt ?? new Date()))
  const [selected, setSelected] = useState<string[]>(
    () => editing?.participants.map((p) => p.personId) ?? [],
  )
  const [split, setSplit] = useState<SplitState>(() => ({
    method: editing?.splitMethod ?? 'equal',
    weights: Object.fromEntries(
      (editing?.participants ?? []).map((p) => [p.personId, p.weight ?? 0]),
    ),
  }))

  const [splitOpen, setSplitOpen] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [payerOpen, setPayerOpen] = useState(false)
  const [errors, setErrors] = useState<{ amount?: string; title?: string; participants?: string }>({})

  const group = groups.find((g) => g.id === groupId)
  const currency = group?.currency ?? 'EUR'
  const members = useMemo(
    () => (group?.members ?? []).map((m) => people.get(m.personId)),
    [group, people],
  )

  // Switching group replaces the member pool, so anyone no longer in it has to
  // drop out of the split rather than silently keeping a stale share.
  useEffect(() => {
    if (!group) return
    const memberIds = group.members.map((m) => m.personId)
    setSelected((current) => {
      const kept = current.filter((personId) => memberIds.includes(personId))
      return kept.length > 0 ? kept : memberIds
    })
    setPaidBy((current) => (memberIds.includes(current) ? current : (people.me ?? memberIds[0])))
  }, [group, people.me])

  const amountMinor = parseAmountToMinor(amount, currency) ?? 0

  const participants = useMemo(
    () => selected.map((personId) => ({ personId, weight: split.weights[personId] })),
    [selected, split.weights],
  )

  const splitValidation = useMemo(
    () => validateSplit(amountMinor, split.method, participants),
    [amountMinor, split.method, participants],
  )

  const previewShares = useMemo(
    () => calculateExpenseShares(amountMinor, split.method, participants),
    [amountMinor, split.method, participants],
  )

  const myShare = previewShares.find((s) => s.personId === people.me)?.shareMinor ?? 0
  const perPerson = selected.length > 0 ? Math.round(amountMinor / selected.length) : 0

  // A friend is enough now — an expense no longer needs a group to live in.
  if (namedGroups.length === 0 && friends.length === 0) {
    return (
      <div>
        <PageHeader title="Add expense" backTo="/overview" />
        <div className="paper px-6 py-12 text-center">
          <p className="display text-xl">Nobody to split with yet.</p>
          <p className="mx-auto mt-2 max-w-[32ch] text-sm leading-relaxed text-muted">
            Add a friend to split with one person, or start a group for a trip.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => navigate('/friends')}>Add a friend</Button>
            <Button variant="outline" onClick={() => navigate('/groups/new')}>
              New group
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (editingId && !editing) return <Navigate to="/overview" replace />

  const submit = () => {
    const nextErrors: typeof errors = {}
    if (amountMinor <= 0) nextErrors.amount = 'Enter an amount above zero.'
    if (!title.trim()) nextErrors.title = 'Give it a name so it makes sense later.'
    if (selected.length === 0) nextErrors.participants = 'Select at least one participant.'
    else if (!splitValidation.valid) {
      nextErrors.participants =
        split.method === 'amount'
          ? `The split must equal ${formatMoney(amountMinor, currency)}.`
          : splitValidation.message
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const payload = {
      groupId,
      title,
      amountMinor,
      currency,
      paidBy,
      splitMethod: split.method,
      participants,
      category,
      createdAt: atSameTimeOfDay(spentOn, editing?.createdAt),
    }

    if (editing) {
      updateExpense(editing.id, payload)
      toast.confirm('Expense updated')
      navigate(`/expenses/${editing.id}`, { replace: true })
    } else {
      addExpense(payload)
      toast.confirm('Expense added')
      // You split with a person, so you land on that person — not on a group
      // screen for a ledger that is deliberately never listed as one.
      navigate(group?.pairWith ? `/friends/${group.pairWith}` : `/groups/${groupId}`, {
        replace: true,
      })
    }
  }

  const stagger = (index: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          transition: { duration: 0.3, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] as const },
        }

  return (
    <div>
      <PageHeader
        title={editing ? 'Edit expense' : 'New expense'}
        backTo="/overview"
        display={false}
      />

      <motion.section {...stagger(0)} className="pb-2 pt-2">
        <AmountInput
          value={amount}
          onChange={(next) => {
            setAmount(next)
            if (errors.amount) setErrors((e) => ({ ...e, amount: undefined }))
          }}
          currency={currency}
          autoFocus={!editing}
          invalid={Boolean(errors.amount)}
        />
        {errors.amount ? (
          <p role="alert" className="mt-3 text-center text-[13px] text-negative">
            {errors.amount}
          </p>
        ) : (
          selected.length > 0 &&
          amountMinor > 0 && (
            <p className="mt-3 text-center text-[13px] text-muted">
              {split.method === 'equal'
                ? `${formatMoney(perPerson, currency)} / person`
                : `Your share ${formatMoney(myShare, currency)}`}
            </p>
          )
        )}
      </motion.section>

      <motion.div {...stagger(1)} className="mt-8">
        <Field label="What did you spend on?" error={errors.title}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                if (errors.title) setErrors((e) => ({ ...e, title: undefined }))
              }}
              placeholder="Dinner"
              enterKeyHint="done"
            />
          )}
        </Field>
      </motion.div>

      {/*
        The date is editable because an expense is almost never logged when it
        happened — it is logged at the next quiet moment, which is often the
        next day and sometimes the flight home.
      */}
      <motion.div {...stagger(2)} className="mt-6">
        <Field label="When">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={spentOn}
              max={dayKey(new Date())}
              onChange={(event) => setSpentOn(event.target.value || dayKey(new Date()))}
            />
          )}
        </Field>
      </motion.div>

      <motion.div {...stagger(3)} className="mt-6 grid gap-2 sm:grid-cols-2">
        <SelectorButton
          label="Split with"
          value={group?.name ?? 'Pick a group or a person'}
          onClick={() => setGroupOpen(true)}
          icon={group && <GroupIcon icon={group.icon} emoji={group.emoji} size={16} />}
        />
        <SelectorButton
          label="Paid by"
          value={paidBy === people.me ? 'You' : people.get(paidBy).name}
          onClick={() => setPayerOpen(true)}
          icon={
            <Avatar
              name={people.get(paidBy).name}
              src={people.get(paidBy).avatarUrl}
              size="xs"
              accent={paidBy === people.me}
            />
          }
        />
      </motion.div>

      <motion.div {...stagger(4)} className="mt-6">
        <p className="eyebrow mb-2">Category</p>
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
          {CATEGORIES.map((option) => (
            <button
              key={option.id}
              onClick={() => setCategory(option.id)}
              aria-pressed={category === option.id}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-md border px-3 text-[13px] font-medium transition-colors duration-micro',
                category === option.id
                  ? 'border-navy bg-navy/[0.05] text-navy'
                  : 'border-line text-muted hover:bg-surface hover:text-ink',
              )}
            >
              <CategoryIcon
                category={option.id}
                size={15}
                className={category === option.id ? 'text-navy' : undefined}
              />
              {option.label}
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div {...stagger(5)} className="mt-8">
        <ParticipantPicker
          people={members}
          selected={selected}
          onToggle={(personId) => {
            setSelected((current) =>
              current.includes(personId)
                ? current.filter((p) => p !== personId)
                : [...current, personId],
            )
            // A membership change invalidates any hand-tuned split.
            if (split.method !== 'equal') setSplit({ method: 'equal', weights: {} })
            if (errors.participants) setErrors((e) => ({ ...e, participants: undefined }))
          }}
          onSelectAll={() => setSelected(members.map((m) => m.id))}
          onSelectNone={() => setSelected([])}
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <p
            className={cn(
              'text-[13px]',
              errors.participants ? 'text-negative' : 'text-muted',
            )}
            role={errors.participants ? 'alert' : undefined}
          >
            {errors.participants ??
              (split.method === 'equal'
                ? 'Split equally'
                : `Split by ${split.method === 'amount' ? 'amount' : split.method}`)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSplitOpen(true)}
            disabled={selected.length === 0}
          >
            <SlidersHorizontal size={14} strokeWidth={1.75} />
            Adjust split
          </Button>
        </div>
      </motion.div>

      <motion.div {...stagger(6)} className="mt-8">
        <Button size="lg" full onClick={submit}>
          {editing ? 'Save changes' : 'Add expense'}
        </Button>
      </motion.div>

      <Sheet
        open={splitOpen}
        onOpenChange={setSplitOpen}
        title="Split"
        description={`${formatMoney(amountMinor, currency)} across ${selected.length} ${
          selected.length === 1 ? 'person' : 'people'
        }`}
        footer={
          <Button full size="lg" onClick={() => setSplitOpen(false)} disabled={!splitValidation.valid}>
            {splitValidation.valid ? 'Done' : splitValidation.message}
          </Button>
        }
      >
        <SplitEditor
          totalMinor={amountMinor}
          currency={currency}
          participants={members.filter((m) => selected.includes(m.id))}
          state={split}
          onChange={setSplit}
        />
      </Sheet>

      {/*
        One picker, two kinds of answer. Splitting with a single person is the
        same act as splitting with a group — it only differs in who is in it —
        so it belongs in the same list rather than behind a mode switch.
      */}
      <Sheet open={groupOpen} onOpenChange={setGroupOpen} title="Split with">
        <div className="pb-4">
          {namedGroups.length > 0 && (
            <>
              <p className="eyebrow pb-1 pt-2">Groups</p>
              <div className="divide-y divide-line">
                {namedGroups.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setGroupId(option.id)
                      setSplit({ method: 'equal', weights: {} })
                      setGroupOpen(false)
                    }}
                    className="flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-surface/60"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-surface text-navy">
                      <GroupIcon icon={option.icon} emoji={option.emoji} size={17} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{option.name}</span>
                    {option.id === groupId && (
                      <Check size={16} strokeWidth={2.5} className="text-navy" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {friends.length > 0 && (
            <>
              <p className="eyebrow pb-1 pt-5">Just one person</p>
              <div className="divide-y divide-line">
                {friends.map((friend) => {
                  const pair = groups.find((g) => g.pairWith === friend.id)
                  return (
                    <button
                      key={friend.id}
                      onClick={() => {
                        // Made on first use, so picking a name nobody has split
                        // with yet does not need a separate setup step.
                        setGroupId(ensurePairGroup(friend.id).id)
                        setSplit({ method: 'equal', weights: {} })
                        setGroupOpen(false)
                      }}
                      className="flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-surface/60"
                    >
                      <Avatar name={friend.name} src={friend.avatarUrl} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[15px]">{friend.name}</span>
                      {pair?.id === groupId && (
                        <Check size={16} strokeWidth={2.5} className="text-navy" />
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </Sheet>

      <Sheet open={payerOpen} onOpenChange={setPayerOpen} title="Paid by">
        <div className="divide-y divide-line pb-4">
          {members.map((member) => (
            <button
              key={member.id}
              onClick={() => {
                setPaidBy(member.id)
                setPayerOpen(false)
              }}
              className="flex w-full items-center gap-3 py-3.5 text-left transition-colors hover:bg-surface/60"
            >
              <Avatar name={member.name} src={member.avatarUrl} size="sm" accent={member.isMe} />
              <span className="min-w-0 flex-1 truncate text-[15px]">
                {member.isMe ? 'You' : member.name}
              </span>
              {member.id === paidBy && <Check size={16} strokeWidth={2.5} className="text-navy" />}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  )
}

function SelectorButton({
  label,
  value,
  onClick,
  icon,
}: {
  label: string
  value: string
  onClick: () => void
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-14 w-full items-center gap-3 rounded-md border border-line px-3.5 text-left transition-colors duration-micro hover:bg-surface/60"
    >
      {icon && <span className="flex shrink-0 items-center text-navy">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="eyebrow block">{label}</span>
        <span className="mt-0.5 block truncate text-[15px]">{value}</span>
      </span>
      <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
    </button>
  )
}
