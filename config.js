/* ============================================================================
 * 포코쿠지 (POKO KUJI) · Supabase 접속 설정
 * ----------------------------------------------------------------------------
 * Supabase 프로젝트: pokokuji (ap-northeast-2 / Seoul)
 * Project ref: upkwqbooknasjqdjmjhb
 *
 * 여기 들어가는 두 값은 프론트엔드 공개용입니다.
 *   · Project URL      : Supabase → Project Settings → Data API
 *   · anon public key  : 공개되어도 되는 키. 실제 보안은 DB 의 RLS 담당.
 *
 * ⚠ service_role / secret key 는 절대 여기에 넣지 마세요.
 *    (sb_secret_... , service_role JWT 는 RLS 를 통째로 우회합니다)
 *
 * 값을 비우면 사이트는 자동으로 데모 모드로 돌아갑니다. (?demo=1 도 동일)
 * ----------------------------------------------------------------------------
 * 마지막 갱신: 2026-11-28 (실DB 연결)
 * ==========================================================================*/
window.CHII_BACKEND_CONFIG = {
  SUPABASE_URL: "https://upkwqbooknasjqdjmjhb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVwa3dxYm9va25hc2pxZGptamhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3OTkzMTIsImV4cCI6MjExMTM3NTMxMn0.-pjM_D-mCs7JP88f2v-diApkl33GMHErG6l4JGPu0zQ"
};
