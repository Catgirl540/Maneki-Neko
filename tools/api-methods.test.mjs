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

test('missing or unsupported factories, spreads, computed/duplicate keys and syntax errors fail closed', () => {
  for (const source of [
    'function other(){return {}}', 'function createMockApi(){return missing}',
    'function createMockApi(){return {...missing}}', 'function createMockApi(){return {[name](){}}}',
    'function createMockApi(){return {one(){},one(){}}}',
    'function createMockApi(){return {}} function createMockApi(){return {}}',
    'function createMockApi( { return {',
  ]) assert.throws(() => returnedApiMethods(source, 'createMockApi'))
})
