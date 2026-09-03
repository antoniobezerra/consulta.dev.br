from __future__ import annotations

import os
import re
import time
from collections import defaultdict, deque
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

load_dotenv()
MAX_BODY_BYTES = 1_000_000

API_BASE_URL = os.getenv("CONSULTA_API_BASE_URL", "https://consulta.dev.br").rstrip("/")
API_KEY = os.getenv("CONSULTA_API_KEY", "")
PROJECT_ID = os.getenv("CONSULTA_PROJECT_ID", "")
PARTNER_ORIGIN = os.getenv("CONSULTA_PARTNER_ORIGIN", "")
if not API_KEY or not PROJECT_ID or not PARTNER_ORIGIN:
    raise RuntimeError("Defina CONSULTA_API_KEY, CONSULTA_PROJECT_ID e CONSULTA_PARTNER_ORIGIN no ambiente do servidor.")

app = FastAPI(docs_url=None, redoc_url=None)
windows: dict[str, deque[float]] = defaultdict(deque)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionPayload(StrictModel):
    protocol_version: Literal[1]
    document_type: Literal["auto", "cnh-e", "crlv-e"]


class DecodePayload(StrictModel):
    protocol_version: Literal[1]
    session_token: str
    payload_base64: str
    include_photo: bool

    @field_validator("session_token")
    @classmethod
    def valid_token(cls, value: str) -> str:
        if not 32 <= len(value) <= 4096:
            raise ValueError("invalid token")
        return value

    @field_validator("payload_base64")
    @classmethod
    def valid_base64(cls, value: str) -> str:
        if not 4 <= len(value) <= MAX_BODY_BYTES or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", value):
            raise ValueError("invalid payload")
        return value


def error(code: str, message: str, status: int = 400) -> JSONResponse:
    return JSONResponse(
        {"success": False, "error": {"code": code, "message": message, "retryable": status >= 500}, "request_id": "partner_local"},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def allowed_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    return not origin or origin == PARTNER_ORIGIN


def local_rate_limit(request: Request, scope: str, limit: int) -> bool:
    # Demonstração local: use Redis/chave de usuário em produção distribuída.
    key = f"{scope}:{request.client.host if request.client else 'unknown'}"
    now = time.monotonic()
    queue = windows[key]
    while queue and now - queue[0] >= 60:
        queue.popleft()
    if len(queue) >= limit:
        return False
    queue.append(now)
    return True


async def read_payload(request: Request, model: type[StrictModel]) -> StrictModel | None:
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_BODY_BYTES):
        return None
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return None
    try:
        return model.model_validate_json(body)
    except ValidationError:
        return None


async def forward(path: str, payload: dict) -> JSONResponse:
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.post(
                f"{API_BASE_URL}{path}",
                headers={
                    "Content-Type": "application/json",
                    "X-API-Key": API_KEY,
                    "X-Consulta-Product": "autofill",
                    "X-Consulta-Project-ID": PROJECT_ID,
                },
                json=payload,
            )
        try:
            data = response.json()
        except ValueError:
            return error("UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", 503)
        return JSONResponse(data, status_code=response.status_code, headers={"Cache-Control": "no-store"})
    except httpx.HTTPError:
        # Não inclua o payload em logs ou respostas.
        return error("UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", 503)


async def require_partner_access(_request: Request) -> bool:
    # Substitua por sessão, RBAC e escopo de cadastro do seu produto.
    return True


@app.post("/api/consulta-autofill/session")
async def create_session(request: Request) -> JSONResponse:
    if not allowed_origin(request):
        return error("INVALID_ORIGIN", "Origem não autorizada.", 403)
    if not await require_partner_access(request):
        return error("UNAUTHENTICATED", "Não autorizado.", 401)
    if not local_rate_limit(request, "session", 20):
        return error("RATE_LIMITED", "Muitas sessões; tente novamente em breve.", 429)
    payload = await read_payload(request, SessionPayload)
    if not payload:
        return error("INVALID_REQUEST", "Sessão Autofill inválida.")
    return await forward("/api/v1/autofill/sessions", {**payload.model_dump(), "partner_origin": PARTNER_ORIGIN})


@app.post("/api/consulta-autofill/decode")
async def decode(request: Request) -> JSONResponse:
    if not allowed_origin(request):
        return error("INVALID_ORIGIN", "Origem não autorizada.", 403)
    if not await require_partner_access(request):
        return error("UNAUTHENTICATED", "Não autorizado.", 401)
    if not local_rate_limit(request, "decode", 60):
        return error("RATE_LIMITED", "Muitas leituras; tente novamente em breve.", 429)
    payload = await read_payload(request, DecodePayload)
    if not payload:
        return error("INVALID_REQUEST", "Decode Autofill inválido.")
    return await forward("/api/v1/autofill/decode", payload.model_dump())
