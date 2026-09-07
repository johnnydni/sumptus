import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store/appStore'
import { usePeople } from '@/hooks/usePeople'
import { useNetworkSimplification } from '@/hooks/useLedger'
import { PageHeader } from '@/components/navigation/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Sheet'
import { EmptyState, SectionHeader } from '@/components/ui/Primitives'
import { useToast } from '@/components/ui/toastContext'
import { formatMoney, pluralize } from '@/lib/formatting'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { cn } from '@/lib/cn'

/**
 * The pitch is one sentence: fewer payments, same final balance. Everything on
 * this screen exists to make that claim checkable — the before count, the after
 * count, and every proposed transfer listed in full.
 */
export default function SmartSettlement() {
  const navigate = useNavigate()
  const toast = useToast()
  const people = usePeople()
  const preferences = useAppStore((s) => s.preferences)
  const addSettlement = useAppStore((s) => s.addSettlement)
  const groups = useAppStore((s) => s.groups)
  const { direct, simplified, saved } = useNetworkSimplification()
  const reduced = useReducedMotion()
  const [confirm, setConfirm] = useState(false)

  const currency = preferences.currency
  const mine = simplified.filter(
    (t) => t.fromPersonId === people.me || t.toPersonId === people.me,
  )

  const applyAll = () => {
    for (const transfer of simplified) {
      addSettlement({
        fromPersonId: transfer.fromPersonId,
        toPersonId: transfer.toPersonId,
        amountMinor: transfer.amountMinor,
        currency,
        groupId: transfer.groupId,
      })
    }
    toast.confirm("Settled — you're all square")
    navigate('/overview', { replace: true })
  }

  if (simplified.length === 0) {
    return (
      <div>
        <PageHeader title="Smart settlement" backTo="/settle" />
        <EmptyState
          title="You're all square."
          body="Nothing outstanding anywhere. No payments to make."
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Smart settlement" backTo="/settle" />

      <section className="paper px-5 py-7 sm:px-8">
        <p className="display text-[26px] leading-snug">
          Your expenses created {pluralize(direct.length, 'direct obligation')}.
        </p>
        <p className="display mt-1 text-[26px] leading-snug text-navy">
          {simplified.length === 1
            ? 'One payment settles all of them.'
            : `${simplified.length} payments settle all of them.`}
        </p>

        {saved > 0 && (
          <div className="mt-6 flex items-center gap-3">
            <Counter value={direct.length} label="obligations" />
            <ArrowRight size={16} strokeWidth={1.75} className="text-muted" />
            <Counter value={simplified.length} label="payments" accent />
          </div>
        )}
      </section>

      <section className="mt-9">
        <SectionHeader title="Suggested payments" />
        <div className="divide-y divide-line border-t border-line">
          {simplified.map((transfer, index) => {
            const from = people.get(transfer.fromPersonId)
            const to = people.get(transfer.toPersonId)
            const involvesMe = from.isMe || to.isMe
            return (
              <motion.div
                key={`${transfer.groupId}-${transfer.fromPersonId}-${transfer.toPersonId}`}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.28, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-3 py-4"
              >
                <span className="flex items-center gap-2">
                  <Avatar name={from.name} src={from.avatarUrl} size="sm" accent={from.isMe} />
                  <ArrowRight size={13} strokeWidth={1.75} className="text-muted/60" />
                  <Avatar name={to.name} src={to.avatarUrl} size="sm" accent={to.isMe} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">
                    {from.isMe ? 'You' : from.name.split(' ')[0]}
                    <span className="text-muted"> → </span>
                    {to.isMe ? 'You' : to.name.split(' ')[0]}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted">
                    {groups.find((g) => g.id === transfer.groupId)?.name}
                  </span>
                </span>
                <span
                  className={cn(
                    'tnum shrink-0 text-[15px] font-medium',
                    involvesMe ? (from.isMe ? 'text-negative' : 'text-positive') : 'text-navy',
                  )}
                >
                  {formatMoney(transfer.amountMinor, currency)}
                </span>
              </motion.div>
            )
          })}
        </div>
      </section>

      <section className="mt-9 rounded-md bg-surface px-5 py-6">
        <p className="text-[15px] font-medium">Fewer payments.</p>
        <p className="text-[15px] font-medium text-muted">Same final balance.</p>
        <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
          Who paid for what doesn&rsquo;t change — only who transfers money to whom. Nobody ends up
          better or worse off than the expenses already left them
          {mine.length > 0 && `, you included: ${formatSummary(mine.length)} to make`}.
        </p>
      </section>

      <div className="mt-8">
        <Button size="lg" full onClick={() => setConfirm(true)}>
          Settle these balances
        </Button>
        <p className="mt-3 text-center text-[13px] text-muted">
          Records {pluralize(simplified.length, 'payment')} at once.
        </p>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Settle everything?"
        body={`This records ${pluralize(
          simplified.length,
          'payment',
        )} and brings every balance to zero. Only do this once the money has actually moved.`}
        confirmLabel="Settle"
        onConfirm={applyAll}
      />
    </div>
  )
}

function formatSummary(count: number) {
  return count === 1 ? 'one payment' : `${count} payments`
}

function Counter({
  value,
  label,
  accent = false,
}: {
  value: number
  label: string
  accent?: boolean
}) {
  return (
    <span
      className={cn(
        'flex flex-col items-center rounded-sm border px-4 py-2',
        accent ? 'border-navy/30 bg-navy/[0.05]' : 'border-line',
      )}
    >
      <span className={cn('tnum text-xl font-medium', accent && 'text-navy')}>{value}</span>
      <span className="text-2xs uppercase tracking-[0.12em] text-muted">{label}</span>
    </span>
  )
}
