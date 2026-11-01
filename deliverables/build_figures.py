# -*- coding: utf-8 -*-
"""生成技术文档 / 答辩 PPT 使用的架构图（PNG，2x 超采样）。

纯 Pillow 绘制，无外部图形依赖。字体使用 Windows 微软雅黑。
"""
import os
from PIL import Image, ImageDraw, ImageFont

S = 2  # 超采样倍数
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
os.makedirs(OUT, exist_ok=True)

FONT_DIR = r"C:\Windows\Fonts"
REG = os.path.join(FONT_DIR, "msyh.ttc")
BOLD = os.path.join(FONT_DIR, "msyhbd.ttc")
LIGHT = os.path.join(FONT_DIR, "msyhl.ttc")

# 品牌色（取自 app/src/styles/tokens.css 与品牌 mark）
PAPER = "#f5f7ff"
SURFACE = "#ffffff"
INK = "#061b31"
INK_SOFT = "#4e6078"
INK_MUTE = "#64748d"
LINE = "#dbe4f0"
PURPLE = "#533afd"
PURPLE_DEEP = "#4434d4"
PURPLE_WASH = "#eae7ff"
PURPLE_TINT = "#f2f0ff"
BLUE = "#306fdb"
BLUE_WASH = "#e7effd"
CORAL = "#d92159"
NAVY = "#101c35"
TEAL = "#0f8a8a"


def F(size, bold=False, light=False):
    path = BOLD if bold else (LIGHT if light else REG)
    return ImageFont.truetype(path, int(size * S), index=0)


class Canvas:
    def __init__(self, w, h, bg=PAPER):
        self.w, self.h = w, h
        self.im = Image.new("RGB", (w * S, h * S), bg)
        self.d = ImageDraw.Draw(self.im)

    # ---------- 基础图元 ----------
    def rrect(self, x, y, w, h, r=14, fill=None, outline=None, width=1.5):
        self.d.rounded_rectangle(
            [x * S, y * S, (x + w) * S, (y + h) * S],
            radius=r * S, fill=fill, outline=outline,
            width=max(1, int(width * S)),
        )

    def line(self, x1, y1, x2, y2, color=LINE, width=1.5, dash=None):
        if dash:
            self._dash(x1, y1, x2, y2, color, width, dash)
        else:
            self.d.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=color, width=max(1, int(width * S)))

    def _dash(self, x1, y1, x2, y2, color, width, dash):
        import math
        dx, dy = x2 - x1, y2 - y1
        dist = math.hypot(dx, dy)
        if dist == 0:
            return
        ux, uy = dx / dist, dy / dist
        on, off = dash
        pos = 0.0
        while pos < dist:
            end = min(pos + on, dist)
            self.d.line([(x1 + ux * pos) * S, (y1 + uy * pos) * S,
                         (x1 + ux * end) * S, (y1 + uy * end) * S],
                        fill=color, width=max(1, int(width * S)))
            pos += on + off

    def text(self, x, y, s, size=16, color=INK, bold=False, anchor="la", light=False, spacing=4):
        """anchor: 水平 l/m/r + 垂直 a(顶)/m(中)/s(基线)。手写字距让中文标题更透气。"""
        f = F(size, bold, light)
        if spacing == 0:
            self.d.text((x * S, y * S), s, font=f, fill=color, anchor=anchor)
            return
        h, v = anchor[0], anchor[1] if len(anchor) > 1 else "a"
        widths = [f.getlength(ch) for ch in s]
        total = sum(widths) + spacing * S * (len(s) - 1)
        if h == "m":
            cx = x * S - total / 2
        elif h == "r":
            cx = x * S - total
        else:
            cx = x * S
        anchor2 = {"a": "la", "m": "lm", "s": "ls"}[v]
        for ch, w in zip(s, widths):
            self.d.text((cx, y * S), ch, font=f, fill=color, anchor=anchor2)
            cx += w + spacing * S

    def wrap(self, x, y, s, size=14, color=INK_SOFT, max_w=200, lh=None, bold=False, align="left", spacing=1.2):
        f = F(size, bold)
        lh = lh or size * 1.55
        lines, cur = [], ""
        for ch in s:
            if ch == "\n":
                lines.append(cur); cur = ""; continue
            if f.getlength(cur + ch) + (len(cur) - 1) * spacing * S > max_w * S:
                lines.append(cur); cur = ch
            else:
                cur += ch
        if cur:
            lines.append(cur)
        for i, ln in enumerate(lines):
            if align == "center":
                self.text(x, y + i * lh, ln, size, color, bold, anchor="ma", spacing=spacing)
            else:
                self.text(x, y + i * lh, ln, size, color, bold, anchor="la", spacing=spacing)
        return len(lines) * lh

    def arrow(self, x1, y1, x2, y2, color=PURPLE, width=2, head=7):
        self.d.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=color, width=max(1, int(width * S)))
        import math
        ang = math.atan2(y2 - y1, x2 - x1)
        pts = []
        for a in (ang + 2.6, ang - 2.6):
            pts.append(((x2 + head * math.cos(a)) * S, (y2 + head * math.sin(a)) * S))
        self.d.polygon([(x2 * S, y2 * S)] + pts, fill=color)

    def chip(self, x, y, label, size=13, fg=PURPLE_DEEP, bg=PURPLE_WASH, pad=10, h=24, bold=True):
        f = F(size, bold)
        w = f.getlength(label) + pad * 2
        self.rrect(x, y, w / S, h, r=h / 2, fill=bg)
        self.text(x + pad / S, y + h / 2, label, size, fg, bold, anchor="lm", spacing=2)
        return w / S

    def save(self, name):
        path = os.path.join(OUT, name)
        self.im.save(path, optimize=True)
        print("wrote", path, self.im.size)


