"""Native Hermes platform adapter for WhatsApp Manager.

Install this module in a Hermes checkout or plugin package, then call
``register_platform()`` during plugin initialization. It uses Hermes'
gateway platform path, so active-session queue/steer/stop behavior stays
inside Hermes while WhatsApp transport remains owned by WhatsApp Manager.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import httpx

from gateway.config import Platform, PlatformConfig
from gateway.platform_registry import PlatformEntry, platform_registry
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)
from gateway.session import SessionSource

logger = logging.getLogger(__name__)

PLATFORM_NAME = "whatsapp-manager"


@dataclass(frozen=True)
class WhatsAppManagerClientConfig:
    base_url: str
    api_token: str
    poll_interval_seconds: float = 1.0
    page_size: int = 50
    cursor_file: str = ""
    kitchen_api_base_url: str = ""
    kitchenia_api_key: str = ""
    kitchenia_auth_header: str = "Authorization"
    kitchenia_auth_scheme: str = "Bearer"
    kitchen_default_id: str = "1"


class WhatsAppManagerAdapter(BasePlatformAdapter):
    """Hermes adapter backed by WhatsApp Manager's platform event queue."""

    supports_code_blocks = False
    splits_long_messages = False

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform(PLATFORM_NAME))
        self.client_config = self._read_client_config(config)
        self._client: Optional[httpx.AsyncClient] = None
        self._poll_task: Optional[asyncio.Task] = None
        explicit_cursor = str(config.extra.get("cursor") or os.environ.get("WHATSAPP_MANAGER_CURSOR") or "").strip()
        self._cursor = explicit_cursor or self._read_cursor_file() or "0"

    async def connect(self, *, is_reconnect: bool = False) -> bool:
        if not self.client_config.base_url or not self.client_config.api_token:
            self._set_fatal_error(
                "missing_config",
                "WHATSAPP_MANAGER_API_URL and WHATSAPP_MANAGER_API_TOKEN are required.",
                retryable=False,
            )
            return False

        self._client = httpx.AsyncClient(
            base_url=self.client_config.base_url.rstrip("/"),
            headers={"authorization": f"Bearer {self.client_config.api_token}"},
            timeout=30,
        )
        self._poll_task = asyncio.create_task(self._poll_loop(), name="whatsapp-manager-platform-poll")
        self._mark_connected()
        logger.info("[whatsapp-manager] Connected to %s", self.client_config.base_url)
        return True

    async def disconnect(self) -> None:
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None
        if self._client:
            await self._client.aclose()
            self._client = None
        self._mark_disconnected()
        logger.info("[whatsapp-manager] Disconnected")

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[dict[str, Any]] = None,
    ) -> SendResult:
        if not self._client:
            return SendResult(success=False, error="WhatsApp Manager adapter is not connected", retryable=True)

        metadata = metadata or {}
        chat_account_id, raw_chat_id = split_manager_chat_id(chat_id)
        account_id = str(metadata.get("accountId") or metadata.get("account_id") or chat_account_id).strip()
        chat_jid = str(metadata.get("chatJid") or metadata.get("chat_jid") or raw_chat_id).strip()
        if not account_id:
            return SendResult(success=False, error="Missing accountId for WhatsApp Manager reply")
        if not chat_jid:
            return SendResult(success=False, error="Missing chatJid for WhatsApp Manager reply")

        try:
            response = await self._client.post(
                "/agent/platform/replies",
                json={
                    "accountId": account_id,
                    "chatJid": chat_jid,
                    "text": content,
                    "inboundMessageId": reply_to or metadata.get("inboundMessageId") or metadata.get("message_id"),
                    "sessionKey": metadata.get("sessionKey") or metadata.get("session_key"),
                    "participantJid": metadata.get("participantJid") or metadata.get("participant_jid"),
                },
            )
            response.raise_for_status()
            payload = response.json()
            delivery = payload.get("delivery", {}) if isinstance(payload, dict) else {}
            return SendResult(
                success=True,
                message_id=str(delivery.get("id") or "") or None,
                raw_response=payload,
            )
        except Exception as exc:
            logger.warning("[whatsapp-manager] Reply delivery failed: %s", exc)
            return SendResult(success=False, error=str(exc), retryable=True)

    async def get_chat_info(self, chat_id: str) -> dict[str, Any]:
        account_id, raw_chat_id = split_manager_chat_id(chat_id)
        return {
            "id": chat_id,
            "chat_id": chat_id,
            "name": raw_chat_id,
            "type": "group" if raw_chat_id.endswith("@g.us") else "dm",
            "account_id": account_id,
            "platform": PLATFORM_NAME,
        }

    async def _poll_loop(self) -> None:
        while True:
            try:
                await self._poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("[whatsapp-manager] Event poll failed: %s", exc)
            await asyncio.sleep(self.client_config.poll_interval_seconds)

    async def _poll_once(self) -> None:
        if not self._client:
            return
        response = await self._client.get(
            "/agent/platform/events",
            params={
                "cursor": self._cursor,
                "limit": self.client_config.page_size,
            },
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items", []) if isinstance(payload, dict) else []
        for item in items:
            if isinstance(item, dict):
                if await self._try_handle_with_kitchen(item):
                    continue
                await self.handle_message(self._to_message_event(item))
        if isinstance(payload, dict) and payload.get("nextCursor") is not None:
            self._cursor = str(payload["nextCursor"])
            self._write_cursor_file(self._cursor)

    def _to_message_event(self, item: dict[str, Any]) -> MessageEvent:
        account_id = str(item["accountId"])
        chat_jid = str(item["chatJid"])
        chat_type = "group" if item.get("chatType") == "group" else "dm"
        participant_jid = item.get("participantJid")
        source = SessionSource(
            platform=self.platform,
            chat_id=f"{account_id}:{chat_jid}",
            chat_name=str(item.get("chatName") or chat_jid),
            chat_type=chat_type,
            user_id=str(item.get("senderJid") or chat_jid),
            user_name=str(item.get("senderName") or item.get("senderJid") or chat_jid),
            thread_id=str(participant_jid) if participant_jid else None,
            message_id=str(item.get("messageId") or ""),
        )
        return MessageEvent(
            text=str(item.get("text") or ""),
            message_type=MessageType.TEXT,
            source=source,
            raw_message=item,
            message_id=str(item.get("messageId") or ""),
            metadata={
                "accountId": account_id,
                "chatJid": chat_jid,
                "chatType": item.get("chatType") or "direct",
                "sessionKey": item.get("sessionKey"),
                "participantJid": participant_jid,
                "inboundMessageId": item.get("messageId"),
            },
        )

    def _read_client_config(self, config: PlatformConfig) -> WhatsAppManagerClientConfig:
        extra = config.extra or {}
        cursor_file = str(
            extra.get("cursor_file")
            or os.environ.get("WHATSAPP_MANAGER_CURSOR_FILE")
            or default_cursor_file()
        ).strip()
        return WhatsAppManagerClientConfig(
            base_url=str(extra.get("base_url") or os.environ.get("WHATSAPP_MANAGER_API_URL") or "").strip(),
            api_token=str(extra.get("api_token") or os.environ.get("WHATSAPP_MANAGER_API_TOKEN") or "").strip(),
            poll_interval_seconds=float(extra.get("poll_interval_seconds") or os.environ.get("WHATSAPP_MANAGER_POLL_INTERVAL") or 1),
            page_size=int(extra.get("page_size") or os.environ.get("WHATSAPP_MANAGER_PAGE_SIZE") or 50),
            cursor_file=cursor_file,
            kitchen_api_base_url=str(extra.get("kitchen_api_base_url") or os.environ.get("KITCHEN_API_BASE_URL") or "").strip(),
            kitchenia_api_key=str(extra.get("kitchenia_api_key") or os.environ.get("HERMES_KITCHENIA_API_KEY") or "").strip(),
            kitchenia_auth_header=str(extra.get("kitchenia_auth_header") or os.environ.get("HERMES_KITCHENIA_AUTH_HEADER") or "Authorization").strip(),
            kitchenia_auth_scheme=str(extra.get("kitchenia_auth_scheme") or os.environ.get("HERMES_KITCHENIA_AUTH_SCHEME") or "Bearer").strip(),
            kitchen_default_id=str(extra.get("kitchen_default_id") or os.environ.get("KITCHEN_DEFAULT_ID") or "1").strip(),
        )

    async def _try_handle_with_kitchen(self, item: dict[str, Any]) -> bool:
        if not self._client or not self.client_config.kitchen_api_base_url:
            return False

        text = str(item.get("text") or "").strip()
        if not text:
            return False

        account_id = str(item.get("accountId") or "").strip()
        chat_jid = str(item.get("chatJid") or "").strip()
        sender_jid = str(item.get("senderJid") or chat_jid).strip()
        kitchen_id = extract_kitchen_id(text) or self.client_config.kitchen_default_id
        phone = normalize_whatsapp_phone(sender_jid or chat_jid)
        if not kitchen_id or not phone:
            return False

        headers = {"content-type": "application/json"}
        if self.client_config.kitchenia_api_key:
            auth_value = (
                f"{self.client_config.kitchenia_auth_scheme} {self.client_config.kitchenia_api_key}".strip()
                if self.client_config.kitchenia_auth_scheme
                else self.client_config.kitchenia_api_key
            )
            headers[self.client_config.kitchenia_auth_header] = auth_value

        try:
            response = await self._client.post(
                f"{self.client_config.kitchen_api_base_url.rstrip('/')}/hermes/messages",
                headers=headers,
                json={
                    "message": {
                        "id": str(item.get("messageId") or ""),
                        "text": text,
                        "phone": phone,
                        "kitchenId": kitchen_id,
                    },
                    "context": {
                        "accountId": account_id,
                        "chatJid": chat_jid,
                        "senderJid": sender_jid,
                        "phone": phone,
                        "kitchenId": kitchen_id,
                    },
                },
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:
            logger.warning("[whatsapp-manager] Kitchen backend handoff failed: %s", exc)
            return False

        outbound = payload.get("outboundResponse") if isinstance(payload, dict) else None
        if not isinstance(outbound, dict) or outbound.get("status") != "success":
            return False

        reply_text = format_kitchen_reply(payload)
        if not reply_text:
            return False

        send_result = await self.send(
            f"{account_id}:{chat_jid}",
            reply_text,
            reply_to=str(item.get("messageId") or ""),
            metadata={
                "accountId": account_id,
                "chatJid": chat_jid,
                "sessionKey": item.get("sessionKey"),
                "participantJid": item.get("participantJid"),
                "inboundMessageId": item.get("messageId"),
            },
        )
        return send_result.success

    def _read_cursor_file(self) -> str:
        if not self.client_config.cursor_file:
            return ""
        try:
            return Path(self.client_config.cursor_file).read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return ""
        except Exception as exc:
            logger.warning("[whatsapp-manager] Could not read cursor file %s: %s", self.client_config.cursor_file, exc)
            return ""

    def _write_cursor_file(self, cursor: str) -> None:
        if not self.client_config.cursor_file:
            return
        try:
            path = Path(self.client_config.cursor_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = path.with_name(f"{path.name}.tmp")
            tmp_path.write_text(cursor, encoding="utf-8")
            tmp_path.replace(path)
        except Exception as exc:
            logger.warning("[whatsapp-manager] Could not write cursor file %s: %s", self.client_config.cursor_file, exc)


def check_requirements() -> bool:
    return True


def validate_config(config: PlatformConfig) -> bool:
    extra = config.extra or {}
    return bool(
        str(extra.get("base_url") or os.environ.get("WHATSAPP_MANAGER_API_URL") or "").strip()
        and str(extra.get("api_token") or os.environ.get("WHATSAPP_MANAGER_API_TOKEN") or "").strip()
    )


def split_manager_chat_id(chat_id: str) -> tuple[str, str]:
    if ":" not in chat_id:
        return "", chat_id
    account_id, _, raw_chat_id = chat_id.partition(":")
    return account_id, raw_chat_id


def normalize_whatsapp_phone(jid: str) -> str:
    value = jid.split("@", 1)[0]
    digits = "".join(ch for ch in value if ch.isdigit())
    return f"+{digits}" if digits else ""


def extract_kitchen_id(text: str) -> str:
    words = text.replace("#", " ").replace(":", " ").split()
    for index, word in enumerate(words[:-1]):
        if word.lower() in {"cocina", "kitchen", "kitchenid"}:
            candidate = "".join(ch for ch in words[index + 1] if ch.isdigit())
            if candidate:
                return candidate
    return ""


def format_kitchen_reply(payload: dict[str, Any]) -> str:
    outbound = payload.get("outboundResponse") if isinstance(payload, dict) else {}
    context = outbound.get("context") if isinstance(outbound, dict) else {}
    message = str(outbound.get("message") or "").strip() if isinstance(outbound, dict) else ""
    order_id = str(context.get("orderId") or "").strip() if isinstance(context, dict) else ""
    order_status = str(context.get("orderStatus") or "").strip() if isinstance(context, dict) else ""

    order = (
        payload.get("runtimeResult", {})
        .get("orchestratorResult", {})
        .get("adapterResult", {})
        .get("data", {})
        .get("order", {})
    )
    items = order.get("items", []) if isinstance(order, dict) else []
    item_summary = ", ".join(
        f"{item.get('quantity')} x {item.get('nameSnapshot') or item.get('name')}"
        for item in items
        if isinstance(item, dict) and item.get("quantity") and (item.get("nameSnapshot") or item.get("name"))
    )
    total = order.get("total") if isinstance(order, dict) else None

    if message == "draft_created":
        details = f" ({item_summary})" if item_summary else ""
        total_text = f" Total: ${total}." if total is not None else ""
        return f"Pedido creado{details}. ID: {order_id or 'nuevo'}.{total_text} Responde confirmar para continuarlo."
    if message == "order_retrieved":
        details = f" ({item_summary})" if item_summary else ""
        total_text = f" Total: ${total}." if total is not None else ""
        return f"Pedido {order_id}: {order_status or 'en proceso'}{details}.{total_text}"
    if message:
        return message
    return ""


def default_cursor_file() -> str:
    home = os.environ.get("HERMES_HOME") or "/opt/data"
    return str(Path(home) / "whatsapp-manager" / "platform-cursor")


def register_platform() -> None:
    platform_registry.register(PlatformEntry(
        name=PLATFORM_NAME,
        label="WhatsApp Manager",
        adapter_factory=lambda cfg: WhatsAppManagerAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        required_env=["WHATSAPP_MANAGER_API_URL", "WHATSAPP_MANAGER_API_TOKEN"],
        source="plugin",
        allowed_users_env="WHATSAPP_MANAGER_ALLOWED_USERS",
        allow_all_env="WHATSAPP_MANAGER_ALLOW_ALL_USERS",
        cron_deliver_env_var="WHATSAPP_MANAGER_HOME_CHANNEL",
        pii_safe=True,
        emoji="WA",
        platform_hint=(
            "You are replying through WhatsApp Manager. Kitchen order messages are "
            "handled by the KitchenIA backend when KITCHEN_API_BASE_URL is configured. "
            "Keep fallback replies concise and send only text that should be delivered to the chat."
        ),
    ))


def register(ctx) -> None:
    """Hermes plugin entry point."""
    ctx.register_platform(
        name=PLATFORM_NAME,
        label="WhatsApp Manager",
        adapter_factory=lambda cfg: WhatsAppManagerAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        required_env=["WHATSAPP_MANAGER_API_URL", "WHATSAPP_MANAGER_API_TOKEN"],
        install_hint="Run WhatsApp Manager and configure the API URL/token.",
        allowed_users_env="WHATSAPP_MANAGER_ALLOWED_USERS",
        allow_all_env="WHATSAPP_MANAGER_ALLOW_ALL_USERS",
        cron_deliver_env_var="WHATSAPP_MANAGER_HOME_CHANNEL",
        max_message_length=4096,
        pii_safe=True,
        emoji="WA",
        platform_hint=(
            "You are replying through WhatsApp Manager. Kitchen order messages are "
            "handled by the KitchenIA backend when KITCHEN_API_BASE_URL is configured. "
            "Keep fallback replies concise and send only text that should be delivered to the chat."
        ),
    )
