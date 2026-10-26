/**
 * 模拟消费的预设平台目录。
 *
 * 只描述**商户身份**（商户名、收单机构、城市、商户号）——分类不在这里写死。
 * 交易分类由服务端的分类器按商户名与摘要判定，和真实刷卡消费走同一条路径；
 * 分类器不可用时保持 other，与既有 `pushTransaction` 的约定一致。
 *
 * 演示用途：这些平台不接真实收单，扣的是演示资金账户的余额。
 */

/** 单笔模拟消费上限：¥50,000.00（分） */
export const SPEND_MAX_CENTS = 5_000_000;

export const SPEND_PLATFORMS = [
  {
    id: 'meituan',
    name: '美团外卖',
    merchantId: 'M3101150001',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 美团外卖',
    counterpartyBank: '美团支付（北京三快在线科技有限公司）',
  },
  {
    id: 'taobao',
    name: '淘宝',
    merchantId: 'M3301060002',
    country: '中国',
    city: '杭州市',
    location: '线上商户 · 淘宝',
    counterpartyBank: '支付宝（中国）网络技术有限公司',
  },
  {
    id: 'jd',
    name: '京东',
    merchantId: 'M1101080003',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 京东商城',
    counterpartyBank: '网银在线（北京）科技有限公司',
  },
  {
    id: 'pinduoduo',
    name: '拼多多',
    merchantId: 'M3101040004',
    country: '中国',
    city: '上海市',
    location: '线上商户 · 拼多多',
    counterpartyBank: '上海寻梦信息技术有限公司',
  },
  {
    id: 'didi',
    name: '滴滴出行',
    merchantId: 'M1101050005',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 滴滴出行',
    counterpartyBank: '滴滴支付（北京小桔科技有限公司）',
  },
  {
    id: 'luckin',
    name: '瑞幸咖啡',
    merchantId: 'M1101010006',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 瑞幸咖啡',
    counterpartyBank: '瑞幸咖啡（中国）有限公司',
  },
  {
    id: 'starbucks',
    name: '星巴克',
    merchantId: 'M3101010007',
    country: '中国',
    city: '上海市',
    location: '线上商户 · 星巴克',
    counterpartyBank: '星巴克咖啡（中国）有限公司',
  },
  {
    id: 'hema',
    name: '盒马鲜生',
    merchantId: 'M3101150008',
    country: '中国',
    city: '上海市',
    location: '线上商户 · 盒马鲜生',
    counterpartyBank: '盒马（中国）有限公司',
  },
  {
    id: 'iqiyi',
    name: '爱奇艺会员',
    merchantId: 'M1101080009',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 爱奇艺',
    counterpartyBank: '北京爱奇艺科技有限公司',
  },
  {
    id: 'china-mobile',
    name: '中国移动话费',
    merchantId: 'M1101010010',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 中国移动',
    counterpartyBank: '中国移动通信集团有限公司',
  },
  {
    id: 'ziroom',
    name: '自如房租',
    merchantId: 'M1101050011',
    country: '中国',
    city: '北京市',
    location: '线上商户 · 自如',
    counterpartyBank: '自如（北京）资产管理有限公司',
  },
  {
    id: 'maoyan',
    name: '猫眼电影',
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
