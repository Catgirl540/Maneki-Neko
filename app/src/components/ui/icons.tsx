import type { SVGProps } from 'react'

/**
 * 线性图标集 —— 1.6px 描边、圆角端点，与整体纤细克制的语气一致。
 * 全部 currentColor，尺寸由 className 控制（默认 20px）。
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
    <path d="M9.5 20.5v-6h5v6" />
  </Icon>
)

export const TransferIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M7.5 9.5h9M14 7l2.5 2.5L14 12" />
    <path d="M16.5 15.5h-9M10 13l-2.5 2.5L10 18" />
  </Icon>
)

export const CardIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="M2.5 9.5h19" />
    <path d="M6.5 15h3" />
  </Icon>
)

/** 卡片 + 加号：申请新卡 */
export const CreditCardPlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="M2.5 9.5h19" />
    <path d="M15.5 13.5v4M13.5 15.5h4" />
  </Icon>
)

/** 银行（带立柱）：开户 */
export const BankIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9.6 12 4.6l8.5 5z" />
    <path d="M6 9.6v8M10 9.6v8M14 9.6v8M18 9.6v8" />
    <path d="M4 20.4h16" />
  </Icon>
)

export const ChartIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="18" height="17" rx="3" />
    <path d="M7.5 15.5V12M12 15.5V8.5M16.5 15.5v-5" />
  </Icon>
)

export const ShieldIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.2 5 6v6c0 4.2 2.9 7.6 7 8.8 4.1-1.2 7-4.6 7-8.8V6z" />
    <path d="M9.2 12.2 11.2 14.2 15 10" />
  </Icon>
)

export const ChatIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2-1 0-2-.15-2.9-.42L4.5 20.5l1.2-3.6C4.5 15.6 3.5 14 3.5 12.2c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2z" />
  </Icon>
)

export const ChatSolidIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={0} fill="currentColor">
    <path d="M12 4c-4.9 0-8.9 3.4-8.9 7.6 0 2 1 3.9 2.6 5.2L4.4 20.6a.6.6 0 0 0 .8.74l4.1-1.6c.87.2 1.78.3 2.7.3 4.9 0 8.9-3.4 8.9-7.6S16.9 4 12 4z" />
  </Icon>
)

export const PlusIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12h15M14 6.5 19.5 12 14 17.5" />
  </Icon>
)

export const ArrowDownLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M17.5 6.5 6.5 17.5M6.5 9.5v8h8" />
  </Icon>
)

export const ArrowUpRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 17.5 17.5 6.5M17.5 14.5v-8h-8" />
  </Icon>
)

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Icon>
)

export const UnlockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 7.6-1.7" />
  </Icon>
)

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
)

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4.5 20 19.5" />
    <path d="M9.6 7.1A9.7 9.7 0 0 1 12 6.8c6 0 9.5 5.2 9.5 5.2a17 17 0 0 1-3.1 3.5" />
    <path d="M6.3 9A16.6 16.6 0 0 0 2.5 12s3.5 5.2 9.5 5.2c1.2 0 2.3-.2 3.3-.5" />
    <path d="M10 10.3a2.8 2.8 0 0 0 3.9 3.9" />
  </Icon>
)

export const PhoneIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
    <path d="M10.5 5.5h3" />
  </Icon>
)

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.8 20c.8-3.6 3.7-5.6 7.2-5.6s6.4 2 7.2 5.6" />
  </Icon>
)

export const UsersIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9.5" cy="9" r="3.4" />
    <path d="M3.5 19.5c.7-3.2 3.1-5 6-5s5.3 1.8 6 5" />
    <path d="M16 6.3a3.4 3.4 0 0 1 0 6.4M17.5 14.9c1.7.6 2.9 2.1 3.3 4.1" />
  </Icon>
)

export const ArrowLeftIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19.5 12h-15M10 6.5 4.5 12 10 17.5" />
  </Icon>
)

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="9" y="9.2" width="11.5" height="11.3" rx="2.6" />
    <path d="M15.2 6.3A2.3 2.3 0 0 0 12.9 4H6.3A2.3 2.3 0 0 0 4 6.3v6.6a2.3 2.3 0 0 0 2.3 2.3" />
  </Icon>
)

