# MRV 플랫폼 — 인계 문서

작성 2026-10-24 · 개정 2026-10-25(마이그레이션 목록 정정) · 브랜치 `claude/mrv-platform-github-merge-zqhf88`

이 문서는 **사람이 해야 하는 일**과 **지금 무엇이 되고 무엇이 안 되는지**를 적는다.
기능 설명서가 아니라 인계장이다. 결과보고서에 그대로 옮기지 말고, 여기서 사실만
가져다 쓸 것.

---

## 1. 먼저 — 사람이 실행해야 하는 SQL (전부 10개)

**이 저장소에는 service_role 키가 없다.** 마이그레이션 실행은 사람 몫이다.
Supabase SQL Editor 에서 실행한다. 모두 멱등이라 여러 번 돌려도 안전하다.

### 1-1. 무엇이 빠졌는지 먼저 확인한다

DB 에 어디까지 적용됐는지는 **조회해 보지 않으면 알 수 없다.** 이 문서의 초판이
"다섯 개" 라고 적은 것은 이번 작업에서 만든 것만 세고 그 앞의 것들이 이미 적용돼
있다고 **확인 없이 가정**했기 때문이다. 실제 DB 에서는 10개 중 6개가 미적용이었고,
`mrv_emission_factor_source.sql` 이 `column "source_url" does not exist` 로 실패했다.

```sql
select '1. mrv_readings.source' as 항목, to_char(count(*), 'FM0') as 있음
  from information_schema.columns
 where table_schema='public' and table_name='mrv_readings' and column_name='source'
union all select '2. mrv_emission_factors.source_url', to_char(count(*), 'FM0')
  from information_schema.columns
 where table_schema='public' and table_name='mrv_emission_factors' and column_name='source_url'
union all select '3. mrv_emission_factors.deprecated_at', to_char(count(*), 'FM0')
  from information_schema.columns
 where table_schema='public' and table_name='mrv_emission_factors' and column_name='deprecated_at'
union all select '3b. KR-GRID-2023 계수 행', to_char(count(*), 'FM0')
  from public.mrv_emission_factors where version='KR-GRID-2023'
union all select '4. mrv_device_pairings 표', to_char(count(*), 'FM0')
  from information_schema.tables
 where table_schema='public' and table_name='mrv_device_pairings'
union all select '5. mrv_kpi_config.org_id', to_char(count(*), 'FM0')
  from information_schema.columns
 where table_schema='public' and table_name='mrv_kpi_config' and column_name='org_id'
union all select '6. mrv_harvest_logs.production_basis', to_char(count(*), 'FM0')
  from information_schema.columns
 where table_schema='public' and table_name='mrv_harvest_logs' and column_name='production_basis'
union all select '7. mrv_api_keys.revoked_at', to_char(count(*), 'FM0')
  from information_schema.columns
 where table_schema='public' and table_name='mrv_api_keys' and column_name='revoked_at'
union all select '8. mrv_readings.measurement_basis', to_char(count(*), 'FM0')
  from information_schema.columns
 where table_schema='public' and table_name='mrv_readings' and column_name='measurement_basis';
```

`1` 이면 적용됨, `0` 이면 빠진 것이다. **끝난 뒤 다시 돌려 여덟 줄이 전부 `1` 인지
확인한다.**

### 1-2. 실행 순서

파일은 전부 `supabase/migrations/` 에 있다.

