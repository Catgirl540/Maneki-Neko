import { PageHeader } from '@/components/PageHeader'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type CustomerProfile, type CustomerSummary } from '@/api'
import { CARD_STATUS_LABEL, TX_STATUS_LABEL, formatCents, formatTime } from './labels'

/**
 * 客户查询（清单 §2 P0，乙模块）。
 * 搜索返回脱敏摘要；点开完整资料须填事由，由后端在同一接口内落 customer_access_logs（§2）。
 */

export function CustomersPage() {
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<CustomerSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  // 完整资料视图：pending 是刚点选、还没填事由的客户；profile 是已展开的档案
  const [pendingView, setPendingView] = useState<CustomerSummary | null>(null)
  const [reason, setReason] = useState('')
  const [profile, setProfile] = useState<CustomerProfile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  const search = useCallback(async (kw: string) => {
    setSearching(true)
    setError(null)
    try {
      setResults(await api.searchCustomers(kw))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '客户查询失败，请检查后端是否已启动')
    } finally {
      setSearching(false)
    }
  }, [])

  // 空关键词 = 列出全部客户（demo 数据量小，安全）
  useEffect(() => {
    search('')
  }, [search])

  async function openProfile(customerId: string, r: string) {
    setProfileError(null)
    try {
      setProfile(await api.getCustomerProfile(customerId, r))
    } catch (e) {
      setProfileError(e instanceof ApiError ? e.message : '客户档案加载失败')
    }
  }

  return (
    <div className="staff-page">
      <PageHeader title="客户查询" description="查找客户，按事由查看完整资料。" />

      {/* 搜索：手机号 / 账号 / 姓名（清单 §2） */}
      <div className="staff-toolbar">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search(keyword)
          }}
          placeholder="搜手机号 / 姓名 / 客户号"
          className="w-64 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => search(keyword)}
          disabled={searching}
          className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)] disabled:opacity-50"
        >
          {searching ? '查询中…' : '查询'}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
          {error}
        </div>
      )}

      <div className="staff-table-wrap mt-4"><table className="staff-table">
        <thead>
          <tr>
            <th>客户</th>
            <th>手机号</th>
            <th>客户号</th>
            <th>风险标签</th>
          </tr>
        </thead>
        <tbody>
          {results.map((c) => (
            <tr
              key={c.customerId}
              tabIndex={0}
              onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPendingView(c); setReason(''); setProfile(null) } }}
              onClick={() => {
                setPendingView(c)
                setReason('')
                setProfile(null)
              }}
              className="cursor-pointer hover:bg-[var(--color-gold-tint)]"
            >
              <td className="font-medium">{c.name}</td>
              <td className="font-mono text-xs">{c.phoneMasked}</td>
              <td className="font-mono text-xs">{c.customerId}</td>
              <td>
                {c.riskTags.length > 0 ? (
                  c.riskTags.map((tag) => (
                    <span
                      key={tag}
                      className="mr-1 inline-block rounded-full bg-[var(--color-coral-wash)] px-2 py-0.5 text-xs text-[var(--color-coral)]"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--color-ink-mute)]">—</span>
                )}
              </td>
            </tr>
          ))}
          {results.length === 0 && !error && (
            <tr>
              <td colSpan={4} className="py-8 text-center text-sm text-[var(--color-ink-mute)]">
                {searching ? '正在查询客户…' : '没有匹配的客户'}
              </td>
            </tr>
          )}
        </tbody>
      </table></div>

      {/* 事由弹层：查看完整资料前必填，后端据此落账（清单 §2 / 不变量 10） */}
      {pendingView && !profile && (
        <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
          <div className="text-sm font-semibold text-[var(--color-ink)]">
            查看「{pendingView.name}」完整资料
          </div>
          <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
            请填写查看事由，本次访问将记入审计记录。
          </p>
          <div className="mt-3 flex items-center gap-3">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：工单 T_demo0001 需要核对流水"
              className="flex-1 rounded-[var(--radius-field)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm"
            />
            <button
              onClick={() => {
                if (!reason.trim()) {
                  setProfileError('请填写查看事由')
                  return
                }
                openProfile(pendingView.customerId, reason.trim())
              }}
              className="rounded-[var(--radius-tile)] bg-[var(--color-gold)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-gold-deep)]"
            >
              确认查看
            </button>
            <button
              onClick={() => setPendingView(null)}
              className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-4 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
            >
              取消
            </button>
          </div>
          {profileError && (
            <div className="mt-3 rounded-[var(--radius-tile)] bg-[var(--color-coral-wash)] px-4 py-3 text-sm text-[var(--color-coral)]">
              {profileError}
            </div>
          )}
        </div>
      )}

      {/* 客户 360：账户 / 卡片 / 最近流水（清单 §2 P0） */}
      {profile && (
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-lg font-semibold text-[var(--color-ink)]">{profile.name}</span>
              <span className="ml-2 font-mono text-xs text-[var(--color-ink-mute)]">{profile.phoneMasked}</span>
              <span className="ml-2 font-mono text-xs text-[var(--color-ink-mute)]">{profile.customerId}</span>
            </div>
            <button
              onClick={() => {
                setProfile(null)
                setPendingView(null)
              }}
              className="rounded-[var(--radius-tile)] border border-[var(--color-line-strong)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-paper)]"
            >
              关闭
            </button>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-[var(--color-ink)]">账户</div>
            <div className="staff-table-wrap"><table className="staff-table">
              <thead>
                <tr>
                  <th>账户</th>
                  <th>余额</th>
                </tr>
              </thead>
              <tbody>
                {profile.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td className="font-num">{(a.currencyBalances ?? [{ id: a.id, currency: a.currency ?? 'CNY', balance: a.balance }]).map(row => <div key={row.id}>{row.currency} {formatCents(row.balance)}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-[var(--color-ink)]">银行卡（脱敏）</div>
            <div className="staff-table-wrap"><table className="staff-table">
              <thead>
                <tr>
                  <th>尾号</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {profile.cards.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs">**** {c.last4}</td>
                    <td>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.status === 'active'
                            ? 'bg-[var(--color-blue-wash)] text-[var(--color-blue-deep)]'
                            : c.status === 'locked'
                              ? 'bg-[var(--color-coral-wash)] text-[var(--color-coral)]'
                              : 'bg-[var(--color-sunk)] text-[var(--color-ink-mute)]'
                        }`}
                      >
                        {CARD_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold text-[var(--color-ink)]">最近流水</div>
            <div className="staff-table-wrap"><table className="staff-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>交易对手</th>
                  <th>金额</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {profile.recentTransactions.map((t) => (
                  <tr key={t.id}>
                    <td className="text-xs text-[var(--color-ink-mute)]">{formatTime(t.createdAt)}</td>
                    <td>{t.counterparty}</td>
                    <td className="font-num">{formatCents(t.amount)}</td>
                    <td>
                      <span className="text-xs">
                        {t.pendingReason === 'inflight'
                          ? '审核中（在途）'
                          : (TX_STATUS_LABEL[t.status] ?? t.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}
    </div>
  )
}
