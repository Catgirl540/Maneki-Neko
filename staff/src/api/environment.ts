/** Keep the selected bank consistent across all staff requests in this tab. */
const key = 'luckycat.staff.bank-environment'
const selected = new URLSearchParams(window.location.search).get('bank')
if (selected === 'demo' || selected === 'live') sessionStorage.setItem(key, selected)
export const isDemoStaff = sessionStorage.getItem(key) === 'demo'
export const staffEnvironmentLabel = isDemoStaff ? '演示银行（与官网客户同一环境）' : '合作银行环境'
export const staffRequestPath = (path: string) => isDemoStaff && path.startsWith('/staff-api/')
  ? path.replace('/staff-api/', '/staff-demo-api/') : path

export function changeStaffEnvironment(bank: 'demo' | 'live') {
  // Reload clears the in-memory staff token before the new bank receives requests.
  const base = import.meta.env.BASE_URL
  window.location.assign(`${base}login?bank=${bank}`)
}
