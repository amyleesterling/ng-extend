-- The two demo interneuron quests on MEC (Ames 2026-10-28). Run after
-- supabase-interneuron-quests.sql. Safe to re-run. More cells go in from
-- Admin Hub > Interneurons.
BEGIN;
INSERT INTO public.proofreading_tasks (dataset, segment_id, kind, notes)
SELECT 'pni_mec', s, 'interneuron', 'Demo quest'
FROM unnest(ARRAY['720575947582584839', '720575947560901294']) AS s
WHERE NOT EXISTS (SELECT 1 FROM public.proofreading_tasks t WHERE t.dataset = 'pni_mec' AND t.segment_id = s);
-- Already in the Cell Library: they become quests.
UPDATE public.proofreading_tasks SET kind = 'interneuron', updated_at = now()
WHERE dataset = 'pni_mec' AND segment_id IN ('720575947582584839', '720575947560901294') AND kind <> 'interneuron';
UPDATE public.task_assignments a SET expires_at = 'infinity'
FROM public.proofreading_tasks t
WHERE a.task_id = t.id AND t.kind = 'interneuron' AND a.status = 'active';
SELECT id, segment_id, kind, status FROM public.proofreading_tasks
WHERE dataset = 'pni_mec' AND kind = 'interneuron';
COMMIT;
