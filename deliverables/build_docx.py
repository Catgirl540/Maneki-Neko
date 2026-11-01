# -*- coding: utf-8 -*-
"""渲染《技术文档》DOCX：样式、版式、图注、表格、目录域。

内容与排版分离：正文块由 doc_content_a / doc_content_b 提供。
"""
import os
from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
OUT = os.path.join(HERE, "招财猫银行-技术文档.docx")

INK = RGBColor(0x10, 0x1C, 0x35)
INK_SOFT = RGBColor(0x3A, 0x4A, 0x63)
INK_MUTE = RGBColor(0x64, 0x74, 0x8D)
PURPLE = RGBColor(0x44, 0x34, 0xD4)
PURPLE_LIGHT = RGBColor(0x53, 0x3A, 0xFD)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CORAL = RGBColor(0xD9, 0x21, 0x59)

BODY_CN = "微软雅黑"
BODY_EN = "Segoe UI"
MONO = "Consolas"

CONTENT_W = 16.0  # cm，A4 去掉左右页边距后的正文宽度


# ------------------------------------------------------------------ 底层工具
def set_run_font(run, size=None, bold=None, color=None, cn=BODY_CN, en=BODY_EN, italic=None):
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color
    run.font.name = en
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), en)
    rfonts.set(qn("w:hAnsi"), en)
    rfonts.set(qn("w:eastAsia"), cn)


def shade(element_pr, fill):
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    element_pr.append(shd)


def para_border(p, edges, color="533AFD", sz=12, space=4):
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    for edge, spec in edges.items():
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(spec.get("sz", sz)))
        el.set(qn("w:space"), str(spec.get("space", space)))
        el.set(qn("w:color"), spec.get("color", color))
        pbdr.append(el)
    pPr.append(pbdr)


def set_cell_margins(cell, top=60, bottom=60, left=110, right=110):
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for name, val in (("top", top), ("bottom", bottom), ("start", left), ("end", right)):
        el = OxmlElement(f"w:{name}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tcPr.append(mar)


def table_borders(table, color="DBE4F0", sz=4, inside=True):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    edges = ["top", "left", "bottom", "right"] + (["insideH", "insideV"] if inside else [])
    for edge in edges:
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(sz))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tblPr.append(borders)


def keep_with_next(p, on=True):
    p.paragraph_format.keep_with_next = on


def add_field(paragraph, instr, placeholder="1", size=9, color=INK_MUTE):
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    run._r.append(fld_begin)

    run2 = paragraph.add_run()
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = instr
    run2._r.append(instr_el)

    run3 = paragraph.add_run()
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    run3._r.append(fld_sep)

    run4 = paragraph.add_run(placeholder)
    set_run_font(run4, size, False, color)

    run5 = paragraph.add_run()
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run5._r.append(fld_end)


# ------------------------------------------------------------------ 样式
def setup_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = BODY_EN
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = INK_SOFT
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_CN)
    pf = normal.paragraph_format
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = 1.55
    pf.space_after = Pt(6)
    pf.space_before = Pt(0)

    h1 = doc.styles["Heading 1"]
    h1.font.name = BODY_EN
    h1.font.size = Pt(20)
    h1.font.bold = True
    h1.font.color.rgb = INK
    h1.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_CN)
    h1.paragraph_format.space_before = Pt(18)
    h1.paragraph_format.space_after = Pt(12)
    h1.paragraph_format.keep_with_next = True

    h2 = doc.styles["Heading 2"]
    h2.font.name = BODY_EN
    h2.font.size = Pt(14.5)
    h2.font.bold = True
    h2.font.color.rgb = PURPLE
    h2.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_CN)
    h2.paragraph_format.space_before = Pt(14)
    h2.paragraph_format.space_after = Pt(7)
    h2.paragraph_format.keep_with_next = True

    h3 = doc.styles["Heading 3"]
    h3.font.name = BODY_EN
    h3.font.size = Pt(11.5)
    h3.font.bold = True
    h3.font.color.rgb = INK
    h3.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_CN)
    h3.paragraph_format.space_before = Pt(10)
    h3.paragraph_format.space_after = Pt(4)
    h3.paragraph_format.keep_with_next = True


def setup_page(doc, first_page_header=False):
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.3)
    sec.bottom_margin = Cm(2.1)
    sec.left_margin = Cm(2.5)
    sec.right_margin = Cm(2.5)
    sec.header_distance = Cm(1.2)
    sec.footer_distance = Cm(1.0)
    return sec


