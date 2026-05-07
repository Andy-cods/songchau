"""pytest configuration for E2E tests."""
import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "e2e: end-to-end tests requiring a live backend (set ERP_BASE_URL to enable).",
    )


def pytest_collection_modifyitems(config, items):
    """Skip e2e tests unless explicitly enabled with -m e2e or RUN_E2E=1."""
    import os
    if os.getenv("RUN_E2E") or any("e2e" in str(m) for m in config.option.markexpr.split() if config.option.markexpr):
        return
    skip = pytest.mark.skip(reason="e2e tests skipped (set RUN_E2E=1 or run pytest -m e2e)")
    for it in items:
        if "e2e" in it.keywords:
            it.add_marker(skip)
