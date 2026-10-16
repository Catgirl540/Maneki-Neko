#!/usr/bin/env python3
"""Batch image generation via OpenRouter /api/v1/images (microsoft/mai-image-2.6).

Usage:
    python3 scripts/gen_images.py <spec.json> [--only name1,name2] [--force]

Spec format:
{
  "out_dir": "design/brand/generated",
  "model": "microsoft/mai-image-2.6",
  "items": [
    {"name": "logo-a", "prompt": "...", "size": "1024x1024"}
  ]
}
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

API_URL = "https://openrouter.ai/api/v1/images"
ROOT = pathlib.Path(__file__).resolve().parent.parent


def api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if key:
        return key
    for rc in (pathlib.Path.home() / ".zshrc", pathlib.Path.home() / ".bashrc"):
        if rc.exists():
            for line in rc.read_text(errors="ignore").splitlines():
                if "OPENROUTER_API_KEY" in line and "=" in line:
                    value = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if value:
                        return value
    sys.exit("OPENROUTER_API_KEY not found (env or ~/.zshrc)")


def generate(key: str, model: str, prompt: str, size: str | None) -> bytes:
    payload: dict[str, object] = {"model": model, "prompt": prompt}
    if size:
        payload["size"] = size
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://localhost/luckycat-bank",
            "X-Title": "LuckyCat Bank design",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        body = json.loads(resp.read().decode())
    if "error" in body:
        raise RuntimeError(json.dumps(body["error"], ensure_ascii=False)[:500])
    data = body.get("data") or []
    if not data or "b64_json" not in data[0]:
        raise RuntimeError(f"unexpected response: {json.dumps(body)[:300]}")
    cost = (body.get("usage") or {}).get("cost")
    if cost is not None:
        print(f"      cost=${cost:.4f}", flush=True)
    return base64.b64decode(data[0]["b64_json"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("spec")
    parser.add_argument("--only", default="")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    spec = json.loads(pathlib.Path(args.spec).read_text())
    out_dir = ROOT / spec.get("out_dir", "design/brand/generated")
    out_dir.mkdir(parents=True, exist_ok=True)
    model = spec.get("model", "microsoft/mai-image-2.6")
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    key = api_key()
    manifest_path = out_dir / "manifest.json"
    manifest: list[dict[str, object]] = (
        json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    )

    for index, item in enumerate(spec["items"], 1):
        name = item["name"]
        if only and name not in only:
            continue
        target = out_dir / f"{name}.png"
        if target.exists() and not args.force:
            print(f"[{index}] skip {name} (exists)", flush=True)
            continue
        print(f"[{index}] {name} ...", flush=True)
        started = time.time()
        try:
            raw = generate(key, model, item["prompt"], item.get("size"))
        except urllib.error.HTTPError as exc:
            print(f"      HTTP {exc.code}: {exc.read().decode()[:300]}", flush=True)
            continue
        except Exception as exc:  # noqa: BLE001
            print(f"      FAILED: {exc}", flush=True)
            continue
        target.write_bytes(raw)
        print(
            f"      saved {target.relative_to(ROOT)} "
            f"({len(raw) / 1024:.0f} KB, {time.time() - started:.0f}s)",
            flush=True,
        )
        manifest = [m for m in manifest if m.get("name") != name]
        manifest.append(
            {
                "name": name,
                "file": target.name,
                "model": model,
                "size": item.get("size"),
                "prompt": item["prompt"],
            }
        )
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))

    print(f"\ndone -> {out_dir}", flush=True)


if __name__ == "__main__":
    main()