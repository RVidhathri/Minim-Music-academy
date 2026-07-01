import pytest
import asyncio
import pytest_asyncio
import datetime
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.future import select

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
    
    # Seed a test plan and test user
    async with async_session() as session:
        plan = models.Plan(
            id=1,
            name="Premium Plan",
            description="Premium piano lessons",
            price=499.00,
            is_active=True
        )
        user = models.User(
            id=1,
            name="Test Student",
            email="student@minim.academy",
            hashed_password=auth.hash_password("securepassword123"),
            role="member"
        )
        session.add(plan)
        session.add(user)
        await session.commit()

    yield

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_create_order_unauthorized():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/payments/create-order", json={"plan_id": 1})
        assert res.status_code == 401

@pytest.mark.asyncio
async def test_create_order_success():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Log in to get token
        login_payload = {
            "email": "student@minim.academy",
            "password": "securepassword123"
        }
        res = await ac.post("/auth/login", json=login_payload)
        assert res.status_code == 200
        token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Create order
        res = await ac.post("/payments/create-order", json={"plan_id": 1}, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "order_id" in data
        assert data["amount"] == 49900
        assert data["currency"] == "INR"
        assert data["user_email"] == "student@minim.academy"

@pytest.mark.asyncio
async def test_webhook_payment_captured_and_idempotency():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Trigger successful payment webhook
        webhook_payload = {
            "event": "payment.captured",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_test_captured_123",
                        "order_id": "order_test_captured_123",
                        "amount": 49900,
                        "email": "student@minim.academy",
                        "notes": {
                            "plan_id": "1",
                            "user_email": "student@minim.academy"
                        }
                    }
                }
            }
        }
        res = await ac.post("/payments/webhook", json=webhook_payload)
        assert res.status_code == 200
        assert res.json()["status"] == "subscription activated"

        # Verify subscription was created in the database
        async with async_session() as session:
            result = await session.execute(
                select(models.Subscription).where(models.Subscription.user_id == 1)
            )
            sub = result.scalars().first()
            assert sub is not None
            assert sub.status == "active"
            assert sub.payment_status == "paid"
            assert sub.videos_released == 0
            assert sub.razorpay_payment_id == "pay_test_captured_123"
            assert sub.razorpay_order_id == "order_test_captured_123"
            
            # Verify drip date initialization
            delta = sub.next_release_date - sub.cycle_start_date
            assert delta.days == 7

        # 2. Test Idempotency: Send the exact same webhook again
        res = await ac.post("/payments/webhook", json=webhook_payload)
        assert res.status_code == 200
        assert res.json()["status"] == "already processed"

        # Verify only one subscription exists in database
        async with async_session() as session:
            result = await session.execute(
                select(models.Subscription).where(models.Subscription.user_id == 1)
            )
            subs = result.scalars().all()
            assert len(subs) == 1

@pytest.mark.asyncio
async def test_webhook_payment_failed():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Create a pending subscription first
        async with async_session() as session:
            pending_sub = models.Subscription(
                user_id=1,
                plan_id=1,
                status="inactive",
                payment_status="pending",
                razorpay_order_id="order_failed_test_123",
                videos_released=0
            )
            session.add(pending_sub)
            await session.commit()

        # Trigger failed payment webhook
        webhook_payload = {
            "event": "payment.failed",
            "payload": {
                "payment": {
                    "entity": {
                        "id": "pay_failed_123",
                        "order_id": "order_failed_test_123",
                        "amount": 49900,
                        "email": "student@minim.academy"
                    }
                }
            }
        }
        res = await ac.post("/payments/webhook", json=webhook_payload)
        assert res.status_code == 200
        assert res.json()["status"] == "payment failure recorded"

        # Verify subscription was updated to failed and inactive
        async with async_session() as session:
            result = await session.execute(
                select(models.Subscription).where(models.Subscription.razorpay_order_id == "order_failed_test_123")
            )
            sub = result.scalars().first()
            assert sub is not None
            assert sub.payment_status == "failed"
            assert sub.status == "inactive"
