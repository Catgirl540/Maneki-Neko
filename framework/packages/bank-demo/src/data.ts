/**
 * 演示数据：同步读盘 + 校验。**加载期失败**（fail loud），
 * 与 RAG 语料同一口径：数据文件坏了要在启动时报，不留到客户提问时。
 *
 * 数据里刻意**没有**完整卡号、CVV、支付密码——占位工具不可能返回真实敏感值，
 * 因为文件里根本没有。
 *
 * @module @luckycat/dsh-bank-demo/data
 */

import { readFileSync } from 'node:fs'
import type { DemoAccount, DemoTransaction, DemoWealthProduct } from './types.ts'

/** 数据格式或路径有问题时抛出。 */
export class BankDemoDataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BankDemoDataError'
  }
}

/** 一份校验通过的演示数据集。 */
export interface DemoData {
  accounts: DemoAccount[]
  transactions: DemoTransaction[]
  products: DemoWealthProduct[]
}

/** 要求某个值是对象。 */
function requireObject(raw: unknown, where: string): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BankDemoDataError(`${where} 不是对象`)
  }
  return raw as Record<string, unknown>
}

/** 要求某个字段是非空字符串。 */
function requireText(raw: unknown, where: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BankDemoDataError(`${where} 必须是非空字符串`)
  }
  return raw
}

/** 要求某个字段是安全整数。 */
function requireInt(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    throw new BankDemoDataError(`${where} 必须是整数（金额一律用「分」）`)
  }
  return raw
}

/**
 * 同步读取并校验演示数据。
 * @param path - JSON 数据文件的绝对路径。
 * @returns 校验通过的数据集。
 * @throws {BankDemoDataError} 路径、JSON、字段、或引用完整性有问题时。
 */
export function loadDemoData(path: string): DemoData {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new BankDemoDataError(`演示数据 ${path}: 读不到文件（${(error as NodeJS.ErrnoException).code ?? 'unknown'}）`, { cause: error })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new BankDemoDataError(`演示数据 ${path}: 不是合法 JSON`, { cause: error })
  }
  const root = requireObject(parsed, `演示数据 ${path}`)

  const accountsRaw = root['accounts']
  if (!Array.isArray(accountsRaw) || accountsRaw.length === 0) {
    throw new BankDemoDataError(`演示数据 ${path}: accounts 必须是非空数组`)
  }
  const accounts = accountsRaw.map((entry, index) => {
    const record = requireObject(entry, `演示数据 ${path}: accounts[${index}]`)
    return {
      id: requireText(record['id'], `accounts[${index}].id`),
      name: requireText(record['name'], `accounts[${index}].name`),
      tail: requireText(record['tail'], `accounts[${index}].tail`),
      currency: requireText(record['currency'], `accounts[${index}].currency`),
      balanceCents: requireInt(record['balanceCents'], `accounts[${index}].balanceCents`),
    } satisfies DemoAccount
  })

  const ids = new Set<string>()
  for (const account of accounts) {
    if (ids.has(account.id)) throw new BankDemoDataError(`演示数据 ${path}: 账户 id 重复：${account.id}`)
    ids.add(account.id)
  }

  const transactionsRaw = root['transactions'] ?? []
  if (!Array.isArray(transactionsRaw)) {
    throw new BankDemoDataError(`演示数据 ${path}: transactions 必须是数组`)
  }
  const transactions = transactionsRaw.map((entry, index) => {
    const record = requireObject(entry, `演示数据 ${path}: transactions[${index}]`)
    const accountId = requireText(record['accountId'], `transactions[${index}].accountId`)
    if (!ids.has(accountId)) {
      throw new BankDemoDataError(`演示数据 ${path}: transactions[${index}] 引用了不存在的账户 ${accountId}`)
    }
    return {
      id: requireText(record['id'], `transactions[${index}].id`),
      accountId,
      amountCents: requireInt(record['amountCents'], `transactions[${index}].amountCents`),
      currency: requireText(record['currency'], `transactions[${index}].currency`),
      counterparty: requireText(record['counterparty'], `transactions[${index}].counterparty`),
      category: requireText(record['category'], `transactions[${index}].category`),
      occurredAt: requireText(record['occurredAt'], `transactions[${index}].occurredAt`),
      memo: typeof record['memo'] === 'string' ? record['memo'] : '',
      channel: requireText(record['channel'], `transactions[${index}].channel`),
    } satisfies DemoTransaction
  })

  const productsRaw = root['products'] ?? []
  if (!Array.isArray(productsRaw)) {
    throw new BankDemoDataError(`演示数据 ${path}: products 必须是数组`)
  }
  const products = productsRaw.map((entry, index) => {
    const record = requireObject(entry, `演示数据 ${path}: products[${index}]`)
    const riskLevel = requireText(record['riskLevel'], `products[${index}].riskLevel`)
    if (!['R1', 'R2', 'R3', 'R4', 'R5'].includes(riskLevel)) {
      throw new BankDemoDataError(`演示数据 ${path}: products[${index}].riskLevel 非法：${riskLevel}`)
    }
    return {
      code: requireText(record['code'], `products[${index}].code`),
      name: requireText(record['name'], `products[${index}].name`),
      riskLevel: riskLevel as DemoWealthProduct['riskLevel'],
      benchmark: requireText(record['benchmark'], `products[${index}].benchmark`),
      minAmountCents: requireInt(record['minAmountCents'], `products[${index}].minAmountCents`),
    } satisfies DemoWealthProduct
  })

  return { accounts, transactions, products }
}