def build_header_footer(sec, doc_title):
    sec.different_first_page_header_footer = True

    header = sec.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    r = hp.add_run("MONEY MEOW BANK · 招财猫银行")
    set_run_font(r, 8.5, True, INK_MUTE)
    r = hp.add_run("    " + doc_title)
    set_run_font(r, 8.5, False, INK_MUTE)
    para_border(hp, {"bottom": {"sz": 6, "color": "DBE4F0", "space": 6}})

    footer = sec.footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("内部技术文档 · 比赛演示作品，非真实银行 · 第 ")
    set_run_font(r, 8.5, False, INK_MUTE)
    add_field(fp, "PAGE", "1")
    r = fp.add_run(" 页 / 共 ")
    set_run_font(r, 8.5, False, INK_MUTE)
    add_field(fp, "NUMPAGES", "1")
    r = fp.add_run(" 页")
    set_run_font(r, 8.5, False, INK_MUTE)

    # 封面页脚留空
    first_footer = sec.first_page_footer
    p = first_footer.paragraphs[0]
    p.text = ""


# ------------------------------------------------------------------ 块渲染
class Renderer:
    def __init__(self, doc):
        self.doc = doc
        self.fig_no = 0
        self.tab_no = 0

    def h1(self, text, page_break=True):
        if page_break:
            self.doc.add_page_break()
        p = self.doc.add_heading(level=1)
        r = p.add_run(text)
        set_run_font(r, 20, True, INK)
        para_border(p, {"bottom": {"sz": 12, "color": "533AFD", "space": 8}})
        return p

    def h2(self, text):
        p = self.doc.add_heading(level=2)
        r = p.add_run(text)
        set_run_font(r, 14.5, True, PURPLE)
        return p

    def h3(self, text):
        p = self.doc.add_heading(level=3)
        r = p.add_run(text)
        set_run_font(r, 11.5, True, INK)
        return p

    def p(self, text, size=10.5, color=INK_SOFT, after=6, bold=False, align=None, indent=0):
        para = self.doc.add_paragraph()
        if align == "center":
            para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif align == "justify":
            para.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        para.paragraph_format.space_after = Pt(after)
        if indent:
            para.paragraph_format.first_line_indent = Cm(indent)
        self._rich(para, text, size, color, bold)
        return para

    def _rich(self, para, text, size, color, bold=False):
        """支持 **加粗** 与 `代码` 两种行内标记。"""
        import re
        tokens = re.split(r"(\*\*[^*]+\*\*|`[^`]+`)", text)
        for tok in tokens:
            if not tok:
                continue
            if tok.startswith("**") and tok.endswith("**"):
                r = para.add_run(tok[2:-2])
                set_run_font(r, size, True, INK)
            elif tok.startswith("`") and tok.endswith("`"):
                r = para.add_run(tok[1:-1])
                set_run_font(r, size - 0.5, False, PURPLE, cn=MONO, en=MONO)
            else:
                r = para.add_run(tok)
                set_run_font(r, size, bold, color)

    def bullets(self, items, size=10.5):
        for it in items:
            para = self.doc.add_paragraph(style="List Bullet")
            para.paragraph_format.space_after = Pt(3)
            para.paragraph_format.line_spacing = 1.45
            para.paragraph_format.left_indent = Cm(0.75)
            para.paragraph_format.first_line_indent = Cm(-0.35)
            self._rich(para, it, size, INK_SOFT)

    def numbered(self, items, size=10.5):
        for i, it in enumerate(items, 1):
            para = self.doc.add_paragraph()
            para.paragraph_format.space_after = Pt(3)
            para.paragraph_format.left_indent = Cm(0.85)
            para.paragraph_format.first_line_indent = Cm(-0.55)
            r = para.add_run(f"{i}. ")
            set_run_font(r, size, True, PURPLE)
            self._rich(para, it, size, INK_SOFT)

    def table(self, headers, rows, widths=None, caption=None, font=9, header_fill="101C35",
              zebra="F7F9FE", first_col_bold=False, align=None):
        if caption:
            self.tab_no += 1
            cp = self.doc.add_paragraph()
            cp.paragraph_format.space_before = Pt(6)
            cp.paragraph_format.space_after = Pt(3)
            keep_with_next(cp)
            r = cp.add_run(f"表 {self.tab_no}  {caption}")
            set_run_font(r, 9, True, INK)

        table = self.doc.add_table(rows=1, cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        table_borders(table)
        widths = widths or [CONTENT_W / len(headers)] * len(headers)

        hdr = table.rows[0]
        for i, h in enumerate(headers):
            cell = hdr.cells[i]
            cell.width = Cm(widths[i])
            set_cell_margins(cell)
            shade(cell._tc.get_or_add_tcPr(), header_fill)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.line_spacing = 1.2
            r = p.add_run(h)
            set_run_font(r, font, True, WHITE)

        for ri, row in enumerate(rows):
            cells = table.add_row().cells
            for i, val in enumerate(row):
                cell = cells[i]
                cell.width = Cm(widths[i])
                set_cell_margins(cell)
                if zebra and ri % 2 == 1:
                    shade(cell._tc.get_or_add_tcPr(), zebra)
                p = cell.paragraphs[0]
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.line_spacing = 1.25
                bold = first_col_bold and i == 0
                self._rich(p, str(val), font, INK if bold else INK_SOFT, bold)
                if bold:
                    for r in p.runs:
                        set_run_font(r, font, True, INK)

        # 表后留白
        spacer = self.doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(2)
        spacer.paragraph_format.line_spacing = 0.6
        return table

    def figure(self, filename, caption, width=CONTENT_W, note=None):
        self.fig_no += 1
        path = os.path.join(ASSETS, filename)
        para = self.doc.add_paragraph()
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        para.paragraph_format.space_before = Pt(6)
        para.paragraph_format.space_after = Pt(3)
        keep_with_next(para)
        para.add_run().add_picture(path, width=Cm(width))

        cp = self.doc.add_paragraph()
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.paragraph_format.space_after = Pt(10)
        r = cp.add_run(f"图 {self.fig_no}  {caption}")
        set_run_font(r, 9, False, INK_MUTE)

        if note:
            np_ = self.doc.add_paragraph()
            np_.paragraph_format.space_after = Pt(8)
            self._rich(np_, note, 9, INK_MUTE)

    def callout(self, title, lines, fill="F2F0FF", bar="533AFD", title_color=None):
        table = self.doc.add_table(rows=1, cols=1)
        table.autofit = False
        table_borders(table, color="E8E3FF", sz=2, inside=False)
        cell = table.rows[0].cells[0]
        cell.width = Cm(CONTENT_W)
        shade(cell._tc.get_or_add_tcPr(), fill)
        set_cell_margins(cell, top=140, bottom=140, left=200, right=200)

        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.3
        r = p.add_run(title)
        set_run_font(r, 10, True, title_color or PURPLE)

        for ln in lines:
            p2 = cell.add_paragraph()
            p2.paragraph_format.space_after = Pt(2)
            p2.paragraph_format.line_spacing = 1.45
            self._rich(p2, ln, 9.5, INK_SOFT)

        spacer = self.doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(4)
        spacer.paragraph_format.line_spacing = 0.6

    def code(self, text):
        for line in text.strip("\n").split("\n"):
            p = self.doc.add_paragraph()
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.line_spacing = 1.15
            p.paragraph_format.left_indent = Cm(0.4)
            shade(p._p.get_or_add_pPr(), "F5F7FB")
            r = p.add_run(line if line else " ")
            set_run_font(r, 8.5, False, INK, cn=MONO, en=MONO)
        spacer = self.doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(4)
        spacer.paragraph_format.line_spacing = 0.6

    def quote(self, text, source=None):
        p = self.doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.8)
        p.paragraph_format.space_after = Pt(8)
        p.paragraph_format.line_spacing = 1.45
        para_border(p, {"left": {"sz": 18, "color": "533AFD", "space": 10}})
        self._rich(p, text, 10, INK_SOFT)
        if source:
            r = p.add_run("  —— " + source)
            set_run_font(r, 9, False, INK_MUTE)

    def pagebreak(self):
        self.doc.add_page_break()


