# culiver-api

컬리버 MRV 플랫폼 FastAPI 백엔드(스프린트 0).

- 엔드포인트: `GET /sites/{site_id}/kpi` (EI 산출), `GET /health`.
- KPI 산식은 `packages/kpi`(culiver_kpi)에서만 정의하며 API 는 `compute_ei` 를 호출만 한다(CLAUDE Rule 1).
- 멀티테넌시 3중 방어: JWT(org_id) → RLS(`SET app.current_org_id`) → 서비스 재검증(tenancy).

## 로컬 실행
```
make migrate     # DATABASE_URL 지정(기본 sqlite)
make seed
cd apps/api && uvicorn app.main:app --reload
```

## 테스트
```
cd apps/api && python -m pytest -q
```
SQLite 로 실행되며 TimescaleDB/RLS 특수기능은 우회한다(격리는 tenancy 서비스로 검증).
