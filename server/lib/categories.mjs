// Server-owned business implementation; API contract preserved from the existing client.
export const CATEGORY_LABEL = {
    salary: '工资入账',
    transfer: '转账',
    dining: '餐饮',
    shopping: '购物',
    housing: '房租',
    transport: '交通',
    subscription: '订阅服务',
    other: '其他',
};
/** 环形图 / 图例配色。金 → 青 → 灰，用 token 变量而非硬编码色值 */
export const CATEGORY_COLOR = {
    dining: 'var(--color-gold)',
    shopping: 'var(--color-blue)',
    housing: 'var(--color-chart-neutral)',
    transport: 'var(--color-gold-wash)',
    subscription: 'var(--color-blue-wash)',
    transfer: 'var(--color-line-strong)',
    other: 'var(--color-gold-tint)',
    salary: 'var(--color-blue)',
};
