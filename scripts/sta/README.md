# scripts/sta — STA 시험성적서용 측정 도구 (AI·데이터: 수질 이상징후 탐지 정확도)

시험 대상은 플랫폼 판정 함수(`lib/thresholds.ts` 의 `checkThresholds` · `detectTrendAnomalies`)다.
여기 있는 것은 **기록 출력과 재계산**뿐이고 판정 로직은 없다. 시험 대상 파일은 고치지 않는다.

| 파일 | 하는 일 |
|---|---|
| `sta.config.json` | 기준값(재현율)·셈법 설정, 시험 대상 sha256 고정. 「결정 필요」 항목은 사람이 채운다 |
| `eval-anomaly.mjs` | 사례마다 플랫폼 함수를 불러 `02_사례별_결과.csv` · `03_최종결과.json` 을 쓴다 |
| `recompute.mjs` | `02_사례별_결과.csv` 만 읽어 최종값을 다시 계산·대조한다(불일치면 종료 코드 1) |
| `build-cases.mjs` | 원본(정규화 CSV) + `사례계획.json` → 사례 묶음(cases.csv · series/ · sha256sums.txt · 통계.txt) |
| `normalize-log.py` | 수기 수질일지(xlsx, 「…_수온_pH_DO_사료량」 시트)를 정규화 CSV 로 옮긴다(파이썬 표준 라이브러리만) |
| `source-stats.mjs` | 받은 원본 자료의 수조 수·기간·측정 간격·결측률 정리 |
| `cases/라벨기준.md` | 정답을 붙이는 기준표(확인 전 초안) |
| `../../raspberry-pi/sta_eval.py` | 참고: 같은 사례를 장비 판정(`anomaly.detect`)에 넣는다 |
| `test/sta.test.mjs` | `npm run sta:test` |

```
npm run sta:test        # 도구 시험
npm run sta:eval        # 측정  → sta_AI데이터/
npm run sta:recompute   # 재계산
```

Node 22.18 이상이 필요하다(`.ts` 를 그대로 import). 외부 패키지는 쓰지 않는다.
시험 당일 순서는 `docs/sta/STA-시험당일-실행순서.md`.

원본 자료와 결과 폴더(`sta_AI데이터/`)는 저장소에 올리지 않는다.
