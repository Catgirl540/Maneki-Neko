/**
 * 代客办理（乙模块，Phase 1 实现）。
 * 占位页：乙交付后，由甲把本页替换为乙的实现（目录归乙，见分工清单 §3）。
 */
export function ActionsPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-[var(--color-ink)]">代客办理</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
        白名单动作 Phase 1 接通；未核验禁止解锁卡/调高限额（清单 §2 P1）。
      </p>
    </div>
  )
}
