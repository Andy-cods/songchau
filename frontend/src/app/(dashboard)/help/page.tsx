'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  HelpCircle,
  ChevronRight,
  Plus,
  X,
  Loader2,
  BookOpen,
  ArrowLeft,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────

interface Article {
  id: number;
  title: string;
  slug: string;
  category: string;
  content?: string;
}

interface ArticlesResponse {
  data: Article[];
}

interface ArticleDetailResponse {
  data: {
    title: string;
    content: string;
    category: string;
  };
}

interface FirstLoginResponse {
  data: {
    title: string;
    steps: string[];
  };
}

// ─── Categories ───────────────────────────────────────────────────

const SIDEBAR_CATEGORIES = [
  { value: 'general', label: 'Bắt đầu', icon: '🚀' },
  { value: 'bqms', label: 'BQMS', icon: '📋' },
  { value: 'purchase', label: 'Mua hàng', icon: '🛒' },
  { value: 'inventory', label: 'Kho', icon: '📦' },
  { value: 'finance', label: 'Tài chính', icon: '💰' },
  { value: 'system', label: 'Hệ thống', icon: '⚙️' },
];

// ─── Create Article Modal ─────────────────────────────────────────

interface CreateArticleModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function CreateArticleModal({ onClose, onSuccess }: CreateArticleModalProps) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('general');
  const [content, setContent] = useState('');

  function autoSlug(val: string) {
    return val
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  const createMutation = useMutation({
    mutationFn: (body: { title: string; slug: string; category: string; content: string }) =>
      api.post('/api/v1/help/articles', body),
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim() || !content.trim()) return;
    createMutation.mutate({ title: title.trim(), slug: slug.trim(), category, content: content.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-slate-100 w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-brand-600" />
            <h3 className="text-sm font-semibold text-slate-800">Tạo bài viết mới</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Tiêu đề <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slug) setSlug(autoSlug(e.target.value));
              }}
              placeholder="Nhập tiêu đề bài viết"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(autoSlug(e.target.value))}
              placeholder="url-slug-bai-viet"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Danh mục</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
            >
              {SIDEBAR_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Nội dung <span className="text-red-500">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Nhập nội dung bài viết (Markdown được hỗ trợ)..."
              rows={8}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 resize-none"
              required
            />
          </div>

          {createMutation.isError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">
              {(createMutation.error as { detail?: string })?.detail ?? 'Tạo bài viết thất bại.'}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !title.trim() || !slug.trim() || !content.trim()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60 transition-colors"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Tạo bài viết
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Article Content Viewer ────────────────────────────────────────

function ArticleViewer({
  slug,
  onBack,
}: {
  slug: string;
  onBack: () => void;
}) {
  const { data: raw, isLoading } = useQuery({
    queryKey: ['help-article', slug],
    queryFn: () => api.get<ArticleDetailResponse>(`/api/v1/help/articles/${slug}`),
    enabled: !!slug,
  });

  const article = raw?.data ?? (raw as any);

  // Simple markdown-to-HTML: headers, bold, italic, lists, code blocks
  function renderMarkdown(md: string): string {
    if (!md) return '';
    return md
      .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-800 mt-4 mb-2">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-slate-900 mt-5 mb-2 border-b border-slate-100 pb-1">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-900 mt-6 mb-3">$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code class="bg-slate-100 text-brand-700 px-1 py-0.5 rounded text-xs font-mono">$1</code>')
      .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-slate-600">$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-slate-600">$2</li>')
      .replace(/\n\n/g, '</p><p class="text-slate-600 leading-relaxed mb-3">')
      .replace(/^(?!<[h|l])(.+)$/gm, '<p class="text-slate-600 leading-relaxed mb-3">$1</p>');
  }

  if (isLoading) {
    return (
      <div className="flex-1 p-6 space-y-3">
        <div className="h-7 w-3/4 bg-slate-200 rounded animate-pulse" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={cn('h-4 bg-slate-200 rounded animate-pulse', i % 3 === 2 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-600 mb-4 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Quay lại danh sách
      </button>
      {article ? (
        <>
          <h1 className="text-xl font-bold text-slate-900 mb-4">{article.title}</h1>
          <div
            className="prose prose-sm max-w-none text-slate-600"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content ?? '') }}
          />
        </>
      ) : (
        <p className="text-slate-400 text-sm">Không tìm thấy bài viết.</p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────

export default function HelpPage() {
  const queryClient = useQueryClient();
  const [activeCategory, setActiveCategory] = useState('general');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: articlesRaw, isLoading: articlesLoading } = useQuery({
    queryKey: ['help-articles', activeCategory],
    queryFn: () =>
      api.get<ArticlesResponse>(`/api/v1/help/articles?category=${activeCategory}`),
  });

  const { data: firstLoginRaw } = useQuery({
    queryKey: ['help-first-login'],
    queryFn: () => api.get<FirstLoginResponse>('/api/v1/help/first-login'),
    enabled: activeCategory === 'general',
  });

  const _aRaw: any = articlesRaw?.data ?? articlesRaw;
  const articles: Article[] = Array.isArray(_aRaw)
    ? _aRaw
    : Array.isArray(_aRaw?.items) ? _aRaw.items : [];
  const firstLogin = firstLoginRaw?.data ?? (firstLoginRaw as any);

  return (
    <div className="space-y-6">
      {showCreate && (
        <CreateArticleModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['help-articles'] });
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-slate-900">Trung tâm hướng dẫn</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Tài liệu hướng dẫn sử dụng hệ thống Song Châu ERP
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Tạo bài viết
        </button>
      </div>

      {/* Main Layout */}
      <div className="flex gap-6 min-h-[600px]">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0">
          <div className="bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-3 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Danh mục</p>
            </div>
            <nav className="p-2 space-y-0.5">
              {SIDEBAR_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => {
                    setActiveCategory(cat.value);
                    setSelectedSlug(null);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
                    activeCategory === cat.value
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <span className="text-base leading-none">{cat.icon}</span>
                  {cat.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white rounded-lg shadow-sm border border-slate-100 overflow-hidden flex flex-col">
          {selectedSlug ? (
            <ArticleViewer slug={selectedSlug} onBack={() => setSelectedSlug(null)} />
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* First Login Guide (general only) */}
              {activeCategory === 'general' && firstLogin && (
                <div className="p-5 border-b border-slate-100">
                  <div className="bg-brand-50 border border-brand-100 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <HelpCircle className="h-4 w-4 text-brand-600" />
                      <h3 className="text-sm font-semibold text-brand-800">
                        {firstLogin.title ?? 'Hướng dẫn đăng nhập lần đầu'}
                      </h3>
                    </div>
                    <ol className="space-y-1.5">
                      {(firstLogin.steps ?? []).map((step: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-brand-700">
                          <span className="flex-shrink-0 h-5 w-5 rounded-full bg-brand-200 text-brand-800 text-xs flex items-center justify-center font-bold">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              )}

              {/* Articles List */}
              <div className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-700">
                    {SIDEBAR_CATEGORIES.find((c) => c.value === activeCategory)?.label ?? 'Bài viết'}
                  </h3>
                  {articlesLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 ml-1" />}
                </div>

                {articlesLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : articles.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <HelpCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Chưa có bài viết trong danh mục này</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {articles.map((article) => (
                      <button
                        key={article.id}
                        onClick={() => setSelectedSlug(article.slug)}
                        className="w-full flex items-center justify-between p-4 rounded-lg border border-slate-100 hover:border-brand-200 hover:bg-brand-50/30 transition-colors text-left group"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 p-1.5 rounded bg-brand-50 group-hover:bg-brand-100 transition-colors">
                            <BookOpen className="h-3.5 w-3.5 text-brand-600" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800 group-hover:text-brand-700 transition-colors">
                              {article.title}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5 font-mono">{article.slug}</p>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-brand-400 transition-colors flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
