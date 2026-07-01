import pytest
import asyncio
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from main import app
from database import Base, get_db

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
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_signup_and_login():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Signup
        signup_payload = {
            "name": "Admin User",
            "email": "admin@minim.academy",
            "password": "securepassword123",
            "role": "admin"
        }
        res = await ac.post("/auth/signup", json=signup_payload)
        assert res.status_code == 201
        assert res.json()["email"] == "admin@minim.academy"
        assert res.json()["role"] == "admin"

        # Login
        login_payload = {
            "email": "admin@minim.academy",
            "password": "securepassword123"
        }
        res = await ac.post("/auth/login", json=login_payload)
        assert res.status_code == 200
        assert "access_token" in res.json()
        assert "refresh_token" in res.json()
        token = res.json()["access_token"]

        # Me endpoint
        headers = {"Authorization": f"Bearer {token}"}
        res = await ac.get("/auth/me", headers=headers)
        assert res.status_code == 200
        assert res.json()["email"] == "admin@minim.academy"
