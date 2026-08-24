#!/usr/bin/env python3
"""Audit/delay wrapper for the official MCP Python SDK simple-auth fixture.

[Input] Official SDK simple-auth package on PYTHONPATH and an explicit audit path.
[Output] Delegated OAuth plus redirect-only JSONL, delayed exchange, and fixed response mutations.
[Pos] Test-only observer; delegates DCR, authorization, token, and MCP auth state to the official provider.
[Sync] 2026-08-24: optionally remove token_type from official success responses after the first exchange.
"""

from __future__ import annotations

import asyncio
import json
import os
from hashlib import sha256
from pathlib import Path
from typing import Any

from mcp_simple_auth import legacy_as_server
from mcp.server.auth.handlers.token import TokenHandler
from mcp.server.auth.provider import TokenError
from mcp.shared.auth import OAuthToken


audit_path_raw = os.environ.get("INK_MCP_OAUTH_AUDIT_PATH", "")
if not audit_path_raw or not Path(audit_path_raw).is_absolute():
    raise SystemExit("INK_MCP_OAUTH_AUDIT_PATH must be an explicit absolute path")
audit_path = Path(audit_path_raw)
token_delay_raw = os.environ.get("INK_MCP_OAUTH_TOKEN_DELAY_SECONDS", "")
try:
    token_delay_seconds = float(token_delay_raw)
except ValueError as exc:
    raise SystemExit("INK_MCP_OAUTH_TOKEN_DELAY_SECONDS must be numeric") from exc
if not 1.0 < token_delay_seconds <= 10.0:
    raise SystemExit("INK_MCP_OAUTH_TOKEN_DELAY_SECONDS must be greater than 1 and at most 10")
token_error_on_second_exchange = os.environ.get(
    "INK_MCP_OAUTH_TOKEN_ERROR_ON_SECOND_EXCHANGE",
    "",
)
if token_error_on_second_exchange not in {"", "invalid_grant"}:
    raise SystemExit("INK_MCP_OAUTH_TOKEN_ERROR_ON_SECOND_EXCHANGE must be empty or invalid_grant")
token_response_mutation = os.environ.get("INK_MCP_OAUTH_TOKEN_RESPONSE_MUTATION", "")
if token_response_mutation not in {"", "missing_token_type"}:
    raise SystemExit("INK_MCP_OAUTH_TOKEN_RESPONSE_MUTATION must be empty or missing_token_type")

_original_token_response = TokenHandler.response
_successful_token_response_count = 0


def _token_response_hook(self, obj):  # type: ignore[no-untyped-def]
    """Mutate only the serialized official response; the provider owns the flow."""

    global _successful_token_response_count
    response = _original_token_response(self, obj)
    if isinstance(obj, OAuthToken):
        _successful_token_response_count += 1
        if _successful_token_response_count >= 2 and token_response_mutation == "missing_token_type":
            payload = json.loads(response.body)
            payload.pop("token_type", None)
            response.body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            response.headers["content-length"] = str(len(response.body))
            _audit("token-response-mutation", field="token_type")
    return response


TokenHandler.response = _token_response_hook


def _audit(event: str, **fields: Any) -> None:
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"event": event, **fields}, sort_keys=True) + "\n")


def _client_key(client_id: str | None) -> str:
    if not client_id:
        raise ValueError("OAuth client_id is required")
    return sha256(client_id.encode("utf-8")).hexdigest()


class CapturingOAuthProvider(legacy_as_server.LegacySimpleOAuthProvider):
    """Observe public redirect metadata while preserving the SDK provider state machine."""

    async def register_client(self, client_info):  # type: ignore[no-untyped-def]
        _audit(
            "register",
            client_key=_client_key(client_info.client_id),
            redirect_uris=[str(uri) for uri in client_info.redirect_uris],
        )
        return await super().register_client(client_info)

    async def authorize(self, client, params):  # type: ignore[no-untyped-def]
        _audit(
            "authorize",
            client_key=_client_key(client.client_id),
            redirect_uri=str(params.redirect_uri),
        )
        return await super().authorize(client, params)

    async def exchange_authorization_code(  # type: ignore[no-untyped-def]
        self,
        client,
        authorization_code,
    ):
        fields = {
            "client_key": _client_key(client.client_id),
            "redirect_uri": str(authorization_code.redirect_uri),
        }
        _audit("token-exchange-start", **fields)
        await asyncio.sleep(token_delay_seconds)
        exchange_count = getattr(self, "_ink_exchange_count", 0) + 1
        self._ink_exchange_count = exchange_count
        if exchange_count >= 2 and token_error_on_second_exchange:
            _audit("token-error", error=token_error_on_second_exchange)
            raise TokenError(
                error="invalid_grant",
                error_description="fixture-controlled token failure must remain private",
            )
        result = await super().exchange_authorization_code(client, authorization_code)
        _audit("token", **fields)
        return result

    async def load_access_token(self, token: str):
        result = await super().load_access_token(token)
        _audit("access-token-check", authenticated=result is not None)
        return result


legacy_as_server.LegacySimpleOAuthProvider = CapturingOAuthProvider
legacy_as_server.main()
