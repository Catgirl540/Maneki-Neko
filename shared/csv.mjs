/** 导出 CSV 的唯一实现：网页下载与助手生成的链接共用同一份转义规则。 */

/** 单元格转义：含分隔符、引号或换行时用双引号包住，内部引号翻倍。 */
function escapeCell(value) {
  return /[",\r\n]/.test(value) ? `"${String(value).replace(/"/g, '""')}"` : String(value)
}

/**
 * 拼 CSV 文本。
 *
 * 开头补 UTF-8 BOM：不补的话 Excel（尤其 Windows 版）会按 GBK 解码，中文列名和
 * 对方户名全变乱码。行尾用 CRLF 也是为了让 Excel 规矩换行。
 */
export function toCsv(columns, rows) {
  const cell = (row, key) => escapeCell(row[key] ?? '')
  const header = columns.map(column => escapeCell(column.label)).join(',')
  const body = rows.map(row => columns.map(column => cell(row, column.key)).join(','))
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}
