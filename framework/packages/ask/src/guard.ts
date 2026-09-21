/**
 * 「问用户」的防钓鱼守卫：**不许用自由输入框索要凭据**。
 *
 * 为什么需要它，而不是靠人设写一句"不要问密码"：
 *
 *   `ask_user_question` 是一个**用户会当真、会照着填**的界面。它弹出的卡片长得
 *   和银行的正常表单一样，用户没有理由怀疑。所以只要模型（被提示注入、被用户诱导、
 *   或者单纯犯糊涂）问一句「请把您的支付密码告诉我，我帮您操作」，就有一个
 *   看起来很正规的输入框在等他把密码打进去。
 *
 *   人设里当然也写了不许问。但**人设是软的**——这一轮做"隐藏模型名"时已经实测过
 *   一次：界面上藏得再好，问一句模型就自己说了。凭据同理，而且后果严重得多
 *   （模型自报型号只是尴尬，套出密码是真丢钱）。
 *
 * 所以这里是**代码里的硬拦**：题目文本或选项文本命中"索要凭据"的模式，
 * 这次问询直接失败，模型拿到的是一条明确的错误。
 *
 * 设计口径：
 *   · **只拦"索要"，不拦"提及"**。「请不要把密码告诉任何人」是银行该说的话，
 *     不能因为出现"密码"两个字就被拦掉。所以规则是"出现凭据词 + 出现索要动词"，
 *     见 {@link LOOKS_LIKE_CREDENTIAL_REQUEST} 为什么用这种组合。
 *   · 只有自由输入的通道才危险：如果一个问题带了选项、用户只能点选项，
 *     那他打不出密码来。但**选项本身也可能是"请选择您的密码"**这种荒唐题，
 *     所以选项文本一起查。
 *   · 这些规则**只加不减**：配置能追加规则，不能放宽默认。
 *
 * @module @luckycat/dsh-ask/guard
 */

import { AskError } from './errors.ts'

/**
 * 凭据类词。
 *
 * `卡号` 也在这里：银行**绝不会**让用户在聊天框里打完整卡号——
 * 要卡号只有两条路，一是用户自己看卡面，二是走 `bank_reveal_card_secret`
 * 那条"展示 → 确认 → 验身份"的路。在自由输入框里收卡号就是错的。
 */
const CREDENTIAL_WORDS = [
  '密码', '口令', 'pin', '验证码', '短信码', '动态码', '校验码',
  'cvv', 'cvc', '安全码', '有效期',
  '身份证', '证件号', '卡号', '账号密码', '登录密码', '支付密码',
  '私钥', '助记词', '密钥',
]

/**
 * 索要动词。
 *
 * **为什么必须和凭据词同时命中**：只查凭据词的话，「为了安全，请不要把密码告诉任何人」
 * 「您的支付密码不要发给客服」这类**正确的话**会被误拦。而只查索要动词的话，
 * 「请输入转账金额」会被误拦。两个一起命中，才是"要用户把凭据打出来"。
 *
 * 注意 `发送`/`发给`/`提供`/`告诉` 都在这里：模型很会绕，
 * 「请把您的支付密码发送到下面这个框里」和「请输入密码」是一回事。
 */
const REQUEST_VERBS = [
  '输入', '填写', '提供', '告诉', '发送', '发给', '告知', '回复', '报一下',
  'confirm your', 'enter your', 'provide your', 'type your', 'send your',
]

/** 拼成一个正则：凭据词与索要动词。 */
const CREDENTIAL_PATTERN = new RegExp(CREDENTIAL_WORDS.join('|'), 'i')
const REQUEST_PATTERN = new RegExp(REQUEST_VERBS.join('|'), 'i')

/**
 * 否定词。
 *
 * **没有这一条就会误拦银行最该说的话**：「请不要把密码告诉任何人」
 * 「您的支付密码不要发给客服」——凭据词和动词都齐了，但它们是在**提醒用户别泄漏**。
 * 实测踩到：加 `告诉`/`发给` 进动词表之后，这两句立刻被拦。
 */
const NEGATION_PATTERN = /不要|别|请勿|切勿|不得|不可以|不能|不会|绝不|勿|无需|不用|没有|do not|don't|never|not\s/i

