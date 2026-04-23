-- 日本語SNSブログ記事テーブル（TKSNSサイト向け）
CREATE TABLE IF NOT EXISTS public.jp_blog_posts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title           text NOT NULL,
  slug            text NOT NULL UNIQUE,
  content         text,
  excerpt         text,
  category        text DEFAULT '戦略',   -- RED / 抖音 / WeChat / KOL / 越境EC / インバウンド / 戦略
  keywords        text[],
  trending_topic  text,
  baidu_sources   text,                  -- 百度ニュースから取得した参考情報（デバッグ用）
  featured_image  text,                  -- Pexels写真URL
  photo_credit    text,
  status          text DEFAULT 'draft',  -- draft | published | rejected
  qa_status       text,                  -- pass | fail | null
  qa_result       jsonb,
  qa_checked_at   timestamptz,
  published_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_jp_blog_posts_status     ON public.jp_blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_jp_blog_posts_created_at ON public.jp_blog_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jp_blog_posts_slug       ON public.jp_blog_posts(slug);

-- RLS有効化
ALTER TABLE public.jp_blog_posts ENABLE ROW LEVEL SECURITY;

-- 匿名ユーザーはpublishedの記事のみ読める（TKSNS向け）
CREATE POLICY "anon can read published posts" ON public.jp_blog_posts
  FOR SELECT
  USING (status = 'published');

-- 書き込みは全操作を許可（property-importerのanon keyから書き込む）
-- ※ より安全にするにはservice_role keyを使い、このポリシーは削除すること
CREATE POLICY "anon full write access" ON public.jp_blog_posts
  FOR ALL
  USING (true)
  WITH CHECK (true);
