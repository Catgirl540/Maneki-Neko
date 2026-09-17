/* ==========================================================================
   卡 BIN 查询（纯函数）
   从 mock/index.ts 里抽出来是为了能被单独测到：这段逻辑决定「输卡号认银行」认对认错，
   而它埋在 async 方法里就没法在 Node 下直接跑，检查工具只能重写一遍 —— 那等于
   用一个抄来的实现去验证原实现，抄错了两边一起错。
   ========================================================================== */

import type { Bank, BankRegion, CardBinResolution } from '@/api/types'
import { CARD_BIN_LENGTH, digitsOnly } from '@/lib/account'
import { CN_CARD_BINS } from './bin-table'

/**
 * 本行自己的账号前缀。
 *
 * **不从真实码表来** —— 它就是我们自己的账号格式（`8820…`，见 db.ts 的种子账户），
 * 所以单独列在这里，不混进 `CN_CARD_BINS`（那张表每一行都得能反查到公开来源）。
 *
 * 但它必须参与识别与预填：不然选中本行时没有前缀可补，从别家切过来会**留着别家的号段**
 * —— 界面上写着「招财猫银行」、卡号栏却是工商的 622202，转出去必然失败。
 */
export const INTERNAL_ACCOUNT_PREFIX = '882000'

/**
 * 卡号前缀 → 发卡行。
 *
 * 真实实现是拿前 6 位去问银联 / 网联的 BIN 库；这里查本地收录的表
 * （表由 tools/gen-bin-table.mjs 从公开码表生成，见 bin-table.ts）。
 *
 * 三种「查不到」在这里被区分开，因为界面要说的话完全不同：
 * - `not-applicable` 香港 —— 那不是卡号，压根没有 BIN 这回事
 * - `incomplete`     位数不够 —— 让用户接着输，不是错误
 * - `unsupported`    前缀不认识 —— 才是「暂不支持该银行」
 */
export function lookupCardBin(
  banks: Bank[],
  digits: string,
  region: BankRegion,
): CardBinResolution {
  // 香港侧走的是银行账户号，账号本身不含机构标识（这正是香港转账必须手选收款行的原因）
  if (region !== 'CN') return { status: 'not-applicable' }

  const clean = digitsOnly(digits)
  if (clean.length < CARD_BIN_LENGTH) {
    return { status: 'incomplete', need: CARD_BIN_LENGTH - clean.length }
  }

  const bin = clean.slice(0, CARD_BIN_LENGTH)

  // 本行账号优先判：它的前缀不在公开码表里，但确实是本行的号
  if (bin === INTERNAL_ACCOUNT_PREFIX) {
    const own = banks.find((b) => b.internal && b.region === 'CN')
    if (own) return { status: 'matched', bin, bank: own }
  }

  const hit = CN_CARD_BINS.find((entry) => entry.bin === bin)
  if (!hit) return { status: 'unsupported' }

  // 表里有、名录里没有 = 两边不同步。当成不认识，不要凭空编一家银行出来
  const bank = banks.find((b) => b.code === hit.code && b.region === 'CN')
  if (!bank) return { status: 'unsupported' }

  return { status: 'matched', bin, bank }
}
