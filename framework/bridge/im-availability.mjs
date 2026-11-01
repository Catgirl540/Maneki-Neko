/**
 * The IM adapter is opt-in (`LUCKYCAT_IM_ENABLED` / `LUCKYCAT_STAFF_IM_ENABLED`).
 *
 * When it is off, `/agent-api/im/*` is not an unknown path: the feature exists but
 * is not switched on. The bridge therefore answers 503 `IM_DISABLED` so pages can
 * show an actionable notice instead of leaking an internal route in an error banner.
 */
export function imDisabled(audience = 'customer') {
  return {
    status: 503,
    body: {
      error: audience === 'staff' ? '员工微信 IM 尚未启用' : '微信 IM 尚未启用',
      code: 'IM_DISABLED',
    },
  }
}