| 순서 | 파일 | 안 돌리면 | 점검 항목 |
|---|---|---|---|
| ① | `mrv_platform.sql` | 아무것도 동작하지 않는다(기반 스키마) | — |
| ② | `mrv_readings_source.sql` | 계측값 출처(device/manual/csv)를 저장할 수 없다 | 1 |
| ③ | `mrv_emission_factor_provenance.sql` | **⑩이 `source_url does not exist` 로 실패한다** | 2 |
| ④ | `mrv_emission_factor_2023.sql` | 0.4173 계수 행이 없다 | 3 · 3b |
| ⑤ | `mrv_device_pairing.sql` | 현장 장비 페어링이 실패한다 | 4 |
| **⑥** | **`mrv_kpi_config_org_scope.sql`** | **`/kpi`·리포트·알림·추천이 전부 실패한다. 배포 전 필수.** | 5 |
| ⑦ | `mrv_harvest_logs_production_basis.sql` | 생산량 입력이 503 으로 거절된다(의도 — 적어 넣은 산정 근거가 조용히 사라지는 것보다 낫다). KPI 조회는 미기재로 둔 채 정상 동작 | 6 |
| ⑧ | `mrv_api_key_revocation.sql` | 장비 키 목록·폐기 화면이 실패한다. 수집은 정상 | 7 |
| ⑨ | `mrv_readings_measurement_basis.sql` | 수집은 멈추지 않는다(폴백). 전력이 전부 「미기재」로 남고 리포트가 "실측인지 알 수 없다" 를 인쇄한다 | 8 |
| ⑩ | `mrv_emission_factor_source.sql` | 배출계수 출처(GIR 문서명·URL)가 리포트에 인쇄되지 않는다 | — |

**의존 관계는 둘뿐이다.** ⑩은 ③·④ 뒤에만 돌아간다(③이 만드는 열을 갱신하고 ④가 넣는
행을 찾는다). 나머지는 서로 독립이지만, 위 순서대로 돌리면 틀릴 일이 없다.

**⑥은 배포 전에 반드시** 돌려야 한다. 코드가 먼저 올라가면 그 열이 없어 KPI 산출
경로가 통째로 멈춘다.

> ⑨에 폴백이 있는 이유: 계측값은 증빙이고 자료유형은 그 증빙에 대한 메타데이터다.
> 메타데이터를 적을 칸이 없는 것이 증빙을 받지 못할 이유가 되어서는 안 된다. 열이
> 없으면 그 칸을 빼고 저장하고, 로그에 크게 남기며, SQL 을 돌리면 **추가 조치 없이**
> 정상 경로로 돌아온다(10분 안에). ⑦은 반대로 **거절**한다 — 칸만 빼고 저장하면
> 사람이 적어 넣은 "계산생체량" 이 조용히 사라진 채 생산량만 들어가고 되돌릴 수 없다.

### 1-3. 끝난 뒤 눈으로 확인할 것

- 설정 화면 — 배출계수에 출처(GIR 문서명·URL)가 보이는가
- `/mrv/input` — 생산량이 저장되는가
- 개요 화면 — EI 가 「산출 불가」에서 값으로 바뀌는가
- `/mrv/settings` 의 「수조 · DO 목표대역」 — 대역을 넣으면 개요의 OEI 가 값으로 바뀌는가
- `/mrv/input` 의 「입식 등록 (배치)」 — 등록하면 급이·폐사 폼의 배치 선택에 나타나는가

> **수조 · 입식 창구에는 새 SQL 이 필요 없다.** `mrv_tanks.target_do_min/max` 와
> `mrv_batches.stocked_count` 는 처음부터 있던 열이고, 없던 것은 그 열에 쓰는 길뿐이었다.
> 위 10개 외에 더 실행할 것은 없다.

---

## 2. 사람이 해야 하는 나머지

- **배출계수 1차 대조** — 0.4173 의 출처는 사용자가 작성한 계산표의 「지표정의」 시트를
  근거로 채웠다(GIR 「2025년 승인 국가 온실가스 배출·흡수계수」 1쪽, 공표 2025-12-18,
  대상연도 2023). 원문 PDF 쪽수까지 확정하려면 사람이 한 번 더 대조해야 한다.
- **SNS·외부 제출물 업로드** — 이 저장소가 하지 않는다.
- **엑스텐비 0.4663 의 출처 확인** — 통합 대시보드가 쓰는 값이 우리 0.4173 과 다르다.
  어느 쪽을 쓸지는 사람이 정해야 하고, 섞으면 같은 기간에 두 배출량이 나온다.

---

## 3. 지금 되는 것

### 수집 (증빙 입력)
- **전력 수기 입력** — 웹(`/mrv/input`)과 **기계실 터치스크린**(라즈베리파이) 양쪽.
  파이는 계량기 옆에서 지침을 바로 넣고, 회선이 끊기면 보관했다가 나중에 올린다.
