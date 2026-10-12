"""Search local electoral-roll PDFs with explicit coverage reporting."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata

import pymupdf

MARKS = re.compile('[\u093e-\u094d\u0900-\u0903\u093c\u0951-\u0957]')


def normalize(text, mode):
    text = unicodedata.normalize('NFC', text).replace('\u200c', '').replace('\u200d', '')
    return MARKS.sub('', text) if mode == 'skeleton' else text


def extract(pdf, cache_dir=None, ocr=False):
    # Content hashes invalidate the cache when a PDF changes in place.
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
    key = hashlib.sha256(f'{digest}:{pymupdf.VersionBind}:{ocr}:hin+eng:v1'.encode()).hexdigest()
    cached = cache_dir / f'{key}.json' if cache_dir else None
    if cached and cached.exists():
        try:
            data = json.loads(cached.read_text(encoding='utf-8'))
            if isinstance(data, list) and all(isinstance(page, dict) and isinstance(page.get('lines'), list) and all(isinstance(line, str) for line in page['lines']) and isinstance(page.get('ocr'), bool) for page in data):
                return data
        except (ValueError, OSError):
            pass
    pages = []
    with pymupdf.open(pdf) as doc:
        for page in doc:
            text = page.get_text(sort=True)
            used_ocr = False
            if not text.strip() and ocr:
                text = page.get_text(textpage=page.get_textpage_ocr(language='hin+eng', full=True), sort=True)
                used_ocr = True
            pages.append({'lines': text.splitlines(), 'ocr': used_ocr})
    if cached:
        cache_dir.mkdir(parents=True, exist_ok=True)
        temporary = cached.with_suffix('.partial')
        temporary.write_text(json.dumps(pages, ensure_ascii=False), encoding='utf-8')
        temporary.replace(cached)
    return pages


def search(directory, queries, mode='exact', cache_dir=None, ocr=False, context=0):
    needles = [(query, normalize(query, mode)) for query in queries]
    if any(not needle.strip() for _, needle in needles):
        raise ValueError('Queries must contain searchable characters')
    files = sorted(directory.rglob('*.pdf'))
    if not files:
        raise ValueError(f'No PDFs found in {directory}')
    report = {'mode': mode, 'queries': queries, 'files_found': len(files), 'files_searched': 0, 'pages_searched': 0, 'pages_without_text': [], 'ocr_pages': 0, 'errors': [], 'matches': []}
    for pdf in files:
        try:
            pages = extract(pdf, cache_dir, ocr)
        except Exception as error:
            report['errors'].append({'file': str(pdf), 'error': str(error)})
            continue
        report['files_searched'] += 1
        for number, page in enumerate(pages, 1):
            lines = page['lines']
            if not any(line.strip() for line in lines):
                report['pages_without_text'].append({'file': str(pdf), 'page': number})
                continue
            report['pages_searched'] += 1
            report['ocr_pages'] += int(page['ocr'])
            for index, line in enumerate(lines):
                normalized = normalize(line, mode)
                for query, needle in needles:
                    if needle in normalized:
                        report['matches'].append({'file': str(pdf), 'page': number, 'line': index + 1, 'query': query, 'match_type': mode, 'text': line, 'context': '\n'.join(lines[max(0, index-context):index+context+1])})
    report['complete'] = not report['errors'] and not report['pages_without_text']
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--query', action='append', required=True, help='Literal name or text; repeat for multiple queries')
    parser.add_argument('--mode', choices=['exact', 'skeleton'], default='exact')
    parser.add_argument('--output', type=Path, default=Path('results/search.json'))
    parser.add_argument('--csv', type=Path, help='Optional CSV export of matches')
    parser.add_argument('--cache-dir', type=Path, default=Path('.cache/text'))
    parser.add_argument('--no-cache', action='store_true')
    parser.add_argument('--ocr', action='store_true', help='OCR pages without text; requires Tesseract with Hindi and English data')
    parser.add_argument('--context', type=int, default=0, help='Adjacent lines for review, not proof of a shared voter entry')
    args = parser.parse_args(argv)
    if args.context < 0 or args.context > 20:
        parser.error('--context must be between 0 and 20')
    if not args.directory.is_dir():
        parser.error('directory does not exist')
    try:
        report = search(args.directory, args.query, args.mode, None if args.no_cache else args.cache_dir, args.ocr, args.context)
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if args.csv:
        args.csv.parent.mkdir(parents=True, exist_ok=True)
        with args.csv.open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=['file', 'page', 'line', 'query', 'match_type', 'text', 'context'])
            writer.writeheader()
            # Prevent spreadsheet formula execution from PDF-derived text.
            writer.writerows({key: "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value for key, value in match.items()} for match in report['matches'])
    print(f"Matches: {len(report['matches'])}; files searched: {report['files_searched']}/{report['files_found']}; pages searched: {report['pages_searched']}; pages without text: {len(report['pages_without_text'])}; errors: {len(report['errors'])}")
    print(f'Report: {args.output}')
    return 0 if report['complete'] else 1


if __name__ == '__main__':
    sys.exit(main())
