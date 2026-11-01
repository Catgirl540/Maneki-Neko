export const HONORIFIC_MR: string
export const HONORIFIC_MS: string
export const DEFAULT_HONORIFIC: string
export function honorificFromIdNumber(idNumber: unknown): string | null
export function surnameOf(name: unknown): string
export function displayNameOf(name: unknown, honorific?: string | null): string
export function maskedNameOf(name: unknown): string
