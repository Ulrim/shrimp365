-- 개체수 기록에 추정 체장을 더한다.
--
-- 장비가 먹이망 격자(한 칸 8 × 7.5 cm)로 축척을 잡아 두면, 상자 크기에서
-- 몸길이를 재어 함께 올린다. 축척을 안 잡은 장비는 NULL 을 보낸다.
--
-- **이 값은 추정이다.** 모델은 네모 상자만 주고 새우가 어느 쪽을 보고
-- 누웠는지는 모른다. 길이 L, 두께 T 인 새우가 각도 θ 로 누우면 상자의
-- 대각선은 √(L² + T² + 4·L·T·|sinθ·cosθ|) 이므로 L 이상 L+T 이하가 된다.
-- 개별 한 마리는 최대 20% 과대평가되지만, 여러 마리의 가운뎃값은 각도가
-- 섞여 치우침이 일정해진다. **날짜별 성장 추이**에 쓰는 값이지 출하 규격을
-- 판정하는 값이 아니다.
--
-- 이 파일을 실행하지 않아도 개체수는 그대로 쌓인다 — /api/vision/device 가
-- 열이 없는 것을 알아보고 길이만 떼고 저장한다. 실행하면 그때부터 길이가
-- 함께 들어간다. 장비를 다시 깔거나 재시작할 필요가 없다.

alter table public.count_records
  add column if not exists length_cm real;

comment on column public.count_records.length_cm is
  '추정 체장(cm) — 상자 대각선에서 잰 가운뎃값. 축척을 잡은 장비만 보낸다. 추이용이며 개별 측정값이 아니다.';

-- 음수나 터무니없는 값이 들어오면 그래프가 통째로 망가진다. 새우는 아무리
-- 커도 40 cm 를 넘지 않는다(흰다리새우는 보통 20 cm 이하).
alter table public.count_records
  drop constraint if exists count_records_length_cm_range;
alter table public.count_records
  add constraint count_records_length_cm_range
  check (length_cm is null or (length_cm > 0 and length_cm <= 40));

-- ---------------------------------------------------------------------------
-- 이력 그래프가 체장도 함께 받도록 한다.
--
-- 반환 열이 바뀌므로 `create or replace` 만으로는 안 되고 먼저 지워야 한다
-- (Postgres 는 반환 타입이 다른 같은 이름 함수를 바꿔 끼우지 못한다).
-- 지웠다가 다시 만드는 사이에 화면이 한 번 비는 것은 감수한다 — 이력은
-- 실시간 값이 아니라 다시 열면 그만이다.
-- ---------------------------------------------------------------------------
drop function if exists public.vision_count_history(uuid, timestamptz, timestamptz, int);

create function public.vision_count_history(
  p_camera_id      uuid,
  p_start          timestamptz,
  p_end            timestamptz,
  p_bucket_seconds int default 3600
)
returns table (
  bucket       timestamptz,
  avg_count    int,
  max_count    int,
  min_count    int,
  confidence_avg real,
  sample_count int,
  avg_length_cm real
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    to_timestamp(floor(extract(epoch from time) / p_bucket_seconds) * p_bucket_seconds) as bucket,
    round(avg(count))::int   as avg_count,
    max(count)               as max_count,
    min(count)               as min_count,
    avg(confidence_avg)::real as confidence_avg,
    count(*)::int            as sample_count,
    -- 길이를 올리지 않은 장비는 NULL 이다. avg 는 NULL 을 빼고 세므로, 길이를
    -- 재는 장비와 안 재는 장비가 섞여 있어도 잰 것만으로 평균이 난다.
    avg(length_cm)::real     as avg_length_cm
  from public.count_records
  where camera_id = p_camera_id
    and time >= p_start
    and time <  p_end
  group by 1
  order by 1
$$;

comment on function public.vision_count_history(uuid, timestamptz, timestamptz, int) is
  '카메라 한 대의 개체수·체장 시계열. security invoker 라 RLS 가 그대로 걸린다.';

-- 함수를 지우면 권한도 함께 사라진다. 다시 주지 않으면 로그인한 사용자가
-- 이력 그래프를 못 연다 — 고치려고 한 것보다 큰 것을 깨뜨리게 된다.
grant execute on function public.vision_count_history(uuid, timestamptz, timestamptz, int) to authenticated;
