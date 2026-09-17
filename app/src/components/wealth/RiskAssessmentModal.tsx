import { useState } from 'react'
import { api, ApiError } from '@/api'
import type { RiskAssessment, RiskQuestion } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { AlertIcon, CheckIcon } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { RISK_PLAIN_LABEL, TOLERANCE_LABEL, maxRiskFor } from '@/lib/wealth'

/**
 * 风险承受能力问卷主体。
 *
 * 单独抽出来是因为它有**两个使用场景**：
 *   · 单独重做测评（RiskAssessmentModal）
 *   · 开立理财账户流程的第一步（WealthAccountOpeningModal）
 * 两处必须用同一份题与同一套判分，否则「测评结果」在两个入口会不一致。
 *
 * 按钮放在正文里而不是 Modal 的 footer：这样嵌进别的弹层时也能直接复用。
 *
 * 题目覆盖监管列明的维度（年龄、财务状况、投资经验、投资目的、收益期望、
 * 风险偏好、流动性要求、风险认识及风险损失承受程度）。
 */
export function RiskQuestionnaire({
  questions,
  onDone,
  onExit,
  exitLabel = '取消',
  submitLabel = '提交评估',
}: {
  questions: RiskQuestion[]
  onDone: (result: RiskAssessment) => void
  onExit: () => void
  exitLabel?: string
  submitLabel?: string
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null))
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const current = questions[step]
  const answered = answers.filter((a) => a != null).length
  const isLast = step === questions.length - 1

  function choose(index: number) {
    setAnswers((prev) => prev.map((v, i) => (i === step ? index : v)))
    setError(null)
  }

  async function submit() {
    if (answered !== questions.length) {
      setError('请完成全部题目后再提交')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.submitRiskAssessment(answers as number[])
      onDone(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between text-[12px] text-ink-mute">
          <span>
            第 {step + 1} / {questions.length} 题
          </span>
          <span className="num">已答 {answered} 题</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-chip bg-line">
          <span
            className="block h-full rounded-chip bg-gold transition-[width] duration-300"
            style={{ width: `${((step + 1) / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <p className="text-[16px] leading-relaxed font-medium text-ink">{current.question}</p>

      <div className="flex flex-col gap-2.5">
        {current.options.map((option, index) => {
          const active = answers[step] === index
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() => choose(index)}
              className={cn(
                'flex items-center gap-3 rounded-field border px-4 py-3.5 text-left text-[14px] transition-colors',
                active
                  ? 'border-gold bg-gold-tint text-ink'
                  : 'border-line text-ink-soft hover:border-line-strong',
              )}
            >
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-chip border',
                  active ? 'border-gold bg-gold text-ink' : 'border-line-strong',
                )}
              >
                {active && <CheckIcon size={12} />}
              </span>
              {option.label}
            </button>
          )
        })}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">
          <AlertIcon size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <p className="text-[12px] leading-relaxed text-ink-mute">
        评估结果仅用于判断产品适当性，不构成投资建议。监管要求评估结果有效期一年，到期需重新评估。
      </p>

      <div className="flex gap-3">
        <Button
          block
          disabled={submitting}
          onClick={() => (step === 0 ? onExit() : setStep(step - 1))}
        >
          {step === 0 ? exitLabel : '上一题'}
        </Button>
        <Button
          block
          variant="primary"
          loading={submitting}
          onClick={() => (isLast ? void submit() : setStep(step + 1))}
        >
          {isLast ? submitLabel : '下一题'}
        </Button>
      </div>
    </div>
  )
}

/** 单独使用：重做测评 */
export function RiskAssessmentModal({
  questions,
  onClose,
  onDone,
}: {
  questions: RiskQuestion[]
  onClose: () => void
  onDone: (result: RiskAssessment) => void
}) {
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-[520px]"
      title="风险承受能力评估"
      description="评估结果决定你能购买哪些风险等级的产品。"
    >
      <RiskQuestionnaire questions={questions} onExit={onClose} onDone={onDone} />
    </Modal>
  )
}

/** 测评结果页 */
export function RiskResultModal({
  result,
  onClose,
}: {
  result: RiskAssessment
  onClose: () => void
}) {
  const max = maxRiskFor(result.level)
  return (
    <Modal
      open
      onClose={onClose}
      title="评估完成"
      width="max-w-[440px]"
      footer={
        <Button block variant="primary" onClick={onClose}>
          知道了
        </Button>
      }
    >
      <div className="text-center">
        <p className="text-[13px] text-ink-mute">你的风险承受能力等级</p>
        <p className="mt-3 text-[26px] leading-none font-bold text-ink">
          {result.level} · {TOLERANCE_LABEL[result.level]}
        </p>
        <p className="num mt-3 text-[13px] text-ink-mute">
          得分 {result.score} 分 · 有效期至 {result.expiresAt.slice(0, 10)}
        </p>
      </div>
      <p className="mt-6 rounded-field bg-sunk px-4 py-3.5 text-[13px] leading-relaxed text-ink-soft">
        按投资者适当性管理要求，你可以购买 <span className="font-medium text-ink">{max}</span>（
        {RISK_PLAIN_LABEL[max]}）及以下风险等级的产品。
      </p>
    </Modal>
  )
}
