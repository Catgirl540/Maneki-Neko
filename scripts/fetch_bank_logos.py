#!/usr/bin/env python3
"""
抓取收款银行的官方行标并落到 app/public/banks/。

为什么不用第三方的 logo 服务（clearbit / google s2 / favicon.im）：
实测 favicon.im 对解析不到的域名**不报错，而是返回一张灰色占位圆圈**（257B 的 SVG），
等于把假数据当真的用。所以改成抓一次、校验、本地托管 —— 顺便也避免了
让客户端每次渲染银行列表都去打第三方（对一个银行类应用是隐私问题）。

做法：把官网首页声明的所有 icon 类链接 + 一批常见路径都当候选，
**逐个下载后按真实像素尺寸选最大的那一张**，而不是见到第一个就用。
16×16 的 favicon 放到 32px 会被拉糊，所以尺寸是必须校验的指标。

域名清单从 app/src/api/mock/db.ts 里解析，避免两处维护。

  python3 scripts/fetch_bank_logos.py [--force]
"""
from __future__ import annotations

import pathlib
import re
import struct
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB = ROOT / "app/src/api/mock/db.ts"
OUT = ROOT / "app/public/banks"

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)
TIMEOUT = 15
# 每家最多试多少个候选 URL（全失败的家数会走满）
MAX_TRIES = 34
MIN_BYTES = 120

# 常见 favicon 路径，兜底用
WELL_KNOWN = [
    # apple-touch 系列通常是最清晰的（180×180 上下）
    "/apple-touch-icon.png",
    "/apple-touch-icon-180x180.png",
    "/apple-touch-icon-152x152.png",
    "/apple-touch-icon-120x120.png",
    "/apple-touch-icon-precomposed.png",
    "/favicon-192x192.png",
    "/favicon-192.png",
    "/favicon-180x180.png",
    "/favicon-96x96.png",
    "/favicon-32x32.png",
    "/favicon.png",
    "/favicon.svg",
    "/favicon.ico",
    # 各家静态目录的习惯位置
    "/logo.png",
    "/logo.svg",
    "/images/logo.png",
    "/img/logo.png",
    "/assets/logo.png",
    "/static/logo.png",
    "/static/favicon.ico",
    "/static/img/favicon.ico",
    "/assets/favicon.ico",
    "/img/favicon.ico",
    "/images/favicon.ico",
]


def parse_banks() -> list[dict[str, str]]:
    src = DB.read_text(encoding="utf-8")
    banks = []
    for m in re.finditer(
        r"\{ code: '([^']+)', region: '(CN|HK)', name: '([^']+)'([^}]*)\}", src
    ):
        domain = re.search(r"domain: '([^']+)'", m.group(4))
        banks.append(
            {
                "code": m.group(1),
                "region": m.group(2),
                "name": m.group(3),
                "domain": domain.group(1) if domain else "",
            }
        )
    return banks


def curl(url: str, timeout: int = TIMEOUT, ua: str = UA) -> tuple[int, str, bytes]:
    origin = re.match(r"(https?://[^/]+)", url)
    out = subprocess.run(
        [
            "curl", "-sL", "-A", ua,
            # 不少银行站点的 WAF 会拦没有来源页的裸请求
            "-e", (origin.group(1) + "/") if origin else url,
            "-H", "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
            "--max-time", str(timeout),
            "-w", "\n@@%{http_code}@@%{content_type}",
            url,
        ],
        capture_output=True,
    )
    raw = out.stdout
    marker = raw.rfind(b"\n@@")
    if marker < 0:
        return 0, "", b""
    body = raw[:marker]
    try:
        code_s, ctype = raw[marker + 3:].decode("utf-8", "replace").split("@@")
        return int(code_s), ctype, body
    except ValueError:
        return 0, "", b""


# ------------------------------------------------------------------ 尺寸解析

def png_size(b: bytes):
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", b[16:24])


def gif_size(b: bytes):
    if b[:6] not in (b"GIF87a", b"GIF89a"):
        return None
    return struct.unpack("<HH", b[6:10])


