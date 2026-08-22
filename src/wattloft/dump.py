from __future__ import annotations

import os
import sys

from wattloft.history import dump_history


def main() -> None:
    sys.stdout.write(dump_history(os.environ["DATABASE_URL"]))


if __name__ == "__main__":
    main()
