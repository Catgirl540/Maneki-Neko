/**
 * 收款人消歧的纯逻辑：别名 / 人名 / 手机号 / 备注片段 → 候选列表。
 *
 * 为什么要这层：用户说「给我妈转 200」，agent 不知道「我妈」是哪个收款人。
 * 现有 Payee 类型没有 alias 字段（types.ts:224-239），别名存在
 * profile.challenge.payeeAliases 里。搜索范围三处：
 *   1. payeeAliases —— 「我妈」→ 陈嘉禾
 *   2. payees —— 精确/模糊人名
 *   3. 流水 counterparty —— 转过账但没存收款人的名字
 *
 * 候选按匹配强度排序，同强度按最近使用在前。多候选时返回消歧提示，
 * 绝不替用户猜——猜错收款人是资金损失。
 *
 *   node --import ./tools/ts-resolve-hook.mjs challenge/checks/check-payee-resolve.mjs
 */

/**
 * @typedef {{ alias: string, payeeName: string, note?: string }} PayeeAlias
 * @typedef {{
 *   id: string, name: string, channel: string,
 *   bankCode?: string, bankRegion?: string, bankName?: string,
 *   accountNo?: string, fpsMethod?: string, fpsId?: string,
 *   payeeCurrency?: string, scope: string, lastUsedAt: string,
 * }} PayeeLike
 * @typedef {{
 *   payeeId?: string, payeeName: string, matchType: 'alias'|'name'|'phone'|'history',
 *   score: number, payee?: PayeeLike, alias?: PayeeAlias,
 *   historyCount: number, lastUsedAt?: string,
 * }} PayeeCandidate
 */

/** 归一化：去空白、统一小写、去常见标点，让「我妈 」和 「我妈」命中同一条。 */
function norm(s) {
  return String(s ?? '').trim().toLowerCase().replace(/[\s,，。.!！?？、~～]/g, '')
}

/**
 * 手机号归一化：只保留数字。11 位完整号可精确匹配 payee 的 accountNo 尾号
 * 或流水里的手机号；短片段走模糊。
 */
function digits(s) {
  return String(s ?? '').replace(/\D/g, '')
}

/**
 * 解析 query → 候选列表。
 *
 * @param {object} p
 * @param {string} p.query               用户输入（人名/别名/手机号/备注片段）
 * @param {PayeeAlias[]} p.aliases       profile.challenge.payeeAliases
 * @param {PayeeLike[]} p.payees         profile.payees
 * @param {Array<{ counterparty?: string, detail?: { counterpartyName?: string }, createdAt?: string }>} [p.transactions]
 * @returns {PayeeCandidate[]} 按 score 降序、同分按 lastUsedAt 降序
 */
