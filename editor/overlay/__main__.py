"""`python3 -m editor.overlay ...` (same as `python3 -m editor overlay ...`)."""
import sys

from ..util import EditorError, log
from . import main

try:
    sys.exit(main(sys.argv[1:]))
except EditorError as e:
    log(f"ERROR: {e}")
    sys.exit(1)
