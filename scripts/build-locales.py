"""Build extension/_locales/<lang>/messages.json from translations/<lang>.json.

translations/<lang>.json is a flat {key: message} map. Placeholders and key
order come from the English file, so translators only touch the text.

    python scripts/build-locales.py          # build all
    python scripts/build-locales.py --check  # validate only
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES = ROOT / 'extension' / '_locales'
SOURCES = ROOT / 'translations'
TOKEN = re.compile(r'\$[A-Z]+\$')
LIMITS = {'appName': 75, 'appDescription': 132, 'appShortName': 12}


def problems(lang, en, tr):
    out = []
    missing = [k for k in en if k not in tr]
    extra = [k for k in tr if k not in en]
    if missing:
        out.append(f'missing keys: {missing}')
    if extra:
        out.append(f'unknown keys: {extra}')
    for key, entry in en.items():
        text = tr.get(key, '')
        source = entry['message']
        if not text.strip():
            out.append(f'{key}: empty')
            continue
        if sorted(TOKEN.findall(source)) != sorted(TOKEN.findall(text)):
            out.append(f'{key}: placeholders differ')
        if source.count('<strong>') != text.count('<strong>') or text.count('<strong>') != text.count('</strong>'):
            out.append(f'{key}: <strong> tags differ')
        if source.count('\n') != text.count('\n'):
            out.append(f'{key}: line breaks differ')
        if '—' in text:
            out.append(f'{key}: long dash')
        if key in LIMITS and len(text) > LIMITS[key]:
            out.append(f'{key}: {len(text)} chars, limit {LIMITS[key]}')
    return out


def render(en, tr):
    lines = []
    for key, entry in en.items():
        message = json.dumps(tr[key], ensure_ascii=False)
        if 'placeholders' in entry:
            ph = json.dumps(entry['placeholders'], ensure_ascii=False)
            lines.append(f'  "{key}": {{\n    "message": {message},\n    "placeholders": {ph}\n  }}')
        else:
            lines.append(f'  "{key}": {{ "message": {message} }}')
    return '{\n' + ',\n'.join(lines) + '\n}\n'


def main():
    check_only = '--check' in sys.argv
    en = json.loads((LOCALES / 'en' / 'messages.json').read_text(encoding='utf-8'))
    failed = False
    for src in sorted(SOURCES.glob('*.json')):
        lang = src.stem
        tr = json.loads(src.read_text(encoding='utf-8'))
        issues = problems(lang, en, tr)
        if issues:
            failed = True
            print(f'{lang}:')
            for issue in issues:
                print(f'  {issue}')
            continue
        if not check_only:
            out = LOCALES / lang / 'messages.json'
            out.parent.mkdir(exist_ok=True)
            out.write_text(render(en, tr), encoding='utf-8', newline='\n')
        print(f'{lang}: ok')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
