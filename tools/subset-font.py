"""見出し用フォント（M PLUS Rounded 1c ExtraBold）を、使っている文字だけに絞って作り直す。

画面やページの文言を変えて、見出し・数字・ロゴまわりに新しい漢字が増えたら実行する。
（足りない文字は本文の書体で表示されるので壊れはしないが、見た目が混ざる）

  python tools/subset-font.py <MPLUSRounded1c-ExtraBold.ttf>

元の TTF はリポジトリに入れない（約3.6MB）。次から取得する（SIL Open Font License 1.1）:
  https://github.com/google/fonts/tree/main/ofl/mplusrounded1c
必要なもの: pip install fonttools brotli
出力: public/fonts/yukyu-rounded-800.woff2（ライセンスは同じフォルダの OFL.txt）
"""

import pathlib
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'fonts' / 'yukyu-rounded-800.woff2'
SOURCES = [
    *ROOT.glob('src/**/*.ts'),
    *ROOT.glob('src/**/*.tsx'),
    ROOT / 'index.html',
    *ROOT.glob('public/*.html'),
]


def collect() -> str:
    chars = set(chr(c) for c in range(0x20, 0x7F))  # 英数字・記号
    chars |= set(chr(c) for c in range(0x3041, 0x3097))  # ひらがな
    chars |= set(chr(c) for c in range(0x30A1, 0x30FD))  # カタカナ（長音符を含む）
    chars |= set(chr(c) for c in range(0xFF01, 0xFF5F))  # 全角英数・記号
    chars |= set('、。・「」『』（）〜…ー—→○◯¥×　')
    for p in SOURCES:
        if not p.is_file() or p.name.endswith('.test.ts'):
            continue
        for ch in p.read_text(encoding='utf-8'):
            if ord(ch) >= 0x3000:  # 和文（漢字・かな・全角記号）だけ拾う
                chars.add(ch)
    return ''.join(sorted(chars))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    text = collect()
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['palt', 'kern', 'liga']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    font = subset.load_font(sys.argv[1], opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    subset.save_font(font, str(OUT), opts)
    print(f'{len(text)} 文字 → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
