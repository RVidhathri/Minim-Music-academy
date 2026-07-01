from pydantic import BaseModel, EmailStr
from typing import Optional, List
from decimal import Decimal
import datetime

class UserBase(BaseModel):
    name: str
    email: EmailStr

class UserCreate(UserBase):
    password: str
    role: Optional[str] = "member"

class UserOut(UserBase):
    id: int
    role: str
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class PlanBase(BaseModel):
    name: str
    description: Optional[str] = None
    price: Decimal
    is_active: Optional[bool] = True

class PlanOut(PlanBase):
    id: int
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class CourseBase(BaseModel):
    title: str
    description: Optional[str] = None

class VideoBase(BaseModel):
    title: str
    bunny_video_id: Optional[str] = None
    sequence_order: Optional[int] = 0

class VideoOut(VideoBase):
    id: int
    course_id: int
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class MaterialBase(BaseModel):
    title: str
    file_key: str
    url: str

class MaterialOut(MaterialBase):
    id: int
    course_id: int
    created_at: datetime.datetime

    class Config:
        from_attributes = True

class CourseOut(CourseBase):
    id: int
    created_at: datetime.datetime
    videos: List[VideoOut] = []
    materials: List[MaterialOut] = []

    class Config:
        from_attributes = True
