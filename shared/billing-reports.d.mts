import type { BillingReport, BillingReportQuery, ExportDataset } from '../app/src/api/types'
export function billingReport(db: unknown, query: BillingReportQuery, labels?: Record<string, string>, now?: number): BillingReport
export function exportBillingReport(db: unknown, query: BillingReportQuery, labels?: Record<string, string>, now?: number): ExportDataset & { report: BillingReport }
