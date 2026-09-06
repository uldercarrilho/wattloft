from __future__ import annotations

import os

import uvicorn

from wattloft.api import create_app
from wattloft.history import ensure_history


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    ensure_history(database_url)
    host = os.environ.get("WATTLOFT_API_HOST", "127.0.0.1")
    port = int(os.environ.get("WATTLOFT_API_PORT", "8000"))
    ingest_host = os.environ.get("INGEST_HOST", "0.0.0.0")
    ingest_port = int(os.environ.get("INGEST_PORT", "10000"))
    uvicorn.run(
        create_app(
            database_url,
            ingest_host=ingest_host,
            ingest_port=ingest_port,
        ),
        host=host,
        port=port,
    )


if __name__ == "__main__":
    main()
