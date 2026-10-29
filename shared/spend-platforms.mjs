/**
 * 模拟消费的预设平台目录。
 *
 * 只描述**商户身份**（商户名、收单机构、城市、商户号）与展示用的图标元数据
 * （glyph 字形、tone 品牌底色、noteHint 账单详情示例）——分类不在这里写死。
 * 交易分类由服务端的分类器按商户名与摘要判定，和真实刷卡消费走同一条路径；
 * 分类器不可用时由 `shared/spend-rules.mjs` 的本地商户规则兜底（见 docs/api/spend.md）。
 *
 * 演示用途：这些平台不接真实收单，扣的是演示资金账户的余额。
 */

/** 单笔模拟消费上限：¥50,000.00（分） */
export const SPEND_MAX_CENTS = 5_000_000;

export const SPEND_PLATFORMS = [
  {
    id: 'meituan',
    name: '美团外卖',
    glyph: '美',
    tone: '#FFD100',
    ink: '#1F1F1F',
    noteHint: '店铺 · 商品，如：嗉泰面（大朗店）· 猪扒包',
    merchantId: 'M3101150001',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 美团外卖',
    counterpartyBank: '美团支付（北京三快在线科技有限公司）',
  },
  {
    id: 'taobao',
    name: '淘宝',
    glyph: '淘',
    tone: '#FF5000',
    noteHint: '商品名称，如：无线耳机',
    merchantId: 'M3301060002',
    country: '中国',
    city: '杭州市',
    location: '线上商户 · 淘宝',
    counterpartyBank: '支付宝（中国）网络技术有限公司',
  },
  {
    id: 'jd',
    name: '京东',
    glyph: '京',
    tone: '#E1251B',
    noteHint: '商品名称，如：机械键盘',
    merchantId: 'M1101080003',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 京东商城',
    counterpartyBank: '网银在线（北京）科技有限公司',
  },
  {
    id: 'pinduoduo',
    name: '拼多多',
    glyph: '拼',
    tone: '#E02E24',
    noteHint: '商品名称，如：抽纸 24 包',
    merchantId: 'M3101040004',
    country: '中国',
    city: '上海市',
    location: '线上商户 · 拼多多',
    counterpartyBank: '上海寻梦信息技术有限公司',
  },
  {
    id: 'didi',
    name: '滴滴出行',
    glyph: '滴',
    tone: '#FF7F41',
    noteHint: '行程，如：机场 → 公司',
    merchantId: 'M1101050005',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 滴滴出行',
    counterpartyBank: '滴滴支付（北京小桔科技有限公司）',
  },
  {
    id: 'luckin',
    name: '瑞幸咖啡',
    glyph: '瑞',
    tone: '#002D62',
    noteHint: '门店 · 饮品，如：望京 SOHO 店 · 生椰拿铁',
    merchantId: 'M1101010006',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 瑞幸咖啡',
    counterpartyBank: '瑞幸咖啡（中国）有限公司',
  },
  {
    id: 'starbucks',
    name: '星巴克',
    glyph: '星',
    tone: '#00754A',
    noteHint: '门店 · 饮品，如：国贸店 · 燕麦拿铁',
    merchantId: 'M3101010007',
    country: '中国',
    city: '上海市',
    location: '线上商户 · 星巴克',
    counterpartyBank: '星巴克咖啡（中国）有限公司',
  },
  {
    id: 'hema',
    name: '盒马鲜生',
    glyph: '盒',
    tone: '#1A66FF',
    noteHint: '门店 · 商品，如：世纪大道店 · 车厘子',
    merchantId: 'M3101150008',
    country: '中国',
    city: '上海市',
    location: '线上商户 · 盒马鲜生',
    counterpartyBank: '盒马（中国）有限公司',
  },
  {
    id: 'iqiyi',
    name: '爱奇艺会员',
    glyph: '奇',
    tone: '#00BE06',
    noteHint: '会员套餐，如：黄金会员月卡',
    merchantId: 'M1101080009',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 爱奇艺',
    counterpartyBank: '北京爱奇艺科技有限公司',
  },
  {
    id: 'china-mobile',
    name: '中国移动话费',
    glyph: '移',
    tone: '#0085D0',
    noteHint: '充值号码，如：138****8000',
    merchantId: 'M1101010010',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 中国移动',
    counterpartyBank: '中国移动通信集团有限公司',
  },
  {
    id: 'ziroom',
    name: '自如房租',
    glyph: '自',
    tone: '#1F1F1F',
    noteHint: '房源 · 期数，如：朝阳公园店 A 座 · 第 3 期',
    merchantId: 'M1101050011',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 自如',
    counterpartyBank: '自如（北京）资产管理有限公司',
  },
  {
    id: 'maoyan',
    name: '猫眼电影',
    glyph: '猫',
    tone: '#E60012',
    noteHint: '影片 · 影院，如：流浪地球 3 · 万达影城',
    merchantId: 'M1101010012',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 猫眼电影',
    counterpartyBank: '猫眼娱乐（天津）有限公司',
  },
];

/** 按 id 找平台；找不到返回 null，由调用方决定报错口径 */
export function findSpendPlatform(id) {
  if (typeof id !== 'string') return null;
  return SPEND_PLATFORMS.find((item) => item.id === id) ?? null;
}

/**
 * 自由商家：商户名由请求传入（`merchant`），这里只固定收单侧的元数据。
 * - custom：自定义收单，商户名任意
 * - stripe：Stripe 收单，回单对方机构记 Stripe Payments
 */
export const FREE_SPEND_MERCHANTS = [
  {
    id: 'custom',
    name: '自定义商家',
    glyph: '店',
    tone: '#6B7280',
    noteHint: '商户名称，如：街角咖啡',
    country: '中国',
    city: '线上',
    location: '线上商户',
    counterpartyBank: '自定义收单',
    merchantIdPrefix: 'MC',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    glyph: 'S',
    tone: '#635BFF',
    noteHint: 'Stripe 收单商户，如：OpenAI',
    country: '美国',
    city: '旧金山',
    location: '线上商户 · 境外收单',
    counterpartyBank: 'Stripe Payments',
    merchantIdPrefix: 'MS',
  },
];

/** 自由商家名长度上限（字符） */
export const FREE_MERCHANT_NAME_MAX = 40;

export function findFreeMerchant(id) {
  if (typeof id !== 'string') return null;
  return FREE_SPEND_MERCHANTS.find((item) => item.id === id) ?? null;
}
