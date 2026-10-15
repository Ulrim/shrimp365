// 영농 일지 선택지 — 농업 화면 전용(수아 시안 mode-split-ui.md 5-4).
//
// `lib/record-actions.ts` 의 AGRI_NUTRIENT_TYPES · AGRI_INPUT_TYPES 를 여기로 옮겨 둔다.
// 3단계(새우 정리)에서 그쪽 원본이 지워지므로 농업 뷰는 이 파일만 import 한다 —
// 일지 쓰기(agri-journal-record-view)와 일지 목록(agri-journal-view)이 같은 목록을 본다.
//
// 자재는 제품명이 아니라 **범주**다 — 특정 제품에 묶이지 않게(선행 시안 §3-1).
// 값은 DB(journal_entries.feed_type / microbial_type)에 그대로 저장되므로 이미 쌓인
// 기록과 어긋나지 않게 문자열을 바꾸지 않는다.

/** 양액 종류(`feed_type` 컬럼). */
export const AGRI_NUTRIENT_TYPES = ["A/B 표준 배양액", "자가 배양액", "추비(단비)", "기타"] as const

/** 투입 자재 종류(`microbial_type` 컬럼). */
export const AGRI_INPUT_TYPES = ["미생물제", "칼슘·규산 보충제", "천적", "기타"] as const
