import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The way to start a group from a list of groups.
 *
 * It sits at the end of the grid rather than in a header because that is where
 * the question gets asked: you look at what you have, and the next thought is
 * one more. The overview offered this only while you had none — the button
 * lived in the empty state and vanished with it, which left the screen with no
 * route to a new group at all once one existed.
 *
 * Shaped like the cards above it, one row tall, and drawn in outline so it
 * reads as an opening in the list rather than another entry in it.
 */
export function NewGroupCard({ className }: { className?: string }) {
  return (
    <Link
      to="/groups/new"
      className={cn(
        'group flex items-center gap-4 rounded-md border border-dashed border-line px-4 py-4 text-muted transition-colors duration-micro hover:border-ink/25 hover:bg-surface/40 hover:text-ink',
        className,
      )}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border border-dashed border-line transition-colors group-hover:border-ink/25">
        <Plus size={19} strokeWidth={1.75} />
      </span>
      <span className="text-[15px] font-medium">New group</span>
    </Link>
  )
}
