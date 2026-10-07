"""
Motion Design by Sama Abana — API & serveur du site
====================================================

FastAPI + SQLAlchemy 2 + Pydantic 2.

Lancer en local :
    pip install -r requirements.txt
    cp .env.example .env        # puis remplir les valeurs
    uvicorn main:app --reload

Le site est servi sur http://127.0.0.1:8000 et la documentation de l'API
sur http://127.0.0.1:8000/docs
"""
from __future__ import annotations

import hashlib
import html
import json
import logging
import math
import os
import re
import secrets
import unicodedata
import smtplib
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from enum import Enum as PyEnum
from pathlib import Path
from typing import Annotated, Iterator, Literal, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import Boolean, DateTime, Enum, Integer, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

try:  # .env optionnel en développement
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass

# --------------------------------------------------------------------------- configuration
BASE_DIR = Path(__file__).resolve().parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    site_name = "Motion Design by Sama Abana"
    database_url = os.getenv("DATABASE_URL", "").strip() or f"sqlite:///{BASE_DIR / 'studio.db'}"
    # En minuscules : Resend compare l'adresse au compte à la lettre près.
    notify_email = os.getenv("NOTIFY_EMAIL", "samaabana@gmail.com").strip().lower()
    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "") or os.getenv("SMTP_USER", "")
    send_client_confirmation = env_bool("SEND_CLIENT_CONFIRMATION", True)
    resend_api_key = os.getenv("RESEND_API_KEY", "")
    resend_api_url = os.getenv("RESEND_API_URL", "https://api.resend.com/emails")
    email_from = os.getenv("EMAIL_FROM", "Motion Design by Sama Abana <onboarding@resend.dev>")
    admin_token = os.getenv("ADMIN_TOKEN", "").strip()
    # Stockage des vidéos et photos ajoutées depuis /admin (Cloudinary, offre gratuite)
    cloudinary_url = os.getenv("CLOUDINARY_URL", "").strip().strip("\"'")
    cloudinary_cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    cloudinary_api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    cloudinary_api_secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    cloudinary_api_base = os.getenv("CLOUDINARY_API_BASE", "https://api.cloudinary.com/v1_1").rstrip("/")
    cloudinary_delivery_base = os.getenv("CLOUDINARY_DELIVERY_BASE", "https://res.cloudinary.com").rstrip("/")
    allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    quote_rate_limit = int(os.getenv("QUOTE_RATE_LIMIT_PER_HOUR", "5"))
    whatsapp_number = "237656294043"
    site_url = os.getenv("SITE_URL", "https://sama-abana.samaabana.workers.dev").rstrip("/")


settings = Settings()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("sama-abana")


# --------------------------------------------------------------------------- base de données
class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class QuoteStatus(str, PyEnum):
    PENDING = "pending"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class ProjectCategory(str, PyEnum):
    ANIMATION_2D = "2d_animation"
    ANIMATION_3D = "3d_animation"
    UI_UX_MOTION = "ui_ux_motion"
    VFX_COMPOSITING = "vfx_compositing"


CATEGORY_LABELS = {
    ProjectCategory.ANIMATION_2D: "Animation 2D",
    ProjectCategory.ANIMATION_3D: "Animation 3D",
    ProjectCategory.UI_UX_MOTION: "UI/UX motion",
    ProjectCategory.VFX_COMPOSITING: "VFX & compositing",
}

BUDGET_RANGES = [
    "Moins de 100 000 FCFA",
    "100 000 – 300 000 FCFA",
    "300 000 – 750 000 FCFA",
    "750 000 – 1 500 000 FCFA",
    "Plus de 1 500 000 FCFA",
    "À définir ensemble",
]


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(150), nullable=False)
    slug: Mapped[str] = mapped_column(String(150), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[ProjectCategory] = mapped_column(
        Enum(ProjectCategory, values_callable=lambda e: [m.value for m in e]), nullable=False, index=True
    )
    cover_image_url: Mapped[str] = mapped_column(String(500), nullable=False)
    video_preview_url: Mapped[Optional[str]] = mapped_column(String(500))
    video_full_url: Mapped[str] = mapped_column(String(500), nullable=False)
    client: Mapped[Optional[str]] = mapped_column(String(120))
    aspect_ratio: Mapped[str] = mapped_column(String(10), default="9:16")
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)
    is_published: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QuoteRequest(Base):
    __tablename__ = "quote_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    project_type: Mapped[ProjectCategory] = mapped_column(
        Enum(ProjectCategory, values_callable=lambda e: [m.value for m in e]), nullable=False
    )
    budget_range: Mapped[str] = mapped_column(String(50), nullable=False)
    brief_description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[QuoteStatus] = mapped_column(
        Enum(QuoteStatus, values_callable=lambda e: [m.value for m in e]), default=QuoteStatus.PENDING
    )
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


def _normalise_db_url(url: str) -> str:
    # Les hébergeurs (Render, Railway, Heroku) donnent souvent « postgres:// »
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DB_URL = _normalise_db_url(settings.database_url)
engine = create_engine(
    DB_URL,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]


