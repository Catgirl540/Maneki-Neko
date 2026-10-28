import test from 'node:test'
import assert from 'node:assert/strict'
import { returnedApiMethods } from './lib/api-methods.mjs'

test('API extraction tolerates formatting and method syntax but ignores nested or unrelated helpers', () => {
  const source = `async function outside() {}
  export function createMockApi(): BankApi {
    const helper = () => { return { fake: true } }
    return {
  async first() { return { nested: 1 } },
        async second
        () {},
      'third': async () => {},
      fourth: helper,
    }
  }`
  assert.deepEqual([...returnedApiMethods(source, 'createMockApi')], ['first', 'second', 'third', 'fourth'])
})

test('removing or adding a returned method changes the extracted API instead of producing a false green', () => {
  const parse = body => returnedApiMethods(`function createMockApi(){ return {${body}} }`, 'createMockApi')
  const expected = parse('async one(){}, async two(){}')
  assert(expected.has('two')); assert(!parse('async one(){}').has('two'))
  assert(parse('async one(){}, async two(){}, async extra(){}').has('extra'))
})

test('a factory that returns a self-assignment keeps the same extraction and still rejects loose shapes', () => {
  // 内部助手需要 `() => api` 自引用，所以工厂先赋值再 return；这层赋值不该让检查失效。
  const source = `export function createMockApi(): BankApi {
    let api
    const plans = helper(() => api)
    return api = { async first() {}, async second() {} }
  }`
  assert.deepEqual([...returnedApiMethods(source, 'createMockApi')], ['first', 'second'])
  // 赋值右侧不是对象字面量时仍要拒绝，不能因为放宽一层就放过条件返回。
  assert.throws(() => returnedApiMethods('function createMockApi(){ let api; return api = makeApi() }', 'createMockApi'))
  assert.throws(() => returnedApiMethods('function createMockApi(){ let api; return api = { ...other } }', 'createMockApi'))
})

test('missing or unsupported factories, spreads, computed/duplicate keys and syntax errors fail closed', () => {
  for (const source of [
    'function other(){return {}}', 'function createMockApi(){return missing}',
    'function createMockApi(){return {...missing}}', 'function createMockApi(){return {[name](){}}}',
    'function createMockApi(){return {one(){},one(){}}}',
    'function createMockApi(){return {}} function createMockApi(){return {}}',
    'function createMockApi( { return {',
  ]) assert.throws(() => returnedApiMethods(source, 'createMockApi'))
})
