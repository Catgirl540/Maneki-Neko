# -*- coding: utf-8 -*-
"""生成答辩 PPTX（16:9，13 页 / 约 10 分钟）。

版式与配色沿用技术文档与产品视觉：浅冷底 + 品牌紫 + 墨蓝。
所有文本使用原生文本框架（可编辑），图表为 2x PNG。
"""
import os
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
OUT = os.path.join(HERE, "招财猫银行-答辩材料.pptx")

# ------------------------------------------------------------------ 令牌
INK = RGBColor(0x06, 0x1B, 0x31)
INK_SOFT = RGBColor(0x4E, 0x60, 0x78)
MUTE = RGBColor(0x64, 0x74, 0x8D)
LINE = RGBColor(0xE2, 0xE8, 0xF2)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
PURPLE = RGBColor(0x53, 0x3A, 0xFD)
PURPLE_DEEP = RGBColor(0x44, 0x34, 0xD4)
WASH = RGBColor(0xEA, 0xE7, 0xFF)
TINT = RGBColor(0xF2, 0xF0, 0xFF)
NAVY = RGBColor(0x10, 0x1C, 0x35)
CORAL = RGBColor(0xD9, 0x21, 0x59)
TEAL = RGBColor(0x0F, 0x8A, 0x8A)
BLUE = RGBColor(0x30, 0x6F, 0xDB)
PAPER = RGBColor(0xF7, 0xF8, 0xFC)
CARD = RGBColor(0xFF, 0xFF, 0xFF)

FONT = "微软雅黑"
W, H = 13.333, 7.5
M = 0.82  # 左右页边距（英寸）


def _set_font(run, size, bold=False, color=INK, font=FONT, italic=False, spacing=None):
    f = run.font
    f.name = font
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", font)
    if spacing is not None:
        rPr.set("spc", str(int(spacing * 100)))


class Deck:
    def __init__(self):
        self.prs = Presentation()
        self.prs.slide_width = Inches(W)
        self.prs.slide_height = Inches(H)
        self.blank = self.prs.slide_layouts[6]
        self.n = 0

    # ---------- 基础 ----------
    def slide(self, bg=PAPER):
        s = self.prs.slides.add_slide(self.blank)
        fill = s.background.fill
        fill.solid()
        fill.fore_color.rgb = bg
        self.n += 1
        return s

    def rect(self, s, x, y, w, h, fill=None, line=None, lw=1.0, radius=None, shadow=False):
        shape_type = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
        sh = s.shapes.add_shape(shape_type, Inches(x), Inches(y), Inches(w), Inches(h))
        if radius:
            try:
                sh.adjustments[0] = radius
            except Exception:
                pass
        if fill is None:
            sh.fill.background()
        else:
            sh.fill.solid()
            sh.fill.fore_color.rgb = fill
        if line is None:
            sh.line.fill.background()
        else:
            sh.line.color.rgb = line
            sh.line.width = Pt(lw)
        if not shadow:
            sh.shadow.inherit = False
        return sh

    def text(self, s, x, y, w, h, runs, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT,
             anchor=MSO_ANCHOR.TOP, line=1.25, space_after=0, wrap=True, spacing=None,
             margins=(0, 0, 0, 0)):
        """runs: str 或 list[(text, size, bold, color)] 或 list[段落 list]。"""
        tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        tf = tb.text_frame
        tf.word_wrap = wrap
        tf.vertical_anchor = anchor
        tf.margin_left, tf.margin_top, tf.margin_right, tf.margin_bottom = [Inches(v) for v in margins]
        tf.auto_size = None

        paragraphs = runs if isinstance(runs, list) and runs and isinstance(runs[0], list) else [runs]
        for pi, para in enumerate(paragraphs):
            p = tf.paragraphs[0] if pi == 0 else tf.add_paragraph()
            p.alignment = align
            p.line_spacing = line
            if space_after:
                p.space_after = Pt(space_after)
            items = para if isinstance(para, list) else [(para, size, bold, color)]
            for item in items:
                if isinstance(item, str):
                    txt, sz, bd, cl = item, size, bold, color
                else:
                    txt, sz, bd, cl = item
                r = p.add_run()
                r.text = txt
                _set_font(r, sz, bd, cl, spacing=spacing)
        return tb

    def pic(self, s, path, x, y, w=None, h=None):
        kw = {}
        if w:
            kw["width"] = Inches(w)
        if h:
            kw["height"] = Inches(h)
        return s.shapes.add_picture(os.path.join(ASSETS, path), Inches(x), Inches(y), **kw)

    # ---------- 版式组件 ----------
    def header(self, s, eyebrow, title, sub=None, dark=False):
        c_eyebrow = RGBColor(0x9B, 0x8C, 0xFF) if dark else PURPLE
        c_title = WHITE if dark else INK
        c_sub = RGBColor(0xB9, 0xC5, 0xDA) if dark else INK_SOFT
        self.text(s, M, 0.52, W - 2 * M, 0.3, eyebrow, size=11.5, color=c_eyebrow, bold=True, spacing=2.4)
        self.text(s, M, 0.80, W - 2 * M, 0.62, title, size=30, color=c_title, bold=True, line=1.06)
        if sub:
            self.text(s, M, 1.42, W - 2 * M, 0.42, sub, size=13, color=c_sub, line=1.3)

    def footer(self, s, dark=False, note=None):
        c = RGBColor(0x7A, 0x8A, 0xA6) if not dark else RGBColor(0x6E, 0x7E, 0x9A)
        self.rect(s, M, H - 0.62, W - 2 * M, 0.012, fill=RGBColor(0x2A, 0x38, 0x52) if dark else LINE)
        self.text(s, M, H - 0.52, 6.0, 0.3, "招财猫银行 · Money Meow Bank　|　AI Banking 智能体", size=9, color=c)
        if note:
            import re
            note = re.sub(r"^\d{2} / 13", f"{self.n:02d} / 13", note)
            self.text(s, W - M - 4.4, H - 0.52, 3.2, 0.3, note, size=9, color=c, align=PP_ALIGN.RIGHT)
        self.text(s, W - M - 1.0, H - 0.52, 1.0, 0.3, f"{self.n:02d}", size=9.5, color=c,
                  bold=True, align=PP_ALIGN.RIGHT)

    def notes(self, s, text):
        s.notes_slide.notes_text_frame.text = text

    # ---------- 卡片 ----------
    def card(self, s, x, y, w, h, accent=PURPLE, fill=CARD, border=LINE):
        self.rect(s, x, y, w, h, fill=fill, line=border, lw=0.9, radius=0.055)
        self.rect(s, x, y, w, 0.045, fill=accent, radius=0.5)

    def stat(self, s, x, y, w, value, unit, label, accent=PURPLE):
        self.text(s, x, y, w, 0.72, [[(value, 40, True, accent), (unit, 15, True, accent)]], line=1.0)
        self.text(s, x, y + 0.74, w, 0.34, label, size=11.5, color=INK_SOFT, line=1.3)

    # ---------- 原生示意图元件 ----------
    def arrow_r(self, s, x, y, w=0.26, color=None):
        color = color or RGBColor(0xB9, 0xC4, 0xD8)
        self.rect(s, x, y + 0.02, w - 0.07, 0.022, fill=color)
        tri = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(x + w - 0.11), Inches(y - 0.055), Inches(0.11), Inches(0.17))
        tri.rotation = 90
        tri.fill.solid()
        tri.fill.fore_color.rgb = color
        tri.line.fill.background()
        tri.shadow.inherit = False

    def band(self, s, x, y, w, h, label, color, cards, gap=0.10):
        """一条分层：左侧层名 + 右侧若干小卡。cards=[(标题, 副标题)]"""
        self.rect(s, x, y, w, h, fill=CARD, line=LINE, lw=0.8, radius=0.05)
        self.rect(s, x, y, 0.92, h, fill=color, radius=0.05)
        self.rect(s, x + 0.72, y, 0.20, h, fill=color)
        self.text(s, x, y + h / 2 - 0.14, 0.92, 0.28, label, size=9.5, color=WHITE, bold=True,
                  align=PP_ALIGN.CENTER, line=1.0)
        cx = x + 1.02
        cw = (w - 1.02 - gap * (len(cards) - 1) - 0.10) / len(cards)
        for title, sub in cards:
            self.rect(s, cx, y + 0.09, cw, h - 0.18, fill=RGBColor(0xFB, 0xFC, 0xFF), line=RGBColor(0xEA, 0xEF, 0xF8), lw=0.6, radius=0.08)
            self.text(s, cx + 0.10, y + 0.15, cw - 0.2, 0.24, title, size=8.6, color=INK, bold=True, line=1.1)
            if sub:
                self.text(s, cx + 0.10, y + 0.38, cw - 0.18, h - 0.5, sub, size=7.2, color=INK_SOFT, line=1.2)
            cx += cw + gap


