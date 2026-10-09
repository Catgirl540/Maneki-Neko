import type { BankApi } from './contract'
import { createBackend } from '@/api/runtime'
import { clearLegacyMockData, isMockMode } from '@/lib/dataMode'

// 默认只从服务端读取业务数据，mock 仅用于显式开启的本地开发和回归测试。
clearLegacyMockData()
export const api: BankApi = createBackend()

export { isMockMode }
export * from './contract'
export type * from './types'