def card(c, x, y, w, h, title, lines, accent=PURPLE, body_size=13, title_size=17,
         fill=SURFACE, title_color=INK, body_color=INK_SOFT, border=LINE, badge=None,
         title_lines=1):
    """标准卡片：顶部 3px 强调条 + 标题 + 正文行。"""
    c.rrect(x, y, w, h, r=12, fill=fill, outline=border, width=1.4)
    c.rrect(x, y, w, 3.2, r=1.6, fill=accent)
    ty = y + 16
    for i, t in enumerate(title if isinstance(title, (list, tuple)) else [title]):
        c.text(x + 16, ty + i * (title_size * 1.5), t, title_size, title_color, True, spacing=1)
    ty += (title_size * 1.5) * len(title if isinstance(title, (list, tuple)) else [title]) + 4
    if badge:
        c.chip(x + 16, ty, badge, size=12, fg=accent)
        ty += 30
    for ln in lines:
        if isinstance(ln, tuple):
            txt, sz, col = ln
            c.text(x + 16, ty, txt, sz, col, False, spacing=1)
            ty += sz * 1.6
        else:
            used = c.wrap(x + 16, ty, ln, body_size, body_color, max_w=w - 32, lh=body_size * 1.55, spacing=1)
            ty += used + 3


# ============================================================ 图 1 总体架构
def fig_architecture():
    W, H = 1440, 960
    c = Canvas(W, H)
    # 顶部标题条
    c.rrect(40, 26, W - 80, 58, r=10, fill=NAVY)
    c.text(60, 55, "MONEY MEOW BANK · 总体架构（分层视图）", 24, "#ffffff", True, anchor="lm", spacing=2)
    c.text(W - 60, 55, "四端一核 · 契约先行 · 规则共享 · 交易即事务", 15, "#9fb0cc", False, anchor="rm", spacing=2)

    left_x, label_w = 40, 132
    area_x = left_x + label_w + 18
    area_w = W - area_x - 40

    layers = [
        # (y, h, 标签, 标签色, [卡片])
        (108, 156, "客户端层", NAVY, [
            ("网页用户端", ["React 19 · TS6 · Vite 8", "35 路由 · 桌面工作台"], PURPLE),
            ("安卓客户端", ["Kotlin · Jetpack Compose", "25 源文件 · 原生渲染"], BLUE),
            ("工作人员端", ["React · 工单 / 审批 / 审计", "运维终端 · 双人复核"], TEAL),
            ("IM 渠道", ["微信 / 企业微信私聊", "扫码绑定 · 本人身份"], PURPLE),
            ("个人工作台", ["DSH 官方 Web · 单用户", "日历 / 任务 / 提醒"], INK_MUTE),
        ]),
        (286, 120, "接口与契约层", BLUE, [
            ("/api 银行接口", ["115 端点 · /api/*", "HTTP 8081 · no-store"], PURPLE),
            ("/staff-api 员工接口", ["工单 / 审批 / 对账", "HTTP 8080"], TEAL),
            ("/agent-api 客户 Agent", ["SSE 流式 · 会话", "HTTP 8891"], BLUE),
            ("员工 Agent ×2", ["/staff-agent-api 8789", "/staff-ops-agent-api 8790"], INK_MUTE),
        ]),
        (428, 186, "应用与领域层", PURPLE, [
            ("银行业务域", ["账户 · 卡 · 转账 · 理财", "预算 · 会员 · 客服工单", "记 账 / 冻结 / 冲正均在同一事务"], PURPLE),
            ("安全网关", ["限流 · 短信挑战 · 身份票据", "幂等键 · 环境闸门 · 审计"], CORAL),
            ("Agent 运行时", ["DSH 树外 profile", "luckycat / staff / ops", "工具白名单 + 确认卡"], BLUE),
            ("对账与出纳", ["银行回执 / 备查账", "outbox · 日结 · 异常"], TEAL),
        ]),
        (636, 118, "共享规则层", TEAL, [
            ("shared/ 纯函数规则（15 模块 · 1.5k 行）", [
                "账户模型 · 会员 AUM 评定 · 制卡费与换汇点差 · 预算限额与积分",
                "理财匹配与赎回批次 · 账单聚合 · AA 分摊 · 合同与支付计划",
            ], TEAL),
        ]),
        (772, 168, "数据与运行层", NAVY, [
            ("PostgreSQL 16", ["public 客户与兼容", "banking 银行协作", "accounting 复式账", "regulatory 报表"], PURPLE),
            ("AI 会话库", ["独立角色与密钥", "customer / staff / ops", "单实例持锁"], BLUE),
            ("定时任务", ["备份 · 对账 · 巡检", "systemd timer"], TEAL),
            ("主机加固", ["NoNewPrivileges", "ProtectSystem=strict", "UMask 0077"], INK_MUTE),
        ]),
    ]

    for y, h, label, color, boxes in layers:
        # 层背景
        c.rrect(left_x, y, W - 80, h, r=12, fill="#ffffff", outline="#e8eef8", width=1.2)
        # 层标签
        c.rrect(left_x, y, label_w, h, r=12, fill=color)
        c.rrect(left_x + label_w - 12, y, 12, h, r=0, fill=color)
        c.text(left_x + label_w / 2, y + h / 2, label, 17, "#ffffff", True, anchor="mm", spacing=2)

        n = len(boxes)
        gap = 14
        bw = (area_w - gap * (n - 1)) / n
        for i, (t, lines, accent) in enumerate(boxes):
            bx = area_x + i * (bw + gap)
            card(c, bx, y + 14, bw, h - 28, t, lines, accent=accent,
                 body_size=12.5, title_size=15.5 if bw < 240 else 16.5)

    # 层间箭头
    for y in (280, 420, 626, 764):
        c.arrow(W / 2, y, W / 2, y + 22, color="#b9c4d8", width=2, head=6)

    c.save("fig1_architecture.png")


