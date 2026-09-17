#!/usr/bin/env python3
"""
把收款银行名录的行标换成**矢量**（SVG）。

为什么不再用 PNG
----------------
之前那批是 160×160 的位图。160px 在 32px 的列表里够用，但界面上一放大就糊，
而且位图在 HiDPI 屏上等于又被压了一次。行标是**纯图形**，本来就该是矢量。

两个来源，按优先级：
1. **真矢量**（首选）：icongo/bank-logos 的 `<key>-rect.svg`。
   这批文件是 1024×1024 画布，**第一条铺满画布的白色圆角 path 是底卡**，删掉即得透明底徽章。
2. **描摹**（兜底）：仓库里没有的几家，用 vtracer 把现有的 PNG 描成 SVG。
   这是**保真度降级** —— 描摹只能还原位图里已有的信息，放大不会变清晰，只是不糊。
   哪些是描出来的，脚本会明确列出来，不混在真矢量里当一回事。

两个来源都做完后统一**把 viewBox 收紧到内容边界**（渲染出来量 alpha bbox 反推），
这样各家留白一致，也顺手去掉矢量里多余的空白画布。

    python3 scripts/fetch_bank_logos_svg.py [--force] [--trace-only] [--vector-only]
"""

import io
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app/public/banks"
CDN = "https://cdn.jsdelivr.net/gh/icongo/bank-logos@HEAD/logos"
UA = {"User-Agent": "Mozilla/5.0"}

# 本仓库文件名 → icongo 仓库里的银行键。这 49 家都能拿到真矢量。
VECTOR_MAP = {
    "cn-102": "icbc", "cn-103": "abchina", "cn-104": "boc", "cn-105": "ccb",
    "cn-301": "bankcomm", "cn-302": "citicbank", "cn-303": "cebbank", "cn-304": "hxb",
    "cn-305": "cmbc", "cn-306": "cgbchina", "cn-307": "pingan", "cn-308": "cmbchina",
    "cn-309": "cib", "cn-310": "spdb", "cn-315": "hfbank", "cn-316": "czbank",
    "cn-318": "cbhb", "cn-319": "hsbank", "cn-403": "psbc",
    "hk-003": "sc", "hk-004": "hsbc", "hk-006": "citibank", "hk-009": "ccb",
    "hk-012": "boc", "hk-015": "hkbea", "hk-016": "dbs", "hk-018": "citicbank",
    "hk-020": "cmbcn", "hk-022": "ocbc", "hk-024": "hangseng", "hk-027": "bankcomm",
    "hk-035": "ocbc", "hk-040": "dahsing", "hk-043": "ncbchina", "hk-071": "uobchina",
    "hk-072": "icbc", "hk-128": "fubonchina", "hk-214": "icbc", "hk-221": "ccb",
    "hk-222": "abchina", "hk-238": "cmbchina", "hk-250": "citibank", "hk-338": "boc",
    "hk-345": "spdb", "hk-353": "cmbc", "hk-368": "cebbank", "hk-372": "bosc",
    "hk-377": "cib", "hk-382": "bankcomm",
}

# 上面这批之外、仓库里确实没有矢量的，只能描摹现有的 PNG
TRACE_ONLY = ["hk-028", "hk-039", "hk-041", "hk-061", "hk-025"]

# 个别 `-rect.svg` 其实是**带文字的 lockup**，不能直接用。这些走专门的抽取规则。
#
# `hsbank`（徽商银行）：`-rect.svg` 与 `hsbank.svg` 都是「徽章 + 徽商银行 + HUISHANG BANK」的
# 完整 lockup，而且徽章和「ank」**在同一条 path 里**，所以按路径分、按颜色分、
# 按矩形裁都切不开。可行的办法是按**子路径**拆：徽章那两段（外圈圆环 + 中间的弯钩）
# 都以**绝对 `M`** 开头，而文字那几段用的是**相对 `m`** —— 相对子路径的绝对位置依赖前一段，
# 单独取出来会跑位，所以只保留绝对 `M` 的子路径，正好就是徽章。
# 再滤掉面积过小的碎块（原图里有个孤立小圆点）。
LOCKUP_BADGE = {"cn-319": "hsbank"}