# --------------------------------------------------------------------------- schémas Pydantic
class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    slug: str
    description: str
    category: ProjectCategory
    category_label: str = ""
    cover_image_url: str
    video_preview_url: Optional[str] = None
    video_full_url: str
    client: Optional[str] = None
    aspect_ratio: str = "9:16"
    # « video » ou « image » : une photo n'a pas d'aperçu animé et s'ouvre en grand
    media_type: str = "video"
    is_featured: bool
    created_at: datetime

    @classmethod
    def build(cls, p: Project) -> "ProjectOut":
        out = cls.model_validate(p)
        out.category_label = CATEGORY_LABELS[p.category]
        out.media_type = media_type_of(p.video_full_url)
        return out


class ProjectAdminOut(ProjectOut):
    is_published: bool
    sort_order: int


def media_type_of(url: str) -> str:
    if "/image/upload/" in url or re.search(r"\.(jpe?g|png|webp|avif|gif)(\?.*)?$", url, re.I):
        return "image"
    return "video"


MEDIA_URL = r"^(https://[^\s\"'<>]+|media/[A-Za-z0-9._/-]+)$"
ASPECT_RATIOS = ("9:16", "4:5", "1:1", "16:9")
AspectRatio = Literal["9:16", "4:5", "1:1", "16:9"]


class ProjectCreate(BaseModel):
    title: str = Field(min_length=2, max_length=150)
    slug: str = Field(min_length=2, max_length=150, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    description: str = Field(min_length=10)
    category: ProjectCategory
    cover_image_url: str = Field(max_length=500, pattern=MEDIA_URL)
    video_preview_url: Optional[str] = Field(default=None, max_length=500, pattern=MEDIA_URL)
    video_full_url: str = Field(max_length=500, pattern=MEDIA_URL)
    client: Optional[str] = Field(default=None, max_length=120)
    aspect_ratio: str = Field(default="9:16", pattern=r"^\d{1,2}:\d{1,2}$")
    sort_order: int = 100
    is_featured: bool = False
    is_published: bool = True


def _clean_text(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = re.sub(r"[ \t]+", " ", v.strip())
    return v or None


class MediaProjectCreate(BaseModel):
    """Projet créé depuis /admin après l'envoi du fichier sur Cloudinary."""

    title: str = Field(min_length=2, max_length=150)
    client: Optional[str] = Field(default=None, max_length=120)
    category: ProjectCategory
    description: str = Field(default="", max_length=2000)
    kind: Literal["video", "image"]
    public_id: str = Field(pattern=r"^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$", max_length=200)
    width: Optional[int] = Field(default=None, ge=1, le=20000)
    height: Optional[int] = Field(default=None, ge=1, le=20000)
    cover_time: float = Field(default=0, ge=0, le=36000)
    aspect_ratio: Optional[AspectRatio] = None
    is_published: bool = True
    is_featured: bool = False

    @field_validator("title", "client", mode="before")
    @classmethod
    def strip(cls, v):
        return _clean_text(v) if isinstance(v, str) else v

    @field_validator("description", mode="before")
    @classmethod
    def strip_desc(cls, v):
        return (v or "").strip() if isinstance(v, str) or v is None else v


class ProjectUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=2, max_length=150)
    client: Optional[str] = Field(default=None, max_length=120)
    category: Optional[ProjectCategory] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    aspect_ratio: Optional[AspectRatio] = None
    is_published: Optional[bool] = None
    is_featured: Optional[bool] = None

    @field_validator("title", "client", mode="before")
    @classmethod
    def strip(cls, v):
        return _clean_text(v) if isinstance(v, str) else v

    @field_validator("description", mode="before")
    @classmethod
    def strip_desc(cls, v):
        return v.strip() if isinstance(v, str) else v


class ReorderIn(BaseModel):
    slugs: list[str] = Field(min_length=1, max_length=500)


class UploadParamsIn(BaseModel):
    kind: Literal["video", "image"]


class MediaDiscardIn(BaseModel):
    kind: Literal["video", "image"]
    public_id: str = Field(pattern=r"^[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$", max_length=200)


class QuoteCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: Optional[str] = Field(default=None, max_length=30)
    project_type: ProjectCategory
    budget_range: str
    brief_description: str = Field(min_length=20, max_length=5000)
    # Champ piège anti-robots : invisible pour les humains, doit rester vide.
    website: Optional[str] = Field(default=None, max_length=200)

    @field_validator("full_name", "brief_description")
    @classmethod
    def strip_text(cls, v: str) -> str:
        v = re.sub(r"[ \t]+", " ", v.strip())
        if not v:
            raise ValueError("Ce champ est obligatoire.")
        return v

    @field_validator("phone")
    @classmethod
    def check_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        cleaned = re.sub(r"[\s.\-()]", "", v)
        if not re.fullmatch(r"\+?\d{8,15}", cleaned):
            raise ValueError("Numéro invalide. Exemple : +237 6 56 29 40 43")
        return cleaned

    @field_validator("budget_range")
    @classmethod
    def check_budget(cls, v: str) -> str:
        if v not in BUDGET_RANGES:
            raise ValueError("Choisissez une fourchette de budget dans la liste.")
        return v


class QuoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    phone: Optional[str]
    project_type: ProjectCategory
    budget_range: str
    brief_description: str
    status: QuoteStatus
    notified: bool
    created_at: datetime


class QuoteAccepted(BaseModel):
    id: int
    message: str


class QuoteStatusUpdate(BaseModel):
    status: QuoteStatus


class SiteMeta(BaseModel):
    categories: dict[str, str]
    budget_ranges: list[str]


# --------------------------------------------------------------------------- notifications e-mail
# Deux fournisseurs possibles :
#  - Resend (API HTTPS) : à utiliser chez les hébergeurs qui bloquent le SMTP (Render gratuit, etc.)
#  - SMTP (Gmail avec mot de passe d'application) : sur un VPS ou en local
def email_provider() -> str:
    if settings.resend_api_key:
        return "resend"
    if settings.smtp_host and settings.smtp_user and settings.smtp_password:
        return "smtp"
    return ""


def email_enabled() -> bool:
    return bool(email_provider())


def _sender() -> str:
    if email_provider() == "resend":
        return settings.email_from
    return f"{settings.site_name} <{settings.smtp_from}>"


def can_email_clients() -> bool:
    # L'adresse de test de Resend (…@resend.dev) n'envoie qu'au propriétaire du compte.
    return not (email_provider() == "resend" and "resend.dev" in settings.email_from.lower())


def send_email(to: str, subject: str, text: str, html_body: Optional[str] = None, reply_to: Optional[str] = None) -> None:
    provider = email_provider()
    if provider == "resend":
        payload = {"from": _sender(), "to": [to], "subject": subject, "text": text}
        if html_body:
            payload["html"] = html_body
        if reply_to:
            payload["reply_to"] = reply_to
        req = urllib.request.Request(
            settings.resend_api_url,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
                "User-Agent": "sama-abana-studio/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                res.read()
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"Resend a refusé l'envoi ({err.code}) : {err.read().decode('utf-8', 'replace')[:300]}") from err
        return

    if provider == "smtp":
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = _sender()
        msg["To"] = to
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.set_content(text)
        if html_body:
            msg.add_alternative(html_body, subtype="html")
        ctx = ssl.create_default_context()
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=20) as s:
                s.login(settings.smtp_user, settings.smtp_password)
                s.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
                s.starttls(context=ctx)
                s.login(settings.smtp_user, settings.smtp_password)
                s.send_message(msg)
        return

    raise RuntimeError("Aucun fournisseur d'e-mail configuré.")


