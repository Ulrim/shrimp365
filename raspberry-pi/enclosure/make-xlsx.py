# -*- coding: utf-8 -*-
"""수질 모니터링 장비 함체 — 하드웨어 사양 통합 엑셀"""
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

OUT = "/home/user/shrimp365/raspberry-pi/enclosure/xlsx/hardware.xlsx"
F = "Arial"
H1   = Font(name=F, size=14, bold=True)
H2   = Font(name=F, size=11, bold=True, color="FFFFFF")
BOLD = Font(name=F, size=10, bold=True)
BODY = Font(name=F, size=10)
INPUT= Font(name=F, size=10, color="0000FF")
NOTE = Font(name=F, size=9, italic=True, color="666666")
RED  = Font(name=F, size=10, bold=True, color="C00000")
HDRF = PatternFill("solid", fgColor="1F4E79")
SUBF = PatternFill("solid", fgColor="DCE6F1")
WARN = PatternFill("solid", fgColor="FFF2CC")
CRIT = PatternFill("solid", fgColor="FCE4E4")
YEL  = PatternFill("solid", fgColor="FFFF00")
thin = Side(style="thin", color="B0B0B0")
BOX  = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top")
CTR  = Alignment(horizontal="center", vertical="center")

wb = openpyxl.Workbook()


def sheet(name, widths, title, sub=None):
    ws = wb.create_sheet(name)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws["A1"] = title; ws["A1"].font = H1
    r = 2
    if sub:
        ws["A2"] = sub; ws["A2"].font = NOTE
        r = 3
    return ws, r + 1


def header(ws, row, cols):
    for i, c in enumerate(cols, 1):
        cell = ws.cell(row=row, column=i, value=c)
        cell.font = H2; cell.fill = HDRF; cell.border = BOX; cell.alignment = CTR
    ws.freeze_panes = ws.cell(row=row + 1, column=1)
    return row + 1


