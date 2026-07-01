"""
scheduler.py — APScheduler background jobs.

Jobs:
  drip_release_videos (daily at midnight UTC):
    For every active subscription where:
      - next_release_date <= now
      - videos_released < 4 (one full monthly cycle)
    → Increment videos_released
    → Advance next_release_date by +7 days
    → After 4 videos, mark the subscription cycle complete (status=expired)
      so the payment engine can trigger a renewal.

Usage:
  Called from main.py lifespan context so the scheduler starts with the app
  and shuts down cleanly on exit.
"""

import asyncio
import datetime
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.future import select

from config import settings
import models

logger = logging.getLogger(__name__)

# Module-level scheduler instance
_scheduler = AsyncIOScheduler()


# ---------------------------------------------------------------------------
# Job: drip_release_videos
# ---------------------------------------------------------------------------

async def drip_release_videos() -> None:
    """
    Check all active subscriptions and release the next video if due.
    Runs daily. Designed to be idempotent — safe to run multiple times.
    """
    # Build a fresh DB session for background use (separate from request sessions)
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    now = datetime.datetime.utcnow()
    released_count = 0

    try:
        async with session_factory() as session:
            # Fetch subscriptions that are due for a release
            result = await session.execute(
                select(models.Subscription).where(
                    models.Subscription.status == "active",
                    models.Subscription.payment_status == "paid",
                    models.Subscription.next_release_date <= now,
                    models.Subscription.videos_released < 4,  # max 4 per cycle
                )
            )
            due_subs = result.scalars().all()

            for sub in due_subs:
                sub.videos_released += 1
                released_count += 1

                if sub.videos_released >= 4:
                    # Full cycle complete — mark expired so payment renews
                    sub.status = "expired"
                    logger.info(
                        f"Subscription {sub.id} (user {sub.user_id}) completed 4-video cycle → expired"
                    )
                else:
                    # Schedule next release in 7 days
                    sub.next_release_date = sub.next_release_date + datetime.timedelta(days=7)
                    logger.info(
                        f"Subscription {sub.id}: video #{sub.videos_released} released, "
                        f"next_release_date={sub.next_release_date.date()}"
                    )

            await session.commit()

    except Exception as exc:
        logger.error(f"drip_release_videos job failed: {exc}", exc_info=True)
    finally:
        await engine.dispose()

    logger.info(f"drip_release_videos: processed {len(due_subs)} subscriptions, released {released_count} videos")


# ---------------------------------------------------------------------------
# Scheduler lifecycle
# ---------------------------------------------------------------------------

def start_scheduler() -> AsyncIOScheduler:
    """
    Start the APScheduler with the drip release job.
    Called from main.py lifespan on startup.
    """
    _scheduler.add_job(
        drip_release_videos,
        trigger=CronTrigger(hour=0, minute=0),  # daily at 00:00 UTC
        id="drip_release_videos",
        name="Weekly video drip release",
        replace_existing=True,
        misfire_grace_time=3600,  # allow 1-hour window if server was down
    )
    _scheduler.start()
    logger.info("APScheduler started — drip_release_videos job scheduled (daily 00:00 UTC)")
    return _scheduler


def stop_scheduler() -> None:
    """Stop the scheduler cleanly. Called from main.py lifespan on shutdown."""
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped")
