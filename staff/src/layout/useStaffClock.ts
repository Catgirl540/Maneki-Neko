import { useEffect, useState } from 'react'

/** 长时间值班时，日期与问候语也随上海时区更新。 */
export function useStaffClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
