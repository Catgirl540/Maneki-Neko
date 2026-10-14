type DeviceNavigator = Pick<Navigator, 'userAgent'> & {
  userAgentData?: { mobile?: boolean }
}

export type ClientDevice = 'desktop' | 'android' | 'ios' | 'other-phone'

/** 判断设备而不是窗口宽度，避免电脑缩窄窗口后被误送到下载页。 */
export function clientDevice(device: DeviceNavigator = navigator): ClientDevice {
  const ua = device.userAgent
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'desktop'
  if (/iPhone|iPod/i.test(ua)) return 'ios'
  const mobile = device.userAgentData?.mobile === true || /Mobile|Mobi\b|Windows Phone|IEMobile|Opera Mini/i.test(ua)
  if (/Android/i.test(ua)) return mobile ? 'android' : 'desktop'
  return mobile ? 'other-phone' : 'desktop'
}
