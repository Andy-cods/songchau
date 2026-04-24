'use client';

import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────

interface Card {
  id: number;
  stage: string;
  title: string;
  description?: string;
  customer_id?: number;
  customer_name?: string;
  rfq_number?: string;
  po_number?: string;
  bqms_code?: string;
  follow_up_date?: string;
  follow_up_note?: string;
  assigned_name?: string;
  priority: string;
  source: string;
  is_overdue?: boolean;
  created_at: string;
  moved_at: string;
}

interface StageData {
  label: string;
  cards: Card[];
  count: number;
}

// ─── Constants ──────────────────────────────────────────────────

const STAGES = ['new', 'nurturing', 'active', 'delivering', 'aftercare'];

const STAGE_COLORS: Record<string, { header: string; dot: string }> = {
  new: { header: 'bg-blue-50 border-blue-200', dot: 'bg-blue-500' },
  nurturing: { header: 'bg-violet-50 border-violet-200', dot: 'bg-violet-500' },
  active: { header: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  delivering: { header: 'bg-cyan-50 border-cyan-200', dot: 'bg-cyan-500' },
  aftercare: { header: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-amber-500',
  normal: 'border-l-slate-300',
  low: 'border-l-slate-200',
};

const TABS = [
  { key: 'kanban', label: 'Pipeline' },
  { key: 'customers', label: 'Danh sách KH' },
  { key: 'contacts', label: 'Danh bạ' },
];

// ─── Page Component ─────────────────────────────────────────────

export default function CRMPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('kanban');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [dragCard, setDragCard] = useState<Card | null>(null);
  const [generating, setGenerating] = useState(false);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Khách hàng</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý chu kỳ chăm sóc khách hàng</p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'kanban' && (
            <>
              <button
                onClick={async () => {
                  setGenerating(true);
                  try {
                    const res = await api.post<any>('/api/v1/crm/pipeline/generate');
                    queryClient.invalidateQueries({ queryKey: ['crm-board'] });
                    alert(res.message || 'Done');
                  } catch {} finally { setGenerating(false); }
                }}
                disabled={generating}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {generating ? 'Đang tạo...' : 'Tạo từ BQMS'}
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700"
              >
                + Thêm card
              </button>
            </>
          )}
          {activeTab === 'customers' && (
            <button onClick={() => router.push('/crm/new')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700">
              + Thêm KH
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'kanban' && <KanbanBoard dragCard={dragCard} setDragCard={setDragCard} />}
      {activeTab === 'customers' && <CustomersTab />}
      {activeTab === 'contacts' && <ContactsTab />}

      {/* Create modal */}
      {showCreateModal && (
        <CreateCardModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['crm-board'] });
          }}
        />
      )}
    </div>
  );
}

// ─── Kanban Board ───────────────────────────────────────────────

