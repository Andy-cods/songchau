"""
PWA Settings & i18n Config — Phase 8
Provides version info, supported locales, and PWA configuration.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/config")
async def get_pwa_config():
    """Return PWA configuration including supported locales."""
    return {
        "data": {
            "version": "1.0.0",
            "default_locale": "vi",
            "supported_locales": ["vi", "en"],
            "locale_labels": {
                "vi": "Tiếng Việt",
                "en": "English",
            },
            "app_name": "Song Châu ERP",
            "app_short_name": "SC ERP",
            "theme_color": "#1e40af",
            "background_color": "#f1f5f9",
        }
    }