# ==================================================================== 幻灯片
def s01_cover(d):
    s = d.slide(NAVY)
    # 装饰：右下角细网格
    for gy in range(0, 4):
        for gx in range(0, 7):
            d.rect(s, 9.2 + gx * 0.55, 4.6 + gy * 0.55, 0.035, 0.035, fill=RGBColor(0x1E, 0x2E, 0x4E))

    badge = d.rect(s, M, 0.92, 0.92, 0.92, fill=PURPLE, radius=0.32)
    d.text(s, M, 1.10, 0.92, 0.56, "招", size=26, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
    d.text(s, M + 1.12, 1.02, 6.0, 0.3, "M O N E Y   M E O W   B A N K", size=11, color=RGBColor(0x8E, 0xA3, 0xC8), bold=True)
    d.text(s, M + 1.12, 1.30, 6.0, 0.34, "招财猫银行", size=19, color=WHITE, bold=True)

    d.text(s, M, 2.42, 10.6, 0.32, "AI BANKING AGENT · 技术答辩", size=12, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True, spacing=3)
    d.text(s, M, 2.82, 11.0, 1.0, "让 AI 真正会办银行业务", size=44, color=WHITE, bold=True, line=1.05)
    d.text(s, M, 3.86, 10.4, 0.5, "一个可验证、可回滚、可演示的智能银行系统", size=19, color=RGBColor(0xC7, 0xD3, 0xE6), line=1.3)

    # 三条要点
    items = [("四端一核", "网页 · 安卓 · 员工端 · IM"), ("115 个端点", "契约先行 · 同一套规则"), ("10 分钟", "架构 / 算法 / 安全 / 边界")]
    x = M
    for i, (k, v) in enumerate(items):
        d.rect(s, x, 4.86, 0.03, 0.62, fill=PURPLE)
        d.text(s, x + 0.16, 4.86, 2.6, 0.3, k, size=14, color=WHITE, bold=True)
        d.text(s, x + 0.16, 5.16, 2.9, 0.3, v, size=10.5, color=RGBColor(0x93, 0xA5, 0xC2))
        x += 3.3

    d.rect(s, M, H - 1.16, W - 2 * M, 0.012, fill=RGBColor(0x2A, 0x38, 0x52))
    d.text(s, M, H - 1.04, 8.4, 0.3, "比赛演示作品 · 非真实银行　|　技术文档同步提交", size=9.5, color=RGBColor(0x6E, 0x7E, 0x9A))
    d.text(s, W - M - 4.0, H - 1.04, 4.0, 0.3, "2026.10.28", size=9.5, color=RGBColor(0x6E, 0x7E, 0x9A), align=PP_ALIGN.RIGHT)
    d.notes(s, "【0:00–0:30】开场：我们做的是招财猫银行，一个能真正办理银行业务的 AI 智能体系统。\n"
                "今天用 10 分钟讲四件事：架构怎么分层、核心算法怎么保证钱不出错、安全边界在哪里、以及我们明确没做什么。\n"
                "先说清楚定位：这是比赛演示作品，不是真实银行；但它的资金逻辑和约束是按真实系统写的。")


def s02_numbers(d):
    s = d.slide()
    d.header(s, "OPENING", "先给三个数字", "工程量不是重点，重点是它们背后的约束")
    stats = [
        ("115", "个", "文档化 REST 端点", "账户、卡、转账、理财、预算、会员、工单、Agent 全覆盖"),
        ("50", "张", "PostgreSQL 表 / 4 schema", "客户与账户、银行协作、复式记账、监管报表分层隔离"),
        ("78", "项", "后端断言 / 20 个测试文件", "迁移、冻结、幂等、并发、限额、账务逐项校验"),
    ]
    x = M
    cw = (W - 2 * M - 0.5) / 3
    for i, (v, u, label, desc) in enumerate(stats):
        d.card(s, x, 1.95, cw, 2.35, accent=[PURPLE, BLUE, TEAL][i])
        d.text(s, x + 0.34, 2.18, cw - 0.6, 0.8, [[(v, 46, True, [PURPLE, BLUE, TEAL][i]), (u, 16, True, INK_SOFT)]], line=1.0)
        d.text(s, x + 0.34, 3.02, cw - 0.6, 0.3, label, size=13, color=INK, bold=True)
        d.text(s, x + 0.34, 3.38, cw - 0.62, 0.72, desc, size=10.5, color=INK_SOFT, line=1.45)
        x += cw + 0.25

    # 底部主张
    d.rect(s, M, 4.72, W - 2 * M, 1.52, fill=NAVY, radius=0.05)
    d.text(s, M + 0.5, 4.95, W - 2 * M - 1.0, 0.3, "核心主张", size=10.5, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True, spacing=2.5)
    d.text(s, M + 0.5, 5.24, W - 2 * M - 1.0, 0.8,
           "AI 不是给银行加一个聊天框，而是把「会办业务」装进一套可审计的资金约束里。", size=19, color=WHITE, bold=True, line=1.3)
    d.footer(s, note="01 / 13　约 30 秒")
    d.notes(s, "【0:30–1:10】三个数字说明规模：115 个端点、50 张表、78 项断言。\n"
                "但规模不是重点。重点是这三组数字背后的三件事：端点说明业务面完整，schema 说明钱和证据分开存，断言说明关键路径被自动验证过。\n"
                "一句话主张：AI 不是给银行加聊天框，而是把「会办业务」装进可审计的资金约束里。")


def s03_three(d):
    s = d.slide()
    d.header(s, "PROBLEM", "做 AI 银行，难的不是对话", "三个真实的判断题，决定了后面的所有设计")
    cards = [
        ("01", "钱不能停在中间态", "先扣钱再补流水，一旦崩溃就会出现「扣了钱没流水」。", "交易即事务：冻结、流水、凭证、审计同事务提交，失败整体回滚。", PURPLE),
        ("02", "规则不能在两端漂移", "前端 mock 与后端各写一遍会员/预算规则，结果永远对不上。", "规则下沉 shared/：同一份纯函数被三端引用，单测即覆盖。", BLUE),
        ("03", "AI 不能自己拍板", "模型看起来「很懂」，但它不能替你按确认，也不能编造回执。", "工具白名单 + 确认卡 + 支付密码；未接入一律 503。", TEAL),
    ]
    x = M
    cw = (W - 2 * M - 0.6) / 3
    for i, (num, q, pain, ans, color) in enumerate(cards):
        d.card(s, x, 1.92, cw, 3.32, accent=color)
        d.text(s, x + 0.32, 2.10, 0.8, 0.4, num, size=22, color=color, bold=True)
        d.text(s, x + 0.32, 2.54, cw - 0.62, 0.4, q, size=16.5, color=INK, bold=True, line=1.2)
        d.text(s, x + 0.32, 3.04, cw - 0.64, 0.9, pain, size=11, color=INK_SOFT, line=1.5)
        d.rect(s, x + 0.32, 3.96, 0.34, 0.03, fill=color)
        d.text(s, x + 0.32, 4.12, cw - 0.64, 1.0, ans, size=11, color=INK, line=1.5, bold=False)
        x += cw + 0.3

    # 底部结论条
    d.rect(s, M, 5.52, W - 2 * M, 0.70, fill=NAVY, radius=0.06)
    d.text(s, M + 0.36, 5.70, W - 2 * M - 0.7, 0.36,
           "三条主线贯穿全篇：账户是第一性对象 · 交易即事务 · 智能体在边界内工作。",
           size=13, color=WHITE, bold=True)
    d.footer(s, note="02 / 13　约 50 秒")
    d.notes(s, "【1:10–2:00】这三道题是我们踩过的坑。\n"
                "第一，钱的中间态：如果先扣余额再写流水，进程崩了就会出现扣了钱没流水。我们的答案是交易即事务。\n"
                "第二，规则漂移：前端要能脱离后端开发，就会有两套实现。我们把规则下沉到 shared/ 纯函数。\n"
                "第三，AI 拍板：模型不能代替客户确认，也不能编造回执——这是后面安全章节的主线。")


def s04_arch(d):
    s = d.slide()
    d.header(s, "ARCHITECTURE", "五层架构：四端一核", "客户端只经接口层访问；Agent 同样不能绕过接口直连数据库")
    x, w = M, W - 2 * M
    y = 1.80
    d.band(s, x, y, w, 0.80, "客户端层", NAVY, [
        ("网页用户端", "React 19 · 34 路由"),
        ("安卓客户端", "Kotlin · Compose"),
        ("工作人员端", "工单 / 审批 / 审计"),
        ("IM 渠道", "微信 · 企业微信"),
        ("个人工作台", "DSH · 单用户"),
    ])
    y += 0.90
    d.band(s, x, y, w, 0.66, "接口层", BLUE, [
        ("/api 银行接口", "115 端点 · 8081"),
        ("/staff-api", "员工接口 · 8080"),
        ("/agent-api", "客户 Agent · SSE · 8891"),
        ("员工 Agent ×2", "8789 / 8790"),
    ])
    y += 0.76
    d.band(s, x, y, w, 0.86, "应用层", PURPLE, [
        ("银行业务域", "账户 · 卡 · 转账 · 理财 · 预算"),
        ("安全网关", "限流 · 幂等 · 闸门 · 审计"),
        ("Agent 运行时", "profile + 工具白名单"),
        ("对账与出纳", "回执 · outbox · 日结"),
    ])
    y += 0.96
    d.band(s, x, y, w, 0.50, "规则层", TEAL, [
        ("shared/ 纯函数规则", "会员 AUM · 预算 · 账单 · 理财 · 分摊　—　三端共用同一份实现"),
    ])
    y += 0.60
    d.band(s, x, y, w, 0.80, "数据层", NAVY, [
        ("PostgreSQL 16", "public / banking / accounting / regulatory"),
        ("AI 会话库", "customer / staff / ops 隔离"),
        ("定时任务", "备份 · 对账 · 巡检"),
        ("主机加固", "只读文件系统 · 零 capability"),
    ])

    # 层间箭头
    for yy in (2.62, 3.44, 4.36, 5.02):
        d.rect(s, x + w / 2 - 0.01, yy, 0.02, 0.09, fill=RGBColor(0xB9, 0xC4, 0xD8))

    # 三个要点
    notes = [("契约先行", "app/src/api/contract.ts 是前端唯一依赖", PURPLE),
             ("规则共享", "shared/ 15 个纯函数模块，mock 与后端同口径", TEAL),
             ("交易即事务", "advisory lock + 同事务提交，失败整体回滚", BLUE)]
    nb_y = 6.24
    nx = x
    for k, v, c in notes:
        d.rect(s, nx, nb_y, 0.03, 0.56, fill=c)
        d.text(s, nx + 0.14, nb_y - 0.01, 3.4, 0.26, k, size=10, color=INK, bold=True)
        d.text(s, nx + 0.14, nb_y + 0.24, 3.45, 0.34, v, size=8.4, color=INK_SOFT, line=1.3)
        nx += 3.95
    d.footer(s, note="03 / 13　约 60 秒")
    d.notes(s, "【2:00–3:00】这张图是整份文档的骨架。\n"
                "横向看是五层：客户端、接口与契约、应用与领域、共享规则、数据与运行。\n"
                "纵向看只有一个入口：所有客户端，包括 Agent，都只能通过接口层访问银行，Agent 不能直连数据库。\n"
                "三个要点：契约先行让前端可以脱离后端开发；规则共享让两端算一样的数；交易即事务保证钱不会停在中间态。")


def s05_account(d):
    s = d.slide()
    d.header(s, "CORE MODEL", "一个账户，多币种，多张卡", "这是全系统最基础的不变量，也是我们拒绝最多需求的地方")
    # 左：结构
    d.card(s, M, 1.86, 6.1, 3.55, accent=PURPLE)
    d.text(s, M + 0.34, 2.04, 5.4, 0.3, "资金账户（唯一）", size=12, color=PURPLE_DEEP, bold=True)
    d.text(s, M + 0.34, 2.34, 5.4, 0.34, "账号 A / 客户 林小满", size=15, color=INK, bold=True)

    chips = [("CNY", "¥86,320.00"), ("USD", "$1,200.00"), ("HKD", "HK$8,800.00")]
    x = M + 0.34
    for cur, amt in chips:
        d.rect(s, x, 2.86, 1.72, 0.78, fill=TINT, line=WASH, lw=0.8, radius=0.08)
        d.text(s, x + 0.14, 2.94, 1.5, 0.24, cur, size=9.5, color=PURPLE_DEEP, bold=True)
        d.text(s, x + 0.14, 3.16, 1.6, 0.3, amt, size=11.5, color=INK, bold=True)
        x += 1.84
    d.text(s, M + 0.34, 3.74, 5.4, 0.26, "币种是同一账户下的记账分区，不是一个新账户", size=9.5, color=MUTE)

    # 卡
    cards = [("Visa 借记卡", "使用中", TEAL), ("银联借记卡", "锁定", MUTE)]
    x = M + 0.34
    for name, st, c in cards:
        d.rect(s, x, 4.12, 2.66, 0.94, fill=CARD, line=LINE, lw=0.8, radius=0.08)
        d.text(s, x + 0.16, 4.22, 2.3, 0.26, name, size=11, color=INK, bold=True)
        d.text(s, x + 0.16, 4.50, 2.3, 0.24, "卡组织各限 1 张 · " + st, size=9, color=c)
        x += 2.78
    d.text(s, M + 0.34, 5.12, 5.4, 0.24, "卡不单独存钱；开卡 / 换卡 / 换汇都不创建账户", size=9.5, color=MUTE)

    # 右：四条禁止
    d.card(s, M + 6.42, 1.86, 5.28, 3.55, accent=CORAL, fill=RGBColor(0xFF, 0xF9, 0xFB), border=RGBColor(0xF6, 0xDC, 0xE6))
    d.text(s, M + 6.76, 2.04, 4.6, 0.3, "我们明确不做的事", size=12, color=CORAL, bold=True)
    rules = [
        "不按卡建户、不做卡间划转",
        "换汇不开新户，只初始化目标币种分区",
        "不把卡号当账号，也不把理财持仓当储蓄余额",
        "不允许自己名下银行卡之间互转",
    ]
    y = 2.44
    for r in rules:
        d.text(s, M + 6.76, y, 0.2, 0.26, "×", size=12, color=CORAL, bold=True)
        d.text(s, M + 6.98, y, 4.4, 0.5, r, size=11, color=INK_SOFT, line=1.35)
        y += 0.62

    # 底部：门禁
    d.rect(s, M, 5.62, W - 2 * M, 0.72, fill=TINT, radius=0.06)
    d.text(s, M + 0.3, 5.74, W - 2 * M - 0.6, 0.5,
           [[("可执行的门禁：", 11, True, PURPLE_DEEP),
             ("npm --prefix app run check:account-model 在每次构建前检查文档与业务夹具，约束不只写在文档里。", 11, False, INK_SOFT)]], line=1.3)
    d.footer(s, note="04 / 13　约 50 秒")
    d.notes(s, "【3:00–3:50】账户模型是我们拒绝最多需求的地方。\n"
                "每位客户只有一个储蓄资金账户、一个对客账号。币种是账户里的记账分区，不是新账户；卡是支付工具，不单独存钱。\n"
                "右边是我们明确不做的四件事：不按卡建户、不卡间划转、不把卡号当账号、不让自己名下的卡互转。\n"
                "而且这条约束有门禁：构建前自动检查文档与业务夹具，不是口头约定。")


def s06_member(d):
    s = d.slide()
    d.header(s, "ALGORITHM 01", "会员等级：按上月日均 AUM", "口径决定公平：不含授信额度，缺快照按 0 计（只会低估，不会虚高）")
    # 左：公式
    d.card(s, M, 1.84, 6.0, 1.76, accent=PURPLE)
    d.text(s, M + 0.3, 2.0, 5.3, 0.28, "AUM 口径（分）", size=10.5, color=PURPLE_DEEP, bold=True)
    d.text(s, M + 0.3, 2.30, 5.4, 1.2, [
        [("AUM = 账户余额 + Σ(外币 × 中间价) + 理财市值 + 现金管理", 11, False, INK)],
        [("月均 = round(Σ 上月日终快照 / 上月天数)", 11, False, INK)],
        [("不含信用卡 / 授信额度", 10.5, True, CORAL)],
    ], line=1.5)

    # 升降级
    d.card(s, M, 3.74, 6.0, 2.34, accent=BLUE)
    d.text(s, M + 0.3, 3.90, 5.3, 0.28, "升降级状态机", size=10.5, color=BLUE, bold=True)
    d.text(s, M + 0.3, 4.22, 5.4, 0.5, [[("升级即时", 12.5, True, INK), ("　实时 AUM 达门槛当天生效", 10.5, False, INK_SOFT)]], line=1.4)
    d.text(s, M + 0.3, 4.62, 5.4, 0.5, [[("降级缓冲", 12.5, True, INK), ("　连续 2 个评定周期未达标才降", 10.5, False, INK_SOFT)]], line=1.4)
    d.text(s, M + 0.3, 5.02, 5.4, 0.5, [[("额度跨年", 12.5, True, INK), ("　制卡减免 / 贵宾厅按自然年清零", 10.5, False, INK_SOFT)]], line=1.4)
    d.text(s, M + 0.3, 5.56, 5.4, 0.36, "快照保留 400 天上限，防止档案无限膨胀", size=9.5, color=MUTE)

    # 右：四档
    tiers = [("普通", "¥0", "全价", "1.0", MUTE), ("金卡", "¥10 万", "半价 · 1 次", "0.9", BLUE),
             ("白金", "¥50 万", "全免 · 2 次贵宾厅", "0.8", PURPLE), ("钻石", "¥300 万", "全免含寄送 · 6 次", "0.7", PURPLE_DEEP)]
    y = 1.84
    for name, th, perk, fx, c in tiers:
        d.rect(s, M + 6.3, y, 5.4, 1.02, fill=CARD, line=LINE, lw=0.8, radius=0.07)
        d.rect(s, M + 6.3, y, 0.05, 1.02, fill=c)
        d.text(s, M + 6.52, y + 0.16, 1.5, 0.3, name, size=13.5, color=INK, bold=True)
        d.text(s, M + 6.52, y + 0.52, 1.9, 0.3, th, size=10.5, color=c, bold=True)
        d.text(s, M + 8.5, y + 0.20, 3.0, 0.3, perk, size=10, color=INK_SOFT)
        d.text(s, M + 8.5, y + 0.54, 3.0, 0.3, "换汇点差 ×" + fx, size=10, color=INK_SOFT)
        y += 1.16
    d.text(s, M + 6.3, 6.42, 5.4, 0.28, "权益收敛到 entitlements(tier)：业务代码不再各自写 if-else", size=9.5, color=MUTE)
    d.footer(s, note="05 / 13　约 50 秒")
    d.notes(s, "【3:50–4:40】第一个核心算法：会员。\n"
                "口径是上月日均 AUM：账户余额加外币按中间价折算，加理财市值和现金管理，不含授信额度——防止借钱升级。\n"
                "缺快照的日子按 0 计入，结果只会低估不会虚高，这是刻意保守。\n"
                "升降级是升快降慢：升级即时，降级要连续两个周期不达标。权益统一收敛到一个函数，业务代码不再各写 if-else。")


def s07_transfer(d):
    s = d.slide()
    d.header(s, "ALGORITHM 02", "转账：冻结 → 结清 / 释放", "钱不能在中间态：余额、冻结、流水、凭证同一个事务")
    steps = [
        ("01", "受理与校验", "渠道 / 范围枚举\n收款人核验\n账户归属校验", PURPLE),
        ("02", "报价与限额", "汇率与点差\n手续费按会员\n大额与单日限额", PURPLE),
        ("03", "支付密码", "scrypt 校验\n失败计数\n不保存明文", CORAL),
        ("04", "冻结预留", "按付款币种分区\n只冻结本指令额\n并发 advisory lock", BLUE),
        ("05", "指令落账", "状态 pending\n双边流水\n幂等响应同事务", BLUE),
        ("06", "结清 / 释放", "settle 扣款\n撤销释放冻结\n回执不可变", TEAL),
    ]
    x = M
    cw, gap = 1.76, 0.26
    for i, (num, title, body, c) in enumerate(steps):
        d.rect(s, x, 1.80, cw, 1.46, fill=CARD, line=LINE, lw=0.8, radius=0.07)
        d.rect(s, x, 1.80, cw, 0.045, fill=c, radius=0.5)
        d.text(s, x + 0.14, 1.88, 0.5, 0.3, num, size=13, color=c, bold=True)
        d.text(s, x + 0.14, 2.16, cw - 0.24, 0.28, title, size=10.2, color=INK, bold=True, line=1.1)
        d.text(s, x + 0.14, 2.48, cw - 0.24, 0.72, body, size=7.6, color=INK_SOFT, line=1.5)
        if i < 5:
            d.arrow_r(s, x + cw + 0.05, 2.50, 0.16)
        x += cw + gap

    # 分支
    d.rect(s, M, 3.52, 5.55, 1.32, fill=RGBColor(0xFF, 0xF5, 0xF8), line=RGBColor(0xF6, 0xD3, 0xE0), lw=0.8, radius=0.06)
    d.text(s, M + 0.26, 3.66, 4.9, 0.28, "分支：撤销 / 超窗 / 失败", size=10.5, color=CORAL, bold=True)
    d.text(s, M + 0.26, 3.96, 5.05, 0.8,
           "在途窗口内客户可自行撤销；员工处置有版本号与审批。只释放本指令记录的冻结额，其他指令与币种不变；到账前不称退款。",
           size=8.8, color=INK_SOFT, line=1.45)

    # 不变量
    d.rect(s, M + 5.88, 3.52, 5.81, 1.32, fill=RGBColor(0xF0, 0xFB, 0xFB), line=RGBColor(0xC9, 0xE9, 0xE9), lw=0.8, radius=0.06)
    d.text(s, M + 6.14, 3.66, 5.2, 0.28, "不变量（每次提交都校验）", size=10.5, color=TEAL, bold=True)
    d.text(s, M + 6.14, 3.96, 5.3, 0.8, [
        [("① 余额 + 冻结 + 流水 = 守恒　② 手续费与本金同事务", 8.8, False, INK_SOFT)],
        [("③ 同一幂等键重放返回原响应，参数不一致直接 409", 8.8, False, INK_SOFT)],
    ], line=1.5)

    # 底部
    d.rect(s, M, 5.08, W - 2 * M, 0.92, fill=NAVY, radius=0.06)
    d.text(s, M + 0.34, 5.22, W - 2 * M - 0.7, 0.3, "为什么不是「先扣钱再记账」", size=10, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True)
    d.text(s, M + 0.34, 5.50, W - 2 * M - 0.7, 0.34,
           "冻结与流水在同一事务内提交：崩溃或校验失败整笔回滚，不会留下「扣了钱没流水」或两笔流水共享一次冻结。",
           size=10, color=WHITE)
    d.footer(s, note="06 / 13　约 55 秒")
    d.notes(s, "【4:40–5:35】第二个算法是转账，也是最不能出错的地方。\n"
                "六个阶段：受理校验、报价限额、支付密码、冻结预留、指令落账、结清或释放。\n"
                "四个细节：冻结按付款币种分区；撤销只释放这条指令的冻结，不动别人的钱；手续费和本金同事务，不会出现扣了本金没记手续费；到账前我们叫释放冻结，不叫退款。\n"
                "底下一句话：为什么不是先扣钱再记账——因为那样崩溃就会留下半个状态。")


def s08_budget(d):
    s = d.slide()
    d.header(s, "ALGORITHM 03", "预算与消费风控：六道校验", "顺序固定，前一道不过就不进入下一道；分类异步，不阻塞记账")
    steps = [
        ("卡状态", "active 才可消费；locked / pending / lost / replaced 直接拒绝"),
        ("渠道与类别", "线上、境外、商户类别限额分别校验，未命中按「其他」桶"),
        ("单笔与单日", "单笔上限 + 当日累计上限，按卡计算"),
        ("预算闸门", "命中启用预算且超当日额度 → 409，并报第一个被撑爆的预算"),
        ("余额与币种", "扣该卡对应币种分区的可用余额，不动其他币种"),
        ("记账与分类", "先以 other 落账，后台分类后回写 done / failed"),
    ]
    y = 1.86
    for i, (k, v) in enumerate(steps):
        d.rect(s, M, y, 7.1, 0.72, fill=CARD, line=LINE, lw=0.8, radius=0.06)
        d.rect(s, M, y, 0.05, 0.72, fill=PURPLE if i < 4 else (BLUE if i == 4 else TEAL))
        d.text(s, M + 0.2, y + 0.19, 0.5, 0.34, f"{i+1}", size=13, color=PURPLE_DEEP, bold=True)
        d.text(s, M + 0.62, y + 0.10, 1.7, 0.5, k, size=11.5, color=INK, bold=True, line=1.2)
        d.text(s, M + 2.32, y + 0.10, 4.6, 0.52, v, size=9.8, color=INK_SOFT, line=1.35)
        y += 0.80

    # 右：参数
    d.card(s, M + 7.45, 1.86, 4.25, 2.5, accent=PURPLE)
    d.text(s, M + 7.72, 2.02, 3.7, 0.28, "预算参数（shared/budgets.mjs）", size=10, color=PURPLE_DEEP, bold=True)
    params = [("每日限额", "¥1 – ¥50,000"), ("积分门槛", "默认 ¥10 / 天"), ("兑换", "30 分 = +¥20 额度"), ("窗口", "今天起 30 天内")]
    yy = 2.36
    for k, v in params:
        d.text(s, M + 7.72, yy, 1.35, 0.26, k, size=9.5, color=MUTE)
        d.text(s, M + 9.10, yy, 2.4, 0.26, v, size=9.8, color=INK, bold=True)
        yy += 0.34

    d.card(s, M + 7.45, 4.52, 4.25, 1.72, accent=TEAL, fill=RGBColor(0xF6, 0xFD, 0xFD), border=RGBColor(0xC9, 0xE9, 0xE9))
    d.text(s, M + 7.72, 4.66, 3.7, 0.28, "为什么分类要异步", size=10, color=TEAL, bold=True)
    d.text(s, M + 7.72, 4.96, 3.72, 1.1,
           "同步等待会让刷卡体验被第三方延迟绑架；失败就回滚，会让一笔已成功的消费因为「分类没做出来」而失败。",
           size=9.6, color=INK_SOFT, line=1.45)
    d.footer(s, note="07 / 13　约 50 秒")
    d.notes(s, "【5:35–6:25】第三组算法是预算和消费风控。\n"
                "六道校验顺序固定：卡状态、渠道类别、单笔单日、预算闸门、余额币种、记账分类。\n"
                "右边的参数都来自 shared/budgets.mjs，前端 mock 和后端用同一份。\n"
                "特别说下异步分类：如果同步等模型，刷卡就被第三方延迟绑架；如果失败回滚，一笔成功的消费反而失败。所以先落账再补分类。")


def s09_security(d):
    s = d.slide()
    d.header(s, "SECURITY", "六道可验证的控制面", "每一道都能指认代码位置与测试断言，不靠口头承诺")
    rows = [
        ("01", "传输与浏览器", "TLS 终结于 Nginx · API 响应 no-store · 下载路径 nosniff + attachment · 静态资源一年强缓存", PURPLE),
        ("02", "接入准入", "登录 10 次 / 15 分钟（按手机号 + 按来源）· 短信 60 秒间隔 + 5 次校验上限 · 20 次 / 小时 / 来源", CORAL),
        ("03", "身份与会话", "Bearer 令牌仅存 SHA-256 摘要 · 12 小时到期 · 数据库权威撤销 · 改密撤销其他设备", BLUE),
        ("04", "业务授权", "客户归属逐次校验 · 支付密码 scrypt(N=32768) · 人脸/短信票据 5 分钟一次性 · 幂等键防重放", TEAL),
        ("05", "数据与密钥", "字段级 AES-256-GCM（AAD 绑定列语境）· 四 schema 角色分权 · 运行时禁止 DDL", PURPLE),
        ("06", "审计与恢复", "请求审计 · 登录与资金审计流水 · 不可变回执 · 备份 + 对账 + 巡检定时器", MUTE),
    ]
    y = 1.78
    for num, name, desc, c in rows:
        d.rect(s, M, y, W - 2 * M, 0.62, fill=CARD, line=LINE, lw=0.8, radius=0.08)
        d.rect(s, M, y, 0.05, 0.62, fill=c)
        d.text(s, M + 0.22, y + 0.13, 0.5, 0.34, num, size=13, color=c, bold=True)
        d.text(s, M + 0.78, y + 0.14, 1.95, 0.34, name, size=11.5, color=INK, bold=True)
        d.text(s, M + 2.86, y + 0.15, W - 2 * M - 3.1, 0.34, desc, size=8.9, color=INK_SOFT, line=1.2)
        y += 0.72

    d.rect(s, M, 6.12, W - 2 * M, 0.62, fill=NAVY, radius=0.06)
    d.text(s, M + 0.3, 6.22, W - 2 * M - 0.6, 0.44,
           [[("live 额外闸门　", 9.5, True, RGBColor(0x9B, 0x8C, 0xFF)),
             ("未接入合作银行的资金操作返回 503 INTEGRATION_NOT_CONFIGURED，不回落本地模拟器；生产环境拒绝 sandbox 启动。", 9.5, False, WHITE)]], line=1.25)
    d.footer(s, note="08 / 13　约 55 秒")
    d.notes(s, "【6:25–7:20】安全部分，我们不讲制度，讲六道能指认的控制面。\n"
                "传输与响应头；接入准入的限流与验证码；身份与会话——令牌只存摘要、12 小时到期、数据库权威撤销；\n"
                "业务授权——逐次归属校验、支付密码 scrypt、一次性身份票据、幂等键；\n"
                "数据与密钥——字段级 AES-256-GCM、四 schema 角色分权、运行时禁止 DDL；\n"
                "最后是审计与恢复。\n"
                "有一个细节值得说：验证码失败计数写在事务回滚之后的钩子里，否则回滚会把计数一起吃掉，攻击者可以无限重试。")


def s10_honest(d):
    s = d.slide()
    d.header(s, "HONESTY", "我们明确没做什么", "把「未接入」建模成系统状态，而不是假装能用", )
    # 左：闸门
    d.card(s, M, 1.84, 5.9, 3.40, accent=CORAL, fill=RGBColor(0xFF, 0xF9, 0xFB), border=RGBColor(0xF6, 0xDC, 0xE6))
    d.text(s, M + 0.32, 2.00, 5.2, 0.3, "环境闸门：宁可不可用，不可假装可用", size=11, color=CORAL, bold=True)
    d.text(s, M + 0.32, 2.38, 5.3, 2.6, [
        [("NODE_ENV=production", 10, True, INK), (" 必须 live，否则拒绝启动", 10, False, INK_SOFT)],
        [("未接入能力", 10, True, INK), (" 返回 503，不回落到模拟器", 10, False, INK_SOFT)],
        [("sandbox 能力", 10, True, INK), (" live 下不可用（模拟短信 / 消费）", 10, False, INK_SOFT)],
        [("commercialReady=false", 10, True, INK), (" 真实通道未就绪", 10, False, INK_SOFT)],
        [("演示数据", 10, True, INK), (" 只写隔离沙箱库，需显式开启", 10, False, INK_SOFT)],
    ], line=1.85)
    d.rect(s, M + 0.32, 4.44, 5.26, 0.012, fill=RGBColor(0xF6, 0xDC, 0xE6))
    d.text(s, M + 0.32, 4.62, 5.26, 0.5,
           "以上都是可查询的显式状态：/health、/ready 与员工端 readiness 都能读到，不是文档里的说法。",
           size=8.8, color=MUTE, line=1.45)

    # 右：限制表
    rows = [
        ("真实银行通道", "未接入", CORAL),
        ("短信 / 实名核验", "未接入", CORAL),
        ("监管报送", "仅有模板与血缘", PURPLE),
        ("CSP / HSTS", "未配置，列入待补", PURPLE),
        ("计息摊销 / 高可用", "未实现 / 单机单实例", MUTE),
    ]
    d.text(s, M + 6.3, 1.90, 5.4, 0.3, "已知限制（文档 4.10 节全文）", size=11, color=INK, bold=True)
    y = 2.28
    for k, v, c in rows:
        d.rect(s, M + 6.3, y, 5.4, 0.52, fill=CARD, line=LINE, lw=0.7, radius=0.1)
        d.rect(s, M + 6.3, y, 0.045, 0.52, fill=c)
        d.text(s, M + 6.48, y + 0.13, 2.4, 0.3, k, size=10, color=INK, bold=True)
        d.text(s, M + 8.9, y + 0.13, 2.7, 0.3, v, size=9.8, color=INK_SOFT)
        y += 0.62

    # 底部结论
    d.rect(s, M, 5.46, W - 2 * M, 1.12, fill=NAVY, radius=0.05)
    d.text(s, M + 0.45, 5.60, W - 2 * M - 0.9, 0.3, "为什么我们敢把这些写出来", size=10, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True)
    d.text(s, M + 0.45, 5.88, W - 2 * M - 0.9, 0.6,
           "能清楚说出自己没做什么的系统，通常也知道自己做了什么。演示态与生产态共用一条代码路径，不靠删代码上线。",
           size=13, color=WHITE, line=1.35)
    d.footer(s, note="09 / 13　约 60 秒")
    d.notes(s, "【7:20–8:20】这一页是我个人最想讲的：我们明确没做什么。\n"
                "真实银行通道没接、短信实名没接、监管报送只有模板、CSP 和 HSTS 还没配、没有自动计息、单机没有高可用。\n"
                "重点不是列清单，而是这些「没接」在系统里是显式状态：live 模式下未接入的操作直接 503，绝不回落到模拟器；生产环境拒绝 sandbox 启动。\n"
                "我们宁可显示不可用，也不假装可用。")


def s11_agent(d):
    s = d.slide()
    d.header(s, "AGENT", "Agent 在边界内工作", "模型负责理解与表达，服务端负责事实与资金")
    # 流程
    boxes = [
        ("客户", "网页 / 安卓 / 微信", PURPLE),
        ("会话", "SSE 流式 · 可续传", BLUE),
        ("运行时", "profile + 工具白名单", TEAL),
        ("银行 API", "/api 校验与落账", PURPLE_DEEP),
    ]
    x = M
    bw, bgap = 1.78, 0.31
    for i, (k, v, c) in enumerate(boxes):
        d.rect(s, x, 1.92, bw, 1.02, fill=CARD, line=LINE, lw=0.9, radius=0.08)
        d.rect(s, x, 1.92, bw, 0.045, fill=c, radius=0.5)
        d.text(s, x + 0.16, 2.06, bw - 0.3, 0.28, k, size=12, color=INK, bold=True)
        d.text(s, x + 0.16, 2.36, bw - 0.26, 0.5, v, size=8.4, color=INK_SOFT, line=1.25)
        if i < 3:
            d.arrow_r(s, x + bw + 0.08, 2.36, 0.15)
        x += bw + bgap

    # 确认卡回路
    d.rect(s, M, 3.28, 8.05, 0.62, fill=TINT, radius=0.1)
    d.text(s, M + 0.24, 3.40, 7.6, 0.4,
           [[("写操作回路：", 10.5, True, PURPLE_DEEP), ("发起确认卡 → 客户在网页点击确认 → 再验支付密码 → 才落账", 10.5, False, INK_SOFT)]], line=1.3)

    # 三条规则
    rules = [
        ("读", "逐次校验归属", "只查本人，失败不当成零", PURPLE),
        ("写", "确认卡 + 密码", "180 秒超时按拒绝处理", CORAL),
        ("答", "不预测收益", "不构成申购授权，不编造回执", BLUE),
    ]
    y = 4.14
    for k, title, desc, c in rules:
        d.rect(s, M, y, 8.05, 0.62, fill=CARD, line=LINE, lw=0.8, radius=0.1)
        d.rect(s, M + 0.18, y + 0.14, 0.34, 0.34, fill=c, radius=0.3)
        d.text(s, M + 0.18, y + 0.19, 0.34, 0.26, k, size=9.5, color=WHITE, bold=True, align=PP_ALIGN.CENTER)
        d.text(s, M + 0.66, y + 0.16, 1.8, 0.3, title, size=11, color=INK, bold=True)
        d.text(s, M + 2.5, y + 0.17, 5.2, 0.3, desc, size=10, color=INK_SOFT)
        y += 0.72

    # 右：技术底座
    d.card(s, M + 8.42, 1.92, 3.28, 2.52, accent=TEAL)
    d.text(s, M + 8.68, 2.06, 2.8, 0.3, "技术底座", size=10, color=TEAL, bold=True)
    d.text(s, M + 8.68, 2.38, 2.90, 2.4, [
        [("DSH 树外 profile", 9.6, True, INK)],
        [("luckycat / staff / ops 三套人格与工具集", 8.8, False, INK_SOFT)],
        [("会话库独立", 9.6, True, INK)],
        [("按 customer / staff / ops 隔离，单实例持锁", 8.8, False, INK_SOFT)],
        [("模型链可回退", 9.6, True, INK)],
        [("每模型重试 3 次，全失败才报错", 8.8, False, INK_SOFT)],
    ], line=1.45)

    d.card(s, M + 8.42, 4.58, 3.28, 1.44, accent=PURPLE, fill=TINT, border=WASH)
    d.text(s, M + 8.68, 4.72, 2.8, 0.28, "知识库 8 篇", size=10, color=PURPLE_DEEP, bold=True)
    d.text(s, M + 8.68, 5.00, 2.92, 0.86, "账户 / 转账 / 卡 / 账单\n分析 / 理财 / 助手 / 安全", size=9.2, color=INK_SOFT, line=1.5)
    d.footer(s, note="10 / 13　约 55 秒")
    d.notes(s, "【8:20–9:15】Agent 这块，一句话：模型负责理解与表达，服务端负责事实与资金。\n"
                "链路是客户 → 会话 → 运行时 → 银行 API。写操作有一个回路：发确认卡、客户在网页点确认、再验支付密码，才落账；超时按拒绝处理。\n"
                "三条规则：读要逐次校验归属；写要确认卡加密码；答不预测收益、不构成申购授权。\n"
                "技术上是 DSH 树外 profile，三套人格与工具集，会话库独立隔离。")


def s12_verify(d):
    s = d.slide()
    d.header(s, "VERIFICATION", "怎么证明它是对的", "能在本地跑的就不靠手工点；需要外部依赖的，明确标未验证")
    gates = [
        ("账户模型", "npm --prefix app run check:account-model", "文档 + 业务夹具的单账户约束", PURPLE),
        ("后端测试", "npm --prefix server test", "20 个文件 / 78 项断言", BLUE),
        ("整合门禁", "npm --prefix server run check:integration", "四个专用库，缺配置直接失败", TEAL),
        ("前端构建", "npm --prefix app run build", "prebuild 自动跑账户模型检查", PURPLE),
    ]
    cw = 6.15
    for i, (k, cmd, desc, c) in enumerate(gates):
        cy = 1.86 + i * 1.08
        d.rect(s, M, cy, cw, 0.96, fill=CARD, line=LINE, lw=0.8, radius=0.07)
        d.rect(s, M, cy, 0.05, 0.96, fill=c)
        d.text(s, M + 0.24, cy + 0.13, 2.0, 0.3, k, size=11.5, color=INK, bold=True)
        d.text(s, M + 0.24, cy + 0.44, cw - 0.5, 0.46, [[(cmd, 8.8, True, PURPLE_DEEP)], [(desc, 8.8, False, INK_SOFT)]], line=1.35)

    # 右：发布
    rx = M + 6.55
    rw = W - M - rx
    d.card(s, rx, 1.86, rw, 2.32, accent=NAVY)
    d.text(s, rx + 0.28, 2.00, 4.4, 0.3, "发布留痕", size=10, color=PURPLE_DEEP, bold=True)
    d.text(s, rx + 0.28, 2.32, 1.3, 0.72, "15", size=34, color=INK, bold=True)
    d.text(s, rx + 1.10, 2.42, rw - 1.3, 0.34, "份 JSON 发布记录", size=12, color=INK, bold=True)
    d.text(s, rx + 1.10, 2.74, rw - 1.3, 0.34, "提交 · 范围 · 验证结论 · 未通过项", size=9.2, color=INK_SOFT)
    d.text(s, rx + 0.28, 3.18, rw - 0.55, 0.9,
           "构建 → 门禁 → 备份 → 迁移 → 重启 → 就绪检查 → 记录；任一失败即中止，不部署半成品。",
           size=9.6, color=INK_SOFT, line=1.5)

    # 复现
    d.rect(s, rx, 4.32, rw, 1.74, fill=NAVY, radius=0.06)
    d.text(s, rx + 0.28, 4.46, 4.4, 0.28, "任何人都能复现", size=9.5, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True)
    d.text(s, rx + 0.28, 4.74, rw - 0.5, 1.2, [
        [("npm --prefix app run check:account-model", 8.4, False, RGBColor(0xD5, 0xDE, 0xEE))],
        [("npm --prefix server test", 8.4, False, RGBColor(0xD5, 0xDE, 0xEE))],
        [("npm --prefix app run build", 8.4, False, RGBColor(0xD5, 0xDE, 0xEE))],
    ], line=1.6)
    d.footer(s, note="11 / 13　约 45 秒")
    d.notes(s, "【9:15–9:35】怎么证明它是对的：四道门禁加发布留痕。\n"
                "账户模型检查、后端 78 项断言、整合门禁要求四个专用库缺一个就失败、前端构建带 prebuild 检查。\n"
                "每次上线留一份 JSON 记录，目前 15 份。\n"
                "任何一个拿到仓库的人都能在本地把这三条命令跑一遍。")


def s13_close(d):
    s = d.slide(NAVY)
    d.text(s, M, 0.86, 8.0, 0.3, "TAKEAWAYS", size=11, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True, spacing=3)
    d.text(s, M, 1.18, 10.5, 0.7, "三句话，结束这次答辩", size=30, color=WHITE, bold=True)

    items = [
        ("01", "把 AI 关进资金的笼子里", "工具白名单、确认卡、支付密码；模型不产生事实，只产生表达。"),
        ("02", "把钱关进事务的笼子里", "冻结、流水、凭证、审计同事务；失败整体回滚，不留中间态。"),
        ("03", "把「没做」写进系统状态", "live 闸门、503、已知限制清单；不假装能用，才有可能真的能用。"),
    ]
    y = 2.16
    for num, title, desc in items:
        d.rect(s, M, y, 0.035, 0.86, fill=PURPLE)
        d.text(s, M + 0.22, y + 0.02, 0.6, 0.3, num, size=11, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True)
        d.text(s, M + 0.78, y, 5.6, 0.36, title, size=16.5, color=WHITE, bold=True)
        d.text(s, M + 0.78, y + 0.40, 6.1, 0.45, desc, size=10.5, color=RGBColor(0xA8, 0xB8, 0xD2), line=1.4)
        y += 1.02

    # 右：路线
    d.rect(s, M + 7.5, 2.05, 4.2, 3.12, fill=RGBColor(0x16, 0x22, 0x3C), radius=0.05)
    d.text(s, M + 7.76, 2.22, 3.7, 0.28, "下一步（按优先级）", size=9.5, color=RGBColor(0x9B, 0x8C, 0xFF), bold=True)
    roadmap = [("P0", "接入持牌银行适配器 + CSP/HSTS"), ("P1", "短信实名 · 监管报送适配器"), ("P2", "计息摊销 · 多副本与演练")]
    yy = 2.58
    for p, t in roadmap:
        d.text(s, M + 7.76, yy, 0.5, 0.28, p, size=9.5, color=WHITE, bold=True)
        d.text(s, M + 8.26, yy, 3.3, 0.5, t, size=9.5, color=RGBColor(0xC2, 0xCE, 0xE2), line=1.35)
        yy += 0.72
    d.text(s, M + 7.76, 4.62, 3.7, 0.4, "当前：sandbox 可完整演示\nlive 闸门已就位", size=9, color=RGBColor(0x7E, 0x90, 0xAE), line=1.4)

    # 结语
    d.text(s, M, 5.62, 11.4, 0.7, "谢谢，欢迎提问。", size=32, color=WHITE, bold=True)
    d.text(s, M, 6.38, 11.4, 0.34, "技术文档已同步提交：系统架构 · 核心算法 · 安全设计（含已知限制）", size=10.5, color=RGBColor(0x8E, 0xA3, 0xC8))
    d.rect(s, M, H - 0.62, W - 2 * M, 0.012, fill=RGBColor(0x2A, 0x38, 0x52))
    d.text(s, M, H - 0.50, 6.0, 0.3, "招财猫银行 · Money Meow Bank", size=9, color=RGBColor(0x6E, 0x7E, 0x9A))
    d.text(s, W - M - 1.0, H - 0.50, 1.0, 0.3, f"{d.n:02d}", size=9.5, color=RGBColor(0x6E, 0x7E, 0x9A), bold=True, align=PP_ALIGN.RIGHT)
    d.notes(s, "【9:35–10:00】最后三句话收尾。\n"
                "第一，把 AI 关进资金的笼子里：模型不产生事实，只产生表达。\n"
                "第二，把钱关进事务的笼子里：失败整体回滚，不留中间态。\n"
                "第三，把「没做」写进系统状态：不假装能用，才有可能真的能用。\n"
                "下一步 P0 是接入持牌银行适配器和补齐 CSP/HSTS。谢谢，欢迎提问。")


def main():
    # 品牌 mark 复制到 assets（PPT 与文档共用）
    src = os.path.join(os.path.dirname(HERE), "docs/design/logo-proposal/maneki-mark.png")
    dst = os.path.join(ASSETS, "maneki_mark.png")
    if os.path.exists(src) and not os.path.exists(dst):
        import shutil
        shutil.copyfile(src, dst)

    builders = [s01_cover, s02_numbers, s03_three, s04_arch, s05_account, s06_member,
                s07_transfer, s08_budget, s09_security, s10_honest, s11_agent, s12_verify, s13_close]
    limit = int(os.environ.get("SLIDE_LIMIT", str(len(builders))))
    d = Deck()
    for fn in builders[:limit]:
        fn(d)
    out = OUT if limit == len(builders) else os.path.join(HERE, "_partial.pptx")
    d.prs.save(out)
    print("saved", out, "slides=", len(d.prs.slides))


if __name__ == "__main__":
    main()
