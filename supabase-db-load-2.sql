-- ============================================================================
-- Pyr: database load, round 2 (2026-11-02)
-- After supabase-db-load.sql (26 Oct). From Supabase Query Performance, about
-- 7 days: the leaderboard refresh was 11% of database time (every minute,
-- 211 ms), Dataset Stats 3% (every 10 minutes, 632 ms), and anon edit_log
-- reads 22% (the MEC segment list asked about each segment on its own).
--
-- Run each @@STEP on its own in the Supabase SQL editor. Step 3 is
-- CREATE INDEX CONCURRENTLY: alone, outside a transaction.
-- ============================================================================


-- @@STEP 1: Leaderboard refresh only when something changed
-- The minute's refresh is skipped when no edit has been logged since the
-- last one, but it still runs at least every 10 minutes, so the 24 hour and
-- 7 day windows and changed names keep up. max(id) reads one index entry.
BEGIN;
CREATE TABLE IF NOT EXISTS public.ew_cache_marks (
  name         TEXT PRIMARY KEY,
  max_edit_id  BIGINT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ew_cache_marks ENABLE ROW LEVEL SECURITY;   -- no policy: API roles read nothing
REVOKE ALL ON public.ew_cache_marks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_leaderboard_cache()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  newest BIGINT;
  last   public.ew_cache_marks%ROWTYPE;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(98127, 61760) THEN RETURN; END IF;
  SELECT max(id) INTO newest FROM public.edit_log;
  SELECT * INTO last FROM public.ew_cache_marks WHERE name = 'leaderboard';
  IF FOUND AND last.max_edit_id IS NOT DISTINCT FROM newest
     AND last.refreshed_at > now() - interval '10 minutes' THEN
    RETURN;
  END IF;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_cache;
  INSERT INTO public.ew_cache_marks (name, max_edit_id, refreshed_at) VALUES ('leaderboard', newest, now())
  ON CONFLICT (name) DO UPDATE SET max_edit_id = EXCLUDED.max_edit_id, refreshed_at = EXCLUDED.refreshed_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refresh_leaderboard_cache() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_leaderboard_cache() TO service_role;
COMMIT;


-- @@STEP 2: Dataset Stats every 30 minutes instead of 10
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'pyr-dataset-stats-refresh'),
                      schedule => '*/30 * * * *');


-- @@STEP 3: Index for one segment's status (MEC segment list)
-- Serves src/widgets/lightbulb_service.ts: edit_log where dataset = X and
-- segment_after in (...) and operation in (mark, unmark, type), newest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_editlog_status_by_root
  ON public.edit_log (dataset, segment_after, "timestamp" DESC)
  WHERE operation IN ('mark_complete', 'unmark_complete', 'set_cell_type');


-- @@STEP 4: Checks
-- The refresh still runs and how long it takes (a skipped minute takes ~1 ms):
SELECT status, end_time - start_time AS took, start_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'pyr-leaderboard-cache-refresh')
ORDER BY start_time DESC LIMIT 10;


-- @@ROLLBACK
-- Step 1: the refresh as it was (every minute, always):
-- CREATE OR REPLACE FUNCTION public.refresh_leaderboard_cache()
-- RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
-- BEGIN
--   IF NOT pg_catalog.pg_try_advisory_xact_lock(98127, 61760) THEN RETURN; END IF;
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.leaderboard_cache;
-- END;
-- $fn$;
-- DROP TABLE IF EXISTS public.ew_cache_marks;
-- Step 2:
-- SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'pyr-dataset-stats-refresh'), schedule => '*/10 * * * *');
-- Step 3:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_editlog_status_by_root;
