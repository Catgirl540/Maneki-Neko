/**
 * 演示身份证生成器。
 *
 * 正规开户要求拍摄身份证——演示环境没有摄像头和 OCR，
 * 就用「点击生成」代替：号码按 GB 11643-1999 算出真实校验位，
 * 性别与序列号奇偶一致，看起来像一张真的证件，但纯属虚构。
 */

export interface DemoIdentity {
  name: string
  gender: '男' | '女'
  ethnicity: string
  birthDate: string // YYYY 年 MM 月 DD 日
  address: string
  idNumber: string // 18 位，含合法校验位
  // 国徽面
  issueAuthority: string // 签发机关
  validPeriod: string // 有效期限，YYYY.MM.DD-YYYY.MM.DD 或 -长期
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK_CHARS = '10X98765432'

/** GB 11643-1999 校验位：前 17 位加权和 % 11 查表 */
function idChecksum(body17: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(body17[i]) * ID_WEIGHTS[i]
  return ID_CHECK_CHARS[sum % 11]
}

const SURNAMES = ['沈', '顾', '陆', '韩', '方', '袁', '邹', '尹', '梅', '喻']
const GIVEN_NAMES = ['一诺', '亦辰', '书瑶', '景行', '清和', '望舒', '知远', '静姝', '云舟', '听澜']
const REGIONS = [
  { code: '110101', address: '北京市东城区东华门街道灯市口大街 12 号', authority: '北京市公安局东城分局' },
  { code: '310104', address: '上海市徐汇区漕溪北路 88 号', authority: '上海市公安局徐汇分局' },
  { code: '330106', address: '杭州市西湖区文三路 259 号', authority: '杭州市公安局西湖分局' },
  { code: '440305', address: '深圳市南山区深南大道 9668 号', authority: '深圳市公安局南山分局' },
  { code: '510107', address: '成都市武侯区人民南路四段 27 号', authority: '成都市公安局武侯分局' },
]

const pad2 = (n: number) => String(n).padStart(2, '0')

export function generateDemoIdentity(): DemoIdentity {
  const name = SURNAMES[Math.floor(Math.random() * SURNAMES.length)] +
    GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)]
  const region = REGIONS[Math.floor(Math.random() * REGIONS.length)]
  // 1978–2000 年出生，保证是成年人
  const year = 1978 + Math.floor(Math.random() * 23)
  const month = 1 + Math.floor(Math.random() * 12)
  const day = 1 + Math.floor(Math.random() * 28)
  const gender: DemoIdentity['gender'] = Math.random() < 0.5 ? '男' : '女'
  // 顺序码第 3 位：奇数男、偶数女
  let seq = 100 + Math.floor(Math.random() * 99)
  seq = gender === '男' ? seq | 1 : seq & ~1
  const body = `${region.code}${year}${pad2(month)}${pad2(day)}${seq}`

  // 有效期按签发规则：16-25 岁发 10 年，26-45 岁发 20 年，46 岁以上长期
  const now = new Date()
  const issueYear = now.getFullYear() - (1 + Math.floor(Math.random() * 5))
  const issueDate = `${issueYear}.${pad2(1 + Math.floor(Math.random() * 12))}.${pad2(1 + Math.floor(Math.random() * 28))}`
  const age = now.getFullYear() - year
  const span = age <= 25 ? 10 : age <= 45 ? 20 : null
  const validPeriod = span ? `${issueDate}-${issueYear + span}${issueDate.slice(4)}` : `${issueDate}-长期`

  return {
    name,
    gender,
    ethnicity: '汉',
    birthDate: `${year} 年 ${pad2(month)} 月 ${pad2(day)} 日`,
    address: region.address,
    idNumber: body + idChecksum(body),
    issueAuthority: region.authority,
    validPeriod,
  }
}
