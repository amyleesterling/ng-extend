-- The Training Sim gives its cells through Play (Ames 2026-11-17). Claim Cell
-- on a Sandbox cell outside the list made a new task with no soma point and
-- no answer key (task 16837, retired): the box sat on "No key" with nothing
-- in 3D. Claiming a listed Sandbox cell, and new cells on other datasets, are
-- unchanged. Applied 2026-11-17 as migration sandbox_claim_only_listed_cells.
-- Patches pilot_task_action in place (its full text lives in
-- supabase-claim-working-link.sql); runs twice safely.
DO $do$
DECLARE def text; anchor text := 'IF NOT FOUND THEN' || chr(13) || chr(10) || '      INSERT INTO public.proofreading_tasks (dataset,segment_id';
  guard text := 'IF NOT FOUND THEN' || chr(13) || chr(10)
    || '      -- The Training Sim gives its cells through Play; a cell outside its list has no answer key (Ames 2026-11-17).' || chr(13) || chr(10)
    || '      IF ds = ''pinky_nf_v2'' THEN RAISE EXCEPTION ''Training Sim cells come from Play. Press Play for a practice cell.''; END IF;' || chr(13) || chr(10)
    || '      INSERT INTO public.proofreading_tasks (dataset,segment_id';
BEGIN
  def := pg_get_functiondef('public.pilot_task_action(uuid,text,jsonb)'::regprocedure);
  IF position('Training Sim cells come from Play' IN def) > 0 THEN RAISE NOTICE 'already in place'; RETURN; END IF;
  IF (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 THEN RAISE EXCEPTION 'anchor not found exactly once'; END IF;
  EXECUTE replace(def, anchor, guard);
END $do$;
