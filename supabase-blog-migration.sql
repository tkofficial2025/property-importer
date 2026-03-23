-- ブログ下書きテーブル
CREATE TABLE IF NOT EXISTS public.blog_drafts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  slug text,
  content text NOT NULL,
  excerpt text,
  meta_description text,
  category text DEFAULT 'Guide',
  keywords text[],
  trending_topic text,          -- Google Trendsで取得したトピック
  japanese_sources text,        -- 参照した日本語情報（デバッグ用）
  featured_image text,          -- Pexels写真URL
  photo_credit text,            -- 写真クレジット（例: Photo by X on Pexels）
  status text DEFAULT 'draft',  -- draft | published | rejected
  created_at timestamptz DEFAULT now(),
  published_at timestamptz
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_blog_drafts_status ON public.blog_drafts(status);
CREATE INDEX IF NOT EXISTS idx_blog_drafts_created_at ON public.blog_drafts(created_at DESC);

-- 公開ポリシー（service_roleのみ書き込み可）
ALTER TABLE public.blog_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON public.blog_drafts
  USING (true)
  WITH CHECK (true);