- **적산 지침 2건 규칙** — 지침은 두 건의 차이로만 사용량이 된다. 장비가 직전 지침을
  함께 보내 한 건만 넣어도 구간값이 나오게 한다.
- **기록지 CSV** — 급이·폐사·전력(구간/적산). 견본 서식 내려받기 포함.
- **현장 장비 페어링** — 6자리 코드로 장비에 수집 키를 발급. 원문 키는 장비가 한 번만
  가져가고 DB 에는 해시만 남는다. 끊는 화면도 있다.
- **전력 자료유형** — 계량기 실측인지 계산값인지 구분해 저장하고 리포트가 밝힌다.
- **생산량 입력** — 수기 + 기록지 CSV(`/mrv/input`). EI·FCR·OEI 의 **분모**가
  이 값이다. 이것이 없으면 전력을 아무리 잘 모아도 EI 가 영원히 null 이었다.
- **생산량 산정 근거** — 실측 출하량인가, 입식수×평균체중 계산생체량인가, 어림인가.
  계산·어림이면 **무엇으로 계산했는지** 적게 한다(근거 없는 딱지는 검산할 수 없는
  주장이라 딱지가 없는 것보다 나쁘다). 생존율 보정 적용 여부도 함께 받는다.
  리포트가 EI 분모를 만든 **두 점**의 근거를 인쇄하고, 실측이 아니면 경고한다.
- **입식 등록(배치)** — `/mrv/input` 의 「입식 등록 (배치)」. 입식 수가 **폐사율의
  분모**다. 배치가 없으면 급이·폐사·생산량의 배치 선택이 비어 이 화면 전체가 쓰이지
  않는다. 수정 창구는 없다 — 입식 수를 고치면 이미 발행된 폐사율이 소급해 달라진다.
- **수조 · DO 목표대역** — `/mrv/settings` 의 「수조 · DO 목표대역」. 이 두 수가
  **OEI 의 유일한 산출 조건**이다. 대역이 설정된 수조가 여럿이면 id 가 가장 앞선
  하나가 기준이고, 화면이 어느 수조인지 이름으로 적는다. 대역을 넓히면 유지율이
  올라가 OEI 가 좋아지므로 변경은 감사 로그에 남는다.

### 산출 (증빙 생성)
- KPI 5종(EI 총/폭기 · FCR · OEI · 폐사율) + Scope 2 + 전·후 비교
- **기준선 잠금** — 잠그기 전에 입력 충분성을 판정해 모자라면 막는다. 잠근 뒤에는
  DB 트리거가 변경을 거부한다.
- **MRV 리포트** — 배출계수 출처·측정경계·산정 가정을 발행 시점에 얼려 인쇄한다.

### 증빙으로서의 정직성 (이번 과제에서 집중한 부분)
- **산출 불가는 null 로 남기고 왜인지 말한다.** 0 으로 치환하지 않는다.
- **OEI 는 「잠정 지표」로 표시된다** — 사업계획서에 산식이 없는 제안값이고, 스케일
  계수와 신호등 임계값은 실증 전 가정이다.
- **품질 플래그를 넓히면 경고한다** — 적산 원값이 EI 분자로 새는 길을 쓰기 경계에서
  막는다. 빈 목록은 EI 를 0 으로 만들어 「감축률 100%」가 나오므로 422 로 거부한다.
- **배출계수 출처**가 리포트에 인쇄된다.

---

## 4. 지금 안 되는 것 — 결과보고에 반영할 것

| | 내용 |
|---|---|
| **수확 기록 수정·삭제 경로 없음** | 잘못 넣은 생산량을 지우려면 DB 를 직접 고쳐야 한다. `app/api/mrv` 전체에 DELETE 라우트가 없는 기존 상태 그대로다. |
| **Scope 2 market-based 미구현** | 현재는 location-based 만. REC·PPA·녹색프리미엄은 다루지 않는다. 한국에는 공표된 residual mix 가 없다. |
| **OEI 가 기본 알림 감시 목록에 있다** | 산식이 미확정인 지표로 빨간 알림이 나간다. 빼는 것이 맞다고 보지만, 그 기본값은 원본 Python 과 차분검증된 자리라 원본·픽스처와 함께 다뤄야 한다. |

