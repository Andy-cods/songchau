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

from app.tasks import bqms_sync       # noqa: F401 — registers bqms_nightly_sync
from app.tasks import reports         # noqa: F401 — registers generate_daily_reports
from app.tasks import notifications   # noqa: F401 — registers send_email_notification, check_deadline_reminders
from app.tasks import onedrive_sync   # noqa: F401 — registers onedrive_delta_sync (mỗi 4 giờ)
from app.tasks import report_generation  # noqa: F401 — registers generate_scheduled_reports (daily 07:00)
from app.tasks import smart_classify     # noqa: F401 — registers batch_classify_rfq
from app.tasks import file_index_crawler # noqa: F401 — registers file_index_crawl (mỗi 6 giờ)
