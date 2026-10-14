export function redactSupportText(value: string): string
export function supportTranscript(items: readonly { kind: string; text: string }[]): { role: 'user' | 'assistant'; text: string }[]