---

## 5. 검증 상태

```
npm run mrv:verify     10종
  KPI 차분 250 시나리오 · config 매핑 102 문서 · 계측값 정규화 44배치/372건
  조립 25 시나리오 · 알림 60시나리오/128건
  CSV 121 · 기준선 충분성 127 · KPI 쓰기 경계 58 · 화면 대비 88쌍 · 스키마 방어선
npx tsc --noEmit       통과
npm run build          통과
```

라즈베리파이:
```
python3 raspberry-pi/verify.py        모두 통과
python3 raspberry-pi/verify-mrv.py    모두 통과
i18n 297항목 × 4언어(ko/en/vi/id)      빠짐 없음
800×480 실측                           27탭 × 4언어
```

생산량을 넣으면 EI 가 실제로 산출되는 것까지 브라우저로 확인했다 — 입력 전
「산출 불가」, 두 건 입력 후 같은 화면에서 EI 가 값으로 바뀐다.

**차분 검증이 무엇인가** — `lib/mrv/kpi/` 의 산식은 원본 Python 엔진과 같은 입력에
같은 출력을 내는지 시나리오별로 대조한다. 그래서 그 폴더는 이번 과제에서 **한 줄도
바꾸지 않았다.** 필요한 방어는 전부 그 밖(쓰기 경계·표시 계층)에 두었다.

---

## 6. 개발 중 발견해 막은 것 (증빙 신뢰성 관련)

결과보고서에 "무엇을 왜 고쳤는가" 로 쓸 수 있는 것들이다.

1. **적산 원값이 EI 로 새는 길** — 첫 적산 지침은 `value` 에 구간값이 아니라 적산
   원값(예: 12,000 kWh)이 `suspect` 로 앉는다. 기본 설정에서는 빠지지만 그 목록이
   아무 검증도 받지 않아, `["ok","suspect"]` 로 바꾸면 그 원값이 분자에 통째로
   들어갔다. 쓰기 경계에서 막았다.
2. **빈 품질 플래그 목록 = 감축률 100%** — EI 가 null 이 아니라 **0** 이 되어
   "완벽한 성과" 로 읽힌다. 422 로 거부한다.
3. **KPI 설정의 테넌시 누수** — 한 조직의 owner 가 넣은 설정이 플랫폼 전체 조직의
   KPI·신호등·알림 임계값이 됐다. 조직 범위로 가뒀다.
4. **마이그레이션 전 배포 시 수집 사망** — 인증 질의와 계측값 insert 가 아직 없는 열을
   건드려 500 이 났다. 전 장비의 수집이 막히는 경로였다. 둘 다 닫았다.
5. **장비 키를 끊을 수 없었다** — 발급은 되는데 폐기 경로가 DB 직접 수정뿐이었다.
6. **파이 설정 파일 한 줄로 장비가 15초마다 재시작** — `[mrv] ; 주석` 형태의 꼬리
   주석을 헤더로 못 알아봐 구간을 중복 생성, `DuplicateSectionError` 로 수질 수집까지
   멈췄다.
7. **거부된 보관분을 「전송 완료」로 적었다** — 서버는 전부 거부해도 200 으로 답하는데
   장비가 상태코드만 봤다. 사람이 계량기 앞에서 적은 값이 사라졌다.

---

## 7. 검사에 대한 주의

이 과제에서 **세 번 연속으로** 같은 함정이 나왔다 — 검사가 "이름이 소스에 있는지" 만
보아, 기능을 지워도 함수 정의 안·`aria-label` 속성·타입 이름에 그 낱말이 남아
**통과했다.** 지금은 셋 다 **출력물**(렌더된 HTML·응답 객체·실제 보간된 자식)을 보도록
고쳤다.

새 검사를 더할 때는 **일부러 되돌려 FAIL 하는지 반드시 확인할 것.** 통과만 보고
믿으면 그 검사는 아무것도 지키지 않는다.
