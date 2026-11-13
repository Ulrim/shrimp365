# 현장 수조 라벨 자료 — 1회차 (2026-11-12, 급이대)

급이대(체크망)를 위에서 찍은 사진 12장과 새우 상자 라벨입니다.
배포 모델(`shrimp_yolov8n_416.onnx`)이 이 사진에서 0~5마리만 찾아서
(`docs/result-03-bluestartup/evidence/09_현장수조_1차확인.txt`), 수조 조건을
학습시키려고 만든 자료입니다.

| | |
|---|---|
| 사진 | 12장, 1512×2016, 휴대폰 촬영 (위치·기기 정보 없음 확인) |
| 상자 | 305개 (장당 12~31) — `labels/*.txt`, YOLO 형식, 클래스 `shrimp` 하나 |
| 보류 | 120건 — `hold.tsv` (새우인지 확정하지 못해 **상자를 치지 않은** 곳) |
| 장면 묶음 | `index.tsv` 의 A~D — 분할할 때 이 단위로 나눈다 |

## 꼭 알고 써야 할 것

1. **라벨은 AI 가 그렸고 사람 검수 전입니다.** 사진을 4~8조각으로 확대해 좌표
   눈금을 얹어 한 마리씩 읽고, 상자를 덧그린 그림으로 다시 확인하는 방식으로
   만들었습니다. 덧그린 그림으로 12장 모두 한 번 더 훑어봤지만, `docs/라벨링_기준.md`
   §5 의 "두 사람이 같은 장을 따로 작업해 비교"는 하지 않았습니다.
   **시험성적서용 정답으로 쓰려면 사람이 검수해야 합니다.**
2. **12장이 모두 같은 날·같은 급이대·같은 새우입니다.** 몇 초 간격으로 찍은 거의
   같은 장면도 있습니다(같은 묶음 안의 사진들). 이 자료 안에서 잰 성능은 다른 날·
   다른 수조에서보다 좋게 나옵니다. 독립된 시험용으로는 쓸 수 없습니다.
3. **수면 반사 구역은 덜 그려져 있습니다.** 머리부터 꼬리부채까지 윤곽을 따라갈 수
   있는 새우만 그렸고, 나머지는 `hold.tsv` 에 있습니다. 실제 마릿수는 상자 수보다
   많습니다.
4. 상자 범위는 **머리 앞 끝 ~ 꼬리부채 끝**, 더듬이·다리 제외입니다.
   탈피각으로 보이는 것, 나뭇잎, 기포는 그리지 않았습니다.

## 분할 규칙

파일 이름의 `.rf.` 앞부분(`tank1-20261112-feedtray`)이 촬영 회차입니다.
`prepare_dataset.py` 는 회차를 통째로 한 분할에 넣으므로, **회차가 하나뿐인
지금은 이 자료 전체가 한쪽(train)으로 갑니다.** 이 자료 안에서 성능을 가늠할 때는
`index.tsv` 의 장면 묶음 단위로 나눠 교차검증합니다(같은 묶음을 학습·평가 양쪽에
두지 않는다).

## 학습과 평가

```bash
cd vision
# 묶음 A 를 빼고 학습 → 뺀 묶음으로 평가 (B, C, D 도 같은 방식)
python ai/trainer/train_tank.py --holdout A --out data/tank/tiles/cvA
python ai/trainer/export_edge.py --weights ai/trainer/runs/tank_A/weights/last.pt --format onnx --imgsz 416
python ai/trainer/eval_detect.py --weights ai/trainer/runs/tank_A/weights/last.onnx \
  --images data/tank/tiles/cvA/heldout/images --labels data/tank/tiles/cvA/heldout/labels \
  --tile 1008 --conf 0.25

# 전부 학습 (배포용)
python ai/trainer/train_tank.py --holdout none --out data/tank/tiles/all
```

조각(`data/tank/tiles/`)과 학습 산출물(`ai/trainer/runs/`)은 저장소에 넣지 않습니다.

## 이 자료로 얻은 결과 (2026-11-13)

장면 묶음 4-겹 교차검증, 조각 1008px → 모델 입력 416, conf 0.25:
**mAP@0.5 평균 0.871(묶음별 0.799~0.955), 정밀도 0.771, 재현율 0.839,
계수 오차율 평균 14.5%.** 같은 사진에서 기존 배포 모델은 0~5마리만 찾았습니다.

12장 전부로 학습한 모델이 `vision/ai/models/shrimp_tank_yolov8n_416.onnx` 입니다.
이 모델은 **수조 사진 전용**이고 쟁반·흰 배경 사진은 보지 못합니다(기존 모델과
반대). 전체 수치와 한계는
`docs/result-03-bluestartup/evidence/10_현장수조_재학습_교차검증.txt` 에 있습니다.