def render(blocks, doc, renderer):
    for b in blocks:
        kind = b[0]
        if kind == "h1":
            renderer.h1(b[1], page_break=b[2] if len(b) > 2 else True)
        elif kind == "h2":
            renderer.h2(b[1])
        elif kind == "h3":
            renderer.h3(b[1])
        elif kind == "p":
            renderer.p(b[1], **(b[2] if len(b) > 2 else {}))
        elif kind == "bul":
            renderer.bullets(b[1])
        elif kind in ("num", "numbered"):
            renderer.numbered(b[1])
        elif kind == "tab":
            renderer.table(b[1], b[2], b[3] if len(b) > 3 else None,
                           b[4] if len(b) > 4 else None,
                           **(b[5] if len(b) > 5 else {}))
        elif kind == "fig":
            renderer.figure(b[1], b[2], b[3] if len(b) > 3 else CONTENT_W,
                            b[4] if len(b) > 4 else None)
        elif kind == "callout":
            renderer.callout(b[1], b[2], **(b[3] if len(b) > 3 else {}))
        elif kind == "code":
            renderer.code(b[1])
        elif kind == "quote":
            renderer.quote(b[1], b[2] if len(b) > 2 else None)
        elif kind == "pb":
            renderer.pagebreak()
        else:
            raise ValueError(f"unknown block {kind}")


