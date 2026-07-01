"""
main.py — Minim Music Academy FastAPI application entry point.

Lifespan:
  - Starts APScheduler on startup (drip-release job)
  - Stops APScheduler on shutdown

Routes:
  /health              — health check
  /auth/*              — authentication
  /admin/*             — admin-only course/video/material management
  /payments/*          — Razorpay payment & webhook handling
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models
from database import engine
import router_auth
import router_admin
import router_payments
import router_student
from scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    logger.info("Starting Minim Music Academy API...")
    start_scheduler()
    yield
    logger.info("Shutting down...")
    stop_scheduler()


app = FastAPI(
    title="Minim Music Academy API",
    description="Subscription-based music learning platform API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",        # local Next.js dev
        "https://*.vercel.app",         # Vercel preview deployments
        "https://minim-music.vercel.app",  # update to your actual Vercel URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect router systems
app.include_router(router_auth.router)
app.include_router(router_admin.router)
app.include_router(router_payments.router)
app.include_router(router_student.router)


@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "ok"}