function KanbanBoard({ dragCard, setDragCard }: { dragCard: Card | null; setDragCard: (c: Card | null) => void }) {
  const queryClient = useQueryClient();

  const { data: boardData, isLoading } = useQuery({
    queryKey: ['crm-board'],
    queryFn: () => api.get<any>('/api/v1/crm/pipeline/board'),
    refetchInterval: 30000,
  });

  const board: Record<string, StageData> = boardData?.data ?? {};

  const moveMutation = useMutation({
    mutationFn: ({ cardId, stage }: { cardId: number; stage: string }) =>
      api.patch(`/api/v1/crm/pipeline/cards/${cardId}/move`, { stage }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm-board'] }),
  });

  const handleDrop = (stage: string) => {
    if (dragCard && dragCard.stage !== stage) {
      moveMutation.mutate({ cardId: dragCard.id, stage });
    }
    setDragCard(null);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-3">
        {STAGES.map(s => (
          <div key={s} className="bg-slate-50 rounded-xl h-96 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-3 min-h-[500px]">
      {STAGES.map(stage => {
        const data = board[stage] || { label: stage, cards: [], count: 0 };
        const colors = STAGE_COLORS[stage] || STAGE_COLORS.new;

        return (
          <div
            key={stage}
            className="bg-slate-50/80 rounded-xl flex flex-col min-h-0"
            onDragOver={e => e.preventDefault()}
            onDrop={() => handleDrop(stage)}
          >
            {/* Column header */}
            <div className={cn('px-3 py-2.5 rounded-t-xl border-b flex items-center justify-between', colors.header)}>
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full', colors.dot)} />
                <span className="text-xs font-semibold text-slate-700">{data.label}</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 bg-white px-1.5 py-0.5 rounded">
                {data.count}
              </span>
            </div>

            {/* Cards */}
            <div className="p-2 space-y-2 flex-1 overflow-y-auto">
              {data.cards.length === 0 ? (
                <p className="text-center text-xs text-slate-300 py-8">Trống</p>
              ) : (
                data.cards.map(card => (
                  <PipelineCard
                    key={card.id}
                    card={card}
                    onDragStart={() => setDragCard(card)}
                    onMove={(newStage) => moveMutation.mutate({ cardId: card.id, stage: newStage })}
                    onArchive={async () => {
                      await api.delete(`/api/v1/crm/pipeline/cards/${card.id}`);
                      queryClient.invalidateQueries({ queryKey: ['crm-board'] });
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Pipeline Card ──────────────────────────────────────────────

function PipelineCard({ card, onDragStart, onMove, onArchive }: {
  card: Card;
  onDragStart: () => void;
  onMove: (stage: string) => void;
  onArchive: () => void;
}) {
  const router = useRouter();
  const [showActions, setShowActions] = useState(false);
  const currentIdx = STAGES.indexOf(card.stage);
  const nextStage = currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={cn(
        'bg-white rounded-lg border border-slate-200 p-3 cursor-grab active:cursor-grabbing',
        'hover:shadow-sm transition-shadow border-l-[3px]',
        PRIORITY_COLORS[card.priority] || PRIORITY_COLORS.normal,
        card.is_overdue && 'ring-1 ring-red-200',
      )}
      onClick={() => setShowActions(!showActions)}
    >
      {/* Title */}
      <p className="text-xs font-semibold text-slate-800 mb-1 line-clamp-2">{card.title}</p>

      {/* Customer */}
      {card.customer_name && (
        <p className="text-[10px] text-slate-500 mb-1">{card.customer_name}</p>
      )}

      {/* Description */}
      {card.description && (
        <p className="text-[10px] text-slate-400 line-clamp-2 mb-1.5">{card.description}</p>
      )}

      {/* Codes */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {card.rfq_number && (
          <span className="text-[9px] font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
            {card.rfq_number}
          </span>
        )}
        {card.po_number && (
          <span className="text-[9px] font-mono bg-violet-50 text-violet-600 px-1.5 py-0.5 rounded">
            PO {card.po_number}
          </span>
        )}
      </div>

      {/* Follow-up */}
      {card.follow_up_date && (
        <div className={cn('text-[10px] px-2 py-1 rounded mt-1',
          card.is_overdue ? 'bg-red-50 text-red-600 font-medium' : 'bg-slate-50 text-slate-500'
        )}>
          {card.is_overdue ? 'Quá hạn: ' : 'Follow-up: '}
          {formatDate(card.follow_up_date)}
          {card.follow_up_note && <span className="block text-[9px] mt-0.5">{card.follow_up_note}</span>}
        </div>
      )}

      {/* Assigned */}
      {card.assigned_name && (
        <p className="text-[10px] text-slate-400 mt-1">{card.assigned_name}</p>
      )}

      {/* Actions */}
      {showActions && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex gap-1.5">
          {card.customer_id && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/crm/${card.customer_id}`);
              }}
              className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-700 font-medium hover:bg-blue-100"
            >
              Xem CRM
            </button>
          )}
          {nextStage && (
            <button
              onClick={(e) => { e.stopPropagation(); onMove(nextStage); }}
              className="text-[10px] px-2 py-1 rounded bg-brand-50 text-brand-700 font-medium hover:bg-brand-100"
            >
              Chuyển tiếp
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="text-[10px] px-2 py-1 rounded bg-slate-50 text-slate-500 hover:bg-slate-100"
          >
            Lưu trữ
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Create Card Modal ──────────────────────────────────────────

function CreateCardModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    title: '', description: '', customer_name: '', stage: 'new',
    rfq_number: '', po_number: '', priority: 'normal',
    follow_up_date: '', follow_up_note: '', assigned_name: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      await api.post('/api/v1/crm/pipeline/cards', {
        ...form,
        follow_up_date: form.follow_up_date || null,
      });
      onCreated();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[500px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Thêm card mới</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">x</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Tiêu đề *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Khách hàng</label>
              <input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Giai đoạn</label>
              <select value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="new">Mới tiếp nhận</option>
                <option value="nurturing">Đang chăm sóc</option>
                <option value="active">Có RFQ/PO mới</option>
                <option value="delivering">Đang giao hàng</option>
                <option value="aftercare">Theo dõi sau bán</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Mã RFQ</label>
              <input value={form.rfq_number} onChange={e => setForm(f => ({ ...f, rfq_number: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Mã PO</label>
              <input value={form.po_number} onChange={e => setForm(f => ({ ...f, po_number: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Mô tả</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Ưu tiên</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="low">Thấp</option>
                <option value="normal">Bình thường</option>
                <option value="high">Cao</option>
                <option value="urgent">Khẩn cấp</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Follow-up</label>
              <input type="date" value={form.follow_up_date} onChange={e => setForm(f => ({ ...f, follow_up_date: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Phụ trách</label>
              <input value={form.assigned_name} onChange={e => setForm(f => ({ ...f, assigned_name: e.target.value }))}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-600 hover:bg-slate-50">Hủy</button>
          <button onClick={handleSave} disabled={saving || !form.title}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
            {saving ? 'Đang tạo...' : 'Tạo card'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customers Tab ──────────────────────────────────────────────

function CustomersTab() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['crm-customers', page],
    queryFn: () => api.get<any>(`/api/v1/crm/customers?page=${page}`),
  });

  const raw = data?.data;
  const customers: any[] = Array.isArray(raw) ? raw : (raw?.customers ?? []);
  const filtered = search
    ? customers.filter((c: any) => c.company_name?.toLowerCase().includes(search.toLowerCase()))
    : customers;

  return (
    <div>
      <div className="mb-4">
        <input type="text" placeholder="Tìm khách hàng..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-64 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Chưa có khách hàng</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-mono uppercase">Công ty</th>
                <th className="text-left px-4 py-2.5 text-xs text-slate-400 font-mono uppercase">Tên ngắn</th>
                <th className="text-right px-4 py-2.5 text-xs text-slate-400 font-mono uppercase">Đơn hàng</th>
                <th className="text-right px-4 py-2.5 text-xs text-slate-400 font-mono uppercase">Doanh thu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c: any) => (
                <tr key={c.id} onClick={() => router.push(`/crm/${c.id}`)}
                  className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm text-slate-700 font-medium">{c.company_name}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{c.short_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">{c.total_orders ?? 0}</td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right font-mono">
                    {c.total_revenue ? `${(c.total_revenue / 1_000_000).toFixed(0)}M` : '0'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Contacts Tab ───────────────────────────────────────────────

function ContactsTab() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['crm-contacts-all', search],
    queryFn: () => api.get<any>(`/api/v1/crm/contacts-all?search=${search}&page=1`),
  });

  const contacts: any[] = data?.data?.contacts ?? [];
  const bqmsContacts: any[] = data?.data?.bqms_contacts ?? [];
  const all = [...contacts, ...bqmsContacts.map((b: any) => ({ ...b, company_name: b.company_name || 'Samsung BQMS' }))];

  function contactColor(lastDate: string | null): string {
    if (!lastDate) return 'text-slate-400';
    const days = (Date.now() - new Date(lastDate).getTime()) / 86400000;
    if (days <= 7) return 'text-emerald-600';
    if (days <= 30) return 'text-amber-600';
    return 'text-red-600';
  }

  return (
    <div>
      <div className="mb-4">
        <input type="text" placeholder="Tìm tên, email, SĐT..." value={search} onChange={e => setSearch(e.target.value)}
          className="w-64 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
      </div>
      {isLoading ? (
        <div className="text-center text-slate-400 py-8 text-sm">Đang tải...</div>
      ) : all.length === 0 ? (
        <div className="text-center text-slate-400 py-8 text-sm">Chưa có liên hệ</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {all.slice(0, 20).map((c: any, i: number) => (
            <div key={c.id ?? i} className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{c.full_name}</p>
                  <p className="text-xs text-slate-500">{c.company_name ?? '—'}</p>
                </div>
                {c.is_primary && <span className="text-[10px] bg-brand-50 text-brand-600 px-1.5 py-0.5 rounded font-medium">Chính</span>}
              </div>
              {(c.position || c.department) && (
                <p className="text-xs text-slate-400">{c.position}{c.position && c.department ? ' · ' : ''}{c.department}</p>
              )}
              <div className="mt-2 space-y-0.5">
                {c.email && <p className="text-xs text-slate-600">{c.email}</p>}
                {c.phone && <p className="text-xs text-slate-600">{c.phone}</p>}
              </div>
              {c.last_contacted_at && (
                <p className={cn('text-[10px] mt-2', contactColor(c.last_contacted_at))}>
                  Liên hệ: {formatDate(c.last_contacted_at)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