export const PrinterIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 9.2V4.5h10v4.7" />
    <rect x="3.5" y="9.2" width="17" height="7.4" rx="2.2" />
    <path d="M7 14.2h10v5.3H7z" />
  </Icon>
)

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5v10.6M7.9 10 12 14.1 16.1 10" />
    <path d="M4.5 16.6v1.9a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.9" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5.5 9.5 12 16l6.5-6.5" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5 9.5 17 19 7" />
  </Icon>
)

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4 4" />
  </Icon>
)

export const BellIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5h-14S6.5 14 6.5 10z" />
    <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
  </Icon>
)

export const LogoutIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2.5" />
    <path d="M10.5 12H21M17.5 8.5 21 12l-3.5 3.5" />
  </Icon>
)

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 7h9M17.5 7H19M5 17h3.5M12 17h7" />
    <circle cx="15.5" cy="7" r="2.2" />
    <circle cx="10" cy="17" r="2.2" />
  </Icon>
)

export const SparkleIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 13.7 9l5.5 1.8-5.5 1.9L12 18.3l-1.7-5.6L4.8 10.8 10.3 9z" />
  </Icon>
)

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M12 7.8v5M12 16h.01" />
  </Icon>
)

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7" />
    <path d="M20.5 4.5V9H16" />
  </Icon>
)

export const SendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20.5 3.5 3.8 10.2l6.6 2.7 2.7 6.6z" />
    <path d="M20.5 3.5 10.4 12.9" />
  </Icon>
)

export const WalletIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 8.5A2.5 2.5 0 0 1 6 6h11.5a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 17.5 19H6a2.5 2.5 0 0 1-2.5-2.5z" />
    <path d="M20 10.5h-3.2a1.8 1.8 0 0 0 0 3.6H20" />
  </Icon>
)

export const PigIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="6.5" width="17" height="13" rx="3" />
    <path d="M12 6.5V4M8.5 6.5c0-1.4 1.6-2.4 3.5-2.4s3.5 1 3.5 2.4" />
    <circle cx="12" cy="13" r="2.6" />
  </Icon>
)

export const ShopIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 8.5h15l-1 11a1.5 1.5 0 0 1-1.5 1.4H7a1.5 1.5 0 0 1-1.5-1.4z" />
    <path d="M9 8.5V6.8a3 3 0 0 1 6 0v1.7" />
  </Icon>
)

export const FoodIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 3.5v7a2.4 2.4 0 0 0 4.8 0v-7M8.4 12.9V20.5" />
    <path d="M16.5 3.5c1.6 1.4 2.3 3 2.3 5s-.8 3-2.3 3.6V20.5" />
  </Icon>
)

export const HouseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
  </Icon>
)

export const CarIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 15.5v2a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-1.5M16 16v1.5a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-2" />
    <path d="M4.5 15.5V12l1.8-4.5A1.5 1.5 0 0 1 7.7 6.5h8.6a1.5 1.5 0 0 1 1.4 1L19.5 12v3.5z" />
    <path d="M4.5 12h15" />
  </Icon>
)

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M10.3 8.8 15 12l-4.7 3.2z" />
  </Icon>
)

export const DeviceIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M8 20.5h8M12 16.5v4" />
  </Icon>
)

export const GlobalIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.8" />
    <path d="M3.2 12h17.6" />
    <path d="M12 3.2c2.2 2.4 3.3 5.4 3.3 8.8S14.2 18.4 12 20.8c-2.2-2.4-3.3-5.4-3.3-8.8S9.8 5.6 12 3.2z" />
  </Icon>
)

export const BoltIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 3 6 13.2h4.8L10 21l7.6-10.2H12.8z" />
  </Icon>
)

/** 侧栏收起（面板 + 左向箭头） */
export const SidebarCollapseIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
    <path d="M16.2 9.4 13.6 12l2.6 2.6" />
  </Icon>
)

/** 侧栏展开（面板 + 右向箭头） */
export const SidebarExpandIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M9.5 4.5v15" />
    <path d="M13.8 9.4 16.4 12l-2.6 2.6" />
  </Icon>
)

/** 铅笔：重命名 */
export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </Icon>
)

/** 垃圾桶：删除 */
export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M9.5 7V4.8h5V7" />
    <path d="M6.5 7l1 12.2c.06.9.8 1.6 1.7 1.6h5.6c.9 0 1.64-.7 1.7-1.6L17.5 7" />
    <path d="M10.5 11v6M13.5 11v6" />
  </Icon>
)

/** 带指针的表盘：历史对话 */
export const HistoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.2 4.2v4.3h4.3" />
    <path d="M12 7.8V12l3 1.8" />
  </Icon>
)