// Server-owned business implementation; API contract preserved from the existing client.
/* ==========================================================================
   收款标识的输入格式化与校验
   - 银行账户：12–19 位数字，按 4 位分组展示
   - 转数快标识：手机号（香港 8 位） / 电邮 / 7 位 FPS ID
   ========================================================================== */
/** 去掉所有非数字字符 */
export function digitsOnly(raw) {
    return raw.replace(/\D/g, '');
}
/**
 * 卡 BIN（发卡行识别码）的位数。
 *
 * 真实 BIN 长度 6–9 位不等，本行只收录 6 位（见 tools/gen-bin-table.mjs 的筛选规则），
 * 因为 6 位已经覆盖绝大多数借记卡，而且让「输满 6 位就出结果」这条交互规则成立。
 * 放在 lib 里由界面和 mock 共用，避免两边各写一个 6。
 */
export const CARD_BIN_LENGTH = 6;
/** 银行卡号按 4 位分组：6222 0202 0011 2233 445 */
export function formatBankAccount(raw) {
    return digitsOnly(raw).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
}
/** 校验银行卡号，返回错误文案（通过则返回 null） */
export function validateBankAccount(raw) {
    const digits = digitsOnly(raw);
    if (digits.length === 0)
        return '请输入收款账号';
    if (digits.length < 12)
        return '账号至少 12 位';
    if (digits.length > 19)
        return '账号最多 19 位';
    return null;
}
/** 6222 **** **** 3445 */
export function maskBankAccount(raw) {
    const digits = digitsOnly(raw);
    if (digits.length <= 8)
        return digits;
    return `${digits.slice(0, 4)} **** **** ${digits.slice(-4)}`;
}
/* ------------------------------------------------------------ 汇款方式 */
export const FPS_METHOD_LABEL = {
    account: '收款账户',
    mobile: '手机号',
    email: '电邮',
    fpsid: 'FPS ID',
};
export const FPS_METHOD_PLACEHOLDER = {
    account: '请输入英文字母或数字',
    mobile: '请输入手机号',
    email: '请输入邮箱地址',
    fpsid: '请输入 7 位 FPS ID',
};
/** FPS 收款币种：转数快同时支持人民币与港币 */
export const FPS_CURRENCIES = [
    { value: 'CNY', label: '人民币' },
    { value: 'HKD', label: '港币' },
];
/** 按方式格式化输入 */
export function formatFpsValue(method, raw) {
    if (method === 'mobile') {
        return digitsOnly(raw).slice(0, 8).replace(/(\d{4})(?=\d)/, '$1 ');
    }
    if (method === 'fpsid') {
        return digitsOnly(raw).slice(0, 7);
    }
    if (method === 'account') {
        // 香港账户可能是纯数字，也可能是字母数字混合，只做长度限制
        return raw.replace(/[^0-9a-zA-Z]/g, '').slice(0, 24);
    }
    return raw.replace(/\s/g, '').slice(0, 60);
}
/** 校验，返回错误文案（通过则返回 null） */
export function validateFpsValue(method, raw) {
    const value = raw.trim();
    if (!value)
        return `请输入${FPS_METHOD_LABEL[method]}`;
    if (method === 'account') {
        if (value.length < 6)
            return '收款账号至少 6 位';
        return null;
    }
    if (method === 'mobile') {
        if (!/^[4-9]\d{7}$/.test(digitsOnly(value)))
            return '请输入 8 位香港手机号（4/5/6/7/8/9 开头）';
        return null;
    }
    if (method === 'fpsid') {
        if (!/^\d{7}$/.test(digitsOnly(value)))
            return 'FPS ID 为 7 位数字';
        return null;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value))
        return '请输入有效的邮箱地址';
    return null;
}
/** 脱敏展示 */
export function maskFpsValue(method, raw) {
    if (method === 'account') {
        const v = raw.trim();
        if (v.length <= 6)
            return v;
        return `${v.slice(0, 3)} **** ${v.slice(-3)}`;
    }
    if (method === 'mobile') {
        const digits = digitsOnly(raw);
        return digits.length === 8 ? `${digits.slice(0, 4)} ****` : digits;
    }
    if (method === 'fpsid')
        return raw;
    const [name, domain] = raw.split('@');
    if (!domain)
        return raw;
    const head = name.slice(0, Math.min(2, name.length));
    return `${head}${'*'.repeat(Math.max(name.length - 2, 1))}@${domain}`;
}
