-- A published blog post announces itself (Ames 2026-10-10).
--
-- When a post becomes published, a notification goes to every player:
--   title  "New on the blog: <the post's title>"
--   body   the post's summary, a link to the post on the blog, a rule, and
--          then the whole post, so it can be read without leaving the game
--   image  the post's feature image, if it has one
-- and it is flagged to be posted in chat as well. The game already posts a
-- flagged notification to chat, once, from an admin's open game (the same
-- path "Also post to chat" in the Admin Hub uses), within about a minute.
--
-- It is a database trigger, so it does not matter how the post was published:
-- the Blog Editor, or SQL. Each post is announced once: editing a published
-- post, or unpublishing and publishing it again, does not announce it twice.
-- An edit to the post's title, summary, text or feature image after it is
-- published is carried over to the notification already sent.
--
-- Run in the Supabase SQL editor. Safe to re-run. It announces posts published
-- from now on; nothing published before the trigger existed is announced.

CREATE OR REPLACE FUNCTION public.ew_announce_blog_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  link    TEXT;
  cover   TEXT := NULLIF(btrim(COALESCE(NEW.cover_url, '')), '');
  post    TEXT := COALESCE(NEW.body, '');
  heading TEXT;
  words   TEXT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' OR NEW.title IS NULL THEN RETURN NEW; END IF;
  link := 'https://connectome.quest/blog/post.html?p=' || NEW.slug;

  -- The post's text, with the three things only the blog page understands
  -- put into words a notification can show: a video becomes a link, a
  -- callout becomes a quote, and a picture's caption line is dropped (the
  -- notification shows no pictures from the text, only the feature image).
  post := regexp_replace(post, '^@\[youtube\]\(([A-Za-z0-9_-]+)\)\s*$', '[Watch the video](https://www.youtube.com/watch?v=\1)', 'gn');
  post := regexp_replace(post, '^!> ?', '> ', 'gn');
  post := regexp_replace(post, '^\^ ?.*$', '', 'gn');
  post := regexp_replace(post, '^!\[[^\]]*\]\([^)]*\)\s*$', '', 'gn');

  heading := 'New on the blog: ' || NEW.title;
  words := COALESCE(NULLIF(btrim(NEW.summary), '') || E'\n\n', '')
        || '[Read it on the blog](' || link || ')'
        || CASE WHEN btrim(post) <> '' THEN E'\n\n---\n\n' || btrim(post) ELSE '' END;

  -- Already announced: keep the notification in step with the post.
  IF EXISTS (SELECT 1 FROM public.notifications n WHERE position(link IN n.body) > 0) THEN
    UPDATE public.notifications n
       SET title = heading, body = words, image_url = cover, thumbnail_url = cover
     WHERE position(link IN n.body) > 0
       AND (n.title IS DISTINCT FROM heading OR n.body IS DISTINCT FROM words OR n.image_url IS DISTINCT FROM cover);
    RETURN NEW;
  END IF;
  -- An edit to a post that was already out before this trigger existed.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'published' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications
    (title, body, image_url, thumbnail_url, target_type, send_at, post_to_chat, created_by)
  VALUES (heading, words, cover, cover, 'all',
    -- a post dated ahead is announced when its date arrives
    GREATEST(NOW(), COALESCE(NEW.published_at, NOW())),
    TRUE, NEW.author_id);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
CREATE TRIGGER blog_post_announce
  AFTER INSERT OR UPDATE OF status, cover_url, title, summary, body ON public.blog_posts
  FOR EACH ROW EXECUTE FUNCTION public.ew_announce_blog_post();

-- Bring the notification for the post already announced up to date (it was
-- sent with the summary and the link only). This changes nothing in the post.
UPDATE public.blog_posts SET body = body WHERE slug = 'upgrades-to-chat';

-- To switch it off:
--   DROP TRIGGER IF EXISTS blog_post_announce ON public.blog_posts;
