export const AVATAR_IDS: readonly string[]
export function avatarUrl(id: string): string
export function isAvatarId(value: unknown): value is string
export function avatarIdFor(seed: unknown): string
export function randomAvatarId(): string
