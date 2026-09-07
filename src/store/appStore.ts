import { create } from 'zustand'
import type {
  CurrencyCode,
  Expense,
  Friend,
  Group,
  GroupIconId,
  PersistedState,
  Preferences,
  Settlement,
  SplitMethod,
  User,
} from '@/types'
import { createId } from '@/lib/id'
import { calculateExpenseShares, type ShareInput } from '@/lib/calculations'
import { createDemoState, createEmptyState } from '@/data/mockData'
import { localAdapter } from './persistence/localAdapter'
import type { PersistenceAdapter } from './persistence/types'

/**
 * Swap this single binding for a SupabaseAdapter and the whole app moves to a
 * backend. Nothing below reaches past the interface.
 */
const adapter: PersistenceAdapter = localAdapter

export interface NewExpenseInput {
  groupId: string
  title: string
  amountMinor: number
  currency: CurrencyCode
  paidBy: string
  splitMethod: SplitMethod
  participants: ShareInput[]
  category: Expense['category']
  note?: string
  /** Only set when back-dating; defaults to now. */
  createdAt?: string
}

interface AppState extends PersistedState {
  hydrated: boolean

  hydrate: () => Promise<void>
  seedDemo: () => Promise<void>
  resetEverything: () => Promise<void>

  completeOnboarding: (input: {
    name: string
    avatarUrl?: string
    currency: CurrencyCode
  }) => Promise<void>
  updateUser: (patch: Partial<User>) => void
  setPreferences: (patch: Partial<Preferences>) => void

  addFriend: (input: { name: string; handle?: string; email?: string }) => Friend
  removeFriend: (id: string) => void

  createGroup: (input: {
    name: string
    icon: GroupIconId
    emoji?: string
    coverUrl?: string
    coverY?: number
    memberIds: string[]
    currency?: CurrencyCode
    /** Both or neither — a start without an end is not a length. */
    startsOn?: string
    endsOn?: string
  }) => Group
  /** The private ledger with one person, made on first use. */
  ensurePairGroup: (personId: string) => Group
  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) => void
  deleteGroup: (id: string) => void

  addExpense: (input: NewExpenseInput) => Expense
  updateExpense: (id: string, input: NewExpenseInput) => void
  deleteExpense: (id: string) => void

  addSettlement: (input: {
    fromPersonId: string
    toPersonId: string
    amountMinor: number
    currency?: CurrencyCode
    groupId?: string
    note?: string
  }) => Settlement
  deleteSettlement: (id: string) => void
}

function snapshot(state: AppState): PersistedState {
  return {
    version: state.version,
    user: state.user,
    onboarded: state.onboarded,
    friends: state.friends,
    groups: state.groups,
    expenses: state.expenses,
    settlements: state.settlements,
    preferences: state.preferences,
  }
}