def notify_new_quote(quote_id: int) -> None:
    """Envoie la demande à Samaabana@gmail.com (+ accusé de réception au client si possible)."""
    with SessionLocal() as db:
        q = db.get(QuoteRequest, quote_id)
        if q is None:
            return
        label = CATEGORY_LABELS[q.project_type]
        if not email_enabled():
            log.warning("E-mail non configuré : la demande #%s est enregistrée mais aucun e-mail n'est parti.", q.id)
            return

        wa = f"https://wa.me/{(q.phone or '').lstrip('+')}" if q.phone else None
        text = (
            f"Nouvelle demande de devis #{q.id}\n\n"
            f"Nom : {q.full_name}\nE-mail : {q.email}\nTéléphone : {q.phone or '—'}\n"
            f"Type de projet : {label}\nBudget : {q.budget_range}\n\n"
            f"Brief :\n{q.brief_description}\n"
        )
        e = html.escape
        rows = "".join(
            f"<tr><td style='padding:6px 16px 6px 0;color:#8c8a86'>{k}</td><td style='padding:6px 0'>{v}</td></tr>"
            for k, v in [
                ("Nom", e(q.full_name)),
                ("E-mail", f"<a href='mailto:{e(q.email)}'>{e(q.email)}</a>"),
                ("Téléphone", f"<a href='{e(wa)}'>{e(q.phone)}</a> (WhatsApp)" if wa else "—"),
                ("Type de projet", e(label)),
                ("Budget", e(q.budget_range)),
            ]
        )
        body_html = (
            "<div lang='fr' style='font-family:Arial,sans-serif;font-size:15px;color:#111;max-width:600px'>"
            f"<h2 style='margin:0 0 16px'>Demande de devis #{q.id}</h2>"
            f"<table style='border-collapse:collapse'>{rows}</table>"
            "<h3 style='margin:24px 0 8px'>Brief</h3>"
            f"<p style='white-space:pre-wrap;line-height:1.55'>{e(q.brief_description)}</p></div>"
        )
        try:
            send_email(settings.notify_email, f"Devis #{q.id} — {q.full_name} ({label})", text, body_html, reply_to=q.email)
            q.notified = True
            db.commit()
            log.info("Demande #%s envoyée à %s via %s", q.id, settings.notify_email, email_provider())
        except Exception:  # l'enregistrement en base reste la source de vérité
            log.exception("Échec de l'envoi de la demande #%s", q.id)
            return

        if settings.send_client_confirmation and can_email_clients():
            try:
                send_email(
                    q.email,
                    "Votre demande de devis est bien reçue",
                    f"Bonjour {q.full_name},\n\n"
                    f"Votre demande de devis ({label}, {q.budget_range}) est bien arrivée. "
                    "Sama Abana vous répond par e-mail ou sur WhatsApp.\n\n"
                    "Pour ajouter des références ou des fichiers, répondez simplement à cet e-mail.\n\n"
                    f"— {settings.site_name}\nWhatsApp : https://wa.me/{settings.whatsapp_number}\n",
                    reply_to=settings.notify_email,
                )
            except Exception:
                log.exception("Échec de l'accusé de réception pour la demande #%s", q.id)


