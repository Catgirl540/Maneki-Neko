export interface CsvColumn {
  key: string
  label: string
}
export function toCsv(columns: readonly CsvColumn[], rows: readonly Record<string, string>[]): string
