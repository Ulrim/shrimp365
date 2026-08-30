import type { Locale } from "@/lib/i18n"

const HANGUL = /[가-힣]/
const VIETNAMESE = /[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i
// 인도네시아어 고빈도 기능어 — 영어와 문자 체계가 같아 단어로 구분한다.
const INDONESIAN = /\b(yang|dan|untuk|tidak|dengan|adalah|saya|ini|itu|dari|akan|sudah|bisa|tambak|udang|air|pakan)\b/i
const LATIN = /[A-Za-z]/

/**
 * 글 내용에서 언어를 추정한다. 작성자가 언어를 직접 고르지 않아도
 * 게시판이 언어별로 갈리도록 하기 위한 것.
 *
 * 문자 체계가 확실한 한국어·베트남어는 본문 판별을 신뢰하고,
 * 판별이 애매하면 작성 당시 화면 언어(fallback)를 그대로 쓴다.
 */
export function detectLocale(text: string, fallback: Locale): Locale {
  const sample = text.slice(0, 2000)

  if (HANGUL.test(sample)) return "ko"
  if (VIETNAMESE.test(sample)) return "vi"

  if (LATIN.test(sample)) {
    if (INDONESIAN.test(sample)) return "id"
    // 라틴 문자뿐이고 인니어 단서가 없을 때: 화면 언어가 en/id면 그대로 존중하고
    // (예: 인니 사용자가 짧은 영단어만 적은 경우) 그 외에는 영어로 본다.
    return fallback === "id" ? "id" : "en"
  }

  return fallback
}
