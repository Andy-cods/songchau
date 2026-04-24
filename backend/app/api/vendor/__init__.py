"""Vendor Portal API — separate routes for supplier access."""

from fastapi import APIRouter

from app.api.vendor.auth import router as auth_router
from app.api.vendor.batches import router as batches_router
from app.api.vendor.quotes import router as quotes_router
from app.api.vendor.profile import router as profile_router

vendor_router = APIRouter()

vendor_router.include_router(auth_router, prefix="/auth", tags=["Vendor Auth"])
vendor_router.include_router(batches_router, prefix="/batches", tags=["Vendor Batches"])
vendor_router.include_router(quotes_router, prefix="/quotes", tags=["Vendor Quotes"])
vendor_router.include_router(profile_router, prefix="/profile", tags=["Vendor Profile"])
