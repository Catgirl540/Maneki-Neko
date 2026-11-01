export const NICKNAME_MAX: number
export function normalizeNickname(value: unknown): string
export function validateNickname(value: unknown): string | null
export function nicknameOf(user: { nickname?: unknown; displayName?: unknown } | null | undefined): string