# ============================================================ 图 2 部署拓扑
def fig_deploy():
    W, H = 1440, 812
    c = Canvas(W, H)
    c.rrect(40, 26, W - 80, 58, r=10, fill=NAVY)
    c.text(60, 55, "单机生产拓扑（Nginx 反向代理 + systemd 单元）", 24, "#ffffff", True, anchor="lm", spacing=2)
    c.text(W - 60, 55, "全部服务仅监听 127.0.0.1 · TLS 终结于 Nginx", 15, "#9fb0cc", False, anchor="rm", spacing=2)

    # 互联网
    c.rrect(80, 104, 240, 52, r=10, fill="#ffffff", outline=LINE)
    c.text(200, 130, "浏览器 / 安卓 / 微信", 15, INK, True, anchor="mm", spacing=1)

    # Nginx
    c.rrect(470, 96, 500, 68, r=12, fill=PURPLE_TINT, outline=PURPLE_WASH)
    c.text(720, 116, "Nginx · TLS 终结与路由", 18, PURPLE_DEEP, True, anchor="ma", spacing=1)
    c.text(720, 142, "bank.waveflow.men · gzip · 静态资源长缓存 · 上游超时分级", 13, INK_SOFT, False, anchor="ma", spacing=1)

    c.arrow(320, 130, 466, 130, color="#b9c4d8", width=2)

    services = [
        ("银行 HTTP API", "8081", "server/index.mjs", "PostgreSQL 事务 · 115 端点"),
        ("员工接口", "8080", "staff-api.mjs", "工单 / 审批 / 对账 / PTY"),
        ("客户 Agent", "8891", "bridge/demo-server.mjs", "luckycat profile · SSE"),
        ("员工 Agent", "8789", "staff-server.mjs", "工单草稿与代客操作"),
        ("运维 Agent", "8790", "ops-server.mjs", "只读巡检 · 双重闸门"),
    ]
    bw, gap = 246, 18
    total = bw * 5 + gap * 4
    x0 = (W - total) / 2
    centers = []
    for i, (name, port, entry, desc) in enumerate(services):
        x = x0 + i * (bw + gap)
        centers.append(x + bw / 2)
        c.rrect(x, 216, bw, 112, r=12, fill=SURFACE, outline=LINE)
        c.rrect(x, 216, bw, 3.2, r=1.6, fill=PURPLE if i in (0, 2) else (BLUE if i in (3, 4) else TEAL))
        c.text(x + 14, 232, name, 16, INK, True, spacing=1)
        c.chip(x + bw - 68, 228, ":" + port, size=12, fg=PURPLE_DEEP, bg=PURPLE_WASH)
        c.text(x + 14, 266, entry, 12.5, PURPLE_DEEP, False, spacing=0)
        c.wrap(x + 14, 288, desc, 12, INK_SOFT, max_w=bw - 28, lh=19)
        c.arrow(720, 164, x + bw / 2, 212, color="#c9d3e4", width=1.6, head=5)

    # 数据总线
    bus_y = 352
    c.line(centers[0], bus_y, centers[-1], bus_y, color="#c9d3e4", width=1.6)
    for cx in centers:
        c.line(cx, 330, cx, bus_y, color="#c9d3e4", width=1.6)
    c.arrow(720, bus_y, 720, 392, color="#c9d3e4", width=2, head=6)
    c.text(732, bus_y + 12, "pg 连接池 · 按角色取连接", 11.5, INK_MUTE, False, anchor="la", spacing=1)

    # PostgreSQL
    c.rrect(150, 392, 1140, 132, r=12, fill=SURFACE, outline=LINE)
    c.rrect(150, 392, 1140, 3.2, r=1.6, fill=NAVY)
    c.text(172, 408, "PostgreSQL 16 · 单实例多角色", 17, INK, True, spacing=1)
    c.text(560, 412, "owner（仅结构部署） / 应用角色 / 银行 worker / AI 会话角色", 13, INK_SOFT, False, spacing=1)
    schemas = [("public", "客户档案 · 加密域 · 兼容历史"), ("banking", "意图 · 回执 · outbox · 对账"),
               ("accounting", "科目 · 凭证 · 营业日 · 日结"), ("regulatory", "报表模板 · 血缘 · 校验"),
               ("AI 会话", "会话事件 · 单实例持锁")]
    for i, (s, d) in enumerate(schemas):
        x = 172 + i * 220
        c.rrect(x, 442, 208, 62, r=8, fill=PURPLE_TINT, outline=PURPLE_WASH)
        c.text(x + 12, 452, s, 13, PURPLE_DEEP, True, spacing=1)
        c.wrap(x + 12, 472, d, 10.5, INK_SOFT, max_w=186, lh=14)

    # 运维平面
    c.rrect(150, 552, 1140, 96, r=12, fill=SURFACE, outline=LINE)
    c.rrect(150, 552, 1140, 3.2, r=1.6, fill=TEAL)
    c.text(172, 568, "运维平面（systemd 单元与定时器）", 16, INK, True, spacing=1)
    ops = [("bank.service", "API 主进程 · 5 次重启限流"),
           ("backup.timer", "备份 + 校验 · 保留策略"),
           ("reconcile.timer", "银行对账 · 异常登记"),
           ("check.service", "发布检查 · 就绪与不变量")]
    for i, (t, d) in enumerate(ops):
        x = 172 + i * 280
        c.text(x, 596, "· " + t, 12, PURPLE_DEEP, False, spacing=0)
        c.wrap(x, 616, d, 11, INK_SOFT, max_w=250, lh=15)

    # 密钥
    c.rrect(150, 668, 1140, 74, r=12, fill="#ffffff", outline=LINE)
    c.text(172, 686, "密钥与凭据分层", 14, INK, True, spacing=1)
    c.text(172, 710, "BANK_DATA_KEY（字段加密 32B）· 数据库口令 · 银行私钥 · 模型 API Key 分别受保护存放；仓库与镜像不含任何密钥", 12.5, INK_SOFT, False, spacing=1)
    c.text(1268, 686, "无外网监听", 14, CORAL, True, anchor="ra", spacing=1)

    c.text(720, 772, "客户浏览器 → Nginx 443 → 各上游 127.0.0.1 端口；数据库与 Agent 均不在公网暴露。", 13, INK_MUTE, False, anchor="ma", spacing=1)
    c.save("fig2_deploy.png")


