"""Pub/sub broadcaster with Redis and in-process (asyncio) implementations.

All real-time events (count_update / alert / camera_status) flow through a
single `Broadcaster` facade. When a Redis server is reachable, messages are
published on a Redis channel so multiple processes share the stream; when it
is not, an in-process fan-out keeps WebSocket broadcasting fully functional.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)

REDIS_CHANNEL = "shrimp_vision:events"


class Broadcaster:
    """Fan-out hub: services publish event dicts, WebSocket handlers subscribe.

    Every published message must contain a `camera_id` key; subscribers filter
    on their own subscription sets.
    """

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._redis: Any | None = None
        self._listener_task: asyncio.Task | None = None
        self._started = False

    # -- lifecycle ----------------------------------------------------------
    async def start(self) -> None:
        if self._started:
            return
        self._started = True
        try:
            import redis.asyncio as aioredis

            client = aioredis.from_url(
                settings.redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=True,
            )
            await asyncio.wait_for(client.ping(), timeout=2)
            self._redis = client
            self._listener_task = asyncio.create_task(self._redis_listener())
            logger.info("Broadcaster: using Redis pub/sub (%s)", settings.redis_url)
        except Exception as exc:  # noqa: BLE001 - any failure => local mode
            self._redis = None
            logger.warning(
                "Broadcaster: Redis unavailable (%s) — falling back to in-process pub/sub", exc
            )

    async def stop(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None
        if self._redis is not None:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
            self._redis = None
        self._started = False

    # -- publish / subscribe --------------------------------------------------
    async def publish(self, message: dict[str, Any]) -> None:
        """Publish an event. Routed via Redis when connected, else locally."""
        if self._redis is not None:
            try:
                await self._redis.publish(REDIS_CHANNEL, json.dumps(message, default=str))
                return  # local delivery happens through the listener task
            except Exception as exc:  # noqa: BLE001
                logger.warning("Broadcaster: Redis publish failed (%s); local fan-out", exc)
        self._deliver_local(message)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    # -- internals ------------------------------------------------------------
    def _deliver_local(self, message: dict[str, Any]) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                # Slow consumer: drop the oldest message to keep latency low.
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    queue.put_nowait(message)

    async def _redis_listener(self) -> None:
        assert self._redis is not None
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(REDIS_CHANNEL)
        try:
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    self._deliver_local(json.loads(item["data"]))
                except (TypeError, ValueError):
                    logger.warning("Broadcaster: dropped malformed redis message")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Broadcaster: redis listener died (%s); local-only mode", exc)
            self._redis = None


broadcaster = Broadcaster()
