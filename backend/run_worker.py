"""
Run Procrastinate worker using sync API (Psycopg2Connector).

Procrastinate 2.14+ CLI requires async connector, but we use Psycopg2Connector
(sync) for compatibility with psycopg2-based task code. This script runs the
worker using the sync Python API instead of the CLI.
"""

import logging

logging.basicConfig(level=logging.INFO)

from app.core.procrastinate_app import app

if __name__ == "__main__":
    app.run_worker(concurrency=5)
