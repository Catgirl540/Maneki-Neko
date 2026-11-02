"""Render the security report from Markdown; requires pandoc and weasyprint."""
from pathlib import Path
import html,re,subprocess,tempfile
base=Path(__file__).resolve().parent
source=base.parent/'安全自评报告.md'
text=source.read_text(encoding='utf-8')
text=text[text.index('# 1 '):]
entries=[]
def heading(match):
    level=len(match[1]);title=match[2];anchor=f'security-section-{len(entries)}'
    entries.append((level,title,anchor))
    return match[1]+' '+title+' {#'+anchor+'}'
text=re.sub(r'^(#{1,3}) (.+)$',heading,text,flags=re.M)
with tempfile.TemporaryDirectory(prefix='maneki-security-pdf-') as directory:
    work=Path(directory)
    (work/'body.md').write_text(text,encoding='utf-8')
    subprocess.run(['pandoc',str(work/'body.md'),'-f','markdown+header_attributes','-t','html5','-o',str(work/'body.html')],check=True)
    toc=''.join(f'<li class="level-{level}"><a href="#{anchor}">{html.escape(title)}</a></li>' for level,title,anchor in entries if level<=2)
    page=f'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>招财猫 Bank 安全自评报告</title><link rel="stylesheet" href="{(base/"report.css").as_uri()}"><body><section class="cover"><h1>安全自评报告</h1></section><section class="toc"><h1>目　录</h1><ul>{toc}</ul></section><main class="content">{(work/"body.html").read_text()}</main></body></html>'
    (work/'report.html').write_text(page,encoding='utf-8')
    subprocess.run(['weasyprint',str(work/'report.html'),str(base.parent/'安全自评报告.pdf')],check=True)
