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

import html
import json
import logging
import os
import re
import secrets
import smtplib
import ssl
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from email.message import EmailMessage
from enum import Enum as PyEnum
from pathlib import Path
from typing import Annotated, Iterator, Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
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
    admin_token = os.getenv("ADMIN_TOKEN", "")
    allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    quote_rate_limit = int(os.getenv("QUOTE_RATE_LIMIT_PER_HOUR", "5"))
    whatsapp_number = "237656294043"


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
    is_featured: bool
    created_at: datetime

    @classmethod
    def build(cls, p: Project) -> "ProjectOut":
        out = cls.model_validate(p)
        out.category_label = CATEGORY_LABELS[p.category]
        return out


class ProjectCreate(BaseModel):
    title: str = Field(min_length=2, max_length=150)
    slug: str = Field(min_length=2, max_length=150, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    description: str = Field(min_length=10)
    category: ProjectCategory
    cover_image_url: str = Field(max_length=500)
    video_preview_url: Optional[str] = Field(default=None, max_length=500)
    video_full_url: str = Field(max_length=500)
    client: Optional[str] = Field(default=None, max_length=120)
    aspect_ratio: str = Field(default="9:16", pattern=r"^\d{1,2}:\d{1,2}$")
    sort_order: int = 100
    is_featured: bool = False
    is_published: bool = True


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


def require_admin(x_admin_token: Annotated[Optional[str], Header()] = None) -> None:
    if not settings.admin_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Administration désactivée : définissez ADMIN_TOKEN.")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, settings.admin_token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Jeton d'administration invalide.")


Admin = Depends(require_admin)


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
    if request.url.path.startswith(("media/", "/assets/")):
        response.headers.setdefault("Cache-Control", "public, max-age=604800")
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
def email_test(token: str = Query(description="Valeur de ADMIN_TOKEN (Render > Environment)")) -> dict:
    """Envoie un e-mail de test et affiche la réponse du fournisseur : à ouvrir dans le navigateur."""
    require_admin(token)
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


@app.post("/api/admin/projects", response_model=ProjectOut, status_code=201, dependencies=[Admin], tags=["administration"])
def create_project(payload: ProjectCreate, db: DB) -> ProjectOut:
    if db.scalar(select(Project.id).where(Project.slug == payload.slug)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Ce slug existe déjà.")
    p = Project(**payload.model_dump())
    db.add(p)
    db.commit()
    db.refresh(p)
    return ProjectOut.build(p)


@app.delete("/api/admin/projects/{slug}", status_code=204, dependencies=[Admin], tags=["administration"])
def delete_project(slug: str, db: DB) -> None:
    p = db.scalar(select(Project).where(Project.slug == slug))
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Projet introuvable.")
    db.delete(p)
    db.commit()


# ---- fichiers du site (seuls ces fichiers sont exposés, jamais main.py ni .env)
for folder in ("media", "assets"):
    (BASE_DIR / folder).mkdir(exist_ok=True)
    app.mount(f"/{folder}", StaticFiles(directory=BASE_DIR / folder), name=folder)


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "index.html", media_type="text/html; charset=utf-8")


@app.get("/style.css", include_in_schema=False)
def stylesheet() -> FileResponse:
    return FileResponse(BASE_DIR / "style.css", media_type="text/css; charset=utf-8")


@app.get("/script.js", include_in_schema=False)
def javascript() -> FileResponse:
    return FileResponse(BASE_DIR / "script.js", media_type="text/javascript; charset=utf-8")


if __name__ == "__main__":  # python main.py
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)
