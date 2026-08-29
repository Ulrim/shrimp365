"""MQTT ingestion 소비자 골격(sub-priority) — phase-1 3.4절.

토픽: `culiver/v1/{site_id}/{meter_id}/telemetry` (QoS 1, at-least-once).
페이로드: 3.3 의 readings[] 원소와 동일 JSON. **tenancy 는 토픽이 아니라 게이트웨이
API Key 인증으로 확정**(토픽 site_id 는 라우팅 힌트일 뿐 신뢰하지 않는다).

설계 원칙(과설계 금지): 실제 브로커 배선은 Docker/CI 에서 수행하며, 브로커 미가동/
라이브러리(paho-mqtt) 부재 시 **안전하게 no-op** 한다(HTTP 경로가 대체 수용). 이 모듈은
HTTP 라우터와 **동일한 `ingestion.process_batch` 서비스**를 호출하는 얇은 소비자 골격만
제공한다(정규화·멱등 로직 단일 소스 유지).

미배선 항목(의도적):
  - 게이트웨이별 API Key 매핑(연결 인증 or payload 내 키) → get_ingest_context 재사용.
  - 재연결/백오프, QoS1 in-flight 관리 → 브로커 배선 시(Phase 2 인프라).
"""

from __future__ import annotations

import json
import logging

from app.db.session import SessionLocal, set_org_context
from app.services.ingestion import RawReading, process_batch

logger = logging.getLogger("culiver.mqtt")

TOPIC_PATTERN = "culiver/v1/+/+/telemetry"  # {site_id}/{meter_id}


def _handle_payload(raw_payload: bytes | str, *, org_id: str, site_id: str) -> None:
    """수신 메시지 1건을 파싱해 동일 ingestion 서비스로 저장(멱등).

    org_id/site_id 는 **게이트웨이 인증으로 확정된 스코프**여야 한다(토픽 아님).
    브로커 배선 시 연결 인증에서 (org_id, site_id) 를 주입한다.
    """
    try:
        doc = json.loads(raw_payload)
    except (ValueError, TypeError):
        logger.warning("mqtt: malformed json payload dropped")
        return

    items = doc.get("readings") if isinstance(doc, dict) else None
    if not isinstance(items, list) or not items:
        logger.warning("mqtt: payload has no readings[]")
        return

    raws = [
        RawReading(
            index=i,
            meter_id=str(it.get("meter_id")),
            ts=it.get("ts"),
            value=float(it.get("value")),
            reading_kind=str(it.get("reading_kind")),
            seq=it.get("seq"),
        )
        for i, it in enumerate(items)
    ]

    session = SessionLocal()
    try:
        set_org_context(session, org_id)
        result = process_batch(session, org_id=org_id, site_id=site_id, raws=raws)
        session.commit()
        logger.info(
            "mqtt ingest: accepted=%d deduped=%d rejected=%d",
            result.accepted,
            result.deduped,
            len(result.rejected),
        )
    finally:
        session.close()


def run_consumer(broker_host: str = "localhost", broker_port: int = 1883) -> None:
    """브로커 구독 루프. paho-mqtt 부재/브로커 미가동 시 no-op(HTTP 경로 대체).

    실제 배선은 Docker/CI 에서. 여기서는 구조만 제공(과설계 금지).
    """
    try:
        import paho.mqtt.client as mqtt  # type: ignore
    except ImportError:
        logger.info("mqtt: paho-mqtt not installed; consumer disabled (HTTP path active)")
        return

    def _on_message(_client, _userdata, msg) -> None:  # pragma: no cover - 브로커 필요
        # NOTE: (org_id, site_id) 는 게이트웨이 인증에서 와야 한다. 토픽 site_id 는 힌트.
        # 실배선 시 연결 인증 컨텍스트에서 주입 — 여기서는 골격만.
        logger.debug("mqtt message on %s", msg.topic)

    client = mqtt.Client()
    client.on_message = _on_message
    try:
        client.connect(broker_host, broker_port)
    except OSError:
        logger.info("mqtt: broker unreachable at %s:%d; consumer disabled", broker_host, broker_port)
        return
    client.subscribe(TOPIC_PATTERN, qos=1)
    client.loop_forever()


if __name__ == "__main__":  # pragma: no cover
    logging.basicConfig(level=logging.INFO)
    run_consumer()
