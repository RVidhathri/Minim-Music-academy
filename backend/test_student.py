import pytest
import asyncio
import pytest_asyncio
import datetime
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from database import Base, get_db
import models
import auth

DATABASE_URL = "sqlite+aiosqlite:///:memory:"

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

async def override_get_db():
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

@pytest.fixture(scope="session")
def event_loop():
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    app.dependency_overrides[get_db] = override_get_db
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async with async_session() as session:
        # 1. User
        user = models.User(
            id=1,
            name="Test Student",
            email="student@minim.academy",
            hashed_password=auth.hash_password("securepassword123"),
            role="member"
        )
        # 2. Plan
        plan = models.Plan(
            id=1,
            name="Premium Plan",
            price=499.00,
            is_active=True
        )
        # 3. Course
        course = models.Course(id=1, title="Test Course")
        
        # 4. Videos (seq 1, 2, 3)
        v1 = models.Video(id=1, course_id=1, title="Video 1", sequence_order=1, bunny_video_id="bunny1")
        v2 = models.Video(id=2, course_id=1, title="Video 2", sequence_order=2, bunny_video_id="bunny2")
        v3 = models.Video(id=3, course_id=1, title="Video 3", sequence_order=3, bunny_video_id="bunny3")

        # 5. Active Subscription with 1 video released
        sub = models.Subscription(
            id=1,
            user_id=1,
            plan_id=1,
            status="active",
            payment_status="paid",
            videos_released=1,
            next_release_date=datetime.datetime.utcnow() + datetime.timedelta(days=7)
        )

        session.add_all([user, plan, course, v1, v2, v3, sub])
        await session.commit()

    yield

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)

async def get_auth_headers(ac: AsyncClient) -> dict:
    login_payload = {
        "email": "student@minim.academy",
        "password": "securepassword123"
    }
    res = await ac.post("/auth/login", json=login_payload)
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.mark.asyncio
async def test_course_progress():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = await get_auth_headers(ac)
        res = await ac.get("/student/course-progress", headers=headers)
        assert res.status_code == 200
        videos = res.json()
        assert len(videos) == 3
        
        # Video 1 should be unlocked (seq 1 <= videos_released 1)
        assert videos[0]["sequence_order"] == 1
        assert videos[0]["is_unlocked"] is True
        assert videos[0]["unlock_date"] is None
        
        # Video 2 should be locked (seq 2 > videos_released 1)
        assert videos[1]["sequence_order"] == 2
        assert videos[1]["is_unlocked"] is False
        assert videos[1]["unlock_date"] is not None

@pytest.mark.asyncio
async def test_play_url_unlocked():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = await get_auth_headers(ac)
        # Video 1 is unlocked
        res = await ac.get("/student/videos/1/play-url", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "play_url" in data
        assert "bunny1" in data["play_url"]

@pytest.mark.asyncio
async def test_play_url_locked():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        headers = await get_auth_headers(ac)
        # Video 2 is locked
        res = await ac.get("/student/videos/2/play-url", headers=headers)
        assert res.status_code == 403
        assert res.json()["detail"] == "Video is locked"