# ------------------------------------------------------------------ 封面
def build_cover(doc, meta):
    para = doc.add_paragraph()
    para.alignment = WD_ALIGN_PARAGRAPH.LEFT
    para.paragraph_format.space_after = Pt(0)
    para.add_run().add_picture(os.path.join(ASSETS, "cover_banner.png"), width=Cm(CONTENT_W))

    # 标题区
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(26)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("技术文档")
    set_run_font(r, 34, True, INK)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("招财猫银行 · AI Banking 智能体系统")
    set_run_font(r, 17, True, PURPLE)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(18)
    r = p.add_run("系统架构 · 核心算法 · 安全设计")
    set_run_font(r, 12, False, INK_MUTE)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(26)
    para_border(p, {"bottom": {"sz": 8, "color": "533AFD", "space": 1}})

    # 元信息表
    rows = [
        ("项目名称", "Maneki-Neko（招财猫银行 / MONEY MEOW BANK）"),
        ("仓库地址", "https://github.com/Catgirl540/Maneki-Neko"),
        ("文档版本", meta["version"]),
        ("对应提交", meta["commit"]),
        ("编制日期", meta["date"]),
        ("文档密级", "内部资料 · 赛事评审可见"),
        ("适用模式", "sandbox 演示 / live 生产闸门（真实银行通道未接入）"),
    ]
    table = doc.add_table(rows=0, cols=2)
    table.autofit = False
    table_borders(table, color="E7ECF6", inside=True)
    for k, v in rows:
        cells = table.add_row().cells
        cells[0].width = Cm(3.6)
        cells[1].width = Cm(12.4)
        set_cell_margins(cells[0], top=90, bottom=90)
        set_cell_margins(cells[1], top=90, bottom=90)
        shade(cells[0]._tc.get_or_add_tcPr(), "F5F7FF")
        p0 = cells[0].paragraphs[0]
        r = p0.add_run(k)
        set_run_font(r, 9.5, True, INK_MUTE)
        p1 = cells[1].paragraphs[0]
        r = p1.add_run(v)
        set_run_font(r, 9.5, False, INK)

    # 底部声明
    for _ in range(2):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    r = p.add_run("本文件为比赛演示作品的工程说明。系统为虚拟（模拟）银行，不持有金融牌照，不吸收公众存款，")
    set_run_font(r, 8.5, False, INK_MUTE)
    p2 = doc.add_paragraph()
    r = p2.add_run("真实资金通道、监管报送与支付清算均未接入；文中所有金额与时序均为工程口径，可追溯到仓库提交。")
    set_run_font(r, 8.5, False, INK_MUTE)


