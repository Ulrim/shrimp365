# 개체수 계수 모델 학습과 라즈베리파이 적용

카메라 영상에서 흰다리새우 마리 수를 세는 모델을 만들어 파이에 올리기까지의
전 과정입니다. 배포(서버·주소·서비스 기동)는 [VISION_DEPLOY.md](VISION_DEPLOY.md)
에 있고, 이 문서는 **모델**만 다룹니다.

- 학습은 구글 Colab 에서 합니다(무료 GPU + 드라이브 직접 마운트).
- 노트북: `vision/ai/trainer/colab_train_shrimp.ipynb`
- 사람이 해야 하는 일은 §5, §6 두 곳입니다.

---

## 1. 무엇으로 학습하나 — 드라이브 데이터 판정

구글 드라이브 `00. 데이터 / 01. 흰다리새우 학습 데이터` 안의 다섯 폴더를 전부
확인했습니다. 결론부터:

| 폴더 | 내용 | 계수 모델 학습에 | 이유 |
|---|---|---|---|
| **03. shrimp_cf** → `shrimp_cf.v1i.yolov8` | 라벨 이미지 **5,032장**, 640×640, 클래스 `shrimp` | **주 학습 데이터** | 라벨이 있고 양이 충분합니다. 단 **세그멘테이션 폴리곤**이라 변환이 필요합니다(§2) |
| **04. Counting PL** → `Counting PL.v1i.yolov8` | 라벨 이미지 **213장**, 클래스 `Shrimp-baby`(자어) | **보조 학습 데이터** | 라벨은 있으나 양이 적고 대상이 자어입니다. 단일 클래스로 병합해 씁니다 |
| 02. 흰다리새우 이미지_해외 (DB1~DB5) | PNG 프레임 다수, **라벨 없음** | 2차로 투입 | 라벨이 없어 지금은 학습에 넣을 수 없습니다. 1차 모델이 나온 뒤 `pseudo_label.py` 로 박스를 미리 찍고 사람이 고쳐 쓰는 것이 가장 빠릅니다(§5) |
| 01. 스마트양식장 통합 데이터_AI허브 135 | 1.Training 원천데이터 = `TS_Timeseries.zip`(수질·성장 시계열), 라벨 = `TL1_수중`·`TL2_채집`·`TL3_개별`, 2.Validation 원천데이터 = `VS2_채집.zip`(1.66GB) | **못 씀** | 학습 분할의 **이미지 원천데이터가 없습니다**(시계열만 있음). 유일한 이미지 묶음 `VS2_채집` 은 물 밖에서 찍은 채집·계측 사진이라 수조 수중 계수와 도메인이 다릅니다 |
| 02. …_블루스타트업 (`shrimp_counter_FINAL_v2` 등) | 수행계획서·이전 산출물 | 참고 | 검수 기준의 출처입니다(§4) |

> AI허브 135 는 계수 모델에는 못 쓰지만 **수질·성장 시계열**이라 shrimp365 의
> 수질 분석 쪽에는 가치가 있습니다. 별도 과제로 다루는 것이 맞습니다.

### 합쳐서 쓸 수 있는 양

단일 클래스로 병합하면 **5,245장**(5,032 + 213)입니다. 계획서의 "3,000장 이상"
기준은 넘습니다.

---

## 2. 그냥 학습시키면 안 되는 이유 두 가지

이 두 가지 때문에 `prepare_dataset.py` 를 거칩니다. 건너뛰면 오류 없이 성능만
안 나옵니다 — 가장 찾기 어려운 실패입니다.

### (1) shrimp_cf 의 라벨은 박스가 아니라 폴리곤이다

라벨 한 줄이 이렇게 생겼습니다.

```
0 0.4812 0.3551 0.4890 0.3498 ... 0.4735 0.3612     ← 좌표 48개 = 24개 점
```

detect 모델(`yolov8n.pt`)은 한 줄을 `클래스 중심x 중심y 폭 높이`(필드 5개)로
읽습니다. 49개 필드짜리 폴리곤을 그대로 주면 앞 4개만 박스로 해석되어 전혀
다른 영역을 학습합니다. 그래서 폴리곤의 최소·최대 좌표로 박스를 만듭니다.

