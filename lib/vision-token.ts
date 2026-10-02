import { createHmac, timingSafeEqual } from "crypto"

// MJPEG·WebSocket 서명 토큰 발급 — **서버 전용**.
//
// 왜 필요한가: 영상은 <img> 태그가, 실시간 값은 WebSocket 이 가져온다.
// 둘 다 Authorization 헤더를 실을 수 없다. 그래서 로그인 세션을 서버에서
// 한 번 확인한 뒤, "이 사용자가 이 카메라들을 잠깐 볼 수 있다"는 짧은 서명을
// 주소에 실어 보낸다.
//
// 검증하는 쪽은 비전 서비스의 vision/app/core/security.py 다. **형식이 한 글자만
// 어긋나도 영상이 통째로 막히므로, 한쪽을 고치면 반드시 다른 쪽도 고쳐야 한다.**
//
// 토큰 형식:  v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
// 페이로드 :  {"c": 카메라 id 목록(쉼표), "e": 만료 epoch(초), "u": 사용자 id}
//             — JSON.stringify 대신 키를 정렬해 직접 만든다. 서명이 바이트
//               단위로 맞아야 하는데 키 순서가 흔들리면 서명도 흔들린다.

const TOKEN_VERSION = "v1"

/** 토큰 수명(초). 새로고침 한 번을 버티면 충분하다 — 길게 잡을수록 주소가
 *  새어 나갔을 때 열려 있는 시간이 길어진다. 화면은 만료 전에 다시 받아 간다. */
export const STREAM_TOKEN_TTL_SECONDS = 180

function b64url(raw: Buffer): string {
  return raw.toString("base64url")
}

function secret(): string | null {
  // 환경변수는 호출 시점에 읽는다(lib/push-server.ts 와 같은 이유 —
  // 값을 넣고 재배포해도 모듈 최상단 상수는 안 바뀌는 배포 형태가 있다).
  return process.env.VISION_STREAM_SECRET || null
}

/**
 * 스트림 토큰을 발급한다. 비밀키가 없으면 null — 호출부가 503 으로 알린다.
 *
 * @param cameraIds 이 토큰으로 볼 수 있는 카메라. **반드시 소유 확인을 마친
 *   목록**이어야 한다. 여기 담긴 카메라는 비전 서비스가 그대로 허용한다.
 * @param userId    감사 로그용. 비전 서비스는 이 값으로 권한을 다시 판단하지
 *   않는다 — 판단은 이미 여기서 끝났다.
 */
export function signStreamToken(cameraIds: string[], userId: string): string | null {
  const key = secret()
  if (!key || cameraIds.length === 0) return null

  const exp = Math.floor(Date.now() / 1000) + STREAM_TOKEN_TTL_SECONDS
  // 키 순서 c → e → u (파이썬 쪽 sort_keys=True 와 같은 순서).
  const payload = `{"c":${JSON.stringify(cameraIds.join(","))},"e":${exp},"u":${JSON.stringify(userId)}}`
  const payloadB64 = b64url(Buffer.from(payload, "utf8"))
  const signature = b64url(createHmac("sha256", key).update(payloadB64).digest())
  return `${TOKEN_VERSION}.${payloadB64}.${signature}`
}

/** 서비스 간 공유 키 확인. 비전 서비스가 shrimp365 를 되부를 때 쓴다. */
export function serviceKeyValid(provided: string | null | undefined): boolean {
  const expected = process.env.VISION_SERVICE_KEY
  if (!expected || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual 은 길이가 다르면 던진다. 길이 차이는 먼저 걸러 낸다
  // (길이는 비밀이 아니므로 여기서 새어 나갈 것이 없다).
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