# ============================================================ 图 3 交易链路
def fig_transfer():
    W, H = 1440, 640
    c = Canvas(W, H)
    c.rrect(40, 26, W - 80, 58, r=10, fill=NAVY)
    c.text(60, 55, "一次转账的生命周期（冻结 → 结清 / 释放）", 24, "#ffffff", True, anchor="lm", spacing=2)
    c.text(W - 60, 55, "幂等键贯穿全程 · 资金守恒 · 失败整体回滚", 15, "#9fb0cc", False, anchor="rm", spacing=2)

    steps = [
        ("01", "受理与校验", ["渠道 / 范围枚举", "收款人核验", "账户归属校验"], PURPLE),
        ("02", "报价与限额", ["汇率与点差", "手续费按会员", "大额与单日限额"], PURPLE),
        ("03", "支付密码", ["scrypt 校验", "计数与锁定", "不保存明文"], CORAL),
        ("04", "冻结预留", ["按付款币种分区", "仅冻结本指令额", "并发 advisory lock"], BLUE),
        ("05", "指令落账", ["状态 pending", "双边流水", "幂等响应同事务"], BLUE),
        ("06", "结清 / 释放", ["settle 扣款", "撤销释放冻结", "回执不可变"], TEAL),
    ]
    bw, gap = 196, 26
    x0 = (W - (bw * 6 + gap * 5)) / 2
    for i, (num, title, lines, color) in enumerate(steps):
        x = x0 + i * (bw + gap)
        c.rrect(x, 112, bw, 172, r=12, fill=SURFACE, outline=LINE)
        c.rrect(x, 112, bw, 3.2, r=1.6, fill=color)
        c.text(x + 14, 126, num, 22, color, True, spacing=1)
        c.text(x + 14, 160, title, 16, INK, True, spacing=1)
        yy = 188
        for ln in lines:
            c.text(x + 14, yy, "· " + ln, 12, INK_SOFT, False, spacing=0)
            yy += 20
        if i < 5:
            c.arrow(x + bw + 4, 198, x + bw + gap - 6, 198, color="#b9c4d8", width=2, head=6)

    # 分支：从 04 / 05 之间折向左侧说明框
    xb = x0 + 3 * (bw + gap) + bw * 0.5
    c.line(xb, 284, xb, 320, color="#b9c4d8", width=1.6, dash=(6, 5))
    c.line(xb, 320, 300, 320, color="#b9c4d8", width=1.6, dash=(6, 5))
    c.arrow(300, 320, 300, 342, color="#b9c4d8", width=1.6, head=5)

    c.rrect(107, 342, 640, 96, r=12, fill="#fff5f8", outline="#f6d3e0")
    c.text(125, 356, "分支：撤销 / 超窗 / 失败", 15, CORAL, True, spacing=1)
    c.text(125, 384, "在途窗口内客户可自行撤销；员工处置有版本号与审批。", 12.5, INK_SOFT, False, spacing=1)
    c.text(125, 406, "只释放本指令记录的冻结额，其他指令与币种不变；到账前不称退款。", 12.5, INK_SOFT, False, spacing=1)

    c.rrect(767, 342, 640, 96, r=12, fill="#f0fbfb", outline="#c9e9e9")
    c.text(785, 356, "不变量（每次提交都校验）", 15, TEAL, True, spacing=1)
    c.text(785, 384, "① 余额 + 冻结 + 流水 = 守恒   ② 手续费与本金同事务", 12.5, INK_SOFT, False, spacing=1)
    c.text(785, 406, "③ 同一幂等键重放返回原响应，参数不一致直接 409", 12.5, INK_SOFT, False, spacing=1)

    # 底部说明
    c.rrect(107, 462, 1300, 68, r=12, fill="#ffffff", outline=LINE)
    c.text(125, 476, "为什么不是「先扣钱再记账」", 14, INK, True, spacing=1)
    c.text(125, 500, "冻结与流水在同一数据库事务内提交：进程崩溃或校验失败时整笔回滚，不会留下扣了钱却没有流水、或两笔流水共享一次冻结的状态。", 12.5, INK_SOFT, False, spacing=1)
    c.save("fig3_transfer.png")