### (2) 두 데이터셋의 클래스 인덱스가 겹친다

`shrimp_cf` 는 `names: ['shrimp']`, `Counting PL` 은 `names: ['Shrimp-baby']`
인데 둘 다 `nc: 1` 이라 인덱스가 **똑같이 0** 입니다. 합치면 성체와 자어가 같은
클래스로 섞입니다.

기본값은 **단일 클래스 병합**(`shrimp`)입니다. 운영 검출기
(`app/services/detector.py`)가 클래스를 구분하지 않고 박스 수를 세기 때문에
이게 실제 동작과 맞고, 데이터도 최대로 씁니다. 성체와 자어를 구분해야 하면
`--stage-classes` 를 붙이면 `['shrimp', 'shrimp_pl']` 두 클래스가 됩니다.

### 덧붙여: 분할 누수 검사

같은 원본 프레임이 train 과 valid 에 함께 들어가 있으면 검증 점수가 부풀려져
"잘 된다"고 착각하게 됩니다. 영상에서 뽑은 프레임 데이터셋에서 특히 흔합니다.
`prepare_dataset.py` 는 파일 내용 해시와 Roboflow 원본 파일명(`.rf.` 앞부분)으로
검사하고, `--on-leakage drop` 을 주면 train 쪽에서 뺍니다.

---

## 3. 전체 흐름

```
드라이브 (Roboflow YOLOv8 내보내기 2개)
   └ prepare_dataset.py      폴리곤→박스, 클래스 병합, 누수 검사
       └ datasets/shrimp/{train,valid,test} + data.yaml
           └ train.py                    YOLOv8n 파인튜닝 (Colab GPU)
               └ best.pt
                   ├ eval_count.py       계수 오차율 ±20% 판정 + 최적 conf 추천
                   └ export_edge.py      ONNX 내보내기 (파이용)
                       └ 파이: MODEL_PATH=...onnx  →  systemctl restart
```

도구는 모두 `vision/ai/trainer/` 에 있습니다.

| 파일 | 하는 일 |
|---|---|
| `prepare_dataset.py` | 데이터셋 병합·변환·검사 (무거운 의존성 없음) |
| `train.py` | YOLOv8 파인튜닝 |
| `eval_count.py` | 계수 오차율 평가 — **합격 판정은 이것으로 합니다** |
| `export_edge.py` | ONNX/ncnn 내보내기 + 파이에서 처리 시간 측정 |
| `colab_train_shrimp.ipynb` | 위 넷을 순서대로 돌리는 Colab 노트북 |
| `extract_frames.py` | 우리 수조 영상에서 라벨링용 프레임 뽑기 (데이터 추가 수집용) |
| `pseudo_label.py` | 1차 모델로 라벨 없는 이미지에 박스를 미리 찍어 라벨링 시간 줄이기 |

---

## 4. 무엇을 만족해야 합격인가

`shrimp_counter_FINAL_v2` 의 수행계획서 기준입니다.

| 항목 | 목표 | 재는 방법 |
|---|---|---|
| 계수 오차율 (일반) | ±20% 이내 | `eval_count.py` |
| 계수 오차율 (탁도·겹침) | ±30% 이내 | `eval_count.py --hard-list` |
| 장당 처리 시간 | 1~3초 | `export_edge.py --bench` (**파이에서** 실행) |
| 가동률 | 95% 이상 | 운영 중 `last_seen_at` / 경보 로그 |
| 데이터 누락률 | 5% 이하 | `count_records` 적재 간격 |
| (참고) mAP@0.5 | 0.85 이상 | `train.py` 가 출력 |

mAP 는 "박스를 얼마나 잘 맞췄나"이고 검수 기준은 "몇 마리인지 얼마나 맞췄나"
입니다. **mAP 가 좋아도 계수 오차율이 나쁠 수 있습니다.** 판정은 반드시
`eval_count.py` 로 합니다.

---

## 5. 사람이 하는 일 ① — Colab 에서 학습