# --------------------------------------------------------------------------- anti-abus
_hits: dict[str, deque[float]] = defaultdict(deque)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def rate_limited(ip: str) -> bool:
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= settings.quote_rate_limit:
        return True
    q.append(now)
    return False


# Mot de passe admin : au-delà de 10 essais ratés en 15 min (par connexion), ou 60 au total, on bloque.
_admin_fails: dict[str, deque[float]] = defaultdict(deque)
ADMIN_FAIL_WINDOW = 900


def _recent(q: deque[float], now: float) -> int:
    while q and now - q[0] > ADMIN_FAIL_WINDOW:
        q.popleft()
    return len(q)


def check_admin(token: Optional[str], ip: str) -> None:
    if not settings.admin_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Administration désactivée : définissez ADMIN_TOKEN.")
    now = time.monotonic()
    if _recent(_admin_fails[ip], now) >= 10 or _recent(_admin_fails["*"], now) >= 60:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'essais ratés. Réessayez dans 15 minutes.")
    given = (token or "").strip().encode("utf-8")
    if not given or not secrets.compare_digest(given, settings.admin_token.encode("utf-8")):
        _admin_fails[ip].append(now)
        _admin_fails["*"].append(now)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Mot de passe administrateur incorrect.")


def require_admin(request: Request, x_admin_token: Annotated[Optional[str], Header()] = None) -> None:
    check_admin(x_admin_token, client_ip(request))


Admin = Depends(require_admin)


# --------------------------------------------------------------------------- stockage Cloudinary
@dataclass(frozen=True)
class CloudinaryConfig:
    cloud_name: str = ""
    api_key: str = ""
    api_secret: str = ""
    error: str = ""

    @property
    def ready(self) -> bool:
        return bool(self.cloud_name and self.api_key and self.api_secret and not self.error)


def load_cloudinary() -> CloudinaryConfig:
    raw = settings.cloudinary_url
    if raw.upper().startswith("CLOUDINARY_URL="):  # la ligne entière a été collée
        raw = raw.split("=", 1)[1].strip().strip("\"'")
    name, key, secret = settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret
    if raw:
        if "<" in raw or ">" in raw:
            return CloudinaryConfig(error="CLOUDINARY_URL contient encore <your_api_key> ou <your_api_secret> : remplacez-les par vos vraies valeurs.")
        m = re.fullmatch(r"cloudinary://([^:@\s]+):([^@\s]+)@([A-Za-z0-9_-]+)", raw)
        if not m:
            return CloudinaryConfig(error="CLOUDINARY_URL doit ressembler à cloudinary://CLÉ:SECRET@NOM-DU-CLOUD.")
        key, secret, name = m.groups()
    if not (name or key or secret):
        return CloudinaryConfig()
    if not (name and key and secret):
        return CloudinaryConfig(error="Il manque une valeur Cloudinary (nom du cloud, clé API ou secret API).")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
        return CloudinaryConfig(error="Le nom du cloud Cloudinary ne doit contenir que des lettres, chiffres, - ou _.")
    return CloudinaryConfig(name, key, secret)


CLD = load_cloudinary()
MAX_UPLOAD_BYTES = {"video": 100 * 1024 * 1024, "image": 10 * 1024 * 1024}
UPLOAD_FORMATS = {
    "video": "mp4,mov,m4v,webm,mkv,avi,3gp,mpeg,mpg",
    "image": "jpg,jpeg,png,webp,heic,heif,avif,gif",
}
CLD_FOLDER = "sama-abana"
# Versions livrées (paramètres triés comme le font les SDK Cloudinary) :
T_VIDEO_FULL = "c_limit,h_1920,q_auto,w_1920"                 # film complet, jusqu'à 1080p
T_VIDEO_PREVIEW = "ac_none,c_limit,du_6,h_960,q_auto:low,w_960"  # aperçu muet de 6 s sur les cartes
T_IMAGE_COVER = "c_limit,f_auto,h_1600,q_auto,w_1600"
T_IMAGE_FULL = "c_limit,f_auto,h_2560,q_auto,w_2560"
# Préparées dès l'envoi, en arrière-plan, pour que le premier visiteur n'attende pas.
EAGER_VIDEO = f"{T_VIDEO_FULL}/mp4|{T_VIDEO_PREVIEW}/mp4|{T_VIDEO_PREVIEW}/webm"


def cld_sign(params: dict[str, str]) -> str:
    to_sign = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if v not in ("", None))
    return hashlib.sha1((to_sign + CLD.api_secret).encode("utf-8")).hexdigest()