export function resolvePayee({ query, aliases, payees, transactions = [] }) {
  const q = norm(query)
  const qd = digits(query)
  if (!q && !qd) return []

  /** @type {PayeeCandidate[]} */
  const out = []
  const seen = new Set()

  const push = (cand) => {
    const key = cand.payeeId ?? cand.payeeName
    if (seen.has(key)) return
    seen.add(key)
    out.push(cand)
  }

  // 1. 别名精确命中：score 100
  for (const alias of aliases) {
    if (norm(alias.alias) === q || (alias.note && norm(alias.note) === q)) {
      const payee = payees.find((p) => p.name === alias.payeeName)
      push({
        payeeId: payee?.id,
        payeeName: alias.payeeName,
        matchType: 'alias',
        score: 100,
        ...(payee ? { payee } : {}),
        alias,
        historyCount: 0,
        lastUsedAt: payee?.lastUsedAt,
      })
    }
  }

  // 2. 别名包含命中（「转给我妈妈」里的「妈妈」）：score 80
  if (q.length >= 1) {
    for (const alias of aliases) {
      const an = norm(alias.alias)
      if (an && (an.includes(q) || q.includes(an))) {
        const payee = payees.find((p) => p.name === alias.payeeName)
        push({
          payeeId: payee?.id,
          payeeName: alias.payeeName,
          matchType: 'alias',
          score: 80,
          ...(payee ? { payee } : {}),
          alias,
          historyCount: 0,
          lastUsedAt: payee?.lastUsedAt,
        })
      }
    }
  }

  // 3. 收款人精确名：score 90
  for (const payee of payees) {
    if (norm(payee.name) === q) {
      push({
        payeeId: payee.id, payeeName: payee.name, matchType: 'name',
        score: 90, payee, historyCount: 0, lastUsedAt: payee.lastUsedAt,
      })
    }
  }

  // 4. 收款人模糊名（包含）：score 70
  if (q.length >= 1) {
    for (const payee of payees) {
      const pn = norm(payee.name)
      if (pn && (pn.includes(q) || q.includes(pn))) {
        push({
          payeeId: payee.id, payeeName: payee.name, matchType: 'name',
          score: 70, payee, historyCount: 0, lastUsedAt: payee.lastUsedAt,
        })
      }
    }
  }

  // 5. 手机号匹配 payee.accountNo 尾号或流水：score 85（完整号）/ 60（片段）
  if (qd.length >= 4) {
    for (const payee of payees) {
      const acc = digits(payee.accountNo ?? payee.fpsId ?? '')
      if (acc && (acc === qd || acc.endsWith(qd) || qd.endsWith(acc))) {
        push({
          payeeId: payee.id, payeeName: payee.name, matchType: 'phone',
          score: qd.length >= 11 ? 85 : 60, payee,
          historyCount: 0, lastUsedAt: payee.lastUsedAt,
        })
      }
    }
  }

  // 6. 流水 counterparty：转过账但没存收款人。score 50，按出现次数加权
  const historyMap = new Map()
  for (const tx of transactions) {
    const name = tx.detail?.counterpartyName ?? tx.counterparty
    if (!name) continue
    const nn = norm(name)
    if (!nn || !(nn.includes(q) || q.includes(nn))) continue
    const prev = historyMap.get(name)
    if (prev) {
      prev.historyCount += 1
      if (tx.createdAt && (!prev.lastUsedAt || tx.createdAt > prev.lastUsedAt)) prev.lastUsedAt = tx.createdAt
    } else {
      const payee = payees.find((p) => p.name === name)
      historyMap.set(name, {
        payeeId: payee?.id,
        payeeName: name,
        matchType: 'history',
        score: 50,
        ...(payee ? { payee } : {}),
        historyCount: 1,
        lastUsedAt: tx.createdAt ?? payee?.lastUsedAt,
      })
    }
  }
  for (const cand of historyMap.values()) {
    cand.score += Math.min(10, cand.historyCount - 1) // 出现越多越可信，最多 +10
    push(cand)
  }

  out.sort((a, b) => b.score - a.score || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
  return out
}

/**
 * 消歧提示：多候选时告诉用户有哪些选项、缺什么信息。
 * 单候选返回 null（可以直接展示确认卡）。
 *
 * @param {PayeeCandidate[]} candidates
 * @returns {{ needDisambiguation: boolean, message: string, options: string[] } | null}
 */
export function disambiguationHint(candidates) {
  if (candidates.length <= 1) return null
  const options = candidates.map((c, i) => {
    const bits = [`${i + 1}. ${c.payeeName}`]
    if (c.payee?.bankName) bits.push(c.payee.bankName)
    if (c.payee?.accountNo) bits.push(`尾号 ${String(c.payee.accountNo).slice(-4)}`)
    else if (c.payee?.fpsId) bits.push(`FPS ${c.payee.fpsId}`)
    if (c.matchType === 'alias' && c.alias?.note) bits.push(`（${c.alias.note}）`)
    return bits.join(' · ')
  })
  return {
    needDisambiguation: true,
    message: `找到 ${candidates.length} 个匹配的收款人，请确认转给哪一位：`,
    options,
  }
}
