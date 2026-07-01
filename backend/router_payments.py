"""
Payments router — Razorpay integration.

Endpoints:
  POST /payments/create-order   — Create a Razorpay order for a plan (auth required)
  POST /payments/webhook         — Handle Razorpay payment webhooks (signature verified)

Idempotency:
  Subscriptions store razorpay_order_id so duplicate webhook deliveries are ignored.
"""

import hmac
import hashlib
import json
import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel

from database import get_db
import models
from config import settings
from router_auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["Payments"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_razorpay_client():
    """Return a configured Razorpay client, or None when running with dummy keys."""
    if settings.RAZORPAY_KEY_ID == "dummy" or settings.RAZORPAY_KEY_SECRET == "dummy":
        return None
    try:
        import razorpay  # type: ignore
        return razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
    except ImportError:
        logger.warning("razorpay package not installed — running in simulation mode")
        return None


def _verify_razorpay_signature(body: bytes, signature: str) -> bool:
    """Verify Razorpay webhook HMAC-SHA256 signature."""
    if settings.RAZORPAY_WEBHOOK_SECRET in ("dummy", ""):
        # Skip verification in dev/test mode
        return True
    expected = hmac.new(
        settings.RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------------------
# POST /payments/create-order
# ---------------------------------------------------------------------------

class CreateOrderRequest(BaseModel):
    plan_id: int


@router.post("/create-order")
async def create_order(
    req: CreateOrderRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Create a Razorpay order for the authenticated user.
    Returns the order details needed by the Razorpay JS SDK on the frontend.
    """
    # Fetch plan
    result = await db.execute(select(models.Plan).where(models.Plan.id == req.plan_id, models.Plan.is_active == True))
    plan = result.scalars().first()
    if not plan:
        raise HTTPException(status_code=404, detail="Subscription plan not found or inactive")

    amount_paise = int(plan.price * 100)  # Razorpay amounts are in paise (1 INR = 100 paise)

    rz_client = _get_razorpay_client()
    if rz_client:
        # Real Razorpay order
        order_data = {
            "amount": amount_paise,
            "currency": "INR",
            "receipt": f"receipt_plan_{plan.id}_user_{current_user.id}",
            "notes": {
                "plan_id": str(plan.id),
                "user_id": str(current_user.id),
                "user_email": current_user.email,
            },
        }
        rz_order = rz_client.order.create(data=order_data)
        order_id = rz_order["id"]
    else:
        # Simulation mode — useful for local dev without real keys
        order_id = f"order_sim_{plan.id}_{current_user.id}_{int(datetime.datetime.utcnow().timestamp())}"

    return {
        "order_id": order_id,
        "amount": amount_paise,
        "currency": "INR",
        "key_id": settings.RAZORPAY_KEY_ID,
        "plan_name": plan.name,
        "user_email": current_user.email,
        "user_name": current_user.name,
    }


# ---------------------------------------------------------------------------
# POST /payments/webhook
# ---------------------------------------------------------------------------

@router.post("/webhook")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Handle Razorpay payment webhooks.

    Supported events:
      - payment.captured   → activate subscription
      - payment.failed     → mark payment_status=failed
      - order.paid         → same as payment.captured (fallback)

    Security:
      - Signature is verified against RAZORPAY_WEBHOOK_SECRET
      - Duplicate delivery is rejected via razorpay_order_id uniqueness
    """
    body = await request.body()

    # --- Signature Verification ---
    if x_razorpay_signature:
        if not _verify_razorpay_signature(body, x_razorpay_signature):
            logger.warning("Webhook signature mismatch — rejected")
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        # If no signature header at all, only allow in dev/test mode
        if settings.RAZORPAY_WEBHOOK_SECRET not in ("dummy", ""):
            raise HTTPException(status_code=400, detail="Missing webhook signature")

    # --- Parse Payload ---
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event = payload.get("event", "")
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {})

    # --- Handle payment.failed ---
    if event == "payment.failed":
        order_id = entity.get("order_id")
        if order_id:
            sub_res = await db.execute(
                select(models.Subscription).where(models.Subscription.razorpay_order_id == order_id)
            )
            sub = sub_res.scalars().first()
            if sub:
                sub.payment_status = "failed"
                sub.status = "inactive"
                await db.flush()
        return {"status": "payment failure recorded"}

    # --- Handle payment.captured / order.paid ---
    if event not in ("payment.captured", "order.paid", "subscription.activated"):
        return {"status": "event ignored"}

    # Extract key IDs
    razorpay_payment_id = entity.get("id")
    razorpay_order_id = entity.get("order_id")
    notes = entity.get("notes", {})

    user_email = notes.get("user_email") or entity.get("email", "")
    plan_id_str = notes.get("plan_id")

    # --- Idempotency Check (by payment_id) ---
    if razorpay_payment_id:
        dup_res = await db.execute(
            select(models.Subscription).where(
                models.Subscription.razorpay_payment_id == razorpay_payment_id
            )
        )
        if dup_res.scalars().first():
            logger.info(f"Duplicate webhook for payment {razorpay_payment_id} — skipping")
            return {"status": "already processed"}

    # --- Idempotency Check (by order_id) ---
    if razorpay_order_id:
        dup_res = await db.execute(
            select(models.Subscription).where(
                models.Subscription.razorpay_order_id == razorpay_order_id,
                models.Subscription.payment_status == "paid",
            )
        )
        if dup_res.scalars().first():
            logger.info(f"Duplicate webhook for order {razorpay_order_id} — skipping")
            return {"status": "already processed"}

    # --- Resolve User ---
    user = None
    if user_email:
        user_res = await db.execute(select(models.User).where(models.User.email == user_email))
        user = user_res.scalars().first()
    if not user:
        logger.warning(f"Webhook: could not find user with email={user_email!r}")
        raise HTTPException(status_code=422, detail=f"User not found: {user_email}")

    # --- Resolve Plan ---
    plan = None
    if plan_id_str:
        try:
            plan_id = int(plan_id_str)
            plan_res = await db.execute(select(models.Plan).where(models.Plan.id == plan_id))
            plan = plan_res.scalars().first()
        except (ValueError, TypeError):
            pass

    if not plan:
        # Fallback: find first active plan
        plan_res = await db.execute(select(models.Plan).where(models.Plan.is_active == True))
        plan = plan_res.scalars().first()

    if not plan:
        raise HTTPException(status_code=422, detail="No active plan found to assign subscription")

    # --- Create Subscription ---
    now = datetime.datetime.utcnow()
    new_sub = models.Subscription(
        user_id=user.id,
        plan_id=plan.id,
        status="active",
        payment_status="paid",
        videos_released=0,
        cycle_start_date=now,
        next_release_date=now + datetime.timedelta(days=7),
        razorpay_order_id=razorpay_order_id,
        razorpay_payment_id=razorpay_payment_id,
    )
    db.add(new_sub)
    await db.flush()

    logger.info(f"Subscription activated: id={new_sub.id} user={user.email} plan={plan.name}")
    return {
        "status": "subscription activated",
        "subscription_id": new_sub.id,
        "user": user.email,
        "plan": plan.name,
    }


@router.get("/subscription")
async def get_subscription(
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Get the current active or pending subscription for the logged-in user.
    """
    result = await db.execute(
        select(models.Subscription)
        .where(models.Subscription.user_id == current_user.id)
        .order_by(models.Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if not sub:
        return {"status": "inactive", "payment_status": "pending", "videos_released": 0}
    return {
        "status": sub.status,
        "payment_status": sub.payment_status,
        "videos_released": sub.videos_released,
        "next_release_date": sub.next_release_date,
        "cycle_start_date": sub.cycle_start_date,
    }

