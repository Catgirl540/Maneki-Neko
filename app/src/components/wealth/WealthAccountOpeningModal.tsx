import { useEffect, useState } from 'react'
import { api, ApiError } from '@/api'
import type {
  Account,
  RiskAssessment,
  RiskQuestion,
  WealthAccount,
} from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { CheckIcon } from '@/components/ui/icons'
import { Tag } from '@/components/ui/Segmented'
import { useToast } from '@/components/ui/toast-context'
import { useSession } from '@/store/session-context'
import { cn } from '@/lib/cn'
import { formatAmount, maskAccountNo } from '@/lib/format'
import { TOLERANCE_LABEL, WEALTH_INVESTMENT_AGREEMENT } from '@/lib/wealth'
import { RiskQuestionnaire } from './RiskAssessmentModal'

type Step = 'risk' | 'identity' | 'agreement' | 'done'


/**
 * 开立理财账户（投资账户）。
 *
 * 和 ZA 一样，银行账户 ≠ 理财账户：
 *   · 储蓄账户是注册时开的（装钱）
 *   · 理财账户是这里开的，它不装钱，只是把「你」和理财公司之间的委托关系立起来
 * 开立前置三件事，缺一不可：
 *   ① 风险承受能力评估（监管要求，且必须在有效期内）
 *   ② 复用已验证的实名资料，通过短信与人脸确认本人操作
 *   ③ 签署投资协议 + 绑定资金账户（申赎款项走它）
 *
 * 顺序是**先测评再开户**，不是并行 —— 因为账户的适当性等级要在开立时确定下来。
 */
