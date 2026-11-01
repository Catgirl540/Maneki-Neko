import { avatarUrl, isAvatarId } from '../../../../shared/avatars.mjs'

interface AvatarProps {
  /** 头像池 id；非池内值退回姓名首字 */
  avatarId?: string | null
  /** 姓名首字，头像缺失时的兜底 */
  initial?: string | null
  /** 直径（px） */
  size?: number
  className?: string
}

/**
 * 用户头像：头像池里的图直接用，缺失或非法时退回姓名首字。
 *
 * 不在这里做圆角裁切之外的任何处理——头像文件本身是白底方图，
 * 用 `rounded-full` 裁成圆形即可。
 */
export function Avatar({ avatarId, initial, size = 32, className }: AvatarProps) {
  if (!isAvatarId(avatarId)) {
    return (
      <span
        aria-hidden
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: '9999px',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-gold-wash, #f4efe4)',
          color: 'var(--color-gold-deep, #6b5423)',
          fontSize: Math.round(size * 0.42),
          fontWeight: 600,
        }}
      >
        {initial || '喵'}
      </span>
    )
  }
  return (
    <img
      src={avatarUrl(avatarId)}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full bg-white object-cover ${className ?? ''}`}
      style={{ width: size, height: size }}
    />
  )
}
