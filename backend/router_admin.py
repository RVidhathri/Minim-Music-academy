"""
Admin router — course, video, and material management.

All endpoints require role="admin" (enforced via get_current_admin dependency).

Endpoints:
  Courses:
    POST   /admin/courses                                  — create course
    GET    /admin/courses                                  — list all courses
    PATCH  /admin/courses/{course_id}                      — update course
    DELETE /admin/courses/{course_id}                      — delete course

  Videos:
    POST   /admin/courses/{course_id}/videos               — upload video to Bunny Stream
    PATCH  /admin/courses/{course_id}/videos/{video_id}    — update video metadata
    DELETE /admin/courses/{course_id}/videos/{video_id}    — delete video
    GET    /admin/courses/{course_id}/videos/{video_id}/play-url — get signed Bunny URL

  Materials (PDFs):
    POST   /admin/courses/{course_id}/materials            — upload PDF to Cloudflare R2
    PATCH  /admin/courses/{course_id}/materials/{mat_id}   — update material metadata
    DELETE /admin/courses/{course_id}/materials/{mat_id}   — delete material
"""

import time
import hmac
import hashlib
import logging
import urllib.parse
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from database import get_db
import models
import schemas
from router_auth import get_current_admin
from config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin Operations"])


# ---------------------------------------------------------------------------
# Helpers — Bunny.net Stream
# ---------------------------------------------------------------------------

async def _bunny_create_and_upload(title: str, file_data: bytes) -> str:
    """
    Create a video object in Bunny Stream and upload the raw content.
    Returns the Bunny video GUID.
    Raises HTTPException on failure.
    """
    base_url = f"https://video.bunnycdn.com/library/{settings.BUNNY_STREAM_LIBRARY_ID}/videos"
    headers = {
        "AccessKey": settings.BUNNY_API_KEY,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=300) as client:
        # 1. Create video object
        res = await client.post(base_url, json={"title": title}, headers=headers)
        if res.status_code not in (200, 201):
            logger.error(f"Bunny create failed: {res.status_code} {res.text}")
            raise HTTPException(status_code=502, detail="Failed to create video in Bunny Stream")
        video_guid = res.json()["guid"]

        # 2. Upload raw video bytes
        upload_url = f"{base_url}/{video_guid}"
        upload_res = await client.put(
            upload_url,
            content=file_data,
            headers={"AccessKey": settings.BUNNY_API_KEY},
        )
        if upload_res.status_code not in (200, 201):
            logger.error(f"Bunny upload failed: {upload_res.status_code} {upload_res.text}")
            raise HTTPException(status_code=502, detail="Failed to upload video to Bunny Stream")

    return video_guid


def _generate_bunny_signed_url(video_guid: str, expires_in_seconds: int = 3600) -> str:
    """
    Generate a Bunny Stream token-authenticated embed URL.
    Uses SHA-256 HMAC of (security_key + video_guid + expiry_time).
    See: https://support.bunny.net/hc/en-us/articles/8768702727964
    """
    library_id = settings.BUNNY_STREAM_LIBRARY_ID
    security_key = settings.BUNNY_API_KEY
    expiry = int(time.time()) + expires_in_seconds

    # Token = sha256(SecurityKey + VideoGUID + Expiry)
    token_str = f"{security_key}{video_guid}{expiry}"
    token = hashlib.sha256(token_str.encode("utf-8")).hexdigest()

    url = (
        f"https://iframe.mediadelivery.net/embed/{library_id}/{video_guid}"
        f"?token={token}&expires={expiry}"
    )
    return url


# ---------------------------------------------------------------------------
# Helpers — Cloudflare R2 (S3-compatible)
# ---------------------------------------------------------------------------

def _get_r2_client():
    """Return a boto3 S3 client pointed at Cloudflare R2."""
    if settings.CF_R2_ACCESS_KEY_ID == "dummy":
        return None
    try:
        import boto3  # type: ignore
        return boto3.client(
            "s3",
            endpoint_url=settings.CF_R2_ENDPOINT,
            aws_access_key_id=settings.CF_R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.CF_R2_SECRET_ACCESS_KEY,
        )
    except ImportError:
        logger.warning("boto3 not installed — R2 uploads in simulation mode")
        return None


async def _r2_upload(file_key: str, file_data: bytes, content_type: str = "application/pdf") -> str:
    """
    Upload file to Cloudflare R2. Returns the public-like URL.
    Falls back to simulation URL if credentials are dummies.
    """
    r2 = _get_r2_client()
    if r2 is None:
        # Simulation mode
        return f"{settings.CF_R2_ENDPOINT}/{settings.CF_R2_BUCKET_NAME}/{file_key}"

    r2.put_object(
        Bucket=settings.CF_R2_BUCKET_NAME,
        Key=file_key,
        Body=file_data,
        ContentType=content_type,
    )
    # R2 doesn't have built-in public URLs — return the endpoint-based path
    return f"{settings.CF_R2_ENDPOINT}/{settings.CF_R2_BUCKET_NAME}/{file_key}"


# ---------------------------------------------------------------------------
# Course Endpoints
# ---------------------------------------------------------------------------

