#!/usr/bin/env python3
"""
Mini Workspace — 단일 파일 빌드 스크립트

index.html 이 참조하는 CSS/JS 를 전부 한 파일 안에 넣습니다.
번들러 없이 표준 라이브러리만 사용하므로 `python3 scripts/build-single.py` 로 바로 돌아갑니다.

  python3 scripts/build-single.py                 → dist/mini-workspace.html (그대로 열리는 완전한 HTML)
  python3 scripts/build-single.py --artifact      → dist/artifact.html (<body> 안쪽만, Artifact 게시용)
  python3 scripts/build-single.py --fonts         → Pretendard 를 data URI 로 함께 포함

알람 소리는 항상 data URI 로 포함되므로 파일 하나만 있으면 소리까지 동작합니다.
"""

import base64
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

# 폰트를 넣을 때 포함할 굵기 (전부 넣으면 12MB 를 넘어가므로 본문/강조 두 종만)
FONT_WEIGHTS = [("Pretendard-Regular.otf", 400), ("Pretendard-Bold.otf", 700)]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def data_uri(path: Path, mime: str) -> str:
    return "data:%s;base64,%s" % (mime, base64.b64encode(path.read_bytes()).decode("ascii"))


def sound_map() -> str:
    entries = []
    for name in ("start-alarm", "end-alarm"):
        f = ROOT / "assets" / "sounds" / (name + ".mp3")
        if f.exists():
            entries.append('  "%s": "%s"' % (name, data_uri(f, "audio/mpeg")))
    return "window.MW = window.MW || {};\nMW.assets = {\n" + ",\n".join(entries) + "\n};\n"


def font_face_css() -> str:
    out = []
    for filename, weight in FONT_WEIGHTS:
        f = ROOT / "assets" / "fonts" / filename
        if not f.exists():
            continue
        out.append(
            "@font-face{font-family:'Pretendard';font-weight:%d;font-display:swap;"
            "src:url('%s') format('opentype');}" % (weight, data_uri(f, "font/otf"))
        )
    return "\n".join(out)


def build(artifact: bool, with_fonts: bool) -> Path:
    html = read(ROOT / "index.html")

    # 1) <link rel=stylesheet> → <style>
    def css_sub(m):
        href = m.group(1)
        text = read(ROOT / href.lstrip("./"))
        if href.endswith("tokens.css"):
            # 로컬 폰트 파일을 참조하는 @font-face 블록은 단일 파일에서 쓸 수 없으므로 걷어냅니다
            text = re.sub(r"@font-face\s*\{[^}]*\}\s*", "", text)
            text = (font_face_css() + "\n" if with_fonts else "") + text
        return "<style>\n%s\n</style>" % text

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_sub, html)

    # 2) <script src> → <script>  (소리 data URI 를 맨 앞에 주입)
    scripts = re.findall(r'<script src="([^"]+)"></script>', html)
    inlined = ["<script>\n%s</script>" % sound_map()]
    for src in scripts:
        inlined.append("<script>\n%s\n</script>" % read(ROOT / src.lstrip("./")))
    html = re.sub(r'\s*<script src="[^"]+"></script>', "", html)
    html = html.replace("</body>", "\n".join(inlined) + "\n</body>")

    DIST.mkdir(exist_ok=True)

    if artifact:
        # Artifact 는 <!doctype>/<html>/<head>/<body> 를 스스로 감싸므로 안쪽 내용만 남깁니다.
        title = re.search(r"<title>(.*?)</title>", html, re.S)
        styles = re.findall(r"<style>.*?</style>", html, re.S)
        body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
        parts = ["<title>%s</title>" % (title.group(1) if title else "Mini Workspace")]
        parts += styles
        # body 에 있던 data-route 속성은 스크립트가 다시 세팅하므로 생략 가능
        parts.append('<script>document.body.dataset.route = "home";</script>')
        parts.append(body)
        out = DIST / "artifact.html"
        out.write_text("\n".join(parts), encoding="utf-8")
    else:
        out = DIST / "mini-workspace.html"
        out.write_text(html, encoding="utf-8")

    return out


if __name__ == "__main__":
    artifact = "--artifact" in sys.argv
    with_fonts = "--fonts" in sys.argv
    path = build(artifact, with_fonts)
    size = path.stat().st_size
    print("%s (%.1f MB)" % (path.relative_to(ROOT), size / 1024 / 1024))
