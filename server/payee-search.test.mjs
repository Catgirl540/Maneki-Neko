import test from 'node:test'
import assert from 'node:assert/strict'
import { addPayee, rememberAaContact, searchPayees } from '../shared/payee-search.mjs'

const makeDb = () => ({ payees: [] })
const counter = () => { let n = 0; return () => `pay-${++n}` }

test('通讯录新增：姓名必填，手机号与账号至少一个', () => {
  const db = makeDb(), nextId = counter()
  assert.throws(() => addPayee(db.payees, { phone: '13700137000' }, nextId), /姓名/)
  assert.throws(() => addPayee(db.payees, { name: '张三' }, nextId), /手机号或账号/)
  assert.throws(() => addPayee(db.payees, { name: '张三', phone: '123' }, nextId), /11 位/)
  assert.throws(() => addPayee(db.payees, { name: '张三', accountNo: '123' }, nextId), /12 至 19 位/)
  assert.equal(db.payees.length, 0, '校验失败不得写入')
  const row = addPayee(db.payees, { name: '张三', phone: '13700137000' }, nextId)
  assert.equal(row.name, '张三'); assert.equal(row.phone, '13700137000'); assert.equal(db.payees.length, 1)
})

test('通讯录去重：手机号或账号任一命中都算同一个人', () => {
  const db = makeDb(), nextId = counter()
  addPayee(db.payees, { name: '张三', accountNo: '8820000000000001' }, nextId)
  // 只带了已有账号：命中
  assert.throws(() => addPayee(db.payees, { name: '张三', accountNo: '8820000000000001' }, nextId), { code: 'PAYEE_EXISTS' })
  assert.equal(db.payees.length, 1)

  const db2 = makeDb()
  addPayee(db2.payees, { name: '李四', phone: '13700137001' }, nextId)
  assert.throws(() => addPayee(db2.payees, { name: '李四', phone: '13700137001' }, nextId), { code: 'PAYEE_EXISTS' })
  assert.equal(db2.payees.length, 1)
})

test('通讯录补齐线索：命中已有记录时补上缺的那条并返回该记录，而不是报错', () => {
  const db = makeDb(), nextId = counter()
  const first = addPayee(db.payees, { name: '张三', accountNo: '8820000000000001' }, nextId)
  // 同一个账号又带了手机号：应补齐，且**返回 2xx 的那条记录**（改动已生效就不能再抛错）。
  const merged = addPayee(db.payees, { name: '张三', phone: '13700137000', accountNo: '8820000000000001' }, nextId)
  assert.equal(merged.id, first.id)
  assert.equal(merged.phone, '13700137000')
  assert.equal(merged.accountNo, '8820000000000001')
  assert.equal(db.payees.length, 1, '补齐不得新建第二条')
  // 再补一次：已经齐了，才是真的重复。
  assert.throws(() => addPayee(db.payees, { name: '张三', phone: '13700137000', accountNo: '8820000000000001' }, nextId), { code: 'PAYEE_EXISTS' })
})

test('同名不同人不会被合并', () => {
  const db = makeDb(), nextId = counter()
  addPayee(db.payees, { name: '张伟', phone: '13700137001' }, nextId)
  addPayee(db.payees, { name: '张伟', phone: '13700137002' }, nextId)
  assert.equal(db.payees.length, 2, '两个不同手机号的张伟是两个人')
})

test('AA 发起时记入参与者：同一个人只会留一条，两条线索会合到同一条', () => {
  const db = makeDb(), nextId = counter()
  rememberAaContact(db, { name: '张三', phone: '13700137000' }, nextId)
  rememberAaContact(db, { name: '张三', accountNo: '8820000000000001' }, nextId)
  rememberAaContact(db, { name: '张三', phone: '13700137000' }, nextId)
  assert.equal(db.payees.length, 1, '同一人的手机号与账号应合到一条')
  assert.equal(db.payees[0].phone, '13700137000')
  assert.equal(db.payees[0].accountNo, '8820000000000001')
})

test('通讯录检索覆盖姓名、账号与备注', () => {
  const db = makeDb(), nextId = counter()
  addPayee(db.payees, { name: '张三', phone: '13700137000' }, nextId)
  assert.equal(searchPayees(db.payees, '张').length, 1)
  assert.equal(searchPayees(db.payees, '13700137000').length, 1)
  assert.equal(searchPayees(db.payees, '不存在').length, 0)
  assert.equal(searchPayees(db.payees).length, 1, '不给关键词时返回全部')
})