1. GitHub 웹에서 아래 4개 파일을 각각 `Download raw file` 로 내려받습니다.
   (저장소가 비공개라 Colab 이 바로 clone 하지 못합니다.)

   ```
   vision/ai/trainer/prepare_dataset.py
   vision/ai/trainer/train.py
   vision/ai/trainer/eval_count.py
   vision/ai/trainer/export_edge.py
   ```

2. `vision/ai/trainer/colab_train_shrimp.ipynb` 를 내려받아
   [Colab](https://colab.research.google.com) 에 업로드합니다.

3. **런타임 → 런타임 유형 변경 → T4 GPU** 로 바꿉니다. (CPU 로는 수십 시간)

4. 셀을 위에서 아래로 실행합니다. 2단계에서 위 4개 파일을 올리라고 하면 올립니다
   (한 번만 올리면 드라이브 `shrimp365-trainer/` 에 저장되어 다음부터 생략됩니다).

5. 5,032장 × 100 에포크는 T4 기준 **2~4시간**입니다. 중간에 세션이 끊기면
   노트북을 다시 열고 4단계부터 다시 실행하면 됩니다(`--epochs 50` 으로 줄여서
   먼저 결과를 보는 것도 방법입니다).

6. 마지막 셀이 결과를 드라이브 `shrimp365-models/<날짜시각>/` 에 저장합니다.

### 학습이 끝나면 꼭 볼 것

- **3단계 출력**: 폴리곤→박스 변환 개수, 누수 건수, 장당 객체 수 중앙값
- **3단계 그림**: 라벨 박스가 새우 위에 올라가 있는지 (변환 검증)
- **5단계 판정**: `일반 계수 오차율 ±20% : 통과/미달`, 그리고 **추천 conf**

### 오차율이 기준에 못 미치면

출력된 지표에 따라 손댈 곳이 다릅니다.

| 증상 | 원인 | 조치 |
|---|---|---|
| 편향이 크게 `-` (계속 적게 셈) | 임계값이 높다 / 겹친 개체를 하나로 합친다 | 추천 conf 적용, `--iou 0.8` 로 재평가 |
| 편향이 크게 `+` (계속 많이 셈) | 임계값이 낮다 / 배경을 새우로 본다 | conf 올리기, 배경만 있는 이미지 추가 |
| 밀도 높은 구간만 나쁨 | 겹침·작은 개체 | `--imgsz 960` 으로 재학습, 겹침 장면 추가 수집 |
| valid 는 좋은데 test 가 나쁨 | 과적합 또는 분할 누수 | `--on-leakage drop` 확인, 에포크 줄이기 |
| 전 구간 고르게 나쁨 | 데이터 부족·도메인 불일치 | **우리 수조 영상**을 `extract_frames.py` 로 뽑아 라벨링해 추가 |

마지막 항목이 가장 중요합니다. 공개 데이터셋(해외 양식장·실험실)과 우리 수조는
물 색·조명·카메라 각도가 다릅니다. 파이 카메라를 설치한 뒤 우리 수조 프레임
수백 장을 라벨링해 추가하는 것이 성능을 가장 크게 올립니다.

```bash
# 파이에 카메라를 달고 촬영한 영상에서 라벨링용 프레임 뽑기
python ai/trainer/extract_frames.py --source tank1.mp4 --out datasets/raw --every-seconds 5
```

### 라벨링을 빨리 하는 방법 — 사전 라벨링

라벨이 없는 이미지(드라이브의 해외 DB1~DB5, 우리 수조 프레임)를 처음부터 손으로
그리면 한 장에 몇 분씩 걸립니다. **1차 모델로 박스를 미리 찍어 두고 사람이 고치면**
훨씬 빠릅니다. 빠진 것은 추가하고 잘못 찍힌 것은 지우는 작업만 남습니다.

```bash
python ai/trainer/pseudo_label.py \
    --weights runs/shrimp/weights/best.pt \
    --images '/content/drive/MyDrive/00. 데이터/01. 흰다리새우 학습 데이터/02. 흰다리새우 이미지_해외/DB1' \
    --out datasets/db1_prelabel --conf 0.4
```

결과 폴더를 Roboflow·CVAT 에 올려 고친 뒤, YOLOv8 형식으로 내려받아
`prepare_dataset.py --source db1=<경로>` 로 학습 데이터에 합칩니다.

> ⚠ **고치지 않은 사전 라벨을 그대로 학습에 쓰면 안 됩니다.** 모델이 자기 실수를
> 정답으로 배워 틀린 방향으로 자신감만 커집니다. 사람의 손을 줄이는 도구이지
> 사람을 대신하는 도구가 아닙니다.

### 탁도·겹침 목록 만들기 (±30% 기준을 적용하려면)

탁하거나 겹침이 심한 이미지 파일명을 한 줄에 하나씩 적은 텍스트 파일을 만들어
`--hard-list` 로 넘기면, 그 묶음만 ±30% 기준으로 따로 판정합니다.

```bash
python ai/trainer/eval_count.py --weights best.pt --data datasets/shrimp/data.yaml \
    --split valid --hard-list hard_images.txt
```

---

## 6. 사람이 하는 일 ② — 파이에 적용

파이 4 에는 GPU 가 없습니다. `best.pt`(PyTorch)를 그대로 쓰면 torch 설치가 무겁고
메모리도 많이 먹으므로, **ONNX 로 내보낸 모델 + onnxruntime** 을 씁니다.
전처리·후처리는 `app/services/detector_onnx.py` 가 직접 하므로 torch 가 필요 없습니다.

### 6-1. 모델 올리기

```bash
# 내 PC 에서 (드라이브에서 내려받은 파일)
scp best_512.onnx pi@<파이주소>:/tmp/shrimp_yolov8n.onnx
```

```bash
# 파이에서
sudo mv /tmp/shrimp_yolov8n.onnx /opt/shrimp365-vision/ai/models/
sudo chown shrimp365:shrimp365 /opt/shrimp365-vision/ai/models/shrimp_yolov8n.onnx
```

### 6-2. onnxruntime 설치

```bash
cd /opt/shrimp365-vision
sudo .venv/bin/pip install -e ".[edge]"
```

이미 `.[ml]`(ultralytics·torch)을 깔아 두었더라도 그대로 두면 됩니다 —
`MODEL_PATH` 가 `.onnx` 면 torch 는 건드리지 않습니다.

### 6-3. 실제 처리 시간 측정 (검수 근거가 되는 숫자)

```bash
cd /opt/shrimp365-vision
.venv/bin/python ai/trainer/export_edge.py \
    --weights ai/models/shrimp_yolov8n.onnx --bench --runs 30
```

`중앙 … p95 …` 와 판정이 나옵니다. p95 가 3초를 넘으면 더 작은 해상도로 내보낸
모델(`best_416.onnx`)로 바꾸거나, `--format ncnn` 으로 내보낸 모델을 씁니다
(보통 가장 빠르지만 `pip install ncnn` 이 필요합니다).

### 6-4. 설정 바꾸고 재시작

```bash
sudo nano /etc/shrimp365-vision/env
```

```bash
MODEL_PATH=./ai/models/shrimp_yolov8n.onnx
CONFIDENCE_THRESHOLD=0.25      # eval_count.py 가 추천한 값으로
NMS_IOU_THRESHOLD=0.7          # 겹침이 심하면 0.8
MODEL_IMGSZ=0                  # 0 = 모델에 적힌 해상도를 그대로 사용
INFERENCE_THREADS=0            # 0 = 코어 전부. 다른 작업과 나눠 쓰면 2~3
INFERENCE_FPS=1                # 1초에 한 장 처리
```

```bash
sudo systemctl restart shrimp365-vision
sudo journalctl -u shrimp365-vision -f
```

로그에 `시뮬레이션` 이 보이면 모델을 못 찾은 것입니다. 경로와 파일 권한,
그리고 `onnxruntime` 설치를 확인하세요.

### 6-5. 화면에서 확인

`www.shrimp365.kr/vision` 에서 해당 카메라의 개체수와 탐지 박스가 실제 영상 위에
올라오는지 봅니다. 시뮬레이션 모드와 달리 `model_version` 이 `shrimp_yolov8n.onnx`
로 표시됩니다.

---

## 7. `.pt` 와 `.onnx` 중 무엇을 쓸까

| | `.pt` (ultralytics) | `.onnx` (onnxruntime) |
|---|---|---|
| 파이 설치 부담 | torch 포함, 무겁다 | `pip install onnxruntime` 하나 |
| 메모리 | 많이 쓴다 | 적게 쓴다 |
| 속도 (파이 4 CPU) | 느리다 | 빠르다 |
| 트래킹(ByteTrack) | 있다 | 없다 (계수에는 영향 없음) |
| 해상도 변경 | 실행 중 자유 | 내보낼 때 고정 |

**파이에는 `.onnx`, 성능 비교·재학습·연구용으로는 `.pt`** 를 씁니다.
`MODEL_PATH` 확장자만 보고 코드가 알아서 갈라지므로 따로 설정할 것은 없습니다.
(`*_ncnn_model` 디렉터리나 openvino 디렉터리를 주면 ultralytics 경로로 갑니다.)

---

## 8. 어디까지 확인했나 (정직하게)

### 실제로 한 번 돌려 봤습니다

드라이브의 5천 장은 이 작업 환경으로 가져올 수 없어서(이미지 한 장을 텍스트로
옮기는 비용이 매우 큽니다), **shrimp_cf 와 똑같은 형태의 합성 데이터셋**
(24점 폴리곤 라벨, 640×640, 60장)을 만들어 전 구간을 통과시켰습니다.

| 단계 | 결과 |
|---|---|
| `prepare_dataset.py` | 폴리곤 653개 → 박스 변환, 누수 0건, ultralytics 가 읽음 |
| `train.py` (15에포크, CPU) | mAP@0.5 = **0.971**, `best.pt` 생성, 목표 판정 출력 정상 |
| `eval_count.py` (.pt) | 평균 오차 **6.0%**, ±20% 내 100%, 추천 conf 0.30 |
| `export_edge.py` | ONNX 내보내기 성공 (2.8초) |
| `eval_count.py` (.onnx) | 평균 오차 **6.0%** — `.pt` 와 같은 숫자 |
| **ultralytics vs 파이 경로** | 8장 모두 **개수 동일, 박스 좌표 차이 0.00px** |
| `export_edge.py --bench` | 동작 확인 (이 x86 CPU 에서 중앙 22ms) |

마지막 줄이 가장 중요합니다. 같은 ONNX 모델을 ultralytics 로 돌린 결과와
파이에서 쓸 `detector_onnx.py` 로 돌린 결과가 **완전히 같았습니다.** 즉
Colab 에서 검증한 계수 성능이 파이에서 그대로 재현됩니다(letterbox·NMS·좌표
복원을 직접 구현했으므로 이 확인이 꼭 필요했습니다).

숫자 자체(0.971, 6.0%)는 **합성 데이터 기준이라 아무 의미가 없습니다.** 확인한
것은 "파이프라인이 끊기지 않고 이어진다"는 사실뿐입니다.

### 아직 확인 못 한 것

- **실제 데이터로 학습한 성능.** 5,032장으로 목표(오차율 ±20%)를 맞출 수 있는지는
  Colab 에서 돌려 봐야 압니다. §5 의 5단계 출력이 그 답입니다.
- **라즈베리파이 실물의 처리 시간.** ARM CPU 실측은 파이에서 `--bench` 를
  돌려야 합니다(§6-3). 이 컨테이너의 x86 숫자는 참고가 되지 않습니다.
- **파이 카메라(CSI)로 들어온 실제 프레임.** 하드웨어가 있어야 합니다.

단위·통합 테스트는 `vision/tests/` 에 135개 있습니다
(`test_dataset_prep.py`, `test_detector_onnx.py`,
`test_detector_onnx_runtime.py`(실제 onnxruntime), `test_eval_count.py`,
`test_pseudo_label.py`, `test_trainer.py`).
