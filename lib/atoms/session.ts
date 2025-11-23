import type { SessionUserInfo } from '@/lib/session/types'
import { atom } from 'jotai'

export const sessionAtom = atom<SessionUserInfo>({ user: undefined })
export const sessionInitializedAtom = atom(false)
