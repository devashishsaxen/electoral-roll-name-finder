import tempfile
import unittest
from pathlib import Path
import pymupdf
from search_rolls import normalize, search


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def pdf(self, name, text=None):
        with pymupdf.open() as document:
            page = document.new_page()
            if text:
                page.insert_text((30, 30), text)
            document.save(self.directory / name)

    def test_coverage_distinguishes_errors_and_blank_pages(self):
        self.pdf('text.pdf', 'Example Name')
        self.pdf('blank.pdf')
        (self.directory / 'broken.pdf').write_bytes(b'not a pdf')
        report = search(self.directory, ['Example'])
        self.assertEqual(report['files_searched'], 2)
        self.assertEqual(len(report['errors']), 1)
        self.assertEqual(len(report['pages_without_text']), 1)
        self.assertEqual(len(report['matches']), 1)
        self.assertFalse(report['complete'])

    def test_long_lines_are_searchable_and_no_sample_cap(self):
        self.pdf('long.pdf', 'Example ' + 'x' * 65)
        report = search(self.directory, ['Example'])
        self.assertEqual(len(report['matches']), 1)
        self.assertTrue(report['complete'])

    def test_cache_invalidates_when_file_changes(self):
        cache = self.directory / 'cache'
        self.pdf('text.pdf', 'First')
        self.assertEqual(len(search(self.directory, ['First'], cache_dir=cache)['matches']), 1)
        (self.directory / 'text.pdf').unlink()
        self.pdf('text.pdf', 'Second')
        self.assertEqual(len(search(self.directory, ['First'], cache_dir=cache)['matches']), 0)
        self.assertEqual(len(search(self.directory, ['Second'], cache_dir=cache)['matches']), 1)

    def test_skeleton_and_joiner_normalization(self):
        self.assertEqual(normalize('कमल', 'skeleton'), normalize('कमल्ाा', 'skeleton'))
        self.assertEqual(normalize('ab\u200dcd', 'exact'), 'abcd')
        with self.assertRaises(ValueError):
            search(self.directory, ['ा'], mode='skeleton')

    def test_missing_files_is_an_error(self):
        with self.assertRaises(ValueError):
            search(self.directory, ['Example'])


if __name__ == '__main__':
    unittest.main()
