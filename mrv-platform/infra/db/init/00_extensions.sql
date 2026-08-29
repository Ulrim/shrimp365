-- TimescaleDB 확장 부트스트랩(컨테이너 최초 기동 시 실행).
-- docker-entrypoint-initdb.d 에 마운트되어 DB 생성 직후 1회 실행된다.
-- 확장이 없으면 마이그레이션이 일반 테이블로 폴백하므로 실패해도 치명적이지 않다.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- app.current_org_id GUC 는 세션에서 SET 되며 RLS 정책이 참조한다(sprint-0 2.3절).
-- 여기서는 별도 등록이 필요 없다(current_setting(..., true) 로 안전 조회).
