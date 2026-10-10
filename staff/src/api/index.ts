import type { StaffApi } from './contract'
import { createHttpApi } from './http'
import { createMockApi } from './mock'

/**
 * 切换点（照客户端惯例）：
 *   VITE_USE_MOCK=true  → 本地写死样例
 *   VITE_USE_MOCK=false → 真后端 /staff-api/*
 */
const useMock = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false'

export const api: StaffApi = useMock ? createMockApi() : createHttpApi()
export const isMockMode = useMock

export * from './contract'
export type * from './types'
