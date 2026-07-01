from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg

from .config import settings


def psycopg_url() -> str:
    return settings.database_url.replace("postgresql+psycopg://", "postgresql://")


@contextmanager
def db_connection() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(psycopg_url())
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
