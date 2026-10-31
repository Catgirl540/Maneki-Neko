# -*- coding: utf-8 -*-
"""结构化校验 DOCX：表格宽度、图片宽度、标题层级、代码行宽。"""
import os
import sys
from docx import Document
from docx.shared import Cm

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, "招财猫银行-技术文档.docx")
CONTENT_CM = 16.0

doc = Document(PATH)

print("== 段落 %d / 表格 %d / 图片 %d ==" % (
    len(doc.paragraphs), len(doc.tables), len(doc.inline_shapes)))

bad_tables = []
for i, t in enumerate(doc.tables):
    widths = []
    for row in t.rows:
        for c in row.cells:
            if c.width:
                widths.append(c.width.cm)
    total = max(widths) if widths else 0
    # 一行的列宽之和
    row_total = sum((c.width.cm if c.width else 0) for c in t.rows[0].cells)
    if row_total > CONTENT_CM + 0.05:
        bad_tables.append((i, round(row_total, 2), len(t.rows[0].cells)))

print("== 超宽表格 ==")
if not bad_tables:
    print("none")
for b in bad_tables:
    print("  table#%d width=%.2fcm cols=%d" % b)

print("== 图片 ==")
for i, s in enumerate(doc.inline_shapes):
    print("  fig%d %.2fcm x %.2fcm" % (i + 1, s.width.cm, s.height.cm))

print("== 标题 ==")
for p in doc.paragraphs:
    if p.style.name.startswith("Heading"):
        print(" ", p.style.name, "|", p.text[:60])

# 代码行宽检查：等宽字体段落
mono_long = []
for p in doc.paragraphs:
    if not p.runs:
        continue
    r = p.runs[0]
    if r.font.name == "Consolas":
        txt = p.text
        if len(txt) > 84:
            mono_long.append((len(txt), txt[:60]))
print("== 代码行超宽（>84 字符）==")
if not mono_long:
    print("none")
for m in mono_long[:20]:
    print("  len=%d %s" % m)

# 估算页数（按字数，粗略）
chars = sum(len(p.text) for p in doc.paragraphs)
table_chars = sum(len(c.text) for t in doc.tables for r in t.rows for c in r.cells)
print("== 文本量：正文 %d 字 + 表格 %d 字 ==" % (chars, table_chars))
sys.exit(1 if bad_tables else 0)