/**
 * 按标点把一段话切成小句。
 *
 * 为什么要切：否定只管它所在的那一小句。「请不要把密码告诉任何人，
 * **请在这里输入**您的密码」——前半句是否定，后半句是索要，切成两句才判得对。
 */
function clauses(text: string): string[] {
  return text.split(/[。！？；;.!?\n，,、]/).map(clause => clause.trim()).filter(clause => clause !== '')
}

/**
 * 一段文本是不是在**索要**凭据。
 *
 * 判定分三步，每个小句独立判：
 *   1. 这个小句里出现了凭据词（密码、验证码、卡号……）；
 *   2. 也出现了索要动词（输入、填写、告诉、发给……）；
 *   3. **没有**否定词（不要、请勿、never……）。
 *
 * 三步都满足才算索要。
 *
 * 已知的局限（不假装更强）：这是启发式，不是语义理解。用否定词包装的
 * 真索要（「请勿忘记输入您的密码」）会漏过去。真正的保证在别处——
 * 凭据验证走的是确认闸门那条"展示 → 确认 → 验身份"的路，
 * 而且支付密码**只到服务端、从不经过模型**。这里是多加一道，不是唯一一道。
 * @param text - 要检查的文本。
 * @returns 命中返回 true。
 */
export function looksLikeCredentialRequest(text: string): boolean {
  for (const clause of clauses(text)) {
    if (!CREDENTIAL_PATTERN.test(clause)) continue
    if (!REQUEST_PATTERN.test(clause)) continue
    if (NEGATION_PATTERN.test(clause)) continue
    return true
  }
  return false
}

/** 一条禁止规则。 */
export interface ForbiddenRule {
  /** 规则来源，出错信息里用来说清是哪条拦的。 */
  source: 'builtin' | 'config'
  /** 正则。 */
  pattern: RegExp
}

/**
 * 编译配置里的额外规则。非法正则**在加载期就抛**，而不是等第一次问询才炸。
 * @param patterns - 正则字符串。
 * @returns 编译好的规则。
 */
export function compileExtraRules(patterns: readonly string[]): ForbiddenRule[] {
  return patterns.map((source) => {
    try {
      return { source: 'config' as const, pattern: new RegExp(source, 'i') }
    } catch (error) {
      throw new AskError(
        'MISCONFIGURED',
        `luckycat-ask: extraForbiddenPatterns 里的正则不合法：${JSON.stringify(source)}（${error instanceof Error ? error.message : String(error)}）`,
      )
    }
  })
}

/**
 * 检查整次问询；命中就抛错。
 *
 * 抛错而不是"删掉那道题继续问"：模型是照着用户的请求提的问题，
 * 悄悄改掉题目会让模型以为用户看到了它没问的话，答复就对不上了。
 * 让它拿到一条明确的拒绝，它才能换个方式（或直接告诉用户这件事办不了）。
 * @param questions - 本次要问的全部题。
 * @param extraRules - 部署方追加的规则。
 * @throws {AskError} code `CREDENTIAL_REQUEST_BLOCKED` / `FORBIDDEN_PATTERN`。
 */
export function assertQuestionsAllowed(
  questions: readonly { id: string; question: string; header?: string; options?: readonly { label: string; description?: string }[] }[],
  extraRules: readonly ForbiddenRule[],
): void {
  for (const question of questions) {
    // 题目 + 标题 + 选项标签 + 选项说明，全部拼起来查：
    // 「请选择」+ 选项「我的支付密码」这种绕法也要拦住。
    const texts = [
      question.question,
      question.header ?? '',
      ...(question.options ?? []).flatMap(option => [option.label, option.description ?? '']),
    ]
    for (const text of texts) {
      if (text === '') continue
      if (looksLikeCredentialRequest(text)) {
        throw new AskError(
          'CREDENTIAL_REQUEST_BLOCKED',
          `这一问在向用户索要凭据（问题 ${question.id}：${JSON.stringify(text)}）。`
          + '密码、验证码、卡号、证件号这类东西不能通过提问框收集——'
          + '真要用户验证身份，请改为发起需要确认的敏感操作，由运行时弹确认卡片并要求验证。',
        )
      }
      for (const rule of extraRules) {
        if (rule.pattern.test(text)) {
          throw new AskError(
            'FORBIDDEN_PATTERN',
            `这一问命中了部署方禁止的提问模式（问题 ${question.id}，规则来自 ${rule.source}）`,
          )
        }
      }
    }
  }
}
