// 移动端 UI 树截图：遍历 drafts/2026-10-20-mobile-framework.html 的点击路径，
// 把每个节点截到 docs/design/mobile-ui/screens/。页面改动后重跑本脚本并更新 index.md。
// 用法：CHROME_PATH=$(which chromium) node tools/shoot-mobile-ui.mjs
import { chromium } from './node_modules/playwright-core/index.mjs'

const OUT = new URL('../docs/design/mobile-ui/screens/', import.meta.url).pathname
const URL_ = 'http://127.0.0.1:5190/2026-10-20-mobile-framework.html'

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] })
const p = await b.newPage({ viewport: { width: 430, height: 900 } })
const shot = (name) => p.screenshot({ path: `${OUT}${name}.png` })
const back = async () => { await p.click('.screen.on .sub-nav .back, .screen.on .chat-head .back'); await p.waitForTimeout(150) }
const go = async (name) => { await p.click(`.screen.on [data-go="${name}"]`); await p.waitForTimeout(180) }

await p.goto(URL_); await p.waitForTimeout(400)
await shot('01-home')

// 转入弹层
await p.click('.screen.on [data-sheet="in"]'); await p.waitForTimeout(450)
await shot('02-sheet-in')
await p.evaluate(() => closeSheets()); await p.waitForTimeout(300)

// 转出 → 三个渠道 → 金额 → 确认 → 结果
await go('转出'); await shot('10-out-select')
await go('手机号转账'); await shot('11-out-phone'); await back()
await go('银行卡号转账'); await shot('12-out-card'); await back()
await go('跨境支付通'); await shot('13-out-fps')
await go('填写金额'); await shot('20-out-amount')
await p.click('.screen.on [data-sheet="cf"]'); await p.waitForTimeout(450)
await shot('21-sheet-confirm')
await p.click('.sheet[data-sheet="cf"] [data-go="转账结果"]'); await p.waitForTimeout(200)
await shot('22-out-result')
await p.click('.screen.on [data-home]'); await p.waitForTimeout(200)

// 主页宫格：换汇、交易记录
await go('换汇'); await shot('31-sub-换汇'); await back()
await go('交易记录'); await shot('32-sub-交易记录')
await p.click('.screen.on .fbtn'); await p.waitForTimeout(400)
await p.click('.flt .ch >> nth=0 >> a >> nth=2'); await p.click('.flt .ch >> nth=1 >> a >> nth=1')
await p.waitForTimeout(120); await shot('33-filter')
await p.evaluate(() => closeSheets()); await p.waitForTimeout(300)
await p.click('.screen.on [data-go="消费分析"]'); await p.waitForTimeout(350); await shot('37-analysis')
await back(); await back()

// 银行卡
await go('银行卡'); await shot('34-cards'); await back()

// 存款
await go('存款'); await shot('35-deposits'); await back()

// 更多服务
await go('更多'); await shot('36-more'); await back()

// tab 一级页
await p.click('.tab:nth-child(2)'); await p.waitForTimeout(350); await shot('40-tab-wealth')
await p.click('.wtab .seg span >> nth=1'); await p.waitForTimeout(250); await shot('44-wealth-products')
await p.click('.wtab .seg span >> nth=2'); await p.waitForTimeout(250); await shot('45-wealth-holdings')
await p.click('.wtab .seg span >> nth=3'); await p.waitForTimeout(250); await shot('46-wealth-records')
await p.click('.wtab .seg span >> nth=1'); await p.waitForTimeout(200)
await p.click('.screen.on .prod'); await p.waitForTimeout(300); await shot('47-wealth-detail')
await back()
await p.click('.wtab .seg span >> nth=0'); await p.waitForTimeout(200)
await p.click('.screen.on [data-go="储蓄与计划"]'); await p.waitForTimeout(350); await shot('48-savings-goals')
await p.click('.seg span[data-sp="plan"]'); await p.waitForTimeout(250); await shot('48-savings-plans')
await back()
await p.click('.tab:nth-child(4)'); await p.waitForTimeout(350); await shot('41-tab-ntf')
await p.click('.fbtn[data-drawer="ntf"]'); await p.waitForTimeout(400)
await p.click('.drawer[data-drawer="ntf"] .flt .ch >> nth=0 >> a >> nth=1')
await p.click('.drawer[data-drawer="ntf"] .flt .ch >> nth=1 >> a >> nth=1')
await p.waitForTimeout(150); await shot('43-ntf-filter')
await p.evaluate(() => closeSheets()); await p.waitForTimeout(300)
await p.click('.tab:nth-child(5)'); await p.waitForTimeout(250); await shot('42-tab-me')
await p.click('.tab:nth-child(1)'); await p.waitForTimeout(250)

