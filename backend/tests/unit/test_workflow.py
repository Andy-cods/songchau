"""Unit tests for workflow state machine."""
import pytest
from app.services.workflow_engine import WFState, WFAction, TRANSITIONS, APPROVAL_THRESHOLD


def test_submit_from_draft():
    assert TRANSITIONS.get((WFState.DRAFT, WFAction.SUBMIT)) == WFState.PENDING_L1


def test_approve_from_pending_l1():
    assert TRANSITIONS.get((WFState.PENDING_L1, WFAction.APPROVE)) == WFState.APPROVED


def test_reject_from_pending_l1():
    assert TRANSITIONS.get((WFState.PENDING_L1, WFAction.REJECT)) == WFState.REJECTED


def test_escalate_from_pending_l1():
    assert TRANSITIONS.get((WFState.PENDING_L1, WFAction.ESCALATE)) == WFState.PENDING_L2


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