# ============================================================ 图 4 安全纵深
def fig_security():
    W, H = 1440, 780
    c = Canvas(W, H)
    c.rrect(40, 26, W - 80, 58, r=10, fill=NAVY)
    c.text(60, 55, "纵深防御：六道可验证的控制面", 24, "#ffffff", True, anchor="lm", spacing=2)
    c.text(W - 60, 55, "每一道都对应代码与测试断言，不靠口头承诺", 15, "#9fb0cc", False, anchor="rm", spacing=2)

    rows = [
        ("传输与浏览器", "TLS 终结于 Nginx · API 响应 no-store · 下载路径 nosniff + attachment · 静态资源一年强缓存", PURPLE),
        ("接入准入", "登录 10 次/15 分钟（按手机号 + 按来源）· 短信 60 秒间隔 + 5 次校验上限 · 20 次/小时/来源", CORAL),
        ("身份与会话", "Bearer 令牌仅存 SHA-256 摘要 · 12 小时到期 · 数据库权威撤销 · 改密撤销其他设备", BLUE),
        ("业务授权", "客户归属逐次校验 · 支付密码 scrypt(N=32768) · 人脸/短信票据 5 分钟一次性 · 幂等键防重放", TEAL),
        ("数据与密钥", "字段级 AES-256-GCM（AAD 绑定列语境）· 四 schema 角色分权 · 运行时禁止 DDL", PURPLE),
        ("审计与恢复", "请求审计 · 登录/资金审计流水 · 不可变回执 · 备份 + 对账 + 巡检定时器", INK_MUTE),
    ]
    y = 112
    for i, (name, desc, color) in enumerate(rows):
        h = 84
        c.rrect(72, y, 1256, h, r=12, fill=SURFACE, outline=LINE)
        c.rrect(72, y, 6, h, r=3, fill=color)
        c.text(96, y + 22, f"0{i+1}", 26, color, True, spacing=1)
        c.text(160, y + 24, name, 19, INK, True, spacing=1)
        c.wrap(160, y + 52, desc, 13, INK_SOFT, max_w=1130, lh=20)
        y += h + 10

    c.wrap(72, 690, "live 模式额外闸门：凡未接入合作银行适配器的资金操作返回 503 INTEGRATION_NOT_CONFIGURED，不会回落到本地模拟器；生产环境拒绝 sandbox 启动。",
           12.5, INK_MUTE, max_w=1256, lh=19)
    c.save("fig4_security.png")