# 整条 path 元素。只匹配开标签会把 `</path>` 留在原地，XML 不闭合，
# rsvg-convert 报 "Opening and ending tag mismatch" —— 而那个报错指不到真正的原因。
PATH_RE = re.compile(r"<path\b[^>]*?/>|<path\b[^>]*?>.*?</path>", re.I | re.S)
SVG_OPEN_RE = re.compile(r"(<svg\b[^>]*>)", re.I)
VIEWBOX_RE = re.compile(r'viewBox\s*=\s*"([^"]+)"', re.I)
WHITE = ("#FFFFFF", "#FFF", "WHITE")


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
        return r.read()


def rsvg(svg_bytes: bytes, px: int) -> Image.Image:
    with tempfile.NamedTemporaryFile(suffix=".svg", delete=False) as f:
        f.write(svg_bytes)
        src = f.name
    dst = src + ".png"
    r = subprocess.run(
        ["rsvg-convert", "-w", str(px), "-h", str(px), "-o", dst, src],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"rsvg-convert: {(r.stderr or '').strip()[:200]}")
    return Image.open(dst).convert("RGBA")


def opaque_fraction(im: Image.Image) -> float:
    a = im.getchannel("A")
    return sum(1 for v in a.get_flattened_data() if v > 8) / (im.width * im.height)


def strip_canvas_card(svg: str) -> tuple[str, int]:
    """
    删掉**铺满画布**的白色底卡。

    判据不是「fill 是白色」，更不是 `d` 的特征串 —— 各家导出写法差异极大
    （`M0 0m224 0l576 0…` / `M224 0h576c…`）。做法是**把每条白色 path 单独渲染出来量覆盖率**：
    >90% 的就是底卡。语义稳定，不挑写法。
    """
    open_tag = SVG_OPEN_RE.search(svg)
    if not open_tag:
        return svg, 0
    removed = 0
    probes = 0
    for tag in PATH_RE.findall(svg):
        fill = (re.search(r'fill="([^"]*)"', tag) or [None, ""])[1].upper()
        if fill not in WHITE:
            continue
        # 只吞「这条 path 单独渲染不出来」这一种情况。
        # 早先这里写的是 `except Exception: continue`，结果上面的 open_tag 少了个捕获组、
        # `.group(1)` 抛 IndexError 也被一起吞了 —— 49 家全部「没找到底卡」而看不出原因。
        try:
            cov = opaque_fraction(rsvg(f"{open_tag.group(1)}{tag}</svg>".encode(), 256))
        except RuntimeError:
            continue
        probes += 1
        if cov < 0.9:
            continue  # 白但不是底卡（例如徽章内部的白色部件），留着
        svg = svg.replace(tag, "", 1)
        removed += 1
    if removed == 0 and probes == 0:
        raise RuntimeError("一条白色 path 都没渲染成功，无法判断底卡")
    if not PATH_RE.search(svg):
        return open_tag.string, 0  # 全删光了说明判断错了，退回原图
    return svg, removed


def extract_badge_from_lockup(svg: str) -> str:
    """
    从带文字的 lockup 里抽出徽章：只保留第一条 path 中以**绝对 `M`** 开头的子路径，
    并滤掉面积过小的碎块。适用于 LOCKUP_BADGE 里登记的那几家，规则见那里的注释。
    """
    first = PATH_RE.findall(svg)[0]
    fill = (re.search(r'fill="([^"]*)"', first) or [None, "#000"])[1]
    d = (re.search(r'\bd="([^"]*)"', first) or [None, ""])[1]
    subs = [x for x in re.findall(r"[Mm][^Mm]*", d) if x.startswith("M")]

    keep = []
    for sub in subs:
        probe = f'<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><path d="{sub}" fill="{fill}"/></svg>'
        bb = rsvg(probe.encode(), 512).getchannel("A").getbbox()
        if not bb:
            continue
        w, h = bb[2] - bb[0], bb[3] - bb[1]
        if w * h < 2000:  # 碎块（原图里有个孤立小圆点）
            continue
        keep.append(sub)
    if not keep:
        raise RuntimeError("按绝对子路径没抽出任何东西")

    open_tag = SVG_OPEN_RE.search(svg).group(1)
    body = f'<path d="{" ".join(keep)}" fill="{fill}"/>'
    return re.sub(r"<path\b[^>]*?/>|<path\b[^>]*?>.*?</path>", "", svg, flags=re.S | re.I).replace(
        open_tag, open_tag + body, 1
    )


