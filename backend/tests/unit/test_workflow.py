"""Unit tests for workflow state machine."""
import pytest
from app.services.workflow_engine import (
    WFState,
    WFAction,
    TRANSITIONS,
    APPROVAL_THRESHOLD,
    resolve_next_state,
)


def test_submit_from_draft():
    assert TRANSITIONS.get((WFState.DRAFT, WFAction.SUBMIT)) == WFState.PENDING_L1


def test_approve_from_pending_l1_is_dynamic():
    """APPROVE from pending_l1 is resolved at RUNTIME by amount, not statically.

    By design (workflow_engine.py TRANSITIONS line 54) the static entry is the
    sentinel ``None`` — approving an L1 item goes to APPROVED when the amount is
    below the threshold, or escalates to PENDING_L2 when it is at/above it. A
    static ``== APPROVED`` mapping (the old assertion) would silently break the
    >= 50M escalation path, so the correct behaviour is asserted via
    ``resolve_next_state``.
    """
    assert TRANSITIONS.get((WFState.PENDING_L1, WFAction.APPROVE)) is None
    assert (
        resolve_next_state(WFState.PENDING_L1, WFAction.APPROVE, APPROVAL_THRESHOLD - 1)
        == WFState.APPROVED
    )


def test_reject_from_pending_l1():
    assert TRANSITIONS.get((WFState.PENDING_L1, WFAction.REJECT)) == WFState.REJECTED


def test_escalate_from_pending_l1_via_high_amount():
    """Escalation L1 → L2 is NOT a separate ESCALATE transition.

    The engine has no ``(PENDING_L1, ESCALATE)`` entry (WFAction.ESCALATE is
    vestigial — no code path emits it). Escalation happens when a pending_l1
    APPROVE lands on an amount at/above APPROVAL_THRESHOLD, resolved at runtime.
    """
    assert TRANSITIONS.get((WFState.PENDING_L1, WFAction.ESCALATE)) is None
    assert (
        resolve_next_state(WFState.PENDING_L1, WFAction.APPROVE, APPROVAL_THRESHOLD)
        == WFState.PENDING_L2
    )


def test_approve_from_pending_l2():
    assert TRANSITIONS.get((WFState.PENDING_L2, WFAction.APPROVE)) == WFState.APPROVED


def test_cancel_from_draft():
    result = TRANSITIONS.get((WFState.DRAFT, WFAction.CANCEL))
    # Cancel may not be defined for draft
    assert result is None or result == WFState.CLOSED


def test_invalid_transition():
    assert TRANSITIONS.get((WFState.APPROVED, WFAction.APPROVE)) is None


def test_approval_threshold():
    assert APPROVAL_THRESHOLD == 50_000_000