def jpeg_size(b: bytes):
    if b[:3] != b"\xff\xd8\xff":
        return None
    i = 2
    while i < len(b) - 9:
        if b[i] != 0xFF:
            i += 1
            continue
        marker = b[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = struct.unpack(">HH", b[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    return None


def ico_best(b: bytes):
    """ICO 里可能塞了多个尺寸，取最大的那个"""
    if b[:4] != b"\x00\x00\x01\x00":
        return None
    n = struct.unpack("<H", b[4:6])[0]
    best = 0
    for i in range(n):
        e = b[6 + i * 16: 6 + (i + 1) * 16]
        if len(e) < 16:
            break
        best = max(best, e[0] or 256, e[1] or 256)
    return (best, best) if best else None


def svg_size(b: bytes):
    head = b[:400].decode("utf-8", "replace")
    if "<svg" not in head and not head.lstrip().startswith("<?xml"):
        return None
    if 'fill="#808080"' in b[:400].decode("utf-8", "replace"):
        return None  # favicon.im 那种灰色占位图
    m = re.search(r'viewBox=["\']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)', head)
    if m:
        return int(float(m.group(1))), int(float(m.group(2)))
    return (512, 512)  # 矢量，按可无限缩放对待


def inspect(body: bytes):
    """返回 (扩展名, 宽, 高)；不是可用图像则 None"""
    for ext, fn in (("png", png_size), ("gif", gif_size), ("jpg", jpeg_size), ("ico", ico_best)):
        size = fn(body)
        if size:
            return ext, size[0], size[1]
    if svg_size(body):
        return "svg", *svg_size(body)
    return None


# ------------------------------------------------------------------ 候选枚举

def candidates(domain: str) -> list[tuple[int, str]]:
    """
    返回 (优先级, url)。优先级数字越小越优先：

      0  apple-touch-icon —— 通常是 180×180 的正牌 logo，最可靠
      1  页面声明的其它 icon（rel=icon / mask-icon / msapplication-TileImage）
      2  常见固定路径兜底

    **不收 og:image**：实测它经常是社交分享用的横幅图而不是行标
    （ocbc.com 的 og:image 有 1200px，但那是宣传图，不是银行标志）。
    """
    out: list[tuple[int, str]] = []

    hosts = (f"https://www.{domain}", f"https://{domain}")
    homepage = None
    # 桌面 UA 先试；拿不到就用移动 UA —— 被 WAF 挡时移动端常常能过
    for ua in (UA, MOBILE_UA):
        for host in hosts:
            status, ctype, body = curl(host + "/", ua=ua)
            if status == 200 and "html" in ctype.lower():
                homepage = (host, body.decode("utf-8", "replace"))
                break
        if homepage:
            break

    if homepage:
        host, html = homepage
        for tag in re.findall(r"<link[^>]+>", html, flags=re.I):
            low = tag.lower()
            if "icon" not in low and "tileimage" not in low:
                continue
            href = re.search(r'href=["\']([^"\']+)["\']', tag, flags=re.I)
            if not href or href.group(1).startswith("data:"):
                continue
            value = href.group(1)
            if value.startswith("//"):
                url = "https:" + value
            elif value.startswith("http"):
                url = value
            elif value.startswith("/"):
                url = host + value
            else:
                url = host + "/" + value.lstrip("./")
            out.append((0 if "apple-touch" in low else 1, url))

    for host in (*hosts, f"http://{domain}"):
        for path in WELL_KNOWN:
            out.append((0 if "apple-touch" in path else 2, host + path))

    seen, dedup = set(), []
    for tier, url in out:
        if url not in seen:
            seen.add(url)
            dedup.append((tier, url))
    return dedup


def main() -> int:
    force = "--force" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    banks = [b for b in parse_banks() if b["domain"]]

    results: list[tuple[str, str, int, str]] = []
    failed: list[tuple[str, str, str]] = []

    for bank in banks:
        key = f"{bank['region'].lower()}-{bank['code']}"
        if not force:
            existing = list(OUT.glob(f"{key}.*"))
            if existing:
                info = inspect(existing[0].read_bytes())
                results.append((key, existing[0].suffix.lstrip("."), info[1] if info else 0, bank["name"]))
                print(f"  跳过 {key:<10} {bank['name']}（已有 {info[1] if info else '?'}px）")
                continue

        best = None  # (tier, -像素, ext, body, 像素)
        # 候选路径多了以后要给个上限：失败的家数会走完全部候选，
        # 不封顶的话 16 家 × 70 多个候选能跑半小时
        tries = 0
        for tier, url in candidates(bank["domain"]):
            tries += 1
            if tries > MAX_TRIES:
                break
            status, ctype, body = curl(url)
            if status != 200 or len(body) < MIN_BYTES or not ctype.startswith("image/"):
                continue
            info = inspect(body)
            if not info:
                continue
            ext, w, h = info
            # SVG 是矢量，按可无限缩放对待
            pixels = 1024 if ext == "svg" else max(w, h)
            if best is None or (tier, -pixels) < (best[0], -best[4]):
                best = (tier, -pixels, ext, body, pixels)
            # apple-touch-icon 且够大就别再找了
            if tier == 0 and pixels >= 128:
                break

        if not best:
            failed.append((key, bank["name"], bank["domain"]))
            print(f"  失败 {key:<10} {bank['name']:<18} {bank['domain']}")
            continue

        for old in OUT.glob(f"{key}.*"):
            old.unlink()
        _, _, ext, body, pixels = best
        (OUT / f"{key}.{ext}").write_bytes(body)
        results.append((key, ext, pixels, bank["name"]))
        print(f"  成功 {key:<10} {bank['name']:<18} {bank['domain']:<26} {ext:<4} {pixels}px")

    print(f"\n成功 {len(results)} / 共 {len(banks)} 家")
    big = [r for r in results if r[2] >= 64]
    mid = [r for r in results if 32 <= r[2] < 64]
    small = [r for r in results if 0 < r[2] < 32]
    print(f"  ≥64px {len(big)} 家 · 32–63px {len(mid)} 家 · <32px {len(small)} 家")
    if small:
        print(f"  偏小（会糊）：{', '.join(f'{k}({p}px)' for k, _, p, _ in small)}")
    if failed:
        print(f"\n失败 {len(failed)} 家（UI 会退回文字色块）：")
        for key, name, domain in failed:
            print(f"  {key:<10} {name}  {domain}")

    print("\n=== 供 db.ts 使用的 logo 映射 ===")
    for key, ext, _, _ in sorted(results):
        print(f"  {key.upper()}: '/banks/{key}.{ext}',")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