export const useAppStore = create<AppState>()((set, get) => {
  /** Apply a state patch and push the resulting snapshot to storage. */
  const commit = (patch: Partial<AppState>) => {
    set(patch)
    void adapter.saveSnapshot(snapshot(get()))
  }

  return {
    ...createEmptyState(),
    hydrated: false,

    async hydrate() {
      const stored = await adapter.load()
      if (stored) {
        set({ ...stored, hydrated: true })
        return
      }
      // First run: land on the Welcome screen with an empty store. The demo
      // data is opt-in from Welcome / Profile so the empty states stay real.
      set({ ...createEmptyState(), hydrated: true })
    },

    async seedDemo() {
      const demo = createDemoState()
      set({ ...demo, hydrated: true })
      await adapter.saveSnapshot(demo)
    },

    async resetEverything() {
      await adapter.clear()
      set({ ...createEmptyState(), hydrated: true })
    },

    async completeOnboarding({ name, avatarUrl, currency }) {
      const user: User = {
        id: get().user?.id ?? createId('u'),
        name: name.trim(),
        handle: name.trim().toLowerCase().replace(/\s+/g, ''),
        avatarUrl,
        currency,
        createdAt: new Date().toISOString(),
      }
      commit({
        user,
        onboarded: true,
        preferences: { ...get().preferences, currency },
      })
      await adapter.setUser(user)
    },

    updateUser(patch) {
      const current = get().user
      if (!current) return
      const user = { ...current, ...patch }
      commit({ user })
      void adapter.setUser(user)
    },

    setPreferences(patch) {
      const preferences = { ...get().preferences, ...patch }
      commit({ preferences })
      void adapter.setPreferences(preferences)
    },

    addFriend({ name, handle, email }) {
      const friend: Friend = {
        id: createId('f'),
        name: name.trim(),
        handle: (handle ?? name).trim().toLowerCase().replace(/[^a-z0-9]/g, ''),
        email,
        createdAt: new Date().toISOString(),
      }
      commit({ friends: [...get().friends, friend] })
      void adapter.insertFriend(friend)
      return friend
    },

    removeFriend(id) {
      // Removing someone must not orphan history: they stay on past expenses,
      // only the address-book entry and future group membership go away.
      commit({
        friends: get().friends.filter((f) => f.id !== id),
        groups: get().groups.map((g) => ({
          ...g,
          members: g.members.filter((m) => m.personId !== id),
        })),
      })
      void adapter.removeFriend(id)
    },

    createGroup({ name, icon, emoji, coverUrl, coverY, memberIds, currency, startsOn, endsOn }) {
      const now = new Date().toISOString()
      const me = get().user?.id
      const uniqueMembers = [...new Set([...(me ? [me] : []), ...memberIds])]
      const group: Group = {
        id: createId('g'),
        name: name.trim(),
        icon,
        emoji,
        coverUrl,
        coverY,
        currency: currency ?? get().preferences.currency,
        createdBy: me,
        members: uniqueMembers.map((personId) => ({ personId, joinedAt: now })),
        // Kept together: half a range is worse than none, because every
        // consumer would then have to invent the missing end.
        ...(startsOn && endsOn ? { startsOn, endsOn } : {}),
        createdAt: now,
      }
      commit({ groups: [...get().groups, group] })
      void adapter.insertGroup(group)
      return group
    },

    ensurePairGroup(personId) {
      const existing = get().groups.find((group) => group.pairWith === personId)
      if (existing) return existing

      const now = new Date().toISOString()
      const me = get().user?.id
      const friend = get().friends.find((f) => f.id === personId)
      const group: Group = {
        id: createId('g'),
        // Named after the person so it reads sensibly anywhere it surfaces —
        // an expense's detail screen, an export — even though no list shows it.
        name: friend?.name ?? 'Shared',
        icon: 'custom',
        currency: get().preferences.currency,
        createdBy: me,
        pairWith: personId,
        members: [...(me ? [me] : []), personId].map((id) => ({ personId: id, joinedAt: now })),
        createdAt: now,
      }
      commit({ groups: [...get().groups, group] })
      void adapter.insertGroup(group)
      return group
    },

    updateGroup(id, patch) {
      const groups = get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g))
      commit({ groups })
      const updated = groups.find((g) => g.id === id)
      if (updated) void adapter.updateGroup(updated)
    },

    deleteGroup(id) {
      commit({
        groups: get().groups.filter((g) => g.id !== id),
        expenses: get().expenses.filter((e) => e.groupId !== id),
        settlements: get().settlements.filter((s) => s.groupId !== id),
      })
      void adapter.removeGroup(id)
    },

    addExpense(input) {
      const expense: Expense = {
        id: createId('e'),
        groupId: input.groupId,
        title: input.title.trim(),
        amountMinor: input.amountMinor,
        currency: input.currency,
        paidBy: input.paidBy,
        // Shares are resolved once, here, and stored. Recomputing them on read
        // would let a later member change silently rewrite past balances.
        participants: calculateExpenseShares(
          input.amountMinor,
          input.splitMethod,
          input.participants,
        ),
        splitMethod: input.splitMethod,
        category: input.category,
        note: input.note,
        createdAt: input.createdAt ?? new Date().toISOString(),
      }
      commit({ expenses: [...get().expenses, expense] })
      void adapter.insertExpense(expense)
      return expense
    },

    updateExpense(id, input) {
      const existing = get().expenses.find((e) => e.id === id)
      if (!existing) return
      const updated: Expense = {
        ...existing,
        groupId: input.groupId,
        title: input.title.trim(),
        amountMinor: input.amountMinor,
        currency: input.currency,
        paidBy: input.paidBy,
        participants: calculateExpenseShares(
          input.amountMinor,
          input.splitMethod,
          input.participants,
        ),
        splitMethod: input.splitMethod,
        category: input.category,
        note: input.note,
        // An expense can be moved in time after the fact: it is almost never
        // logged when it happened. `updatedAt` still records the edit itself.
        createdAt: input.createdAt ?? existing.createdAt,
        updatedAt: new Date().toISOString(),
      }
      commit({ expenses: get().expenses.map((e) => (e.id === id ? updated : e)) })
      void adapter.updateExpense(updated)
    },

    deleteExpense(id) {
      commit({ expenses: get().expenses.filter((e) => e.id !== id) })
      void adapter.removeExpense(id)
    },

    addSettlement({ fromPersonId, toPersonId, amountMinor, currency, groupId, note }) {
      const settlement: Settlement = {
        id: createId('s'),
        groupId,
        fromPersonId,
        toPersonId,
        amountMinor,
        currency: currency ?? get().preferences.currency,
        createdAt: new Date().toISOString(),
        note,
      }
      commit({ settlements: [...get().settlements, settlement] })
      void adapter.insertSettlement(settlement)
      return settlement
    },

    deleteSettlement(id) {
      commit({ settlements: get().settlements.filter((s) => s.id !== id) })
      void adapter.removeSettlement(id)
    },
  }
})