def tighten_viewbox(svg: str) -> str:
    """
    把 viewBox 收紧到内容边界。

    做法：按原 viewBox 渲染一张大图，量出 alpha 的 bbox，再按比例换算回用户坐标。
    顺带补一点边距，让各家在同一个方框里视觉重量接近。
    同时删掉 width/height，避免固定尺寸把 SVG 钉死。
    """
    m = VIEWBOX_RE.search(svg)
    if not m:
        return svg
    vx, vy, vw, vh = (float(x) for x in re.split(r"[,\s]+", m.group(1).strip()))

    px = 1024
    im = rsvg(svg.encode(), px)
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        return svg

    sx, sy = vw / px, vh / px
    x0, y0, x1, y1 = bbox
    # 四周留 3% 边距（按内容较大边算），避免贴着边
    pad = max(x1 - x0, y1 - y0) * 0.03
    nx = vx + x0 * sx - pad * sx
    ny = vy + y0 * sy - pad * sy
    nw = (x1 - x0) * sx + 2 * pad * sx
    nh = (y1 - y0) * sy + 2 * pad * sy

    def fmt(v: float) -> str:
        return f"{v:.2f}".rstrip("0").rstrip(".")

    svg = VIEWBOX_RE.sub(f'viewBox="{fmt(nx)} {fmt(ny)} {fmt(nw)} {fmt(nh)}"', svg, count=1)
    svg = re.sub(r'\s(width|height)\s*=\s*"[^"]*"', "", svg, count=2, flags=re.I)
    return svg


def trace_with_vtracer(png: Path) -> str:
    """把位图描成 SVG。只能还原位图里已有的信息 —— 是保真度降级，不是升级。"""
    sys.path.insert(0, str(ROOT / ".pytools"))
    import vtracer  # type: ignore

    return vtracer.convert_image_to_svg_py(
        str(png),
        colormode="color",
        hierarchical="stacked",
        mode="spline",
        filter_speckle=6,
        corner_threshold=60,
        path_precision=3,
    )


def main() -> int:
    args = set(sys.argv[1:])
    force = "--force" in args
    only_trace = "--trace-only" in args
    only_vector = "--vector-only" in args

    vectors, traced, failed = [], [], []

    for key, bankkey in VECTOR_MAP.items():
        if only_trace:
            continue
        dest = OUT_DIR / f"{key}.svg"
        if dest.exists() and not force:
            vectors.append((key, "已存在，跳过"))
            continue
        try:
            if key in LOCKUP_BADGE:
                # 这类素材要连不带 -rect 的那份一起用（两份都是 lockup）
                raw = fetch(f"{CDN}/{LOCKUP_BADGE[key]}.svg").decode("utf-8", "replace")
                svg = tighten_viewbox(extract_badge_from_lockup(raw))
                note = f"{LOCKUP_BADGE[key]}.svg 抽徽章"
            else:
                raw = fetch(f"{CDN}/{bankkey}-rect.svg").decode("utf-8", "replace")
                cleaned, removed = strip_canvas_card(raw)
                if removed == 0:
                    raise RuntimeError("没找到铺满画布的白色底卡，按非徽章素材处理")
                svg = tighten_viewbox(cleaned)
                note = f"{bankkey}-rect.svg"
            dest.write_text(svg, encoding="utf-8")
            vectors.append((key, f"{note} → {dest.stat().st_size}B"))
        except Exception as e:
            failed.append((key, f"矢量失败：{e}"))

    for key in TRACE_ONLY:
        if only_vector:
            continue
        dest = OUT_DIR / f"{key}.svg"
        png = OUT_DIR / f"{key}.png"
        if not png.exists():
            failed.append((key, "没有可描摹的 PNG，且仓库里没有矢量源"))
            continue
        try:
            svg = trace_with_vtracer(png)
            dest.write_text(svg, encoding="utf-8")
            traced.append((key, f"{png.name} 描摹 → {dest.stat().st_size}B"))
        except Exception as e:
            failed.append((key, f"描摹失败：{e}"))

    print(f"真矢量 {len(vectors)} 家：")
    for k, n in vectors:
        print(f"  ✅ {k:8} {n}")
    if traced:
        print(f"\n描摹（保真度降级，放大不会变清晰）{len(traced)} 家：")
        for k, n in traced:
            print(f"  ⚠️  {k:8} {n}")
    if failed:
        print(f"\n失败 {len(failed)} 家：")
        for k, why in failed:
            print(f"  ❌ {k:8} {why}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
