import type { StaffRole } from '@/api'
import { HomeIcon, SparkleIcon, ReceiptIcon, ShieldIcon, UsersIcon, CardIcon, HistoryIcon, DeviceIcon,ChatIcon } from '../../../app/src/components/ui/icons'

export const staffNavigation = [
  { to: '/workbench', label: '工作台', group: '工作空间', Icon: HomeIcon, roles: ['csr', 'supervisor'] },
  { to: '/assistant', label: '工作人员助手', group: '工作空间', Icon: SparkleIcon, roles: ['csr', 'supervisor', 'ops'] },
  { to:'/im',label:'IM 机器人',group:'工作空间',Icon:ChatIcon,roles:['csr','supervisor'] },
  { to: '/tickets', label: '工单中心', group: '业务处理', Icon: ReceiptIcon, roles: ['csr', 'supervisor'] },
  { to: '/customers', label: '客户查询', group: '业务处理', Icon: UsersIcon, roles: ['csr', 'supervisor'] },
  { to: '/actions', label: '代客办理', group: '业务处理', Icon: CardIcon, roles: ['csr', 'supervisor'] },
  { to: '/approvals', label: '处置中心', group: '业务处理', Icon: ShieldIcon, roles: ['csr', 'supervisor'] },
  { to: '/audit', label: '审计日志', group: '管理与运维', Icon: HistoryIcon, roles: ['supervisor'] },
  { to: '/operations', label: '运维监控', group: '管理与运维', Icon: DeviceIcon, roles: ['ops'] },
] satisfies { to: string; label: string; group: string; Icon: typeof HomeIcon; roles: StaffRole[] }[]

export const staffRoleLabel: Record<StaffRole, string> = { csr: '客服专员', supervisor: '业务主管', ops: '运维人员' }
