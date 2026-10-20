/**
 * 赛题工程的档案附加状态：`profile.challenge`。
 *
 * **为什么不进 MockDb 类型**：`app/src/api/{types,contract,http,mock}` 是队友
 * 日常热点，P1/P2 零触碰。新状态挂在 profile 对象的 challenge 字段上，
 * 走 mock 业务代码同一读写路径 loadDb()/persist()，不需要改 schema、不需要迁移。
 * 已核实：database.mjs 的 saveItemRaw 整份 JSON.stringify（只剥 cards/cardSecrets），
 * 附加段能存活。
 *
 * 这层只操作传入的 profile 对象，不调 persist()——落盘时机由调用方决定
 * （状态机要求 pending→running 时**立即**落盘）。
 */

/**
 * @typedef {{
 *   alias: string,
 *   payeeName: string,
 *   note?: string,
 * }} PayeeAlias
 * @typedef {{
 *   version: 1,
 *   scheduledActions: import('../bridge/scheduled.mjs').ScheduledAction[],
 *   budgetLocks: { id: string, amountCents: number, label: string, createdAt: string, releasedAt?: string }[],
 *   aaBills: { id: string, totalCents: number, payerName: string, participants: { name: string, shareCents: number, paid: boolean }[], createdAt: string }[],
 *   payeeAliases: PayeeAlias[],
 *   occasions: { id: string, kind: 'birthday', person: string, monthDay: string, budgetCents: number }[],
 * }} ChallengeState
 */

export const CHALLENGE_STATE_VERSION = 1

/** 空状态。只在档案第一次接触赛题工程时用。 */
export function emptyChallengeState() {
  return {
    version: CHALLENGE_STATE_VERSION,
    scheduledActions: [],
    budgetLocks: [],
    aaBills: [],
    payeeAliases: [],
    occasions: [],
  }
}

/**
 * 确保 profile.challenge 存在且字段齐全。幂等。
 * 已有的数组不会被清空——只补缺的字段，方便将来版本升级时叠加迁移。
 */
export function ensureChallengeState(profile) {
  if (profile.challenge === undefined || profile.challenge === null) {
    profile.challenge = emptyChallengeState()
    return profile.challenge
  }
  const state = profile.challenge
  const defaults = emptyChallengeState()
  for (const key of Object.keys(defaults)) {
    if (state[key] === undefined) state[key] = defaults[key]
  }
  state.version = CHALLENGE_STATE_VERSION
  return state
}

/**
 * 首次接触时播种收款人别名。幂等：已有的别名不覆盖、不重复。
 * @param {ChallengeState} state
 * @param {PayeeAlias[]} seed
 */
export function seedPayeeAliases(state, seed) {
  if (state.payeeAliases.length > 0) return state.payeeAliases
  state.payeeAliases = seed.map((item) => ({ ...item }))
  return state.payeeAliases
}

/**
 * 首次接触时播种纪念日（Phase 2 生日联动用）。幂等。
 */
export function seedOccasions(state, seed) {
  if (state.occasions.length > 0) return state.occasions
  state.occasions = seed.map((item) => ({ ...item }))
  return state.occasions
}
