from pydantic_settings import BaseSettings


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
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # App
    APP_ENV: str = "production"
    APP_URL: str = ""
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    PO_APPROVAL_THRESHOLD: int = 50_000_000
    MAX_UPLOAD_SIZE_MB: int = 50

    # Files
    FILES_BASE_PATH: str = "/data/files"
    FILES_BASE_URL: str = ""

    # Samsung BQMS
    BQMS_USERNAME: str = ""
    BQMS_PASSWORD: str = ""
    BQMS_BASE_URL: str = "https://www.sec-bqms.com"

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

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
