import { toCsv as buildCsv } from '../../../shared/csv.mjs'
import type { ExportColumn } from '@/api/types'

/**
 * 网页端导出 CSV。
 *
 * 转义、BOM 与 CRLF 的实现放在 `shared/csv.mjs`，服务端生成下载链接时用的是
 * 同一份代码，避免两端导出的文件在 Excel 里表现不一致。
 */
export function toCsv(columns: ExportColumn[], rows: Record<string, string>[]): string {
  return buildCsv(columns, rows)
}
