"""add_razorpay_fields_to_subscriptions

Revision ID: a7a780f808cc
Revises: 6aebbf6c5874
Create Date: 2026-07-01 13:59:18.855651

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7a780f808cc'
down_revision: Union[str, Sequence[str], None] = '6aebbf6c5874'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table: str, column: str) -> bool:
    """Check if a column already exists in a table (SQLite-safe)."""
    result = bind.execute(sa.text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result)


def upgrade() -> None:
    """
    Add razorpay_order_id and razorpay_payment_id to subscriptions.
    Idempotent: skips column creation if already present.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "sqlite":
        # SQLite supports simple ADD COLUMN but not constraints
        if not _column_exists(bind, 'subscriptions', 'razorpay_order_id'):
            bind.execute(sa.text(
                "ALTER TABLE subscriptions ADD COLUMN razorpay_order_id VARCHAR"
            ))
        if not _column_exists(bind, 'subscriptions', 'razorpay_payment_id'):
            bind.execute(sa.text(
                "ALTER TABLE subscriptions ADD COLUMN razorpay_payment_id VARCHAR"
            ))
    else:
        # PostgreSQL / Neon
        op.add_column('subscriptions', sa.Column('razorpay_order_id', sa.String(), nullable=True))
        op.add_column('subscriptions', sa.Column('razorpay_payment_id', sa.String(), nullable=True))
        op.create_unique_constraint('uq_sub_rzp_order_id', 'subscriptions', ['razorpay_order_id'])
        op.create_unique_constraint('uq_sub_rzp_payment_id', 'subscriptions', ['razorpay_payment_id'])


def downgrade() -> None:
    """
    Remove razorpay columns from subscriptions.
    SQLite 3.35+ supports DROP COLUMN; older versions do not.
    On older SQLite in dev, recreate the DB manually if needed.
    """
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "sqlite":
        # Attempt DROP COLUMN (SQLite 3.35+)
        try:
            bind.execute(sa.text(
                "ALTER TABLE subscriptions DROP COLUMN razorpay_payment_id"
            ))
            bind.execute(sa.text(
                "ALTER TABLE subscriptions DROP COLUMN razorpay_order_id"
            ))
        except Exception:
            pass  # Older SQLite — acceptable in dev
    else:
        op.drop_constraint('uq_sub_rzp_payment_id', 'subscriptions', type_='unique')
        op.drop_constraint('uq_sub_rzp_order_id', 'subscriptions', type_='unique')
        op.drop_column('subscriptions', 'razorpay_payment_id')
        op.drop_column('subscriptions', 'razorpay_order_id')
