from pydantic import model_validator
from pydantic_settings import BaseSettings

# W4-04 — fail-fast: nếu ai đó copy backend/.env.example -> .env mà quên đổi
# secret thật, giá trị mẫu luôn chứa chuỗi này (vd "change-me-to-a-random-
# 64-char-string"). Dùng làm "vân tay" để chặn production khởi động với secret
# vẫn còn là placeholder chưa đổi. Xem backend/.env.example.
_PLACEHOLDER_MARKER = "change-me"


def _looks_like_placeholder(value: str) -> bool:
    return _PLACEHOLDER_MARKER in value.lower()


class Settings(BaseSettings):
    # Database
    POSTGRES_DB: str = "songchau_erp"
    POSTGRES_USER: str = "scadmin"
    POSTGRES_PASSWORD: str = ""
    DATABASE_URL: str = ""
    DB_POOL_MIN: int = 5
    DB_POOL_MAX: int = 20
    DB_ENCRYPTION_KEY: str = ""

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # Auth
    JWT_SECRET_KEY: str = ""
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 300
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # refresh_token cookie Secure flag. Default True (production, HTTPS).
    # Set False in local .env to test over plain HTTP.
    COOKIE_SECURE: bool = True

    # App
    APP_ENV: str = "production"
    APP_URL: str = ""
    # V-03: URL cổng NCC (link kích hoạt/reset/hợp đồng ERP sinh cho NCC). PHẢI
    # khai báo ở đây — pydantic-settings IGNORE env var không khai báo, nên
    # thiếu field này thì set VENDOR_PORTAL_URL trong .env sẽ vô tác dụng. Rỗng
    # (falsy) → helper _vendor_portal_base/_portal_base dùng fallback domain mới.
    VENDOR_PORTAL_URL: str = ""
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    PO_APPROVAL_THRESHOLD: int = 50_000_000
    MAX_UPLOAD_SIZE_MB: int = 50

    # ── Phase 3 — Đơn↔PO↔Giao hàng↔Tài chính event spine ──
    # ⚠️ BEHAVIOR-CHANGE FLAG (owner sign-off required before enabling).
    # When TRUE, approving a payment request auto-creates an
    # accounts_receivable (công nợ) row for the linked sourcing order and
    # advances the revenue_chain. Default FALSE so deploying the Phase-3
    # code does NOT change any financial behavior until Thang flips it on.
    PHASE3_AUTO_AR_ENABLED: bool = False

    # ── Đợt 5 — Procurement auto công nợ phải trả (AP) ──
    # ⚠️ BEHAVIOR-CHANGE FLAG (owner sign-off required before enabling).
    # When TRUE, a procurement_delivery transitioning to status='received'
    # auto-creates exactly ONE accounts_payable (công nợ phải trả) row for
    # that delivery (amount = value of that delivery only). Default FALSE so
    # deploying the procurement-AP code does NOT change any financial
    # behavior — the hook is a no-op until Thang flips it on. A runtime
    # override also exists via the app_config key 'procurement_auto_ap_enabled'.
    PROCUREMENT_AUTO_AP_ENABLED: bool = False

    # ── Batch 2C — BQMS QT V-round / D-N state machine tick ──
    # ⚠️ SAFETY FLAGS for the periodic state-machine tick (run_state_tick).
    #   BQMS_STATE_TICK_ENABLED  — master on/off. Default FALSE so deploying the
    #     code does NOT start auto-advancing qt_state until Thang turns it on.
    #   BQMS_STATE_TICK_DRYRUN   — when TRUE the tick LOGS the transitions it
    #     WOULD make but writes NOTHING. Default TRUE so the very FIRST enabled
    #     cycle can be inspected before letting the engine auto-close anything.
    # Flip BQMS_STATE_TICK_DRYRUN=False (after reviewing one dry-run cycle) to
    # let the tick actually persist state changes + append events.
    BQMS_STATE_TICK_ENABLED: bool = False
    BQMS_STATE_TICK_DRYRUN: bool = True

    # Files
    FILES_BASE_PATH: str = "/data/files"
    FILES_BASE_URL: str = ""

    # Samsung BQMS
    BQMS_USERNAME: str = ""
    BQMS_PASSWORD: str = ""
    BQMS_BASE_URL: str = "https://www.sec-bqms.com"

    # IMV (iMarketVietnam) supplier portal
    IMV_USER_ID: str = ""
    IMV_PASSWORD: str = ""
    IMV_BASE_URL: str = "https://www.imvmall.com"

    # Gemini
    GEMINI_API_KEY: str = ""

    # Microsoft Graph
    M365_TENANT_ID: str = ""
    M365_CLIENT_ID: str = ""
    M365_CLIENT_SECRET: str = ""
    M365_DRIVE_ID: str = ""

    # File Browser / OneDrive Cache
    ONEDRIVE_CACHE_PATH: str = "/data/files/onedrive-cache"
    ONEDRIVE_CACHE_MAX_GB: int = 20

    @property
    def async_database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@postgres:5432/{self.POSTGRES_DB}"
        )

    @property
    def sync_database_url(self) -> str:
        return self.async_database_url.replace("+asyncpg", "")

    # ── W4-04 — Fail-fast production config guard ──────────────────────
    # Khi APP_ENV=production, thiếu/để-mặc-định các biến BẮT BUỘC dưới đây sẽ
    # RAISE ngay lúc import (Settings() ở cuối file) thay vì âm thầm chạy với
    # JWT rỗng / DB rỗng / CORS "*" (xem app/main.py _cors_origins — APP_URL
    # rỗng => CORS wildcard, nguy hiểm khi allow_credentials=True).
    #
    # Dev/test KHÔNG bị chặn: chỉ cần APP_ENV != "production" (mặc định của
    # backend/.env.example là "development"; tests/conftest.py cũng
    # os.environ.setdefault("APP_ENV", "development") trước khi import app).
    @model_validator(mode="after")
    def _validate_production_requirements(self) -> "Settings":
        if self.APP_ENV != "production":
            return self

        missing: list[str] = []
        unsafe: list[str] = []

        if not self.JWT_SECRET_KEY:
            missing.append("JWT_SECRET_KEY")
        elif len(self.JWT_SECRET_KEY) < 32:
            unsafe.append("JWT_SECRET_KEY (< 32 ký tự — quá ngắn/yếu cho production)")
        elif _looks_like_placeholder(self.JWT_SECRET_KEY):
            unsafe.append("JWT_SECRET_KEY (vẫn là giá trị mẫu trong .env.example — chưa đổi)")

        if self.DATABASE_URL:
            if _looks_like_placeholder(self.DATABASE_URL):
                unsafe.append("DATABASE_URL (vẫn là giá trị mẫu trong .env.example — chưa đổi)")
        elif not self.POSTGRES_PASSWORD:
            # async_database_url tự ráp từ POSTGRES_* khi DATABASE_URL rỗng —
            # nếu password cũng rỗng thì sẽ nối chuỗi kết nối với password="".
            missing.append("DATABASE_URL (hoặc POSTGRES_PASSWORD)")
        elif _looks_like_placeholder(self.POSTGRES_PASSWORD):
            unsafe.append("POSTGRES_PASSWORD (vẫn là giá trị mẫu trong .env.example — chưa đổi)")

        if not self.APP_URL:
            # Rỗng => app/main.py rơi vào CORS allow_origins=["*"] (kèm
            # allow_credentials=True) — không an toàn cho production.
            missing.append("APP_URL")

        if missing or unsafe:
            lines = [
                "Cấu hình production KHÔNG HỢP LỆ — dừng khởi động (fail-fast, W4-04).",
            ]
            if missing:
                lines.append("  Thiếu biến bắt buộc: " + ", ".join(missing))
            if unsafe:
                lines.append("  Biến đang dùng giá trị KHÔNG AN TOÀN: " + ", ".join(unsafe))
            lines.append(
                "  -> Xem backend/.env.example (mục BẮT BUỘC) và "
                "docs/SECRETS_INVENTORY.md. Nếu đây là môi trường dev/test, đặt "
                "APP_ENV=development trong .env thay vì production."
            )
            raise ValueError("\n".join(lines))

        return self

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
