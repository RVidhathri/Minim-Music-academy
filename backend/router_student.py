import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from database import get_db
import models
import schemas
from router_auth import get_current_user
from router_admin import _generate_bunny_signed_url
from config import settings

router = APIRouter(prefix="/student", tags=["Student Operations"])


@router.get("/course-progress", response_model=List[schemas.StudentVideoOut])
async def get_course_progress(
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """
    Returns the list of videos with their lock/unlock status based on the user's subscription.
    """
    # 1. Fetch user's subscription (active or expired)
    result = await db.execute(
        select(models.Subscription)
        .where(models.Subscription.user_id == user.id)
        .where(models.Subscription.status.in_(["active", "expired"]))
        .order_by(models.Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if not sub:
        raise HTTPException(status_code=403, detail="No active or expired subscription found")

    # 2. Fetch all videos (assuming a single primary course for now), ordered by sequence
    result = await db.execute(
        select(models.Video).order_by(models.Video.sequence_order)
    )
    videos = result.scalars().all()

    # 3. Compute locked/unlocked state
    student_videos = []
    for v in videos:
        # Unlocked if its sequence_order is within the released count
        is_unlocked = v.sequence_order <= sub.videos_released
        
        unlock_date = None
        if not is_unlocked and sub.status == "active" and sub.next_release_date:
            # Simple projection: if next_release is next week, the one after is +1 week, etc.
            # v.sequence_order - sub.videos_released is the number of releases away.
            # The next release covers the first locked video, so we subtract 1.
            weeks_away = v.sequence_order - sub.videos_released - 1
            if weeks_away >= 0:
                unlock_date = sub.next_release_date + datetime.timedelta(days=7 * weeks_away)

        student_videos.append(
            schemas.StudentVideoOut(
                id=v.id,
                title=v.title,
                sequence_order=v.sequence_order,
                is_unlocked=is_unlocked,
                unlock_date=unlock_date
            )
        )

    return student_videos


@router.get("/videos/{video_id}/play-url")
async def get_student_play_url(
    video_id: int,
    db: AsyncSession = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """
    Returns a signed play URL if the video is unlocked for this user.
    """
    # 1. Fetch user's subscription
    result = await db.execute(
        select(models.Subscription)
        .where(models.Subscription.user_id == user.id)
        .where(models.Subscription.status.in_(["active", "expired"]))
        .order_by(models.Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if not sub:
        raise HTTPException(status_code=403, detail="No active subscription found")

    # 2. Fetch video
    result = await db.execute(
        select(models.Video).where(models.Video.id == video_id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # 3. Security Boundary: enforce drip release
    if video.sequence_order > sub.videos_released:
        raise HTTPException(status_code=403, detail="Video is locked")

    if not video.bunny_video_id:
        raise HTTPException(status_code=409, detail="Video has no Bunny ID")

    # 4. Generate URL
    if settings.BUNNY_API_KEY == "dummy":
        signed_url = f"https://iframe.mediadelivery.net/embed/sim/{video.bunny_video_id}?simulated=1"
    else:
        signed_url = _generate_bunny_signed_url(video.bunny_video_id, expires_in_seconds=3600)

    return {
        "video_id": video.id,
        "play_url": signed_url
    }
