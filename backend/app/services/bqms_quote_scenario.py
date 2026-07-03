"""Classify each bqms_rfq row into 1 of 3 quote scenarios.

  TH1 — Mã hoàn toàn mới: chưa từng xuất hiện trong DB ERP, chưa có V1.
        Workflow: user báo V1 trong ERP từ đầu.

  TH2 — Mã chưa trong DB ERP nhưng Samsung đã ở round ≥2:
        Hiểu là nhân viên cũ đã báo V1 TRỰC TIẾP trên Samsung (không qua ERP).
        ERP không backfill, không import Excel. User báo giá mới trong ERP
        → tính là V1 ERP (Samsung-perspective: round 2/3).
        Form mở mặc định round V2 (theo Samsung side).

  TH3 — Mã đã có trong DB ERP, đã từng báo V1 chính thức qua ERP:
        Workflow tiếp tục V2/V3/V4. Có lịch sử để tham khảo.

Policy quyết định 2026-05-18 (Thang):
  - KHÔNG auto-backfill V1 từ portal hay Excel cho TH2
  - ERP là source-of-truth mới — chỉ tin V1 nhập trực tiếp qua ERP
  - UI badge phân biệt 3 cases để user biết
"""
from __future__ import annotations

from typing import Literal

Scenario = Literal["TH1", "TH2", "TH3"]


def classify(
    *,
    quoted_price_bqms_v1,
    quoted_price_bqms_v2,
    version,
    data_source: str | None,
    samsung_round: int | None = None,
) -> Scenario:
    """Classify a single RFQ row into TH1/TH2/TH3.

    Args:
      quoted_price_bqms_v1: bqms_rfq.quoted_price_bqms_v1 (Numeric or None)
      quoted_price_bqms_v2: bqms_rfq.quoted_price_bqms_v2 (used to disambiguate)
      version: bqms_rfq.version (1, 2, 3, 4 — Samsung-side round)
      data_source: bqms_rfq.data_source ('manual'/'excel_import'/'etl'/'api_sync')
      samsung_round: Samsung portal current round (from staging.raw_json).
                     If unknown, falls back to `version`.

    Returns: 'TH1' | 'TH2' | 'TH3'
    """
    has_erp_v1 = quoted_price_bqms_v1 is not None
    samsung_round = samsung_round or version or 1

    # TH3 — DB has V1 (any source), regardless of Samsung round
    if has_erp_v1:
        return "TH3"

    # TH2 — DB has NO V1, but Samsung is at round 2+ (old employee quoted directly)
    if samsung_round >= 2:
        return "TH2"

    # TH1 — DB has NO V1 AND Samsung is round 1 (truly brand new)
    return "TH1"


def scenario_default_round(scenario: Scenario, samsung_round: int = 1) -> int:
    """Recommended starting round for quote wizard form when user clicks "Báo giá".

      TH1 → V1 (ERP báo lần đầu)
      TH2 → V2 (Samsung-perspective: đã ở round 2 do NV cũ báo V1)
            Note: ERP sẽ lưu giá user nhập vào quoted_price_bqms_v2.
            quoted_price_bqms_v1 vẫn NULL (vì không có data trong ERP).
      TH3 → max(samsung_round, ERP_round + 1)
    """
    if scenario == "TH1":
        return 1
    if scenario == "TH2":
        return max(2, samsung_round)
    # TH3: tiếp tục round tiếp theo Samsung mời
    return max(2, samsung_round)


def pushable_round(v1, v2, v3, v4) -> int:
    """Return the HIGHEST round N where quoted_price_bqms_v{N} IS NOT NULL.

    This is the round the user MOST LIKELY wants to push next — they
    just generated it. Independent of TH1/TH2/TH3 (those drive the
    *create* form default, not the *push* button).

    Returns 1 as a defensive fallback when all rounds are NULL — but in
    that case the push button shouldn't even be visible (frontend checks
    `quoted_price_bqms_v1..v4` for null before rendering it).

    Examples:
      user just generated V1 (v1=80000, v2..v4=NULL)  → 1  (was BUG: returned 2)
      user generated V1 then V2 (v1=80000, v2=75000)  → 2
      TH2 first ERP round (v1=NULL, v2=70000)          → 2  (correct — TH2 stores in V2)
      TH2 second ERP round (v1=NULL, v2=70000, v3=68k) → 3
    """
    if v4 is not None:
        return 4
    if v3 is not None:
        return 3
    if v2 is not None:
        return 2
    if v1 is not None:
        return 1
    return 1


def scenario_meta(scenario: Scenario) -> dict:
    """UI metadata for badges + tooltips."""
    return {
        "TH1": {
            "label": "🆕 Mới",
            "tooltip": "Mã hoàn toàn mới — chưa từng có lịch sử báo giá. Báo V1 từ đầu.",
            "badge_color": "emerald",
            "wizard_intro": "Mã này lần đầu trong hệ thống. Báo giá V1.",
        },
        "TH2": {
            "label": "⚠ V1 cũ Samsung",
            "tooltip": (
                "V1 đã báo trực tiếp trên Samsung bởi nhân viên cũ "
                "(không có trong ERP). Báo giá V2 mới trong ERP — "
                "Samsung-perspective: đang ở round 2."
            ),
            "badge_color": "amber",
            "wizard_intro": (
                "Samsung đã mời round 2 cho mã này. Trước đó V1 báo trực tiếp "
                "trên Samsung (không qua ERP). Báo giá V2 mới hoàn toàn ở đây."
            ),
        },
        "TH3": {
            "label": "↻ Có lịch sử",
            "tooltip": "Đã có V1 trong ERP. Báo tiếp V2/V3/V4 với gợi ý từ lịch sử.",
            "badge_color": "violet",
            "wizard_intro": "Có lịch sử V1 trong ERP. Báo giá vòng tiếp theo.",
        },
    }[scenario]