def build_toc(doc, renderer=None):
    """阅读导航页：不用 Word 域，避免打开时目录为空的观感问题。"""
    doc.add_page_break()
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run("阅读导航")
    set_run_font(r, 20, True, INK)
    para_border(p, {"bottom": {"sz": 12, "color": "533AFD", "space": 6}})

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(10)
    r = p.add_run("本文档按“先看结论、再看实现、最后看边界”的顺序组织。每一章都可以独立阅读，")
    set_run_font(r, 9.5, False, INK_MUTE)
    r = p.add_run("括号内为该章的核心交付物。")
    set_run_font(r, 9.5, False, INK_MUTE)

    rows = [
        ["1 项目概述", "背景与定位、交付范围、工程规模、三条设计主线", "全员"],
        ["2 系统架构", "五层架构（图 1）、四端职责、Agent 运行时、部署拓扑（图 4）、技术选型", "技术评审"],
        ["3 核心算法说明", "账户模型、会员 AUM、费用与点差、预算与积分、消费风控、转账生命周期（图 5）、分摊、理财、账单、分类", "技术评审"],
        ["4 安全设计", "威胁模型、六道控制面（图 6）、认证与会话、口令与密钥、授权与幂等、数据库分权、环境闸门、Agent 安全、已知限制", "安全评审"],
        ["5 数据模型与一致性", "schema 分层、关键对象、事务边界与并发、迁移与兼容", "技术评审"],
        ["6 验证与工程实践", "门禁与测试矩阵、发布流程、可复现的本地验证", "全员"],
        ["7 局限与后续路线", "未实现清单与优先级（P0–P3）", "评委"],
        ["附录 A 接口分组", "115 个端点按业务域分组", "开发"],
        ["附录 B 代码索引", "关键文件与职责对照", "开发"],
        ["附录 C 术语表", "AUM、分区、冻结、幂等、确认卡等 10 个术语", "全员"],
    ]
    table = doc.add_table(rows=1, cols=3)
    table.autofit = False
    table_borders(table, color="DBE4F0")
    widths = [4.0, 9.4, 2.6]
    headers = ["章节", "你会读到什么", "建议读者"]
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.width = Cm(widths[i])
        set_cell_margins(cell)
        shade(cell._tc.get_or_add_tcPr(), "101C35")
        pp = cell.paragraphs[0]
        pp.paragraph_format.space_before = Pt(3)
        pp.paragraph_format.space_after = Pt(3)
        r = pp.add_run(h)
        set_run_font(r, 9, True, WHITE)

    for ri, row in enumerate(rows):
        cells = table.add_row().cells
        for i, val in enumerate(row):
            cell = cells[i]
            cell.width = Cm(widths[i])
            set_cell_margins(cell, top=80, bottom=80)
            if ri % 2 == 1:
                shade(cell._tc.get_or_add_tcPr(), "F7F9FE")
            pp = cell.paragraphs[0]
            pp.paragraph_format.space_before = Pt(3)
            pp.paragraph_format.space_after = Pt(3)
            pp.paragraph_format.line_spacing = 1.3
            r = pp.add_run(val)
            set_run_font(r, 9, i == 0, INK if i == 0 else INK_SOFT)

    # 文档约定
    doc.add_paragraph()
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run("文档约定")
    set_run_font(r, 10.5, True, PURPLE)

    notes = [
        "**金额**一律以“分”为整数单位；文中 ¥ 表示人民币元，括号内为代码常量（如 ¥100,000 = 10,000,000 分）。",
        "**时间**一律为北京时间（UTC+8）自然日 / 自然月；跨时区不改口径。",
        "**代码引用**使用等宽字体标注文件或符号（如 `shared/membership.mjs`），可在附录 B 查到职责。",
        "**图表编号**全文连续（图 1–6、表 1–28）；每张图都对应仓库中可验证的实现或部署配置。",
        "**“未接入”“未实现”**均为明确状态，不是待办口误；第 4.10 节集中列出。",
    ]
    for n in notes:
        pp = doc.add_paragraph()
        pp.paragraph_format.left_indent = Cm(0.6)
        pp.paragraph_format.first_line_indent = Cm(-0.35)
        pp.paragraph_format.space_after = Pt(3)
        pp.paragraph_format.line_spacing = 1.45
        r = pp.add_run("· ")
        set_run_font(r, 9.5, True, PURPLE)
        renderer._rich(pp, n, 9.5, INK_SOFT) if renderer else pp.add_run(n)


def enable_update_fields(doc):
    settings = doc.settings.element
    upd = OxmlElement("w:updateFields")
    upd.set(qn("w:val"), "true")
    settings.append(upd)


def main():
    import doc_content_a as A
    import doc_content_b as B

    doc = Document()
    setup_styles(doc)
    sec = setup_page(doc)
    build_header_footer(sec, "技术文档")
    build_cover(doc, A.META)
    r = Renderer(doc)
    build_toc(doc, r)

    render(A.BLOCKS, doc, r)
    render(B.BLOCKS, doc, r)

    doc.save(OUT)
    print("saved", OUT)


if __name__ == "__main__":
    main()
