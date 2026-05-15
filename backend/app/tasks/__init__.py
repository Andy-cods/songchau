"""
Tasks package — Procrastinate discovers all tasks by importing this package.

The `import_paths=["app.tasks"]` entry in app/core/procrastinate_app.py
causes Procrastinate to import this __init__.py when the worker starts,
which in turn imports every task module so their @app.task decorators run
and register the tasks with the Procrastinate app instance.

To add new task modules:
    1. Create  app/tasks/my_module.py  with @app.task functions.
    2. Add     from app.tasks import my_module  below.
"""

# Temporarily disabled per user request 2026-05-04: Samsung BQMS portal scrape
# (Playwright login + selectPOAcceptList.do XHR). The Excel-driven auto-import
# below is now the source of truth for bqms_rfq + bqms_deliveries.
# To re-enable, uncomment the line below.
# from app.tasks import bqms_sync       # noqa: F401 — registers bqms_nightly_sync
from app.tasks import reports         # noqa: F401 — registers generate_daily_reports
from app.tasks import notifications   # noqa: F401 — registers send_email_notification, check_deadline_reminders
from app.tasks import onedrive_sync   # noqa: F401 — registers onedrive_delta_sync (mỗi 4 giờ)
from app.tasks import report_generation  # noqa: F401 — registers generate_scheduled_reports (daily 07:00)
from app.tasks import smart_classify     # noqa: F401 — registers batch_classify_rfq
from app.tasks import file_index_crawler # noqa: F401 — registers file_index_crawl (mỗi 6 giờ)
from app.tasks import local_filesystem_index  # noqa: F401 — registers local_filesystem_index (mỗi 15 phút)
from app.tasks import imv_sync           # noqa: F401 — registers imv_nightly_sync
from app.tasks import bqms_excel_auto_import  # noqa: F401 — registers bqms_excel_auto_import (mỗi 2 phút)
from app.tasks import kpi_aggregator     # noqa: F401 — M40, registers aggregate_monthly_kpi (cron 02:00 ICT day-1)
from app.tasks import bqms_quote_batch   # noqa: F401 — registers bqms_quote_one_rfq (Option B background queue)
from app.tasks import bqms_periodic_scrape  # noqa: F401 — registers bqms_periodic_scrape (mỗi 30 phút, bidding+contract+MRO)
from app.tasks import bqms_auto_submit      # noqa: F401 — registers bqms_submit_quote (queue=bqms_push, concurrency=1)