export function WealthAccountOpeningModal({
  accounts,
  questions,
  risk,
  onClose,
  onOpened,
  onRiskUpdated,
}: {
  accounts: Account[]
  questions: RiskQuestion[]
  risk: RiskAssessment
  onClose: () => void
  onOpened: (account: WealthAccount) => void
  onRiskUpdated: (result: RiskAssessment) => void
}) {
  const toast = useToast()
  const { user } = useSession()
  const assessable = risk.done && !risk.expired

  const [step, setStep] = useState<Step>(assessable ? 'identity' : 'risk')
  const [currentRisk, setCurrentRisk] = useState(risk)

  // 身份
  const [smsCode, setSmsCode] = useState('')
  const [faceTicket, setFaceTicket] = useState('')
  const [scanning, setScanning] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [smsHint, setSmsHint] = useState<string | null>(null)

  // 协议与资金账户
  const [settlementId, setSettlementId] = useState(() => accounts[0]?.id ?? '')
  const [agreed, setAgreed] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [openedAccount, setOpenedAccount] = useState<WealthAccount | null>(null)

  const phone = user?.phone ?? ''
  const counting = cooldown > 0

  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => setCooldown((v) => (v <= 1 ? 0 : v - 1)), 1000)
    return () => clearInterval(timer)
  }, [counting])

  async function sendCode() {
    setError(null)
    try {
      const res = await api.sendSmsCode(phone)
      setCooldown(60)
      setSmsHint(res.demoCode ? `演示环境验证码：${res.demoCode}` : '验证码已发送，请查看短信')
      toast.show(`验证码已发送至 ${phone}`, 'success')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '验证码发送失败')
    }
  }

  async function scanFace() {
    setScanning(true)
    setError(null)
    try {
      const { ticket } = await api.verifyIdentity('face')
      setFaceTicket(ticket)
      toast.show('人脸核身通过', 'success')
    } catch {
      setError('人脸核身失败，请重试')
    } finally {
      setScanning(false)
    }
  }

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      const account = await api.openWealthAccount({
        smsCode,
        faceTicket,
        settlementAccountId: settlementId,
        agreement: agreed ? WEALTH_INVESTMENT_AGREEMENT : '',
      })
      setOpenedAccount(account)
      onOpened(account)
      setStep('done')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '开立失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const settlement = accounts.find((a) => a.id === settlementId) ?? null

  const TITLES: Record<Step, string> = {
    risk: '开立理财账户 · 风险测评',
    identity: '开立理财账户 · 身份核验',
    agreement: '开立理财账户 · 签署协议',
    done: '理财账户已开立',
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeDisabled={submitting}
      width="max-w-[540px]"
      title={TITLES[step]}
      description={step === 'identity' ? `验证手机号 ${phone}` : undefined}
      footer={
        step === 'agreement' ? (
          <>
            <Button block onClick={() => setStep('identity')} disabled={submitting}>
              返回
            </Button>
            <Button
              block
              variant="primary"
              loading={submitting}
              disabled={!agreed || !settlementId}
              onClick={() => void submit()}
            >
              签署并开立
            </Button>
          </>
        ) : step === 'done' ? (
          <Button block variant="primary" onClick={onClose}>
            开始理财
          </Button>
        ) : undefined
      }
    >
      {/* —— 步骤条 —— */}
      {step !== 'done' && (
        <ol className="mb-5 flex items-center gap-2 text-[12px]">
          {(
            [
              { id: 'risk', label: '风险测评' },
              { id: 'identity', label: '身份核验' },
              { id: 'agreement', label: '签署协议' },
            ] as const
          ).map((s, index, arr) => {
            const order: Step[] = ['risk', 'identity', 'agreement', 'done']
            const done = order.indexOf(step) > order.indexOf(s.id)
            const active = step === s.id
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-chip text-[11px] font-semibold',
                    active && 'bg-gold text-ink',
                    done && 'bg-gold-wash text-gold-deep',
                    !active && !done && 'bg-sunk text-ink-mute',
                  )}
                >
                  {done ? <CheckIcon size={12} /> : index + 1}
                </span>
                <span className={active ? 'font-medium text-ink' : 'text-ink-mute'}>{s.label}</span>
                {index < arr.length - 1 && <span className="h-px flex-1 bg-line" />}
              </li>
            )
          })}
        </ol>
      )}

      {/* —— 第一步：风险测评 —— */}
      {step === 'risk' && (
        <RiskQuestionnaire
          questions={questions}
          exitLabel="暂不开立"
          submitLabel="提交并继续"
          onExit={onClose}
          onDone={(result) => {
            setCurrentRisk(result)
            onRiskUpdated(result)
            setStep('identity')
          }}
        />
      )}

      {/* —— 第二步：身份核验 —— */}
      {step === 'identity' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-2.5">
            <div className="min-w-0 flex-1">
              <Field
                label="短信验证码"
                value={smsCode}
                inputMode="numeric"
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6 位验证码"
                hint={smsHint ?? undefined}
              />
            </div>
            <Button
              className="h-14 shrink-0"
              onClick={() => void sendCode()}
              disabled={counting || !phone}
            >
              {counting ? `${cooldown}s 后重发` : '获取验证码'}
            </Button>
          </div>

          <div className="rounded-field border border-line px-4 py-4">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-ink">人脸核身</span>
                <span className="mt-0.5 block text-[12px] text-ink-mute">
                  {faceTicket ? '已通过核身' : '确认为本人操作'}
                </span>
              </span>
              {faceTicket ? (
                <Tag tone="blue">已通过</Tag>
              ) : (
                <Button size="sm" loading={scanning} onClick={() => void scanFace()}>
                  开始核身
                </Button>
              )}
            </div>
          </div>

          {error && (
            <p className="rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">{error}</p>
          )}

          <Button
            variant="primary"
            block
            disabled={!faceTicket || smsCode.length !== 6}
            onClick={() => {
              setError(null)
              setStep('agreement')
            }}
          >
            下一步
          </Button>
          <p className="text-[12px] leading-relaxed text-ink-mute">
            当前风险等级 <span className="font-medium text-ink">{currentRisk.level}</span>（
            {currentRisk.level ? TOLERANCE_LABEL[currentRisk.level] : '未评估'}）
          </p>
        </div>
      )}

      {/* —— 第三步：资金账户 + 投资协议 —— */}
      {step === 'agreement' && (
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-3 text-[13px] font-medium text-ink-soft">资金账户</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-ink-mute">
              用于申购扣款和赎回到账。
            </p>
            <div className="flex flex-col gap-2.5">
              {accounts.map((a) => {
                const active = a.id === settlementId
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSettlementId(a.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-field border px-4 py-3.5 text-left transition-colors',
                      active ? 'border-gold bg-gold-tint' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-[14px]',
                          active ? 'font-medium text-gold-deep' : 'text-ink',
                        )}
                      >
                        {a.label}
                      </span>
                      <span className="num mt-0.5 block text-[12px] text-ink-mute">
                        {maskAccountNo(a.accountNo)} · 可用 ¥{formatAmount(a.available)}
                      </span>
                    </span>
                    {active && <CheckIcon size={18} className="shrink-0 text-gold-deep" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-[13px] font-medium text-ink-soft">投资协议</h3>
            <p className="rounded-field border border-line bg-sunk px-4 py-3 text-[12px] leading-relaxed text-ink">
              {WEALTH_INVESTMENT_AGREEMENT}
            </p>
            <label className="mt-3 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-gold)]"
              />
              <span className="text-[12px] leading-relaxed text-ink-soft">
                我已阅读并同意上述协议。理财非存款、产品有风险、投资须谨慎。
              </span>
            </label>
          </section>

          {error && (
            <p className="rounded-field bg-coral-wash px-4 py-3 text-[13px] text-coral">{error}</p>
          )}

          <p className="text-[12px] leading-relaxed text-ink-mute">
            开立后如需变更资金账户或注销理财账户，请联系客服。
          </p>
        </div>
      )}

      {/* —— 完成 —— */}
      {step === 'done' && (
        <div className="text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-chip bg-blue-wash text-blue">
            <CheckIcon size={28} />
          </span>
          <p className="mt-4 text-[16px] font-semibold text-ink">理财账户已开立</p>

          <dl className="mt-6 flex flex-col gap-3 border-t border-line pt-5 text-left text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-soft">理财账户号</dt>
              <dd className="num text-ink">{openedAccount?.accountNo ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">资金账户</dt>
              <dd className="text-ink">{settlement?.label ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-soft">风险等级</dt>
              <dd className="text-ink">
                {currentRisk.level} · {currentRisk.level ? TOLERANCE_LABEL[currentRisk.level] : '未评估'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Modal>
  )
}
