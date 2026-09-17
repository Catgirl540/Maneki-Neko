import type { ExportColumn } from '@/api/types'

/** 单元格转义：含分隔符 / 引号 / 换行时用双引号包住，内部引号翻倍 */
function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * 拼 CSV 文本。
 *
 * 开头补 UTF-8 BOM：不补的话 Excel（尤其 Windows 版）会按 GBK 解码，
 * 中文列名和对方户名全变乱码 —— 这是国内做导出最常踩的一个坑。
 * 行尾用 CRLF 也是为了让 Excel 规矩换行。
 */
export function toCsv(columns: ExportColumn[], rows: Record<string, string>[]): string {
  const cell = (row: Record<string, string>, key: string) => escapeCell(row[key] ?? '')
  const header = columns.map((c) => escapeCell(c.label)).join(',')
  const body = rows.map((row) => columns.map((c) => cell(row, c.key)).join(','))
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}
