import type { QuestionAnswerItem } from '../api/agent'

export interface QuestionDraft {
  selected: string[]
  custom: string
  customSelected: boolean
}

export const emptyQuestionDraft = (): QuestionDraft => ({ selected: [], custom: '', customSelected: false })

export function selectQuestionOption(draft: QuestionDraft, label: string, multi: boolean): QuestionDraft {
  if (!multi) return { ...draft, selected: [label], customSelected: false }
  return { ...draft, selected: draft.selected.includes(label)
    ? draft.selected.filter(value => value !== label) : [...draft.selected, label] }
}

export function selectCustomAnswer(draft: QuestionDraft, multi: boolean, checked = true): QuestionDraft {
  return { ...draft, selected: multi ? draft.selected : [], customSelected: checked }
}

export function writeCustomAnswer(draft: QuestionDraft, value: string, multi: boolean): QuestionDraft {
  return selectCustomAnswer({ ...draft, custom: value }, multi)
}

export function isQuestionAnswered(draft: QuestionDraft | undefined): boolean {
  return Boolean(draft && (draft.selected.length > 0 || (draft.customSelected && draft.custom.trim() !== '')))
}

/** 未选中的自填草稿不参与提交，避免同时发送“取消”和户名等相反答案。 */
export function questionAnswer(id: string, draft: QuestionDraft): QuestionAnswerItem {
  const custom = draft.customSelected ? draft.custom.trim() : ''
  return { id, selected: draft.selected, ...custom ? { custom } : {} }
}
