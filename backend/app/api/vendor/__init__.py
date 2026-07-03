"""Vendor Portal API — separate routes for supplier access."""

from fastapi import APIRouter

from app.api.vendor.auth import router as auth_router
from app.api.vendor.batches import router as batches_router
from app.api.vendor.quotes import router as quotes_router
from app.api.vendor.profile import router as profile_router
from app.api.vendor.contracts import router as contracts_router
from app.api.vendor.pos import router as pos_router
from app.api.vendor.pos import deliveries_router as deliveries_router
from app.api.vendor.notifications import router as notifications_router
from app.api.vendor.scorecard import router as scorecard_router
from app.api.vendor.rank import router as rank_router
from app.api.vendor.messages import router as messages_router

vendor_router = APIRouter()

vendor_router.include_router(auth_router, prefix="/auth", tags=["Vendor Auth"])
vendor_router.include_router(batches_router, prefix="/batches", tags=["Vendor Batches"])
vendor_router.include_router(quotes_router, prefix="/quotes", tags=["Vendor Quotes"])
vendor_router.include_router(profile_router, prefix="/profile", tags=["Vendor Profile"])
vendor_router.include_router(contracts_router, prefix="/contracts", tags=["Vendor Contracts"])
vendor_router.include_router(pos_router, prefix="/pos", tags=["Vendor POs"])
vendor_router.include_router(deliveries_router, prefix="/deliveries", tags=["Vendor POs"])
vendor_router.include_router(notifications_router, prefix="/notifications", tags=["Vendor Notifications"])
vendor_router.include_router(scorecard_router, prefix="/scorecard", tags=["Vendor Scorecard"])
# #15 rank-hint: path = /api/vendor/quotes/batches/{id}/rank-hint (band-mờ, default OFF → 404).
vendor_router.include_router(rank_router, prefix="/quotes", tags=["Vendor Quotes"])
# Đợt 2a #12 Q&A: path = /api/vendor/rfq/{batch_id}/messages (thread riêng + addendum).
vendor_router.include_router(messages_router, prefix="/rfq", tags=["Vendor Q&A"])
