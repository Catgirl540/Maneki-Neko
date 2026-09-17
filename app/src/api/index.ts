import type { BankApi } from './contract'
import { createHttpApi } from './http'
import { createMockApi } from './mock'

/**
 * 前后端分离的切换点：
 *   VITE_USE_MOCK=true  → 本地模拟后端（当前 MVP 默认）
 *   VITE_USE_MOCK=false → 真实后端，配合 VITE_API_BASE_URL / vite proxy
 * 组件永远只 import { api }，切换时业务代码零改动。
 */
const useMock = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false'

export const api: BankApi = useMock ? createMockApi() : createHttpApi()

export const isMockMode = useMock

export * from './contract'
export type * from './types'