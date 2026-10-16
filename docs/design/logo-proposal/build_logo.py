from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ROOT = Path(__file__).resolve().parent
NAVY = '#101C35'
VIOLET = '#6653EB'
CAT = '''<path d="M116 204C107 177 108 147 116 120L168 150C199 141 231 142 260 151L309 122C317 149 317 180 305 204C326 227 328 258 312 281C303 294 291 302 276 307L286 372C290 393 276 408 254 408H160C138 408 124 395 128 375L140 305C108 291 88 266 90 242C90 227 100 213 116 204Z"/>
<path d="M268 324C305 325 331 306 334 277L337 218C338 199 351 187 367 188C386 189 397 204 395 222L389 288C383 344 345 382 284 385L254 368Z"/>'''

def mark(navy=NAVY, accent=VIOLET):
    return f'''<circle cx="256" cy="256" r="224" fill="{navy}"/>
<g fill="#fff">{CAT}</g>
<g fill="none" stroke="{navy}" stroke-width="10" stroke-linecap="round">
<path d="M146 244Q160 232 174 244M226 244Q240 232 254 244"/>
<path d="M350 237Q366 246 382 237"/>
</g>
<circle cx="206" cy="356" r="28" fill="{accent}"/>
<rect x="196" y="346" width="20" height="20" rx="2" fill="#fff"/>'''

def svg(body, width=512, height=512, label='招财猫银行标志'):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{label}">
<title>{label}</title>
{body}
</svg>'''

for filename, body in [('maneki-mark.svg', mark()), ('maneki-mark-mono.svg', mark('#111111', '#111111'))]:
    (ROOT / filename).write_text(svg(body), encoding='utf-8')

def outlined_text(text, path, x, baseline, size, tracking, font_number=-1):
    ft = TTFont(path, fontNumber=font_number)
    glyphs, cmap = ft.getGlyphSet(), ft.getBestCmap()
    scale = size / ft['head'].unitsPerEm
    output = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        output.append(f'<path d="{pen.getCommands()}" transform="translate({x:.3f} {baseline}) scale({scale:.8f} {-scale:.8f})"/>')
        x += ft['hmtx'][name][0] * scale + tracking
    return f'<g fill="{NAVY}">' + ''.join(output) + '</g>'

wordmark = mark() + outlined_text('招财猫银行', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 556, 252, 110, 3, 2)
wordmark += outlined_text('MANEKI BANK', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 560, 332, 37, 8)
(ROOT / 'maneki-wordmark.svg').write_text(svg(wordmark, 1240, 512, '招财猫银行横版标志'), encoding='utf-8')

for name in ['maneki-mark', 'maneki-mark-mono', 'maneki-wordmark']:
    subprocess.run(['rsvg-convert', str(ROOT / f'{name}.svg'), '-o', str(ROOT / f'{name}.png')], check=True)

font_path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
bold_path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
font = lambda n, bold=False: ImageFont.truetype(bold_path if bold else font_path, n)
board = Image.new('RGB', (1500, 1000), '#F7F7F4')
draw = ImageDraw.Draw(board)
draw.text((72, 56), '招财猫银行', font=font(44, True), fill=NAVY)
draw.text((74, 120), '圆形剪影 · 招财爪 · 方孔钱币', font=font(22), fill='#687083')
mark_image = Image.open(ROOT / 'maneki-mark.png').convert('RGBA')
board.paste(mark_image, (84, 200), mark_image)
draw.line((650, 216, 650, 704), fill='#DDDFE5', width=2)
draw.text((738, 224), '一眼认出猫，也认出招财', font=font(30, True), fill=NAVY)
draw.text((740, 283), '闭眼微笑，举爪迎福。', font=font(23), fill='#687083')
draw.text((740, 323), '圆形徽章适合头像与应用图标。', font=font(23), fill='#687083')
mono = Image.open(ROOT / 'maneki-mark-mono.png').convert('RGBA').resize((176, 176), Image.Resampling.LANCZOS)
board.paste(mono, (740, 408), mono)
draw.text((936, 462), '单色版本', font=font(23), fill=NAVY)
draw.text((740, 636), '小尺寸预览', font=font(19), fill='#687083')
x = 740
for size in [24, 32, 48, 64]:
    small = mark_image.resize((size, size), Image.Resampling.LANCZOS)
    board.paste(small, (x, 687-size), small)
    draw.text((x, 704), f'{size}px', font=font(14), fill='#687083')
    x += 126
draw.line((72, 782, 1428, 782), fill='#DDDFE5', width=2)
word = Image.open(ROOT / 'maneki-wordmark.png').convert('RGBA')
word.thumbnail((665, 190), Image.Resampling.LANCZOS)
board.paste(word, (74, 810), word)
draw.text((1030, 854), 'SVG 矢量源文件', font=font(22), fill=NAVY)
draw.text((1030, 893), '透明底 · 可缩放 · 可导入 OD', font=font(17), fill='#687083')
board.save(ROOT / 'logo-preview.png')
print(ROOT / 'logo-preview.png')
