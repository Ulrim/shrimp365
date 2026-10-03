"""작업 워커(APScheduler) — phase-2 슬라이스 H(docs/design/phase-2.md 1.5절).

스프린트 0 은 기동만 확인하는 placeholder였다. phase-2 는 `job_evaluate_alerts`(3종
알림 배치 평가, app/services/alert_jobs.py — Rule 1: 산식은 culiver_kpi 호출만)를
주기 배치로 등록한다. 신규 워커 프로세스 도입 없음(과설계 금지, docker-compose 의 기존
worker 서비스가 이 모듈을 그대로 실행).

배치 간격은 산식이 아니라 운영 파라미터이므로 .env/환경변수로 관리한다(Rule 2 대상 아님).
"""

from __future__ import annotations

import logging
import os
import time
from datetime import UTC, datetime

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("culiver-worker")

# 알림 평가 배치 주기(분). 운영 파라미터(Rule 2 비대상) — .env 로 조정 가능.
ALERT_EVAL_INTERVAL_MINUTES = int(os.environ.get("ALERT_EVAL_INTERVAL_MINUTES", "15"))


def run_alert_evaluation_once() -> None:
    """job_evaluate_alerts 1회 실행 + 커밋(배치 단일 트랜잭션)."""
    from app.db.session import SessionLocal
    from app.services.alert_jobs import job_evaluate_alerts

    session = SessionLocal()
    try:
        created = job_evaluate_alerts(session, evaluated_at=datetime.now(UTC))
        session.commit()
        log.info("alert evaluation done: %d new alert(s)", len(created))
    except Exception:
        session.rollback()
        log.exception("alert evaluation failed")
        raise
    finally:
        session.close()


def main() -> None:
    log.info(
        "culiver worker started (phase-2 슬라이스 H: job_evaluate_alerts 매 %d분)",
        ALERT_EVAL_INTERVAL_MINUTES,
    )
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler

        scheduler = BlockingScheduler()
        scheduler.add_job(
            run_alert_evaluation_once,
            "interval",
            minutes=ALERT_EVAL_INTERVAL_MINUTES,
            id="evaluate_alerts",
            next_run_time=datetime.now(UTC),  # 기동 즉시 1회 실행.
        )
        scheduler.start()
    except ModuleNotFoundError:
        # apscheduler 미설치 환경(예: 로컬 헬스체크용 이미지) 폴백 — 단순 sleep 루프로 헬스만 유지.
        log.warning("apscheduler not installed; falling back to heartbeat-only loop")
        while True:
            time.sleep(60)
            log.debug("worker heartbeat")


if __name__ == "__main__":
    main()
