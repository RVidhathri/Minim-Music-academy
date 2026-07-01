import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///minim_academy.db"
    JWT_SECRET: str = "supersecretjwtkeychangeinproduction"
    JWT_REFRESH_SECRET: str = "supersecretrefreshjwtkeychangeinproduction"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    
    BUNNY_API_KEY: str = "dummy"
    BUNNY_STREAM_LIBRARY_ID: str = "dummy"
    
    CF_R2_ACCESS_KEY_ID: str = "dummy"
    CF_R2_SECRET_ACCESS_KEY: str = "dummy"
    CF_R2_BUCKET_NAME: str = "dummy"
    CF_R2_ENDPOINT: str = "https://dummy.r2.cloudflarestorage.com"
    
    RAZORPAY_KEY_ID: str = "dummy"
    RAZORPAY_KEY_SECRET: str = "dummy"
    RAZORPAY_WEBHOOK_SECRET: str = "dummy"

    class Config:
        env_file = ".env"

settings = Settings()
