"""Compatibility entry point; queries must be supplied with --query."""
import sys
from search_rolls import main

if __name__ == '__main__':
    sys.exit(main(['--mode', 'exact', '--context', '4', *sys.argv[1:]]))