@router.post("/courses", response_model=schemas.CourseOut, status_code=status.HTTP_201_CREATED)
async def create_course(
    course_in: schemas.CourseBase,
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    course = models.Course(title=course_in.title, description=course_in.description)
    db.add(course)
    await db.flush()
    await db.refresh(course)
    return course


@router.get("/courses", response_model=List[schemas.CourseOut])
async def list_courses(
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(select(models.Course))
    return result.scalars().all()


@router.patch("/courses/{course_id}", response_model=schemas.CourseOut)
async def update_course(
    course_id: int,
    course_in: schemas.CourseBase,
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(select(models.Course).where(models.Course.id == course_id))
    course = result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    course.title = course_in.title
    course.description = course_in.description
    await db.flush()
    await db.refresh(course)
    return course


@router.delete("/courses/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: int,
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(select(models.Course).where(models.Course.id == course_id))
    course = result.scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await db.delete(course)
    await db.flush()


# ---------------------------------------------------------------------------
# Video Endpoints
# ---------------------------------------------------------------------------

@router.post("/courses/{course_id}/videos", response_model=schemas.VideoOut, status_code=status.HTTP_201_CREATED)
async def upload_video(
    course_id: int,
    title: str = Form(...),
    sequence_order: int = Form(0),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """Upload a video file to Bunny Stream and store the returned GUID."""
    # Verify course exists
    course_res = await db.execute(select(models.Course).where(models.Course.id == course_id))
    if not course_res.scalars().first():
        raise HTTPException(status_code=404, detail="Course not found")

    file_data = await file.read()

    if settings.BUNNY_API_KEY == "dummy" or settings.BUNNY_STREAM_LIBRARY_ID == "dummy":
        # Simulation: use a deterministic fake GUID
        bunny_video_id = f"sim-{course_id}-{title.replace(' ', '-').lower()}"
        logger.info(f"Bunny simulation: video_id={bunny_video_id}")
    else:
        bunny_video_id = await _bunny_create_and_upload(title, file_data)

    db_video = models.Video(
        course_id=course_id,
        title=title,
        bunny_video_id=bunny_video_id,
        sequence_order=sequence_order,
    )
    db.add(db_video)
    await db.flush()
    await db.refresh(db_video)
    return db_video


@router.patch("/courses/{course_id}/videos/{video_id}", response_model=schemas.VideoOut)
async def update_video(
    course_id: int,
    video_id: int,
    title: str = Form(...),
    sequence_order: int = Form(0),
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(
        select(models.Video).where(models.Video.id == video_id, models.Video.course_id == course_id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    video.title = title
    video.sequence_order = sequence_order
    await db.flush()
    await db.refresh(video)
    return video


@router.delete("/courses/{course_id}/videos/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_video(
    course_id: int,
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(
        select(models.Video).where(models.Video.id == video_id, models.Video.course_id == course_id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    await db.delete(video)
    await db.flush()


@router.get("/courses/{course_id}/videos/{video_id}/play-url")
async def get_video_play_url(
    course_id: int,
    video_id: int,
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """
    Generate a time-limited Bunny Stream signed URL for the video.
    URL expires in 1 hour. The player cannot be downloaded or linked to directly.
    """
    result = await db.execute(
        select(models.Video).where(models.Video.id == video_id, models.Video.course_id == course_id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if not video.bunny_video_id:
        raise HTTPException(status_code=409, detail="Video has no Bunny ID — upload may have failed")

    if settings.BUNNY_API_KEY == "dummy":
        signed_url = f"https://iframe.mediadelivery.net/embed/sim/{video.bunny_video_id}?simulated=1"
    else:
        signed_url = _generate_bunny_signed_url(video.bunny_video_id, expires_in_seconds=3600)

    return {
        "video_id": video.id,
        "title": video.title,
        "bunny_video_id": video.bunny_video_id,
        "play_url": signed_url,
        "expires_in_seconds": 3600,
    }


# ---------------------------------------------------------------------------
# Material (PDF) Endpoints
# ---------------------------------------------------------------------------

@router.post("/courses/{course_id}/materials", response_model=schemas.MaterialOut, status_code=status.HTTP_201_CREATED)
async def upload_material(
    course_id: int,
    title: str = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    """Upload a PDF to Cloudflare R2 and store the resulting URL/key."""
    course_res = await db.execute(select(models.Course).where(models.Course.id == course_id))
    if not course_res.scalars().first():
        raise HTTPException(status_code=404, detail="Course not found")

    # Sanitize filename for the storage key
    safe_filename = urllib.parse.quote(file.filename or "material.pdf", safe="")
    file_key = f"materials/{course_id}/{safe_filename}"
    file_data = await file.read()

    url = await _r2_upload(file_key, file_data, content_type=file.content_type or "application/pdf")

    db_material = models.Material(
        course_id=course_id,
        title=title,
        file_key=file_key,
        url=url,
    )
    db.add(db_material)
    await db.flush()
    await db.refresh(db_material)
    return db_material


@router.patch("/courses/{course_id}/materials/{mat_id}", response_model=schemas.MaterialOut)
async def update_material(
    course_id: int,
    mat_id: int,
    title: str = Form(...),
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(
        select(models.Material).where(models.Material.id == mat_id, models.Material.course_id == course_id)
    )
    mat = result.scalars().first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    mat.title = title
    await db.flush()
    await db.refresh(mat)
    return mat


@router.delete("/courses/{course_id}/materials/{mat_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_material(
    course_id: int,
    mat_id: int,
    db: AsyncSession = Depends(get_db),
    admin: models.User = Depends(get_current_admin),
):
    result = await db.execute(
        select(models.Material).where(models.Material.id == mat_id, models.Material.course_id == course_id)
    )
    mat = result.scalars().first()
    if not mat:
        raise HTTPException(status_code=404, detail="Material not found")
    await db.delete(mat)
    await db.flush()
