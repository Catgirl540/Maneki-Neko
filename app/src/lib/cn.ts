/** 轻量 className 组合器，避免为此引入额外依赖 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}