// 登录与开户（从「我的 - 退出登录」进入）
await p.click('.tab:nth-child(5)'); await p.waitForTimeout(250)
await p.click('.screen.on [data-go="登录"]'); await p.waitForTimeout(350); await shot('60-login')
await p.click('.screen.on [data-go="开户·手机号"]'); await p.waitForTimeout(250); await shot('61-open-phone')
await p.click('.screen.on [data-go="开户·实名"]'); await p.waitForTimeout(250); await shot('62-open-realname')
await p.click('.screen.on [data-go="开户·核验"]'); await p.waitForTimeout(250); await shot('63-open-face')
await p.click('.screen.on [data-go="开户·支付密码"]'); await p.waitForTimeout(250); await shot('64-open-password')
await p.click('.screen.on [data-go="开户完成"]'); await p.waitForTimeout(250); await shot('65-open-done')
await p.click('.screen.on [data-home]'); await p.waitForTimeout(250)

// 智能助手（推入页）+ 历史会话抽屉
await p.click('.tab.center'); await p.waitForTimeout(800); await shot('50-assistant')
await p.click('.plus'); await p.waitForTimeout(450); await shot('52-assistant-caps')
await p.evaluate(() => { document.querySelector('.caps').scrollTop = 120 }); await p.waitForTimeout(300); await shot('52b-assistant-caps-scroll')
await p.evaluate(() => closeSheets()); await p.waitForTimeout(250)
await p.click('[data-drawer="hist"]'); await p.waitForTimeout(400); await shot('51-assistant-history')
await p.evaluate(() => closeSheets()); await p.waitForTimeout(300)
await back()


// 交易详情 / 理财申赎 / 申请卡 / 寄送信息
await go('交易记录'); await p.waitForTimeout(250)
await p.click('.screen.on .row >> nth=0'); await p.waitForTimeout(300); await shot('38-tx-detail'); await back()
await p.click('.screen.on [data-go="消费分析"]'); await p.waitForTimeout(200); await back()
await back()

await go('银行卡'); await p.waitForTimeout(250)
await p.click('.cact a[data-sheet="card"]'); await p.waitForTimeout(450); await shot('34b-card-apply')
await p.evaluate(() => closeSheets()); await p.waitForTimeout(250)
await p.click('.screen.on [data-go="寄送信息"]'); await p.waitForTimeout(250); await shot('34c-delivery'); await back()
await p.click('.cact a[data-sheet="card"]'); await p.waitForTimeout(400)
await p.click('.sheet[data-sheet="card"] [data-go="申请受理"]'); await p.waitForTimeout(300); await shot('34b-card-apply-done')
await back(); await back()

await p.click('.tab:nth-child(2)'); await p.waitForTimeout(250)
await p.click('.wtab .seg span >> nth=1'); await p.waitForTimeout(200)
await p.click('.screen.on .prod'); await p.waitForTimeout(300)
await p.click('[data-sheet="sub"]'); await p.waitForTimeout(450); await shot('39-subscribe-sheet')
await p.click('.sheet[data-sheet="sub"] [data-go="申购受理"]'); await p.waitForTimeout(300); await shot('39-subscribe-done')
await p.click('.screen.on [data-tab="1"]'); await p.waitForTimeout(250)
await p.click('.wtab .seg span >> nth=2'); await p.waitForTimeout(250)
await p.click('[data-sheet="red"]'); await p.waitForTimeout(450); await shot('39-redeem-sheet')
await p.click('.sheet[data-sheet="red"] [data-go="赎回受理"]'); await p.waitForTimeout(300); await shot('39-redeem-done')
await p.click('.screen.on [data-tab="1"]'); await p.waitForTimeout(250)

// 更多服务二级页
await p.click('.tab:nth-child(1)'); await p.waitForTimeout(250)
await go('更多'); await p.waitForTimeout(200)
for (const [name, file] of [['自动扣款','40a-autodebit'],['工资与备用金','40b-payroll'],['借款与分期','40c-credit'],['保险保障','40d-insurance'],['邀请与奖励','40e-invite']]) {
  await p.click(`.screen.on [data-go="${name}"]`); await p.waitForTimeout(300); await shot(file); await back()
}
await back()

// 我的二级页
await p.click('.tab:nth-child(5)'); await p.waitForTimeout(250)
for (const [name, file] of [['个人资料','49-profile'],['安全中心','49-security'],['会员等级','49-membership'],['IM 连接','49-im'],['通知设置','49-notify'],['语言与地区','49-language'],['帮助与客服','49-help'],['关于','49-about']]) {
  await p.click(`.screen.on [data-go="${name}"]`); await p.waitForTimeout(300); await shot(file)
  if (name === '会员等级') {
    await p.evaluate(() => { const c = document.querySelector('.screen.on .cards'); if (c) c.scrollLeft = 170 })
    await p.waitForTimeout(350); await shot('49b-membership-cards')
  }
  await back()
}

await b.close()
console.log('done →', OUT)
