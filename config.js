/* ============================================================================
 * 포코쿠지 (POKO KUJI) · Supabase 접속 설정
 * ----------------------------------------------------------------------------
 * 아래 두 칸을 채우면 사이트가 자동으로 실DB 모드로 바뀝니다.
 * 비워 두면 지금의 데모 모드 그대로입니다. (배포해도 안전)
 *
 *   1) https://supabase.com 가입 → New project
 *   2) Project Settings → API
 *        · Project URL         → SUPABASE_URL
 *        · anon / public key   → SUPABASE_ANON_KEY
 *
 * ⚠ service_role / secret key 는 절대 여기에 넣지 마세요.
 *    anon key 는 공개되어도 되는 키이고, 실제 보안은 DB 의 RLS 정책이 담당합니다.
 * ==========================================================================*/
window.CHII_BACKEND_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: ""
};