def cover_banner():
    W, H = 1600, 440
    base = Image.new("RGB", (W * S, H * S), NAVY)
    d = ImageDraw.Draw(base)

    # 右侧紫色光晕
    glow = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(38, 0, -1):
        r = i * 9 * S
        alpha = int(2.4 * (39 - i))
        gd.ellipse([(W * 0.86) * S - r, (H * 0.55) * S - r, (W * 0.86) * S + r, (H * 0.55) * S + r],
                   fill=(83, 58, 253, min(alpha, 26)))
    base = Image.alpha_composite(base.convert("RGBA"), glow).convert("RGB")
    d = ImageDraw.Draw(base)

    # 左下装饰线
    for i in range(3):
        d.line([(60 * S), (H - 54 + i * 14) * S, (520 - i * 120) * S, (H - 54 + i * 14) * S],
               fill=(83, 58, 253) if i == 0 else (40, 60, 100), width=2 * S)

    # 品牌 mark
    mark = Image.open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                   "docs/design/logo-proposal/maneki-mark.png")).convert("RGBA")
    mark = mark.resize((132 * S, 132 * S), Image.LANCZOS)
    base.paste(mark, (60 * S, 66 * S), mark)
    d = ImageDraw.Draw(base)

    # 文字
    f_small = F(15, True)
    f_title = F(58, True)
    f_sub = F(20)
    f_tag = F(13)

    d.text((226 * S, 92 * S), "M O N E Y   M E O W   B A N K", font=f_small, fill=(150, 170, 210))
    d.text((222 * S, 116 * S), "招财猫银行", font=f_title, fill=(255, 255, 255))
    d.text((226 * S, 208 * S), "AI Banking 智能体 · 工程文档", font=f_sub, fill=(190, 205, 230))

    # 右上角标签
    tag = "TECHNICAL DOCUMENT  /  2026"
    tw = f_tag.getlength(tag)
    d.text((W * S - 60 * S - tw, 60 * S), tag, font=f_tag, fill=(120, 140, 180))

    # 右下角说明
    d.text((W * S - 60 * S - F(13).getlength("系统架构 · 核心算法 · 安全设计") , H * S - 78 * S),
           "系统架构 · 核心算法 · 安全设计", font=F(13), fill=(130, 150, 185))

    # 细网格点（右下方，增加科技感）
    for gy in range(int(H * 0.62), H - 40, 26):
        for gx in range(int(W * 0.56), W - 50, 26):
            d.ellipse([gx * S, gy * S, gx * S + 2 * S, gy * S + 2 * S], fill=(30, 46, 78))

    path = os.path.join(OUT, "cover_banner.png")
    base.resize((W * S, H * S)).save(path, optimize=True)
    print("wrote", path, base.size)


if __name__ == "__main__":
    fig_architecture()
    fig_deploy()
    fig_transfer()
    fig_security()
    cover_banner()
