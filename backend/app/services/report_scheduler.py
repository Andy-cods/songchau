"""
Report generation service (M08).

Generates reports (daily KPI, weekly summary, monthly revenue)
as HTML → PDF via WeasyPrint, then optionally emails via Graph API.
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

FILES_BASE = Path("/data/files/reports")


async def generate_report(conn, schedule: dict[str, Any]) -> dict[str, Any]:
    """Generate a report based on schedule configuration.

    Args:
        conn: asyncpg connection
        schedule: Schedule dict with report_type, parameters, recipients, etc.

    Returns:
        Dict with file_path, html content, etc.
    """
    report_type = schedule["report_type"]
    params = schedule.get("parameters", {})

    if report_type == "daily_kpi":
        return await _generate_daily_kpi(conn, params)
    elif report_type == "weekly_summary":
        return await _generate_weekly_summary(conn, params)
    elif report_type == "monthly_revenue":
        return await _generate_monthly_revenue(conn, params)
    else:
        return await _generate_daily_kpi(conn, params)


async def _generate_daily_kpi(conn, params: dict) -> dict[str, Any]:
    """Generate daily KPI report."""
    # Fetch KPI data
    kpi = await conn.fetchrow(
        """
        SELECT
            (SELECT COUNT(*) FROM bqms_rfq WHERE created_at::date = CURRENT_DATE) as new_rfq_today,
            (SELECT COUNT(*) FROM bqms_rfq WHERE result ILIKE '%won%' AND created_at::date = CURRENT_DATE) as won_today,
            (SELECT COUNT(*) FROM quotations WHERE created_at::date = CURRENT_DATE) as quotes_today,
            (SELECT COUNT(*) FROM bqms_rfq WHERE created_at >= NOW() - interval '7 days') as rfq_7days,
            (SELECT COUNT(*) FROM bqms_rfq WHERE result ILIKE '%won%' AND created_at >= NOW() - interval '7 days') as won_7days,
            (SELECT ROUND(
                COUNT(*) FILTER (WHERE result ILIKE '%won%')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE result IS NOT NULL AND result != ''), 0) * 100, 1
            ) FROM bqms_rfq WHERE created_at >= NOW() - interval '30 days') as win_rate_30d
        """
    )

    now = datetime.now()
    html = f"""
    <html>
    <head><meta charset="utf-8"><style>
        body {{ font-family: Arial, sans-serif; padding: 20px; }}
        h1 {{ color: #1e40af; }}
        table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
        th, td {{ border: 1px solid #e2e8f0; padding: 12px; text-align: left; }}
        th {{ background: #f1f5f9; font-weight: 600; }}
        .highlight {{ color: #059669; font-weight: bold; font-size: 1.2em; }}
    </style></head>
    <body>
        <h1>📊 Báo Cáo KPI Hàng Ngày — Song Châu ERP</h1>
        <p>Ngày: {now.strftime('%d/%m/%Y')}</p>

        <table>
            <tr><th>Chỉ số</th><th>Hôm nay</th><th>7 ngày</th><th>30 ngày</th></tr>
            <tr><td>RFQ mới</td><td class="highlight">{kpi['new_rfq_today']}</td><td>{kpi['rfq_7days']}</td><td>—</td></tr>
            <tr><td>Thắng thầu</td><td class="highlight">{kpi['won_today']}</td><td>{kpi['won_7days']}</td><td>—</td></tr>
            <tr><td>Báo giá tạo</td><td>{kpi['quotes_today']}</td><td>—</td><td>—</td></tr>
            <tr><td>Tỷ lệ thắng</td><td>—</td><td>—</td><td>{kpi['win_rate_30d'] or 0}%</td></tr>
        </table>

        <p style="color: #64748b; font-size: 0.85em;">
            Tạo tự động bởi Song Châu ERP • {now.strftime('%H:%M %d/%m/%Y')}
        </p>
    </body>
    </html>
    """

    # Save HTML & convert to PDF
    output_dir = FILES_BASE / now.strftime("%Y/%m")
    output_dir.mkdir(parents=True, exist_ok=True)

    html_path = str(output_dir / f"daily_kpi_{now.strftime('%Y%m%d')}.html")
    pdf_path = str(output_dir / f"daily_kpi_{now.strftime('%Y%m%d')}.pdf")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)

    try:
        from weasyprint import HTML
        HTML(string=html).write_pdf(pdf_path)
    except Exception as exc:
        logger.warning("WeasyPrint PDF failed: %s, using HTML only", exc)
        pdf_path = html_path

    logger.info("Daily KPI report generated: %s", pdf_path)
    return {"file_path": pdf_path, "html": html, "report_type": "daily_kpi"}


async def _generate_weekly_summary(conn, params: dict) -> dict[str, Any]:
    """Generate weekly summary report."""
    data = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('day', created_at)::date as day,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE result ILIKE '%won%') as won,
            COUNT(*) FILTER (WHERE result ILIKE '%lost%' OR result ILIKE '%lose%') as lost
        FROM bqms_rfq
        WHERE created_at >= NOW() - interval '7 days'
        GROUP BY day
        ORDER BY day
        """
    )

    now = datetime.now()
    rows_html = "".join(
        f"<tr><td>{r['day']}</td><td>{r['total']}</td><td>{r['won']}</td><td>{r['lost']}</td></tr>"
        for r in data
    )

    html = f"""
    <html>
    <head><meta charset="utf-8"><style>
        body {{ font-family: Arial, sans-serif; padding: 20px; }}
        h1 {{ color: #1e40af; }}
        table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
        th, td {{ border: 1px solid #e2e8f0; padding: 10px; text-align: left; }}
        th {{ background: #f1f5f9; }}
    </style></head>
    <body>
        <h1>📅 Báo Cáo Tuần — Song Châu ERP</h1>
        <p>Tuần kết thúc: {now.strftime('%d/%m/%Y')}</p>
        <table>
            <tr><th>Ngày</th><th>Tổng RFQ</th><th>Thắng</th><th>Thua</th></tr>
            {rows_html}
        </table>
        <p style="color: #64748b; font-size: 0.85em;">Song Châu ERP • {now.strftime('%H:%M %d/%m/%Y')}</p>
    </body></html>
    """

    output_dir = FILES_BASE / now.strftime("%Y/%m")
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = str(output_dir / f"weekly_{now.strftime('%Y%m%d')}.pdf")

    try:
        from weasyprint import HTML
        HTML(string=html).write_pdf(pdf_path)
    except Exception:
        pdf_path = str(output_dir / f"weekly_{now.strftime('%Y%m%d')}.html")
        with open(pdf_path, "w", encoding="utf-8") as f:
            f.write(html)

    return {"file_path": pdf_path, "html": html, "report_type": "weekly_summary"}


async def _generate_monthly_revenue(conn, params: dict) -> dict[str, Any]:
    """Generate monthly revenue report."""
    data = await conn.fetch(
        """
        SELECT
            maker,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE result ILIKE '%won%') as won,
            ROUND(SUM(COALESCE(quoted_price_bqms_v1, 0))::numeric, 0) as total_quoted
        FROM bqms_rfq
        WHERE created_at >= DATE_TRUNC('month', NOW())
        GROUP BY maker
        ORDER BY total DESC
        LIMIT 20
        """
    )

    now = datetime.now()
    rows_html = "".join(
        f"<tr><td>{r['maker'] or 'N/A'}</td><td>{r['total']}</td><td>{r['won']}</td><td>{r['total_quoted']:,.0f}</td></tr>"
        for r in data
    )

    html = f"""
    <html>
    <head><meta charset="utf-8"><style>
        body {{ font-family: Arial, sans-serif; padding: 20px; }}
        h1 {{ color: #1e40af; }}
        table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
        th, td {{ border: 1px solid #e2e8f0; padding: 10px; text-align: left; }}
        th {{ background: #f1f5f9; }}
    </style></head>
    <body>
        <h1>📈 Báo Cáo Tháng — Song Châu ERP</h1>
        <p>Tháng {now.month}/{now.year}</p>
        <table>
            <tr><th>Maker</th><th>Tổng RFQ</th><th>Thắng</th><th>Tổng báo giá (VND)</th></tr>
            {rows_html}
        </table>
        <p style="color: #64748b; font-size: 0.85em;">Song Châu ERP • {now.strftime('%H:%M %d/%m/%Y')}</p>
    </body></html>
    """

    output_dir = FILES_BASE / now.strftime("%Y/%m")
    output_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = str(output_dir / f"monthly_{now.strftime('%Y%m')}.pdf")

    try:
        from weasyprint import HTML
        HTML(string=html).write_pdf(pdf_path)
    except Exception:
        pdf_path = str(output_dir / f"monthly_{now.strftime('%Y%m')}.html")
        with open(pdf_path, "w", encoding="utf-8") as f:
            f.write(html)

    return {"file_path": pdf_path, "html": html, "report_type": "monthly_revenue"}


async def send_report_email(conn, schedule: dict, report_result: dict) -> bool:
    """Send generated report via email to recipients."""
    import base64
    from app.utils.email_sender import send_email

    recipients = schedule.get("recipients", [])
    if not recipients:
        return False

    # Get recipient emails
    emails = []
    for uid in recipients:
        email = await conn.fetchval("SELECT email FROM users WHERE id = $1::uuid", uid)
        if email:
            emails.append(email)

    if not emails:
        return False

    # Prepare attachment
    attachments = []
    file_path = report_result.get("file_path")
    if file_path:
        try:
            with open(file_path, "rb") as f:
                content = base64.b64encode(f.read()).decode()
            attachments.append({
                "name": Path(file_path).name,
                "content_bytes": content,
            })
        except Exception as exc:
            logger.warning("Failed to attach report file: %s", exc)

    subject = schedule.get("email_subject", f"[Song Châu ERP] {schedule.get('report_name', 'Báo cáo')}")

    return await send_email(
        to_emails=emails,
        subject=subject,
        body_html=report_result.get("html", "<p>Xem file đính kèm</p>"),
        attachments=attachments if attachments else None,
    )