def cld_upload_params(kind: str) -> dict:
    rtype = "video" if kind == "video" else "image"
    fields = {"timestamp": str(int(time.time())), "asset_folder": CLD_FOLDER, "allowed_formats": UPLOAD_FORMATS[rtype]}
    if rtype == "video":
        fields.update(eager=EAGER_VIDEO, eager_async="true")
    fields["signature"] = cld_sign(fields)
    fields["api_key"] = CLD.api_key
    return {
        "upload_url": f"{settings.cloudinary_api_base}/{CLD.cloud_name}/{rtype}/upload",
        "fields": fields,
        "chunk_size": 6 * 1024 * 1024,  # Cloudinary exige au moins 5 Mo par morceau (sauf le dernier)
        "max_bytes": MAX_UPLOAD_BYTES[rtype],
    }


def cld_url(rtype: str, transformation: str, public_id: str, ext: str = "") -> str:
    return f"{settings.cloudinary_delivery_base}/{CLD.cloud_name}/{rtype}/upload/{transformation}/{public_id}{'.' + ext if ext else ''}"


def cld_media_urls(kind: str, public_id: str, cover_time: float) -> dict[str, Optional[str]]:
    if kind == "image":
        return {
            "cover_image_url": cld_url("image", T_IMAGE_COVER, public_id),
            "video_preview_url": None,
            "video_full_url": cld_url("image", T_IMAGE_FULL, public_id),
        }
    so = f"{cover_time:.2f}".rstrip("0").rstrip(".") or "0"
    return {
        "cover_image_url": cld_url("video", f"c_limit,h_1280,q_auto,so_{so},w_1280", public_id, "jpg"),
        "video_preview_url": cld_url("video", T_VIDEO_PREVIEW, public_id, "mp4"),
        "video_full_url": cld_url("video", T_VIDEO_FULL, public_id, "mp4"),
    }


def cld_asset_of(url: Optional[str]) -> Optional[tuple[str, str]]:
    """(type, public_id) d'une adresse construite par cld_url, sinon None (fichiers locals media/...)."""
    if not url or not CLD.cloud_name:
        return None
    prefix = f"{settings.cloudinary_delivery_base}/{CLD.cloud_name}/"
    if not url.startswith(prefix):
        return None
    m = re.fullmatch(r"(image|video)/upload/[^/]+/([A-Za-z0-9_/-]+?)(\.[A-Za-z0-9]{2,5})?", url[len(prefix):])
    return (m.group(1), m.group(2)) if m else None


def cld_destroy(assets: set[tuple[str, str]]) -> None:
    """Efface les fichiers sur Cloudinary (tâche de fond, sans bloquer l'administration)."""
    if not CLD.ready:
        return
    for rtype, public_id in assets:
        fields = {"public_id": public_id, "timestamp": str(int(time.time())), "invalidate": "true"}
        fields["signature"] = cld_sign(fields)
        fields["api_key"] = CLD.api_key
        req = urllib.request.Request(
            f"{settings.cloudinary_api_base}/{CLD.cloud_name}/{rtype}/destroy",
            data=urllib.parse.urlencode(fields).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "sama-abana-studio/1.0"},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                log.info("Cloudinary : %s %s supprimé (%s)", rtype, public_id, res.read(200).decode("utf-8", "replace"))
        except Exception:
            log.exception("Cloudinary : impossible de supprimer %s %s", rtype, public_id)


def nearest_ratio(width: Optional[int], height: Optional[int]) -> str:
    if not width or not height:
        return "9:16"
    r = width / height
    return min(ASPECT_RATIOS, key=lambda a: abs(math.log(r / (int(a.split(":")[0]) / int(a.split(":")[1])))))


def slugify(text: str) -> str:
    s = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80].strip("-") or "projet"


# --------------------------------------------------------------------------- données de départ
SEED_PROJECTS = [
    dict(
        title="NK Beauty — spot publicitaire 60\u00a0s",
        slug="nk-beauty-spot",
        description="Publicité motion design pour un salon de beauté : fil d'or qui dessine le logo, "
        "transitions en perspective, quatre services animés et carte de contact. Livrée en 9:16, 4:5 et 1:1.",
        category=ProjectCategory.ANIMATION_2D,
        cover_image_url="media/nk-spot.jpg",
        video_preview_url="media/nk-spot-preview.mp4",
        video_full_url="media/nk-spot.mp4",
        client="NK Beauty",
        sort_order=1,
        is_featured=True,
    ),
    dict(
        title="NK Beauty — révélation du logo",
        slug="nk-beauty-logo",
        description="Une mèche de cheveux tracée en lumière dorée devient l'arche du salon, puis le logo apparaît.",
        category=ProjectCategory.ANIMATION_2D,
        cover_image_url="media/nk-logo.jpg",
        video_preview_url="media/nk-logo-preview.mp4",
        video_full_url="media/nk-logo.mp4",
        client="NK Beauty",
        sort_order=2,
    ),
    dict(
        title="NK Beauty — transitions en perspective",
        slug="nk-beauty-transitions",
        description="Panneaux vidéo qui pivotent en 3D sur fond noir pour enchaîner les espaces du salon.",
        category=ProjectCategory.ANIMATION_3D,
        cover_image_url="media/nk-transitions.jpg",
        video_preview_url="media/nk-transitions-preview.mp4",
        video_full_url="media/nk-transitions.mp4",
        client="NK Beauty",
        sort_order=3,
    ),
    dict(
        title="NK Beauty — séquence services",
        slug="nk-beauty-services",
        description="Quatre écrans de services avec typographie animée et illustrations tracées à la main : "
        "onglerie, tresses, pose lace, makeup.",
        category=ProjectCategory.ANIMATION_2D,
        cover_image_url="media/nk-services.jpg",
        video_preview_url="media/nk-services-preview.mp4",
        video_full_url="media/nk-services.mp4",
        client="NK Beauty",
        sort_order=4,
    ),
]