def put(ws, row, vals, font=None, fill=None, wrap=False):
    for i, v in enumerate(vals, 1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = font or BODY
        c.border = BOX
        if fill: c.fill = fill
        if wrap: c.alignment = WRAP
    return row + 1


# ══════════════════════════════ 1. 개요 ══════════════════════════════
ws, r = sheet("1.개요", [22, 62, 46], "수질 모니터링 장비 함체 — 하드웨어 사양",
              "Shrimp365 / 주식회사 컬리버   ·   Rev.B  2026-08-11   ·   단위 mm")
r = header(ws, r, ["항목", "확정 내용", "비고"])
for a, b, c in [
    ("함체", "하이박스 300 × 300 × 165 (폴리카보네이트/ABS)", "후보 10개 비교 → 6.함체선정 시트"),
    ("전원 — 센서", "SMPS 220V → 12V 60W (5A)", "센서 전용. 부하 약 0.1A = 정격의 2%"),
    ("전원 — 파이", "함체 내부 콘센트 1구(220V) + 파이 자체 어댑터 5.1V 3A", "DC-DC 사용 안 함"),
    ("단자대", "8P 단단 (접지 포함)", "220V/접지 3 + 12V 2 + RS485 2 + 본딩 1"),
    ("센서", "3대 — pH(ID1) · DO(ID3) · EC(ID4)", "하면 원형 타공 4개소 전부 사용"),
    ("파이·LCD 위치", "도어 — 파이가 7\" 디스플레이 뒷면에 장착", "백플레이트에는 AC 계통만"),
    ("유선 LAN", "사용 안 함 (WiFi 전용)", "공유기 동봉, SSID·비밀번호 고정 운용"),
    ("KC 인증", "진행 안 함", "AC 안전 설계(퓨즈·SPD·PE)는 그대로 유지"),
    ("방수 등급", "IP66 이상", "커넥터는 전부 하부면. 측면·상면 뚫지 않음"),
    ("내부 발열", "약 13.4 W", "5.전력예산 시트"),
]:
    r = put(ws, r, [a, b, c], wrap=True)

r += 1
ws.cell(row=r, column=1, value="★ 이 장비에서 가장 중요한 한 가지").font = RED
r += 1
ws.cell(row=r, column=1, value=("파이 어댑터와 SMPS 는 서로 절연된 별개 전원입니다. "
        "센서 0V 와 USB-RS485 변환기 GND 가 만나는 곳은 단자대 8극 본딩 하나뿐입니다. "
        "이 본딩이 빠지면 RS485 공통모드가 벗어나 간헐적 CRC 오류가 나며, "
        "통전 검사·전압 측정으로는 잡히지 않습니다.")).font = BODY
ws.merge_cells(start_row=r, start_column=1, end_row=r + 2, end_column=3)
ws.cell(row=r, column=1).alignment = WRAP
ws.cell(row=r, column=1).fill = CRIT
r += 4

ws.cell(row=r, column=1, value="관련 문서 (저장소 raspberry-pi/enclosure/)").font = BOLD
r += 1
for a, b in [("ENCLOSURE.md", "외함 설계서 — 요구 형상·성능·검증 기준"),
             ("WIRING.md", "내부 배선 설계서 — 결선표·핀맵·검사"),
             ("PARTS.md", "기성품 구매 목록"),
             ("DRAWINGS.md", "제작도면 SH-01~07 + 배선 계통도 W-01~04"),
             ("make-drawings.py", "PARAMS 를 고치면 도면·3D 가 함께 갱신됨")]:
    r = put(ws, r, [a, b])

# ══════════════════════════════ 2. 부품목록 ══════════════════════════
ws, r = sheet("2.부품목록", [6, 14, 30, 52, 7, 12, 34], "부품 목록 (BOM)",
              "확인상태 — 확인완료: 제조사 사양 확인함 / 확인필요: 발주 전 치수·사양 확인 / 제작: 도면대로 제작")
r = header(ws, r, ["#", "구분", "품목", "사양", "수량", "확인상태", "비고"])
BOM = [
 (1,"전원","SMPS","220V → 12V 60W (5A)",1,"확인필요","외형·나사 피치 확인 필요"),
 (2,"전원","콘센트 1구 원형","220V, 함체 내부 설치",1,"확인필요","외형·고정 방식 확인 필요"),
 (3,"전원","파이 전원 어댑터","라즈베리파이 공식 5.1V 3A USB-C",1,"확인필요","브래킷·타이로 고정할 것"),
 (4,"제어","Raspberry Pi Touch Display 7\"","192.96 × 110.76, 활성 155 × 86, 800×480",1,"확인완료","도어 장착"),
 (5,"제어","Raspberry Pi 4 Model B","2GB 이상, 85 × 56",1,"확인완료","디스플레이 뒷면에 장착"),
 (6,"제어","파이 방열 케이스","알루미늄 패시브",1,"확인필요","평면이 있을 것"),
 (7,"제어","USB-RS485 변환기","FTDI 계열 권장. GND 단자가 있는 제품",1,"확인필요","CH340 계열 비권장"),
 (8,"제어","저장장치","USB 3.0 SSD 또는 산업용 pSLC microSD",1,"확인필요","microSD 슬롯 외부 노출 금지"),
 (9,"제어","RTC 모듈","DS3231 I2C + CR2032",1,"확인필요","정전 후 시각 유지"),
 (10,"제어","WiFi 공유기","현장 납품용",1,"확인필요","SSID·비밀번호 고정 운용"),
 (11,"커넥터","AC 인입 커넥터","방수 원형, 센서용과 결합 불가한 형식",1,"확인필요","패널 구멍 지름 확인"),
 (12,"커넥터","AC 케이블 플러그","위와 짝",1,"확인필요",""),
 (13,"커넥터","센서 커넥터","M12 A-coded 4핀 패널 소켓 IP67",3,"확인필요","예비 포트 없음"),
 (14,"커넥터","센서 케이블 플러그","M12 A-coded 현장 조립형",3,"확인필요","케이블 길이 현장마다 다름"),
 (15,"커넥터","(삭제) 통기 벤트","하면 타공 4개소 한정 결정으로 제외",0,"결정됨","결로 대책은 실리카겔뿐"),
 (16,"커넥터","방수캡","M12 소켓용",2,"확인필요","현장 예비"),
 (17,"함체","하이박스","300 × 300 × 165, PC/ABS, IP66",1,"확인필요","내부 유효치수·커버 체결 방식 확인"),
 (18,"함체","백플레이트","알루미늄 2t, 약 260 × 260",1,"확인필요","PE 본딩 필수"),
 (19,"기구","압착 프레임","알루미늄 3t, 도면 SH-04",1,"제작","레이저 절단"),
 (20,"기구","차양","알루미늄 1.5t, 도면 SH-05",0,"제작","직사광 설치 시에만"),
 (21,"기구","실리콘 패드","3t, 폭 8 액자형",1,"확인필요","프레임 접촉면"),
 (22,"기구","개스킷 테이프","폴리우레탄 폼 양면, 폭 5 × 두께 2",1,"확인필요","압축률 30~50%"),
 (23,"기구","M3 스탠드오프","Ø8 베이스, 접착식",4,"확인필요","길이는 시제품 실측 후 확정"),
 (24,"기구","도어 볼트","SUS316 M4 핀-인-톡스(TR)",6,"확인필요","일반 드라이버로 안 열림"),
 (25,"기구","전용 비트","T20 pin-in-torx 등",1,"확인필요","A/S 키트에만. 제품 동봉 금지"),
 (26,"기구","봉인 라벨","탬퍼 에비던트 VOID",2,"확인필요","도어 이음매 대각선"),
 (27,"기구","열전도 패드","방열 케이스 ↔ 백플레이트",1,"확인필요",""),
 (28,"기구","실리카겔","50g 팩",1,"확인필요","정비 시 교체"),
 (29,"기구","케이블 타이 앵커","접착식",1,"확인필요","케이블 덕트 대신"),
 (30,"보호","퓨즈홀더 + 퓨즈","AC 2A 슬로우블로우 / 12V 1A",2,"확인필요",""),
 (31,"보호","SPD","AC 275V 바리스터, 온도퓨즈 내장형",1,"확인필요","맨 바리스터 금지 — 발화 위험"),
 (32,"보호","TVS","RS485용 SM712 1 + 12V 라인 16V급 1",2,"확인필요",""),
 (33,"배선","단자대 8P","단단, 접지 포함, 극 사이 절연 격벽",1,"확인필요","3.단자대 시트"),
 (34,"배선","본딩 점퍼","5극↔8극 점퍼 + 변환기 GND 선 1.0㎟",1,"확인필요","★ 필수"),
 (35,"배선","절연 커버","단자대 1~3극(220V)용 투명 커버",1,"확인필요",""),
 (36,"배선","접지 부품","M4 스터드 + 톱니와셔",1,"확인필요","알루미늄 산화막 관통"),
 (37,"배선","종단저항","120Ω",1,"확인필요","케이블 10m 초과 시에만"),
 (38,"배선","배선재","4.전선규격 시트 참조",1,"확인필요",""),
 (39,"라벨","라벨 세트","정격·경고·커넥터 표시·시리얼",1,"확인필요","전면: 환경 모니터링 시스템 / 주식회사 컬리버"),
]
for row in BOM:
    fill = CRIT if row[0] == 34 else (WARN if row[5] == "확인필요" else None)
    r = put(ws, r, list(row), fill=fill, wrap=True)
last_bom = r - 1
first_bom = last_bom - len(BOM) + 1
r += 1
for lbl, key in (("확인완료 품목 수", "확인완료"), ("확인필요 품목 수", "확인필요"),
                 ("제작 품목 수", "제작")):
    ws.cell(row=r, column=3, value=lbl).font = BOLD
    ws.cell(row=r, column=5,
            value='=COUNTIF(F%d:F%d,"%s")' % (first_bom, last_bom, key)).font = BODY
    r += 1

# ══════════════════════════════ 3. 단자대 ════════════════════════════
ws, r = sheet("3.단자대_8P", [6, 12, 40, 46, 16, 30], "단자대 8P 할당 (접지 포함)",
              "단단 8극 · 220V/접지 3극 + 12V 2극 + RS485 2극 + 본딩 1극")
r = header(ws, r, ["극", "이름", "들어오는 것", "나가는 것", "전선", "비고"])
TB = [
 (1,"L","AC 인입 L (F1 뒤)","SMPS L · 콘센트 L","0.75㎟ 갈색","절연 커버 안"),
 (2,"N","AC 인입 N","SMPS N · 콘센트 N","0.75㎟ 파랑","절연 커버 안"),
 (3,"PE","AC 인입 PE","접지 스터드 · 콘센트 접지극","1.5㎟ 녹/황","접지 표시 부착"),
 (4,"+12V","SMPS +V (F2 · TVS 뒤)","센서 1·2·3 핀 1","0.75㎟ 빨강","극당 3가닥 → 압착 단자"),
 (5,"0V","SMPS −V","센서 1·2·3 핀 3 · 실드 · 8극","0.75㎟ 검정","극당 다수 → 압착 단자"),
 (6,"A","USB-RS485 A (TVS 뒤)","센서 1·2·3 핀 2","0.5㎟ 초록","실드 트위스트 페어"),
 (7,"B","USB-RS485 B (TVS 뒤)","센서 1·2·3 핀 4","0.5㎟ 노랑","실드 트위스트 페어"),
 (8,"본딩","USB-RS485 GND","5극 (점퍼)","1.0㎟ 회색","★ 예비극 아님 — 필수"),
]
for row in TB:
    r = put(ws, r, list(row), fill=CRIT if row[0] == 8 else None, wrap=True)
r += 1
ws.cell(row=r, column=1, value=("220V 극과 저압 극이 한 단자대에 섞여 있습니다. 극 사이 절연 격벽이 있는 제품을 쓰고 "
        "1~3극 위에 투명 절연 커버를 덮으십시오.")).font = RED

# ══════════════════════════════ 4. 결선표 ════════════════════════════
ws, r = sheet("4.결선표", [6, 12, 34, 40, 20, 34], "결선표",
              "배선 순서대로 정렬. 각 구간을 끝내고 확인한 뒤 다음으로 넘어갑니다.")
r = header(ws, r, ["#", "회로", "From", "To", "전선", "비고"])
W = [
 ("AC 1차 — 절연 커버 안쪽",),
 (1,"AC L","X1 : L","F1 : 1","0.75 갈색",""),
 (2,"AC L","F1 : 2","단자대 1극","0.75 갈색",""),
 (3,"AC L","F1 : 2","SPD : L","0.75 갈색",""),
 (4,"AC N","X1 : N","단자대 2극","0.75 파랑",""),
 (5,"AC N","단자대 2극","SPD : N","0.75 파랑",""),
 (6,"PE","X1 : PE","단자대 3극","1.5 녹/황",""),
 (7,"PE","SPD : PE","단자대 3극","0.75 녹/황",""),
 (8,"PE","단자대 3극","접지 스터드","1.5 녹/황","톱니와셔"),
 (9,"AC L","단자대 1극","SMPS : L","0.75 갈색",""),
 (10,"AC N","단자대 2극","SMPS : N","0.75 파랑",""),
 (11,"AC L","단자대 1극","콘센트 : L","0.75 갈색",""),
 (12,"AC N","단자대 2극","콘센트 : N","0.75 파랑",""),
 (13,"PE","단자대 3극","콘센트 : 접지극","0.75 녹/황",""),
 ("12V 계통 — 센서 전용",),
 (14,"+12V","SMPS : +V","F2 : 1","0.75 빨강",""),
 (15,"+12V","F2 : 2","TVS(16V) : +","0.75 빨강",""),
 (16,"+12V","TVS(16V) : +","단자대 4극","0.75 빨강",""),
 (17,"0V","SMPS : −V","단자대 5극","0.75 검정",""),
 (18,"0V","TVS(16V) : −","단자대 5극","0.75 검정",""),
 ("RS485",),
 (19,"A","변환기 : A (T/R+)","TVS(SM712) : A","0.5 초록","실드 TP"),
 (20,"B","변환기 : B (T/R−)","TVS(SM712) : B","0.5 노랑","실드 TP"),
 (21,"A","TVS(SM712) : A","단자대 6극","0.5 초록",""),
 (22,"B","TVS(SM712) : B","단자대 7극","0.5 노랑",""),
 ("센서 커넥터 — 3포트 병렬",),
 ("23~25","+12V","단자대 4극","센서 1·2·3 : 핀 1","0.75 빨강","압착 단자"),
 ("26~28","0V","단자대 5극","센서 1·2·3 : 핀 3","0.75 검정","압착 단자"),
 ("29~31","A","단자대 6극","센서 1·2·3 : 핀 2","0.5 초록","압착 단자"),
 ("32~34","B","단자대 7극","센서 1·2·3 : 핀 4","0.5 노랑","압착 단자"),
 (35,"실드","센서 케이블 실드","단자대 5극","0.5","함체측 한쪽만"),
 ("본딩 — ★ 빠뜨리면 안 됩니다",),
 (36,"본딩","단자대 5극 (0V)","단자대 8극","1.0 회색 점퍼","★ 필수"),
 (37,"본딩","변환기 : GND","단자대 8극","1.0 회색","★ 필수"),
 (38,"LK2","단자대 5극 (0V)","단자대 3극 (PE)","0.75 녹/황","선택 · 기본 장착"),
 ("도어 — 파이 · 디스플레이",),
 (39,"AC","콘센트","파이 어댑터","220V 코드","어댑터 고정 필수"),
 (40,"5V","파이 어댑터","파이 USB-C","어댑터 기본 케이블","클램프 고정"),
 (41,"DSI","파이 DSI","디스플레이","DSI 리본","파이가 디스플레이 뒷면"),
 (42,"5V","파이 GPIO 5V/GND","디스플레이","기본 점퍼",""),
 (43,"USB","파이 USB","USB-RS485 변환기","USB 단척",""),
 (44,"USB","파이 USB","SSD","USB 3.0 단척",""),
 (45,"I2C","파이 GPIO 1·3·5·9","RTC DS3231","I2C 4선",""),
 (46,"RS485","변환기 A/B/GND","단자대 6·7·8극","0.5 / 1.0","★ 도어 가동부 통과 — 힌지쪽 여유 곡선"),
]
for row in W:
    if len(row) == 1:
        c = ws.cell(row=r, column=1, value=row[0]); c.font = BOLD; c.fill = SUBF
        for i in range(2, 7):
            ws.cell(row=r, column=i).fill = SUBF
        for i in range(1, 7):
            ws.cell(row=r, column=i).border = BOX
        r += 1
    else:
        crit = str(row[0]) in ("36", "37", "46")
        r = put(ws, r, list(row), fill=CRIT if crit else None, wrap=True)

# ══════════════════════════════ 5. 전력예산 ══════════════════════════
ws, r = sheet("5.전력예산", [34, 12, 10, 12, 52], "전력 예산 · 열 설계",
              "파란 글씨 = 입력값 / 검정 = 수식.  내부발열 Y = 함체 안에서 열이 되는 것, N = 밖으로 나가는 것")
r = header(ws, r, ["항목", "값", "단위", "내부발열", "근거"])
top = r
P = [("파이 4 (크로미움 키오스크)", 7.0, "W", "Y", "피크 기준"),
     ("7인치 디스플레이", 3.0, "W", "Y", "백라이트 최대 포함"),
     ("파이 어댑터 손실", 1.8, "W", "Y", "효율 0.85, 출력 10W 기준"),
     ("USB-RS485 변환기", 0.1, "W", "Y", ""),
     ("SMPS 손실 (경부하)", 1.5, "W", "Y", "부하율 2% 라 무부하 손실이 지배"),
     ("센서 3대 @ 12V", 1.2, "W", "N", "케이블로 함체 밖 센서에서 소비 — 내부 발열 아님")]
for a, b, c, yn, d in P:
    ws.cell(row=r, column=1, value=a).font = BODY
    ws.cell(row=r, column=2, value=b).font = INPUT
    ws.cell(row=r, column=3, value=c).font = BODY
    ws.cell(row=r, column=4, value=yn).font = BODY
    ws.cell(row=r, column=4).alignment = CTR
    ws.cell(row=r, column=5, value=d).font = BODY
    for i in range(1, 6): ws.cell(row=r, column=i).border = BOX
    if yn == "N": ws.cell(row=r, column=4).fill = WARN
    r += 1
bot = r - 1
ws.cell(row=r, column=1, value="AC 총 소비").font = BOLD
ws.cell(row=r, column=2, value="=SUM(B%d:B%d)" % (top, bot)).font = BOLD
ws.cell(row=r, column=3, value="W").font = BOLD
ws.cell(row=r, column=5, value="정격 라벨용").font = BODY
for i in range(1, 6): ws.cell(row=r, column=i).border = BOX
r += 1
ws.cell(row=r, column=1, value="함체 내부 발열").font = BOLD
ws.cell(row=r, column=2, value='=SUMIF(D%d:D%d,"Y",B%d:B%d)' % (top, bot, top, bot)).font = BOLD
ws.cell(row=r, column=3, value="W").font = BOLD
ws.cell(row=r, column=5, value="열 설계의 입력값").font = BODY
for i in range(1, 6): ws.cell(row=r, column=i).border = BOX; ws.cell(row=r, column=i).fill = SUBF
heat = r
r += 2

ws.cell(row=r, column=1, value="열 설계 — 하이박스 300 × 300 × 165").font = H1
r += 2
r = header(ws, r, ["항목", "값", "단위", "", "근거"])
TH = [("외형 W", 300, "mm", "확정"), ("외형 H", 300, "mm", "확정"), ("외형 D", 165, "mm", "확정"),
      ("열전달계수 k", 3.5, "W/㎡·K", "플라스틱 자연대류")]
tstart = r
for a, b, c, d in TH:
    ws.cell(row=r, column=1, value=a).font = BODY
    ws.cell(row=r, column=2, value=b).font = INPUT
    ws.cell(row=r, column=3, value=c).font = BODY
    ws.cell(row=r, column=5, value=d).font = BODY
    for i in range(1, 6): ws.cell(row=r, column=i).border = BOX
    r += 1
W_, H_, D_, K_ = tstart, tstart + 1, tstart + 2, tstart + 3
calc = [("전체 표면적", "=2*(B%d*B%d+B%d*B%d+B%d*B%d)/1000000" % (W_, H_, W_, D_, H_, D_), "㎡", "6면 합"),
        ("유효 표면적", "=B%d-(B%d*B%d)/1000000" % (r, W_, H_), "㎡", "벽부 설치 — 후면 제외"),
        ("내부 온도 상승 ΔT", "=B%d/(B%d*B%d)" % (heat, K_, r + 1), "K", "내부 발열 / (k × 유효면적)"),
        ("여름 그늘 40℃ 에서 내부", "=40+B%d" % (r + 2), "℃", "허용 (CPU 약 70℃, 스로틀 80℃)")]
for a, b, c, d in calc:
    ws.cell(row=r, column=1, value=a).font = BODY
    ws.cell(row=r, column=2, value=b).font = BODY
    ws.cell(row=r, column=3, value=c).font = BODY
    ws.cell(row=r, column=5, value=d).font = BODY
    for i in range(1, 6): ws.cell(row=r, column=i).border = BOX
    r += 1
ws.cell(row=r - 1, column=1).font = BOLD
ws.cell(row=r - 1, column=2).font = BOLD
r += 1
ws.cell(row=r, column=1, value=("직사광에 노출되면 내부가 70℃ 를 넘습니다. 그늘에 설치하거나 차양(SH-05)을 다십시오. "
        "환기 팬·통풍구는 달지 마십시오 — 염분과 습기를 빨아들여 방열로 얻는 것보다 부식으로 잃는 것이 큽니다.")).font = RED

# ══════════════════════════════ 6. 함체선정 ══════════════════════════
ws, r = sheet("6.함체선정", [6, 10, 10, 10, 12, 12, 12, 10, 10, 10, 12, 26],
              "하이박스 규격 비교", "파란 글씨 = 입력값. 내부 추정과 판정은 수식입니다.")
r = header(ws, r, ["#", "외형 W", "외형 H", "외형 D", "내부 W", "내부 H", "내부 D",
                   "여유 W", "여유 H", "여유 D", "판정", "비고"])
assum_row = r + 12
CAND = [(1,100,150,80,""),(2,150,150,90,""),(3,150,200,130,""),(4,200,300,130,"깊이 부족"),
        (5,300,300,165,"★ 선정 — 깊이 여유 최대, 정사각이라 표기 혼동 없음"),
        (6,300,400,150,"가능하나 깊이 여유 7mm"),(7,400,500,160,"과대"),(8,500,600,190,"과대"),
        (9,600,700,200,"과대"),(10,90,135,85,"")]
cstart = r
for n, w_, h_, d_, memo in CAND:
    ws.cell(row=r, column=1, value=n).font = BODY
    for i, v in enumerate((w_, h_, d_), 2):
        ws.cell(row=r, column=i, value=v).font = INPUT
    ws.cell(row=r, column=5, value="=B%d-$B$%d" % (r, assum_row)).font = BODY
    ws.cell(row=r, column=6, value="=C%d-$B$%d" % (r, assum_row)).font = BODY
    ws.cell(row=r, column=7, value="=D%d-$B$%d" % (r, assum_row + 1)).font = BODY
    ws.cell(row=r, column=8, value="=E%d-$B$%d" % (r, assum_row + 2)).font = BODY
    ws.cell(row=r, column=9, value="=F%d-$B$%d" % (r, assum_row + 3)).font = BODY
    ws.cell(row=r, column=10, value="=G%d-$B$%d" % (r, assum_row + 4)).font = BODY
    ws.cell(row=r, column=11, value='=IF(AND(H%d>=0,I%d>=0,J%d>=0),"가능","불가")' % (r, r, r)).font = BODY
    ws.cell(row=r, column=12, value=memo).font = BODY
    for i in range(1, 13):
        ws.cell(row=r, column=i).border = BOX
        if n == 5: ws.cell(row=r, column=i).fill = SUBF
    r += 1
r += 1
ws.cell(row=r, column=1, value="가정값·요구값 (여기를 고치면 위 표가 다시 계산됩니다)").font = BOLD
r += 1
for a, b, c in [("W·H 벽두께+실링립 손실", 15, "mm — 외형에서 빼는 값 (추정)"),
                ("D 후면벽+도어립 손실", 23, "mm — 외형에서 빼는 값 (추정)"),
                ("요구 내부 W", 250, "mm — 도어에 디스플레이 194 + 개스킷·립"),
                ("요구 내부 H", 220, "mm — SMPS·콘센트·단자대 + 배선 여유"),
                ("요구 내부 D", 120, "mm — SMPS 스택 + 디스플레이 스택 96.5 + 여유")]:
    ws.cell(row=r, column=1, value=a).font = BODY
    ws.cell(row=r, column=2, value=b).font = INPUT
    ws.cell(row=r, column=2).fill = YEL
    ws.cell(row=r, column=3, value=c).font = BODY
    for i in range(1, 4): ws.cell(row=r, column=i).border = BOX
    r += 1
r += 1
ws.cell(row=r, column=1, value=("내부 추정치는 카탈로그 외형에서 가정값을 뺀 것입니다. 실제 내부 유효치수는 제품마다 "
        "20mm 이상 차이 날 수 있으므로, 함체를 사서 실측한 뒤 이 시트와 도면 PARAMS 를 갱신하십시오.")).font = RED

# ══════════════════════════════ 7. 타공좌표 ══════════════════════════
ws, r = sheet("7.타공좌표", [16, 14, 12, 12, 12, 44], "타공 좌표",
              "하부면: X = 좌우 중심 기준 / Y = 후면 외벽 기준.  백플레이트: 판 중심 기준.")
r = header(ws, r, ["도면", "이름", "X", "Y", "지름 Ø", "비고"])
for row in [("SH-02 하부면","센서 1 pH",-102,100,16.5,"M12 A-coded"),
            ("SH-02 하부면","센서 2 DO",-66,100,16.5,"M12 A-coded"),
            ("SH-02 하부면","센서 3 EC",-30,100,16.5,"M12 A-coded"),
            ("SH-02 하부면","AC 인입",102,100,16.5,"센서용과 결합 불가한 형식")]:
    r = put(ws, r, list(row), wrap=True)
r += 1
ws.cell(row=r, column=1, value="※ Ø16.5 는 M16×1.5 전면체결형 기준입니다. 후면체결형은 Ø12.5 로 다릅니다 — 커넥터 데이터시트 확인 필수").font = RED
r += 2
r = header(ws, r, ["도면", "이름", "X", "Y", "지름 Ø", "비고"])
for row in [("SH-03 백플레이트","SMPS-1",-115,19,4.5,"⚠ 나사 피치 추정 110 × 78"),
            ("SH-03 백플레이트","SMPS-2",-5,19,4.5,""),
            ("SH-03 백플레이트","SMPS-3",-115,97,4.5,""),
            ("SH-03 백플레이트","SMPS-4",-5,97,4.5,""),
            ("SH-03 백플레이트","콘센트-1",68,28,4.5,"⚠ 상하 2점 추정 피치 60"),
            ("SH-03 백플레이트","콘센트-2",68,88,4.5,""),
            ("SH-03 백플레이트","단자대-1",-96,-78,4.5,"⚠ 피치 추정 92"),
            ("SH-03 백플레이트","단자대-2",-4,-78,4.5,""),
            ("SH-03 백플레이트","접지 스터드",112,-112,4.5,"톱니와셔로 산화막 관통")]:
    r = put(ws, r, list(row), fill=WARN if "⚠" in row[5] else None, wrap=True)
r += 1
ws.cell(row=r, column=1, value="※ SMPS·콘센트·단자대 세 부품의 외형과 나사 피치는 실물 확인 전 추정치입니다. 실측 후 확정하십시오.").font = RED

# ══════════════════════════════ 8. 커넥터핀맵 ════════════════════════
ws, r = sheet("8.커넥터핀맵", [8, 22, 26, 26, 40], "커넥터 핀맵")
ws.cell(row=r - 1, column=1, value="센서 — M12 A-coded 4핀 (센서 1·2·3)").font = BOLD
r = header(ws, r, ["핀", "신호", "센서 케이블 색 (Nengshi)", "표준 M12 케이블 색", "단자대"])
for row in [(1,"+12 V","빨강","갈색","4극"),(2,"RS485 A (T/R+)","초록","흰색","6극"),
            (3,"0 V","검정","파랑","5극"),(4,"RS485 B (T/R−)","노랑","검정","7극")]:
    r = put(ws, r, list(row))
r += 1
ws.cell(row=r, column=1, value="기성 M12 케이블(갈/백/청/흑)을 쓰면 색이 센서 문서와 달라집니다. 4열을 보고 결선하고 케이블에 라벨을 붙이십시오.").font = NOTE
r += 2
ws.cell(row=r, column=1, value="AC 인입 커넥터").font = BOLD
r += 2
r = header(ws, r, ["핀", "신호", "단자대", "", ""])
for row in [("—","L","1극","",""),("—","N","2극","",""),("—","PE","3극","","")]:
    r = put(ws, r, list(row))
r += 1
ws.cell(row=r, column=1, value=("핀 번호는 구매한 커넥터의 데이터시트를 그대로 따르십시오. AC 커넥터와 센서 커넥터는 "
        "서로 결합되지 않는 형식을 고르십시오 — AC 220V 를 센서 포트에 꽂는 사고를 라벨이 아니라 기구로 막습니다.")).font = RED

# ══════════════════════════════ 9. 전선규격 ══════════════════════════
ws, r = sheet("9.전선규격", [20, 14, 14, 60], "전선 규격")
r = header(ws, r, ["회로", "색", "굵기", "비고"])
for row in [("AC L","갈색","0.75㎟",""),("AC N","파랑","0.75㎟",""),
            ("PE","녹/황","1.5㎟ (주간선) / 0.75 (분기)","다른 색을 쓰지 않습니다"),
            ("+12V","빨강","0.75㎟",""),("0V","검정","0.75㎟",""),
            ("RS485 A","초록","0.5㎟","실드 트위스트 페어. A/B 를 같은 페어로"),
            ("RS485 B","노랑","0.5㎟","실드 트위스트 페어"),
            ("본딩","회색","1.0㎟","5극↔8극 점퍼 + 변환기 GND")]:
    r = put(ws, r, list(row), wrap=True)
r += 1
ws.cell(row=r, column=1, value="A = 초록, B = 노랑은 Nengshi 센서 케이블 색과 같게 맞춘 것이라 센서 쪽과 함체 쪽 색이 이어집니다.").font = NOTE
r += 2
ws.cell(row=r, column=1, value="센서 케이블 전압강하 — 12V 로 낮춘 것의 영향").font = H1
r += 2
r = header(ws, r, ["항목", "값", "단위", "근거"])
vstart = r
for a, b, c, d in [("센서 3대 전류", 0.09, "A", "대당 약 30mA"),
                   ("케이블 단면적", 0.5, "㎟", "입력값 — 바꾸면 아래가 다시 계산됩니다"),
                   ("구리 고유저항", 0.0178, "Ω·㎟/m", "20℃ 연동 기준"),
                   ("편도 길이", 50, "m", "입력값 — 바꾸면 아래가 다시 계산됩니다")]:
    ws.cell(row=r, column=1, value=a).font = BODY
    ws.cell(row=r, column=2, value=b).font = INPUT
    ws.cell(row=r, column=2).fill = YEL
    ws.cell(row=r, column=3, value=c).font = BODY
    ws.cell(row=r, column=4, value=d).font = BODY
    for i in range(1, 5): ws.cell(row=r, column=i).border = BOX
    r += 1
for a, f, c, d in [("왕복 저항", "=B%d*B%d*2/B%d" % (vstart + 2, vstart + 3, vstart + 1), "Ω",
                    "고유저항 × 편도 × 2 ÷ 단면적"),
                   ("전압강하", "=B%d*B%d" % (vstart, r), "V", "전류 × 왕복 저항"),
                   ("센서 입력 전압", "=12-B%d" % (r + 1), "V", "12V − 강하"),
                   ("하한 9V 대비 여유", "=B%d-9" % (r + 2), "V", "0 보다 크면 정상")]:
    ws.cell(row=r, column=1, value=a).font = BODY
    ws.cell(row=r, column=2, value=f).font = BODY
    ws.cell(row=r, column=3, value=c).font = BODY
    ws.cell(row=r, column=4, value=d).font = BODY
    for i in range(1, 5): ws.cell(row=r, column=i).border = BOX
    r += 1
ws.cell(row=r - 1, column=1).font = BOLD; ws.cell(row=r - 1, column=2).font = BOLD
r += 1
ws.cell(row=r, column=1, value=("편도 길이나 단면적을 바꿔 보십시오. 여유가 0 에 가까워지면 0.75㎟ 이상으로 올리거나 "
        "24V SMPS 로 바꿔야 합니다.")).font = RED

# ══════════════════════════════ 10. 검사표 ═══════════════════════════
ws, r = sheet("10.검사표", [6, 46, 34, 12, 26], "출하 검사 (EOL)",
              "판정란은 조립자가 채웁니다. 2·3번이 이 표의 핵심입니다.")
r = header(ws, r, ["#", "항목", "판정 기준", "결과", "비고"])
for row in [(1,"접지 연속성 — AC 인입 PE ↔ 백플레이트","< 0.1 Ω","",""),
            (2,"단자대 5극(0V) ↔ 8극 도통","도통","","★ 빠지면 현장에서 간헐적 CRC 오류"),
            (3,"단자대 8극 ↔ 변환기 GND 도통","도통","","★ 위와 한 쌍"),
            (4,"절연저항 L+N ↔ PE (500VDC)","≥ 10 MΩ","",""),
            (5,"12V 출력 — 단자대 4극 ↔ 5극","11.5 ~ 12.5 V","",""),
            (6,"콘센트 전압","220 V ± 10%","",""),
            (7,"센서 포트 3개 각각 핀 1–3 전압","12 V ± 0.5","",""),
            (8,"센서 포트 3개 각각 핀 2–4 저항 (센서 미연결)","3포트 동일값","","병렬 결선 확인"),
            (9,"소비전력","약 16 W ± 20%","",""),
            (10,"부팅 후 화면 표시","계기판 정상 표시","",""),
            (11,"터치 동작","네 모서리 + 중앙 5점","",""),
            (12,"센서 통신 — --scan","연결한 ID 가 모두 응답","",""),
            (13,"값 읽기 — --once --dry-run -v","4개 값 출력","",""),
            (14,"기기 연결 코드","6자리 코드 표시","",""),
            (15,"RTC — 전원 차단 5분 후 재인가","시각 유지","",""),
            (16,"열 시험 — 40℃ 60분","CPU < 75℃, 스로틀 로그 없음","",""),
            (17,"방수 — 개스킷·커넥터 육안 + 토크","이상 없음","",""),
            (18,"도어 여닫음 20회 후 재검사","RS485 배선 이상 없음","","도어 가동부 통과선"),
            (19,"외관 — 봉인 라벨 2개소, 라벨 일체","이상 없음","","")]:
    r = put(ws, r, list(row), fill=CRIT if row[0] in (2, 3) else None, wrap=True)
    ws.cell(row=r - 1, column=4).fill = YEL

# ══════════════════════════════ 11. 확인필요 ═════════════════════════
ws, r = sheet("11.확인필요", [6, 26, 60, 40], "발주 전 확인이 필요한 항목",
              "이 네 가지가 풀려야 도면 치수가 확정됩니다. 지금 도면의 관련 치수는 추정치입니다.")
r = header(ws, r, ["#", "항목", "필요한 것", "확정되면 바뀌는 것"])
for row in [(1,"SMPS 12V 60W","외형 W×H×D, 나사 4점 피치, 단자 위치","SH-03 백플레이트 구멍, 3D 모델"),
            (2,"콘센트 1구 원형","외경·두께, 고정 방식(매입/노출/나사 2점)","SH-03 백플레이트 구멍, 3D 모델"),
            (3,"단자대 8P","외형 길이×폭, 고정 나사 피치, 극 사이 절연 격벽 유무","SH-03 백플레이트 구멍, 절연 커버"),
            (4,"하이박스 300×300×165","내부 유효치수, 커버 체결 방식, 백플레이트 재질","SH-01·02·03·07 전부, 3D 모델"),
            (5,"AC 인입 커넥터","패널 컷아웃 지름, 핀 배치","SH-02 하부면 타공 Ø16.5"),
            (6,"센서 M12 커넥터","패널 컷아웃 지름","SH-02 하부면 타공 Ø16.5"),
            (7,"디스플레이 유리 뒷면","가장자리 평탄면이 편측 8.5mm 나오는가","SH-01 개구부, SH-04 압착 프레임"),
            (8,"스탠드오프 길이","시제품 조립 후 개스킷 압축 스택 실측","SH-06 단면, 발주 사양")]:
    r = put(ws, r, list(row), fill=WARN, wrap=True)
r += 1
ws.cell(row=r, column=1, value=("4번의 커버 체결 방식이 특히 중요합니다. 매미고리(래치)형이면 소비자가 맨손으로 열 수 있어 "
        "접근 차단 설계가 무너집니다. 나사 체결형이어야 탬퍼 볼트로 바꿀 수 있습니다.")).font = RED

# ══════════════════════════════ 12. 구매대조 ═════════════════════════
ws, r = sheet("12.구매대조", [6, 44, 8, 10, 22, 12, 56], "구매 내역 대조",
              "쿠팡 거래명세표 2건 (2026-08-11) · 주식회사 컬리버 · 합계 185,650원 · 함체 5대분 기준")
r = header(ws, r, ["#", "품목", "수량", "금액", "BOM 대응", "판정", "확인할 것 / 조치"])
ORD = [
 ("명세표 ① 70,950원 (배송 3,000 · 할인 1,800 포함)",),
 (1,"몬스툴 전기 인두기 + 받침대 + 땜납 LX1190-30",1,"9,710","(공구)","적합",""),
 (2,"5색 DIY 전선 30/26/22/20/18/16AWG UL1007 — 옵션 30AWG/50M",1,"14,900","38. 배선재","★ 사용 불가",
    "30AWG = 0.05㎟. 필요한 것은 AWG 16·18·20. 재주문 필요 — 아래 AWG 표 참조"),
 (3,"원스탑 만능 터미널압착기",1,"7,000","(공구)","적합","절연 압착단자용 다이 유무 확인"),
 (4,"고정식 단자대 30A 8P 터미널블럭",5,"14,950","33. 단자대 8P","적합",
    "5대분 확보. 극 사이 절연 격벽 유무 확인 — 220V 와 저압이 한 단자대에 섞임"),
 (5,"어반카 와이오 압착 단자 터미널 320p 세트",1,"6,900","(부속)","확인",
    "단자대 나사 규격(M3.5/M4)에 맞는 링·Y 단자 유무 확인"),
 (6,"수축 튜브 세트 530p",1,"3,590","(부속)","적합",""),
 (7,"직결나사 접시머리 직결피스 10종 500g",1,"12,700","(고정용)","확인",
    "하이박스 내부판이 철판이면 직결나사 부적합 — M4 볼트+너트 또는 탭 가공"),
 ("명세표 ② 114,700원 (배송 6,000 포함)",),
 (8,"써큘러 커넥터 항공단자 암수세트 4P",12,"22,800","13. 센서 커넥터","★ 수량 부족",
    "5대 × 센서 3 = 15세트 필요. 12세트 보유 → 3세트 부족"),
 (9,"디에스이 HiPPO 노출2구 화이트 콘센트 (나사타입)",5,"7,750","2. 콘센트","설계 변경",
    "당초 1구 원형 → 노출 2구로 변경됨. 외형이 커져 백플레이트 배치 재확정 필요. 접지극 유무 확인"),
 (10,"태성전기 하이박스 300×300×165",5,"75,000","17. 함체","적합 · 확정",
    "권장 규격과 일치. 내부 유효치수·커버 체결 방식·내부판 재질 실측 필요"),
 (11,"써큘러 커넥터 항공단자 암수세트 2P",5,"3,150","11. AC 인입 커넥터","★ 극수 부족",
    "2P = L·N 뿐. PE(접지) 극이 없음 — 아래 ★ 항목 참조"),
]
for row in ORD:
    if len(row) == 1:
        c = ws.cell(row=r, column=1, value=row[0]); c.font = BOLD; c.fill = SUBF
        for i in range(2, 8):
            ws.cell(row=r, column=i).fill = SUBF
        for i in range(1, 8): ws.cell(row=r, column=i).border = BOX
        r += 1
    else:
        fill = CRIT if "★" in row[5] else (WARN if row[5] in ("확인", "설계 변경") else None)
        r = put(ws, r, list(row), fill=fill, wrap=True)
r += 1
ws.cell(row=r, column=2, value="합계 (배송·할인 포함)").font = BOLD
ws.cell(row=r, column=4, value="185,650").font = BOLD
r += 2

# ── ★ 최우선 이슈
ws.cell(row=r, column=1, value="★ 조치가 필요한 것 — 순서대로").font = H1
r += 2
r = header(ws, r, ["순위", "문제", "왜 문제인가", "조치", "", "", ""])
for row in [(1,"AC 인입 커넥터에 접지극이 없음 (2P)",
    "PE 를 받을 극이 없어 접지 계통 전체가 성립하지 않음. SPD 가 서지를 PE 로 뺄 수 없고, "
    "금속 내부판을 본딩할 수 없으며, 콘센트 접지극도 무의미해짐",
    "3P 이상 커넥터로 교체 권장. 산 2P 5개는 12V 보조 인출 등 다른 용도로 전용","","",""),
 (2,"전선 30AWG (0.05㎟)","전류·강도 모두 부족해 어느 회로에도 쓸 수 없음",
    "AWG 16·18·20 재주문","","",""),
 (3,"AC 와 센서 커넥터가 같은 계열",
    "직경이 같으면 AC 220V 플러그가 센서 포트에 물릴 수 있음. 이 설계가 기구적으로 막으려던 사고",
    "AC 는 다른 직경(예: 20mm)으로, 센서는 16mm 로 분리. 이미 샀다면 직경 확인 후 라벨·색 병행","","",""),
 (4,"센서 커넥터 3세트 부족","5대 × 3센서 = 15 필요, 12 보유","3세트 추가 주문","","",""),
 (5,"콘센트가 1구 원형 → 노출 2구로 변경",
    "외형이 커져 백플레이트 배치와 SH-03 구멍 위치가 바뀜",
    "노출 2구 외형·나사 피치 실측 후 PARAMS 갱신 → 도면 재생성","","","")]:
    r = put(ws, r, list(row), fill=CRIT if row[0] <= 2 else WARN, wrap=True)
r += 2

ws.cell(row=r, column=1, value="AWG ↔ ㎟ 대조 — 이 장비에 필요한 굵기").font = H1
r += 2
r = header(ws, r, ["AWG", "단면적 ㎟", "쓰는 곳", "필요 여부", "", "", ""])
for row in [("16","1.31","PE 주간선 (사양 1.5㎟ 에 근접)","필요","","",""),
            ("18","0.82","AC L·N / +12V / 0V / 본딩","필요","","",""),
            ("20","0.52","RS485 A·B","필요","","",""),
            ("22","0.33","—","불필요","","",""),
            ("26","0.13","—","불필요","","",""),
            ("30","0.05","—","쓸 수 없음","","","전류·강도 모두 부족")]:
    fill = CRIT if row[3] == "쓸 수 없음" else (SUBF if row[3] == "필요" else None)
    r = put(ws, r, list(row), fill=fill)
r += 2

ws.cell(row=r, column=1, value="아직 구매되지 않은 품목 (5대분 기준)").font = H1
r += 2
r = header(ws, r, ["구분", "품목", "수량", "비고", "", "", ""])
for row in [("전원","SMPS 12V 60W (5A)","5","지정 제품 — 외형·나사 피치 확인","","",""),
            ("전원","파이 전원 어댑터 5.1V 3A","5","공식 어댑터","","",""),
            ("제어","라즈베리파이 4","5","","","",""),
            ("제어","7인치 터치 디스플레이","5","","","",""),
            ("제어","USB-RS485 변환기","5","GND 단자가 있는 제품","","",""),
            ("제어","USB SSD 또는 산업용 microSD","5","","","",""),
            ("제어","RTC DS3231 + CR2032","5","","","",""),
            ("제어","파이 방열 케이스","5","","","",""),
            ("커넥터","AC 인입 커넥터 3P 이상","5","★ 접지극 필수","","",""),
            ("커넥터","센서 커넥터 4P 추가","3","12 보유 → 15 필요 (5대 × 3)","","",""),
            ("커넥터","방수캡","10","현장 예비","","",""),
            ("보호","퓨즈홀더 + 퓨즈 (AC 2A / 12V 1A)","각 5","","","",""),
            ("보호","SPD 275V 온도퓨즈 내장형","5","맨 바리스터 금지","","",""),
            ("보호","TVS — SM712 / 16V급","각 5","","","",""),
            ("기구","압착 프레임 (SH-04) 알루미늄 3t","5","레이저 절단 발주","","",""),
            ("기구","개스킷 테이프 폭5×두께2","1롤","","","",""),
            ("기구","실리콘 패드 3t","5","","","",""),
            ("기구","M3 스탠드오프 Ø8 접착식","20","길이는 시제품 실측 후","","",""),
            ("기구","SUS316 M4 핀-인-톡스 볼트","30","탬퍼 방지","","",""),
            ("기구","전용 톡스 비트","1","A/S 키트에만","","",""),
            ("기구","봉인 라벨 VOID","10","","","",""),
            ("기구","접지 스터드 M4 + 톱니와셔","5","★ AC 3P 커넥터 확보 후","","",""),
            ("기구","실리카겔 50g","5","","","",""),
            ("기구","열전도 패드","5","","","",""),
            ("배선","전선 AWG 16 / 18 / 20","각 1롤","★ 재주문","","",""),
            ("배선","RS485 실드 트위스트 페어 센서 케이블","현장별","0.5㎟ 이상","","",""),
            ("배선","종단저항 120Ω","5","케이블 10m 초과 시","","",""),
            ("배선","케이블 타이 앵커","1식","","","",""),
            ("라벨","정격·경고·커넥터·시리얼 라벨","5식","전면: 환경 모니터링 시스템 / 주식회사 컬리버","","","")]:
    r = put(ws, r, list(row), fill=WARN, wrap=True)


del wb["Sheet"]
wb.save(OUT)
print("saved:", OUT)
