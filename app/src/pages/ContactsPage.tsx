import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { DataLoading, DataUnavailable } from '@/components/ui/DataUnavailable'
import { useAsync } from '@/lib/useAsync'
import { api } from '@/api'
import type { Payee } from '@/api/types'

const inputClass = 'h-11 w-full min-w-0 rounded-field border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-mute focus:border-gold'
/** 通讯录里一行显示的身份：本行账户优先显示手机号，外行显示账号。 */
const identityOf = (row: Payee) => row.phone ?? row.accountNo ?? row.fpsId ?? ''

/**
 * 收款人通讯录。
 *
 * 转账与 AA 收款共用这一份名单：转账成功、发起 AA 成功后都会自动记进来，
 * 这里负责集中查看、搜索、手动添加与删除。没有这一页时，名单只能在转账第 2 步的
 * 弹窗里看到，而那个入口在空名单时根本不出现。
 */
export function ContactsPage() {
  const payees = useAsync(() => api.listPayees(), [])
  const [keyword, setKeyword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState({ name: '', phone: '', accountNo: '' })
  const [removing, setRemoving] = useState('')
  const [editing, setEditing] = useState<Payee | null>(null)

  const rows = (payees.data ?? []).filter(row => {
    const needle = keyword.trim().toLocaleLowerCase()
    if (!needle) return true
    return [row.name, row.phone, row.accountNo, row.bankName, row.remark]
      .filter((value): value is string => typeof value === 'string')
      .some(value => value.toLocaleLowerCase().includes(needle))
  })

  async function add() {
    setBusy(true); setError(''); setMessage('')
    try {
      const name = draft.name.trim()
      const phone = draft.phone.replace(/\D/g, '')
      const accountNo = draft.accountNo.replace(/\D/g, '')
      if (!name) throw Error('请填写收款人姓名')
      if (!phone && !accountNo) throw Error('手机号或账号至少填一个')
      const created = await api.addPayee({ name, ...(phone ? { phone } : {}), ...(accountNo ? { accountNo } : {}) })
      setDraft({ name: '', phone: '', accountNo: '' })
      setMessage(`已添加 ${created.name}`)
      payees.reload()
    } catch (caught) {
      // 已存在分两种：补齐了另一条线索（是好事，刷新让人看到），或完全重复（提示即可）。
      const code = (caught as { code?: string } | null)?.code
      const text = caught instanceof Error ? caught.message : '添加失败'
      if (code === 'PAYEE_EXISTS') { setMessage(text); payees.reload() } else setError(text)
    }
    finally { setBusy(false) }
  }

  async function remove(row: Payee) {
    setRemoving(row.id); setError(''); setMessage('')
    try {
      await api.deletePayee(row.id)
      setMessage(`已删除 ${row.name}`)
      payees.reload()
    } catch (caught) { setError(caught instanceof Error ? caught.message : '删除失败') }
    finally { setRemoving('') }
  }

  async function saveRemark(row: Payee, remark: string) {
    setError(''); setMessage('')
    try { await api.updatePayeeRemark(row.id, remark); setEditing(null); payees.reload() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '备注保存失败') }
  }

  return <div className="page-stack">
    <PageHeader title="收款人通讯录" description="转账与 AA 收款共用这份名单。转账成功或发起 AA 收款后，收款人会自动记进来，也可以在这里手动添加。" />
    <Card>
      <h2 className="text-[17px] leading-6 font-semibold text-ink">添加收款人</h2>
      <form className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); void add() }}>
        <label className="text-[13px] text-ink-soft">姓名<input value={draft.name} maxLength={40} placeholder="与账户户名一致" onChange={event => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></label>
        <label className="text-[13px] text-ink-soft">手机号<input inputMode="numeric" value={draft.phone} maxLength={11} placeholder="11 位手机号" onChange={event => setDraft({ ...draft, phone: event.target.value.replace(/\D/g, '') })} className={inputClass + ' tabular-nums'} /></label>
        <label className="text-[13px] text-ink-soft">本行账号<input inputMode="numeric" value={draft.accountNo} maxLength={19} placeholder="12–19 位账号" onChange={event => setDraft({ ...draft, accountNo: event.target.value.replace(/\D/g, '') })} className={inputClass + ' tabular-nums'} /></label>
        <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy}>{busy ? '添加中…' : '添加'}</Button></div>
      </form>
      <p className="mt-2 text-[12px] text-ink-mute">姓名必填；手机号与账号填一个即可，两个都填时须属于同一位客户。</p>
      {error && <p role="alert" className="mt-3 text-[13px] text-coral">{error}</p>}
      {message && <p role="status" className="mt-3 text-[13px] text-ink-soft">{message}</p>}
    </Card>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] leading-6 font-semibold text-ink">共 {rows.length} 位</h2>
        <label className="w-full max-w-[320px] text-[13px] text-ink-soft">搜索<input value={keyword} maxLength={140} placeholder="姓名、手机号、账号或备注" onChange={event => setKeyword(event.target.value)} className={inputClass} /></label>
      </div>
      {payees.error ? <DataUnavailable message={payees.error} onRetry={payees.reload} /> : !payees.data ? <DataLoading /> : rows.length === 0
        ? <p className="py-6 text-[13px] text-ink-mute">{keyword ? '没有匹配的收款人。' : '通讯录还是空的，先用上面表单添加一位。'}</p>
        : <table aria-label="收款人通讯录" className="mt-4 w-full border-collapse text-[13px]">
          <thead className="text-left text-[12px] text-ink-mute"><tr className="border-b border-line">
            <th scope="col" className="w-16 whitespace-nowrap px-3 py-2.5 font-medium">序号</th>
            <th scope="col" className="w-[22%] px-3 py-2.5 font-medium">姓名</th>
            <th scope="col" className="w-[28%] px-3 py-2.5 font-medium">手机号 / 账号</th>
            <th scope="col" className="px-3 py-2.5 font-medium">备注</th>
            <th scope="col" className="w-36 whitespace-nowrap px-3 py-2.5 font-medium"><span className="sr-only">操作</span></th>
          </tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id} className="border-b border-line last:border-0">
            <td className="px-3 py-2 tabular-nums text-ink-mute">{index + 1}</td>
            <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
            <td className="px-3 py-2 tabular-nums text-ink-soft">{identityOf(row)}</td>
            <td className="px-3 py-2 text-ink-soft">
              {editing?.id === row.id
                ? <form className="flex gap-2" onSubmit={event => { event.preventDefault(); void saveRemark(row, editing.remark ?? '') }}>
                  <input aria-label={`${row.name}的备注`} value={editing.remark ?? ''} maxLength={140} onChange={event => setEditing({ ...editing, remark: event.target.value })} className={inputClass} />
                  <Button type="submit">保存</Button>
                  <Button onClick={() => setEditing(null)}>取消</Button>
                </form>
                : <span className="line-clamp-2 break-words">{row.remark || '—'}</span>}
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                <button type="button" onClick={() => setEditing(row)} className="rounded-chip px-2 py-1 text-[12px] text-ink-soft transition-colors hover:bg-sunk hover:text-ink">改备注</button>
                <button type="button" disabled={removing === row.id} onClick={() => void remove(row)} className="rounded-chip px-2 py-1 text-[12px] text-coral transition-colors hover:bg-coral-wash disabled:text-ink-mute">{removing === row.id ? '删除中…' : '删除'}</button>
              </div>
            </td>
          </tr>)}</tbody>
        </table>}
    </Card>
  </div>
}