def seed(db: Session) -> None:
    if db.scalar(select(Project.id).limit(1)) is not None:
        return
    db.add_all(Project(**p) for p in SEED_PROJECTS)
    db.commit()
    log.info("Base initialisée avec %d projets.", len(SEED_PROJECTS))


# --------------------------------------------------------------------------- application
@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    if not email_enabled():
        log.warning("E-mail non configuré : les demandes de devis seront enregistrées sans notification e-mail.")
    yield


app = FastAPI(
    title="Motion Design by Sama Abana — API",
    version="1.0.0",
    description="Portfolio et demandes de devis du studio.",
    lifespan=lifespan,
)

if settings.allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Admin-Token"],
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    path = request.url.path
    if path.startswith(("/media/", "/assets/")):
        response.headers.setdefault("Cache-Control", "public, max-age=604800")
    elif path.startswith(("/admin", "/api/admin")):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


# ---- API publique
@app.get("/api/health", tags=["système"])
def health(db: DB) -> dict:
    db.execute(select(1))
    return {"status": "ok", "email_notifications": email_enabled(), "email_provider": email_provider() or None}


@app.get("/api/meta", response_model=SiteMeta, tags=["système"])
def meta() -> SiteMeta:
    return SiteMeta(categories={c.value: l for c, l in CATEGORY_LABELS.items()}, budget_ranges=BUDGET_RANGES)


@app.get("/api/projects", response_model=list[ProjectOut], tags=["portfolio"])
def list_projects(
    db: DB,
    category: Optional[ProjectCategory] = Query(default=None, description="Filtrer par catégorie"),
    featured: Optional[bool] = Query(default=None),
) -> list[ProjectOut]:
    stmt = select(Project).where(Project.is_published.is_(True))
    if category:
        stmt = stmt.where(Project.category == category)
    if featured is not None:
        stmt = stmt.where(Project.is_featured.is_(featured))
    stmt = stmt.order_by(Project.sort_order, Project.created_at.desc())
    return [ProjectOut.build(p) for p in db.scalars(stmt)]


@app.get("/api/projects/{slug}", response_model=ProjectOut, tags=["portfolio"])
def get_project(slug: str, db: DB) -> ProjectOut:
    p = db.scalar(select(Project).where(Project.slug == slug, Project.is_published.is_(True)))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projet introuvable.")
    return ProjectOut.build(p)


@app.post("/api/quotes", response_model=QuoteAccepted, status_code=status.HTTP_201_CREATED, tags=["devis"])
def create_quote(payload: QuoteCreate, request: Request, background: BackgroundTasks, db: DB) -> QuoteAccepted:
    if payload.website:  # robot : on répond comme si tout allait bien, sans rien enregistrer
        return QuoteAccepted(id=0, message="Demande envoyée.")
    if rate_limited(client_ip(request)):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Trop de demandes envoyées depuis cette connexion. Réessayez dans une heure ou écrivez sur WhatsApp.",
        )
    q = QuoteRequest(**payload.model_dump(exclude={"website"}))
    db.add(q)
    db.commit()
    db.refresh(q)
    background.add_task(notify_new_quote, q.id)
    return QuoteAccepted(id=q.id, message="Demande envoyée.")


# ---- API d'administration (en-tête X-Admin-Token)
@app.get("/api/admin/email-test", tags=["administration"])
def email_test(
    request: Request,
    token: Optional[str] = Query(default=None, description="Valeur de ADMIN_TOKEN (Render > Environment)"),
    x_admin_token: Annotated[Optional[str], Header()] = None,
) -> dict:
    """Envoie un e-mail de test et affiche la réponse du fournisseur : à ouvrir dans le navigateur."""
    check_admin(x_admin_token or token, client_ip(request))
    if not email_enabled():
        return {"ok": False, "error": "Aucun fournisseur d'e-mail configuré (RESEND_API_KEY vide)."}
    try:
        send_email(
            settings.notify_email,
            "Test d'envoi — Motion Design by Sama Abana",
            "Si vous lisez ce message, les demandes de devis du site arriveront bien ici.",
        )
        return {"ok": True, "provider": email_provider(), "from": _sender(), "to": settings.notify_email}
    except Exception as err:  # on renvoie l'erreur exacte pour pouvoir la corriger
        return {"ok": False, "provider": email_provider(), "from": _sender(), "to": settings.notify_email, "error": str(err)}


