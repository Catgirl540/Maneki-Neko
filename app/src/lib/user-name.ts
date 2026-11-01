import { displayNameOf, maskedNameOf } from '../../../shared/name-display.mjs'
import { nicknameOf } from '../../../shared/nickname.mjs'

type NameLike = {
  name?: string | null
  displayName?: string | null
  maskedName?: string | null
  honorific?: string | null
  nickname?: string | null
} | null | undefined

/**
 * 列表里展示的称呼：优先用服务端下发的 `displayName`，
 * 老接口没有该字段时按同一套规则（姓氏 + 先生/女士）现算。
 */
export function userDisplayName(user: NameLike): string {
  if (!user) return ''
  return user.displayName || displayNameOf(user.name, user.honorific)
}

/** 详情里的脱敏姓名：优先服务端值，否则保留首尾打星。 */
export function userMaskedName(user: NameLike): string {
  if (!user) return ''
  return user.maskedName || maskedNameOf(user.name)
}

/**
 * 展示用昵称：自定义优先，否则回退到称呼。
 *
 * 昵称不是姓名——姓名在详情里始终走 [userMaskedName]。
 */
export function userNickname(user: NameLike): string {
  if (!user) return ''
  return user.nickname || nicknameOf({ nickname: user.nickname, displayName: user.displayName || displayNameOf(user.name, user.honorific) })
}
