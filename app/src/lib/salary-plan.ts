import type { SalaryPlan } from '@/api/types'

/**
 * “未设置工资计划”在数据里用空 nextPayday 表达（emptyCustomerDomains / server 种子同约）。
 * 页面拿它决定渲染空态还是预测日期 —— formatDate('') 会得到 NaN-NaN-NaN，
 * 所以判定必须收敛在这一个函数里，页面与断言脚本共用同一份口径。
 */
export function salaryPlanConfigured(plan: Pick<SalaryPlan, 'nextPayday'>): boolean {
  return plan.nextPayday !== ''
}