@app.get("/api/admin/quotes", response_model=list[QuoteOut], dependencies=[Admin], tags=["administration"])
def list_quotes(db: DB, status_filter: Optional[QuoteStatus] = Query(default=None, alias="status")) -> list[QuoteRequest]:
    stmt = select(QuoteRequest).order_by(QuoteRequest.created_at.desc())
    if status_filter:
        stmt = stmt.where(QuoteRequest.status == status_filter)
    return list(db.scalars(stmt))


@app.patch("/api/admin/quotes/{quote_id}", response_model=QuoteOut, dependencies=[Admin], tags=["administration"])
def update_quote(quote_id: int, payload: QuoteStatusUpdate, db: DB) -> QuoteRequest:
    q = db.get(QuoteRequest, quote_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Demande introuvable.")
    q.status = payload.status
    db.commit()
    return q


def ordered_projects(db: Session) -> list[Project]:
    return list(db.scalars(select(Project).order_by(Project.sort_order, Project.created_at.desc(), Project.id.desc())))


def renumber(projects: list[Project]) -> None:
    for i, p in enumerate(projects, start=1):
        p.sort_order = i


def put_on_top(db: Session, target: Project) -> None:
    """« À la une » : un seul projet, affiché en grand en tête du portfolio."""
    for p in db.scalars(select(Project).where(Project.is_featured.is_(True), Project.id != target.id)):
        p.is_featured = False
    target.is_featured = True
    rest = [p for p in ordered_projects(db) if p.id != target.id]
    renumber([target, *rest])


def unique_slug(db: Session, title: str) -> str:
    base = slugify(title)
    slug = base
    while db.scalar(select(Project.id).where(Project.slug == slug)):
        slug = f"{base}-{secrets.token_hex(2)}"
    return slug


def get_project_or_404(db: Session, slug: str) -> Project:
    p = db.scalar(select(Project).where(Project.slug == slug))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projet introuvable.")
    return p


def project_assets(p: Project) -> set[tuple[str, str]]:
    return {a for a in (cld_asset_of(p.video_full_url), cld_asset_of(p.cover_image_url), cld_asset_of(p.video_preview_url)) if a}


@app.get("/api/admin/status", dependencies=[Admin], tags=["administration"])
def admin_status(db: DB) -> dict:
    pending = db.scalars(select(QuoteRequest.id).where(QuoteRequest.status == QuoteStatus.PENDING)).all()
    return {
        "projects": len(db.scalars(select(Project.id)).all()),
        "quotes_pending": len(pending),
        "storage_ready": CLD.ready,
        "storage_error": CLD.error or None,
        "cloud_name": CLD.cloud_name or None,
        "email_provider": email_provider() or None,
        "notify_email": settings.notify_email,
        "max_mb": {k: v // (1024 * 1024) for k, v in MAX_UPLOAD_BYTES.items()},
    }


@app.get("/api/admin/projects", response_model=list[ProjectAdminOut], dependencies=[Admin], tags=["administration"])
def admin_list_projects(db: DB) -> list[ProjectAdminOut]:
    return [ProjectAdminOut.build(p) for p in ordered_projects(db)]


@app.post("/api/admin/upload-params", dependencies=[Admin], tags=["administration"])
def upload_params(payload: UploadParamsIn) -> dict:
    """Autorisation signée (valable 1 h) pour envoyer un fichier directement du téléphone vers Cloudinary."""
    if not CLD.ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, CLD.error or "Stockage non configuré : ajoutez CLOUDINARY_URL dans Render > Environment.")
    return cld_upload_params(payload.kind)


@app.post("/api/admin/media/discard", status_code=204, dependencies=[Admin], tags=["administration"])
def discard_media(payload: MediaDiscardIn, background: BackgroundTasks, db: DB) -> None:
    """Fichier envoyé puis abandonné (formulaire annulé) : on libère la place."""
    used = any((payload.kind, payload.public_id) in project_assets(p) for p in db.scalars(select(Project)))
    if not used:
        background.add_task(cld_destroy, {(payload.kind, payload.public_id)})


@app.post("/api/admin/projects", response_model=ProjectOut, status_code=201, dependencies=[Admin], tags=["administration"])
def create_project(payload: ProjectCreate, db: DB) -> ProjectOut:
    if db.scalar(select(Project.id).where(Project.slug == payload.slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce slug existe déjà.")
    p = Project(**payload.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return ProjectOut.build(p)


@app.post("/api/admin/media-projects", response_model=ProjectAdminOut, status_code=201, dependencies=[Admin], tags=["administration"])
def create_media_project(payload: MediaProjectCreate, db: DB) -> ProjectAdminOut:
    """Ajout depuis /admin : le serveur construit lui-même les adresses Cloudinary."""
    if not CLD.ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, CLD.error or "Stockage non configuré.")
    p = Project(
        title=payload.title,
        slug=unique_slug(db, payload.title),
        description=payload.description,
        category=payload.category,
        client=payload.client,
        aspect_ratio=payload.aspect_ratio or nearest_ratio(payload.width, payload.height),
        is_published=payload.is_published,
        is_featured=False,
        sort_order=0,
        **cld_media_urls(payload.kind, payload.public_id, payload.cover_time),
    )
    db.add(p)
    db.flush()
    if payload.is_featured:
        put_on_top(db, p)
    else:
        # le nouveau travail passe en tête, juste après le projet « à la une »
        rest = [x for x in ordered_projects(db) if x.id != p.id]
        at = 1 if rest and rest[0].is_featured else 0
        renumber([*rest[:at], p, *rest[at:]])
    db.commit()
    db.refresh(p)
    log.info("Projet ajouté depuis l'admin : %s (%s)", p.slug, payload.kind)
    return ProjectAdminOut.build(p)


@app.patch("/api/admin/projects/{slug}", response_model=ProjectAdminOut, dependencies=[Admin], tags=["administration"])
def update_project(slug: str, payload: ProjectUpdate, db: DB) -> ProjectAdminOut:
    p = get_project_or_404(db, slug)
    data = payload.model_dump(exclude_unset=True)
    for required in ("title", "category", "description"):
        if required in data and data[required] is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Le champ {required} ne peut pas être vide.")
    featured = data.pop("is_featured", None)
    for k, v in data.items():
        setattr(p, k, v)
    if featured is True and not p.is_featured:
        put_on_top(db, p)
    elif featured is False:
        p.is_featured = False
    db.commit()
    db.refresh(p)
    return ProjectAdminOut.build(p)


@app.post("/api/admin/projects/reorder", response_model=list[ProjectAdminOut], dependencies=[Admin], tags=["administration"])
def reorder_projects(payload: ReorderIn, db: DB) -> list[ProjectAdminOut]:
    by_slug = {p.slug: p for p in ordered_projects(db)}
    wanted = [by_slug[s] for s in dict.fromkeys(payload.slugs) if s in by_slug]
    others = [p for p in by_slug.values() if p not in wanted]
    final = [*wanted, *others]
    renumber(final)
    # « À la une » veut dire « en grand, en premier » : un projet descendu perd ce statut.
    for p in final[1:]:
        p.is_featured = False
    db.commit()
    return [ProjectAdminOut.build(p) for p in ordered_projects(db)]


@app.delete("/api/admin/projects/{slug}", status_code=204, dependencies=[Admin], tags=["administration"])
def delete_project(slug: str, background: BackgroundTasks, db: DB) -> None:
    p = get_project_or_404(db, slug)
    assets = project_assets(p)
    db.delete(p)
    db.commit()
    still_used = set().union(*(project_assets(x) for x in db.scalars(select(Project)))) if assets else set()
    if assets - still_used:
        background.add_task(cld_destroy, assets - still_used)


# ---- fichiers du site (seuls ces fichiers sont exposés, jamais main.py ni .env)
for folder in ("media", "assets"):
    (BASE_DIR / folder).mkdir(exist_ok=True)
    app.mount(f"/{folder}", StaticFiles(directory=BASE_DIR / folder), name=folder)


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html", media_type="text/html; charset=utf-8")


@app.get("/robots.txt", include_in_schema=False)
def robots() -> PlainTextResponse:
    return PlainTextResponse(
        f"User-agent: *\nDisallow: /api/\nDisallow: /docs\nDisallow: /admin\nSitemap: {settings.site_url}/sitemap.xml\n"
    )


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap() -> Response:
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"<url><loc>{settings.site_url}/</loc><changefreq>monthly</changefreq></url></urlset>\n"
    )
    return Response(xml, media_type="application/xml")


@app.get("/style.css", include_in_schema=False)
def stylesheet() -> FileResponse:
    return FileResponse(BASE_DIR / "style.css", media_type="text/css; charset=utf-8")


@app.get("/script.js", include_in_schema=False)
def javascript() -> FileResponse:
    return FileResponse(BASE_DIR / "script.js", media_type="text/javascript; charset=utf-8")


def _origin(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


# ---- espace d'administration (une seule page, protégée par le mot de passe ADMIN_TOKEN)
@app.get("/admin", include_in_schema=False)
def admin_page() -> FileResponse:
    api, cdn = _origin(settings.cloudinary_api_base), _origin(settings.cloudinary_delivery_base)
    csp = (
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; "
        f"img-src 'self' blob: data: {cdn}; media-src 'self' blob: {cdn}; connect-src 'self' {api}; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    return FileResponse(
        BASE_DIR / "admin.html", media_type="text/html; charset=utf-8", headers={"Content-Security-Policy": csp}
    )


@app.get("/admin.webmanifest", include_in_schema=False)
def admin_manifest() -> FileResponse:
    return FileResponse(BASE_DIR / "admin.webmanifest", media_type="application/manifest+json")


@app.get("/admin.css", include_in_schema=False)
def admin_css() -> FileResponse:
    return FileResponse(BASE_DIR / "admin.css", media_type="text/css; charset=utf-8")


@app.get("/admin.js", include_in_schema=False)
def admin_js() -> FileResponse:
    return FileResponse(BASE_DIR / "admin.js", media_type="text/javascript; charset=utf-8")


if __name__ == "__main__":  # python main.py
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
