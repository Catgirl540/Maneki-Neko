// node --import ./tools/ts-resolve-hook.mjs tools/check-question-drafts.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyQuestionDraft, isQuestionAnswered, questionAnswer, selectCustomAnswer, selectQuestionOption, writeCustomAnswer } from '../app/src/lib/questionDrafts.ts'

test('单选：输入户名自动取消“先不转了”，提交只含自填户名', () => {
  const cancel = selectQuestionOption(emptyQuestionDraft(), '先不转了', false)
  const custom = writeCustomAnswer(cancel, '  测试收款人  ', false)
  assert.deepEqual(custom.selected, [])
  assert.equal(custom.customSelected, true)
  assert.deepEqual(questionAnswer('name', custom), { id: 'name', selected: [], custom: '测试收款人' })
})

test('单选：切回预设选项不会连带提交残留自填草稿', () => {
  const custom = writeCustomAnswer(emptyQuestionDraft(), '测试收款人', false)
  const cancel = selectQuestionOption(custom, '先不转了', false)
  assert.equal(cancel.customSelected, false)
  assert.equal(cancel.custom, '测试收款人')
  assert.deepEqual(questionAnswer('name', cancel), { id: 'name', selected: ['先不转了'] })
  const resumed = selectCustomAnswer(cancel, false)
  assert.deepEqual(questionAnswer('name', resumed), { id: 'name', selected: [], custom: '测试收款人' })
})

test('空白自填不能提交，单选选项切换仍互斥', () => {
  let draft = selectCustomAnswer(emptyQuestionDraft(), false)
  assert.equal(isQuestionAnswered(draft), false)
  draft = writeCustomAnswer(draft, '  ', false)
  assert.equal(isQuestionAnswered(draft), false)
  draft = selectQuestionOption(draft, '中国大陆', false)
  draft = selectQuestionOption(draft, '中国香港', false)
  assert.deepEqual(draft.selected, ['中国香港'])
  assert.equal(isQuestionAnswered(draft), true)
})

test('多选可以与自填组合，取消自填后保留预设选择', () => {
  let draft = selectQuestionOption(emptyQuestionDraft(), '邮件', true)
  draft = selectQuestionOption(draft, '短信', true)
  draft = writeCustomAnswer(draft, '电话', true)
  assert.deepEqual(questionAnswer('channels', draft), { id: 'channels', selected: ['邮件', '短信'], custom: '电话' })
  draft = selectCustomAnswer(draft, true, false)
  assert.deepEqual(questionAnswer('channels', draft), { id: 'channels', selected: ['邮件', '短信'] })
  draft = selectQuestionOption(draft, '邮件', true)
  assert.deepEqual(draft.selected, ['短信'])
})

test('纯自由输入与不同题目相互独立', () => {
  const name = writeCustomAnswer(emptyQuestionDraft(), '测试收款人', false)
  const region = selectQuestionOption(emptyQuestionDraft(), '中国大陆', false)
  assert.deepEqual(questionAnswer('name', name), { id: 'name', selected: [], custom: '测试收款人' })
  assert.deepEqual(questionAnswer('region', region), { id: 'region', selected: ['中国大陆'] })
  assert.equal(isQuestionAnswered(undefined), false)
  assert.equal(isQuestionAnswered(emptyQuestionDraft()), false)
})
