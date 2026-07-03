'use client';

// Phase 6 "Full Vision" (Thang 2026-05-12) — Pet gamification profile page.
//
// Layout:
//  - Hero: active pet (big sprite + idle animation) + name + EXP bar
//  - Interactions row: Cho ăn / Vuốt ve / Chơi (each +1 EXP, 1h cooldown)
//  - Tabs:
//      * Đàn của tôi — list owned pets (max 3), click to switch active
//      * Cửa hàng — adopt new pets (legendary needs 100+ total EXP)
//      * Bộ sưu tập — 27 sprite grid (greyscale if not unlocked)
//      * Lịch sử EXP — recent events for current pet
//
// Uses framer-motion v11 for idle bounce + click squash + level-up burst.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heart, Drumstick, Gamepad2, Crown, Sparkles, RefreshCw,
  Star, Lock, Trash2, ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Pet = {
  id: string;
  user_id: string;
  species: string;
  nickname: string;
  current_form: 1 | 2 | 3;
  exp: number;
  level: number;
  is_avatar: boolean;
  last_fed_at: string | null;
  last_pet_at: string | null;
  last_play_at: string | null;
  created_at: string;
  display_name_vi: string;
  color_theme: string;
  rarity: string;
  form_1_sprite: string;
  form_2_sprite: string;
  form_3_sprite: string;
  unlock_level_2: number;
  unlock_level_3: number;
  current_sprite: string;
};

type Species = {
  species: string;
  display_name_vi: string;
  description_vi: string;
  form_1_sprite: string;
  form_2_sprite: string;
  form_3_sprite: string;
  unlock_level_2: number;
  unlock_level_3: number;
  rarity: string;
  color_theme: string;
  sort_order: number;
};

type ExpEvent = {
  event_type: string;
  exp_delta: number;
  source_ref: string | null;
  created_at: string;
};

export default function ProfilePage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'collection' | 'shop' | 'history'>('collection');
  const [activePetId, setActivePetId] = useState<string | null>(null);

  const myPets = useQuery<{ data: Pet[] }>({
    queryKey: ['my-pets'],
    queryFn: () => api.get('/api/v1/me/pets'),
  });

  const catalog = useQuery<{ data: Species[] }>({
    queryKey: ['pet-catalog'],
    queryFn: () => api.get('/api/v1/pets/catalog'),
  });

  // Default active pet = avatar (or first)
  useEffect(() => {
    if (!activePetId && myPets.data?.data?.length) {
      const avatar = myPets.data.data.find(p => p.is_avatar) ?? myPets.data.data[0];
      setActivePetId(avatar.id);
    }
  }, [myPets.data, activePetId]);

  const activePet = myPets.data?.data?.find(p => p.id === activePetId) ?? null;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-amber-500" />
        <h1 className="text-xl font-bold text-slate-800">Hồ sơ + Pet của tôi</h1>
      </div>

      {/* Hero — active pet display */}
      {myPets.isLoading ? (
        <div className="bg-gradient-to-br from-slate-100 to-slate-50 rounded-3xl h-64 animate-pulse" />
      ) : !myPets.data?.data?.length ? (
        <EmptyHero onAdopt={() => setActiveTab('shop')} />
      ) : activePet ? (
        <PetHero pet={activePet} onRefresh={() => qc.invalidateQueries({ queryKey: ['my-pets'] })} />
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {([
          { v: 'collection', label: 'Đàn của tôi', icon: Heart },
          { v: 'shop',       label: 'Cửa hàng',   icon: Star },
          { v: 'history',    label: 'Lịch sử EXP', icon: RefreshCw },
        ] as const).map(({ v, label, icon: Icon }) => (
          <button
            key={v}
            onClick={() => setActiveTab(v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 transition-colors',
              activeTab === v ? 'border-amber-500 text-amber-700'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'collection' && (
        <MyPetsTab
          pets={myPets.data?.data ?? []}
          activeId={activePetId}
          onSelect={setActivePetId}
          onChanged={() => qc.invalidateQueries({ queryKey: ['my-pets'] })}
        />
      )}
      {activeTab === 'shop' && (
        <ShopTab
          species={catalog.data?.data ?? []}
          owned={(myPets.data?.data ?? []).map(p => p.species)}
          totalExp={(myPets.data?.data ?? []).reduce((s, p) => s + p.exp, 0)}
          onAdopted={() => qc.invalidateQueries({ queryKey: ['my-pets'] })}
        />
      )}
      {activeTab === 'history' && activePet && (
        <HistoryTab petId={activePet.id} />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function PetHero({ pet, onRefresh }: { pet: Pet; onRefresh: () => void }) {
  const expForNextLevel = (pet.level) * 10;
  const expIntoLevel = pet.exp - (pet.level - 1) * 10;
  const pct = Math.min(100, Math.round((expIntoLevel / 10) * 100));

  const interact = useMutation({
    mutationFn: (kind: 'feed' | 'pet' | 'play') =>
      api.post(`/api/v1/me/pets/${pet.id}/interact`, { kind }),
    onSuccess: (r: any) => {
      toast.success(r.message || 'Pet vui rồi!');
      if (r.data?.evolved) {
        toast.success(`🎉 Pet tiến hóa lên Form ${r.data.new_form}!`, { duration: 5000 });
      } else if (r.data?.leveled_up) {
        toast.success(`⭐ Level up! Hiện ở Lv ${r.data.new_level}`);
      }
      onRefresh();
    },
    onError: (e: any) => toast.error(e?.detail || 'Tương tác lỗi'),
  });

  const setAvatar = useMutation({
    mutationFn: () => api.post(`/api/v1/me/pets/${pet.id}/set-avatar`, {}),
    onSuccess: () => {
      toast.success('Đã đặt làm avatar');
      onRefresh();
    },
  });

  return (
    <div
      className="rounded-3xl p-6 shadow-xl text-white relative overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${pet.color_theme}dd, ${pet.color_theme}88)` }}
    >
      <div className="flex items-start gap-6 flex-wrap">
        {/* Sprite display with framer-motion idle animation */}
        <motion.div
          animate={{ y: [0, -8, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          whileTap={{ scale: 0.9, rotate: -6 }}
          className="flex-shrink-0 cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pet.current_sprite} alt={pet.nickname}
               className="w-40 h-40 drop-shadow-2xl"
               onError={(e) => { (e.target as HTMLImageElement).src = '/pets/dog_1.svg'; }} />
        </motion.div>

        <div className="flex-1 min-w-[260px]">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-white/20 backdrop-blur rounded-full text-[11px] font-mono uppercase tracking-wider border border-white/30 mb-2">
            <Heart className="h-3 w-3" />
            Pet của tôi · {pet.rarity}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-3xl font-bold">{pet.nickname}</h2>
            <span className="text-sm opacity-90">{pet.display_name_vi}</span>
            <span className="px-2 py-0.5 bg-white/25 rounded text-xs font-semibold">
              Lv {pet.level}
            </span>
            <span className="px-2 py-0.5 bg-amber-300/40 rounded text-xs font-semibold">
              Form {pet.current_form}
            </span>
            {pet.is_avatar && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-300/40 rounded text-xs font-semibold">
                <Crown className="h-3 w-3" />Avatar
              </span>
            )}
          </div>

          {/* EXP bar */}
          <div className="mt-4 bg-black/20 rounded-full h-3 overflow-hidden max-w-md">
            <motion.div
              className="h-full bg-gradient-to-r from-yellow-300 to-amber-100"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <div className="mt-1.5 text-xs opacity-80 max-w-md flex justify-between">
            <span>EXP: <strong>{pet.exp}</strong> / lên Lv {pet.level + 1} cần {expForNextLevel}</span>
            <span>{pct}%</span>
          </div>
          {pet.current_form < 3 && (
            <div className="mt-1 text-[11px] opacity-70">
              Form tiếp: Lv {pet.current_form === 1 ? pet.unlock_level_2 : pet.unlock_level_3}
            </div>
          )}

          {/* Interaction buttons */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <InteractBtn icon={Drumstick} label="Cho ăn" disabled={interact.isPending}
              onClick={() => interact.mutate('feed')} />
            <InteractBtn icon={Heart} label="Vuốt ve" disabled={interact.isPending}
              onClick={() => interact.mutate('pet')} />
            <InteractBtn icon={Gamepad2} label="Chơi" disabled={interact.isPending}
              onClick={() => interact.mutate('play')} />
            {!pet.is_avatar && (
              <button
                onClick={() => setAvatar.mutate()}
                disabled={setAvatar.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-xs font-semibold border border-white/30 active:scale-95 transition-all"
              >
                <Crown className="h-3.5 w-3.5" />Đặt làm avatar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InteractBtn({ icon: Icon, label, disabled, onClick }: {
  icon: any; label: string; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-slate-800 hover:bg-slate-50 text-xs font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-60"
    >
      <Icon className="h-3.5 w-3.5" />{label}
    </button>
  );
}

function EmptyHero({ onAdopt }: { onAdopt: () => void }) {
  return (
    <div className="rounded-3xl p-8 bg-gradient-to-br from-amber-50 to-rose-50 border border-amber-200 text-center">
      <div className="text-5xl mb-2">🥺</div>
      <h2 className="text-lg font-semibold text-slate-800">Bạn chưa nuôi pet nào</h2>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
        Mỗi lần báo giá BQMS bạn sẽ nhận +1 EXP. Pet trúng thầu được +5 EXP. Hãy nhận nuôi 1 con đầu tiên!
      </p>
      <button
        onClick={onAdopt}
        className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all"
      >
        <Star className="h-4 w-4" />
        Đến cửa hàng nhận nuôi
      </button>
    </div>
  );
}

function MyPetsTab({ pets, activeId, onSelect, onChanged }: {
  pets: Pet[]; activeId: string | null; onSelect: (id: string) => void; onChanged: () => void;
}) {
  const release = useMutation({
    mutationFn: (petId: string) => api.delete(`/api/v1/me/pets/${petId}`),
    onSuccess: () => { toast.success('Đã chia tay pet'); onChanged(); },
  });

  if (!pets.length) {
    return <div className="text-sm text-slate-500 italic">Chưa có pet nào — qua tab Cửa hàng để nhận nuôi.</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {pets.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p.id)}
          className={cn(
            'rounded-2xl p-4 border-2 text-left transition-all hover:shadow-md',
            activeId === p.id
              ? 'border-amber-500 bg-amber-50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300'
          )}
        >
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.current_sprite} alt={p.nickname} className="w-16 h-16 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-slate-800 truncate">{p.nickname}</div>
              <div className="text-xs text-slate-500">{p.display_name_vi} · Lv {p.level} · F{p.current_form}</div>
              <div className="text-[11px] text-slate-400">EXP: {p.exp}</div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            {p.is_avatar && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded text-[11px] font-semibold">
                <Crown className="h-2.5 w-2.5" />Avatar
              </span>
            )}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Chia tay ${p.nickname}? Hành động này không hoàn lại được.`)) {
                  release.mutate(p.id);
                }
              }}
              className="text-slate-300 hover:text-red-500 ml-auto cursor-pointer"
              title="Chia tay pet (delete)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function ShopTab({ species, owned, totalExp, onAdopted }: {
  species: Species[]; owned: string[]; totalExp: number; onAdopted: () => void;
}) {
  const [nickname, setNickname] = useState('');
  const [selected, setSelected] = useState<Species | null>(null);

  const adopt = useMutation({
    mutationFn: () => api.post('/api/v1/me/pets/adopt', {
      species: selected?.species,
      nickname: nickname.trim() || selected?.display_name_vi,
    }),
    onSuccess: (r: any) => {
      toast.success(r.message || 'Đã nhận nuôi pet mới!');
      setSelected(null);
      setNickname('');
      onAdopted();
    },
    onError: (e: any) => toast.error(e?.detail || 'Adopt lỗi'),
  });

  const isLocked = (sp: Species) => sp.rarity === 'legendary' && totalExp < 100;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {species.map((sp) => {
          const isOwned = owned.includes(sp.species);
          const locked = isLocked(sp);
          return (
            <div
              key={sp.species}
              className={cn(
                'rounded-2xl p-3 border-2 transition-all',
                locked ? 'border-slate-200 bg-slate-50 opacity-60'
                  : isOwned ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:border-amber-400 hover:shadow-md cursor-pointer'
              )}
              onClick={() => !isOwned && !locked && setSelected(sp)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                    {sp.display_name_vi}
                    {sp.rarity === 'rare' && <Star className="h-3 w-3 text-amber-500" />}
                    {sp.rarity === 'legendary' && <Crown className="h-3 w-3 text-brand-500" />}
                  </div>
                </div>
                {locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
                {isOwned && <span className="text-[11px] text-emerald-600 font-semibold">✓ Đã nuôi</span>}
              </div>
              <div className="flex justify-center my-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sp.form_1_sprite} alt={sp.species}
                  className={cn('w-20 h-20', locked && 'grayscale')} />
              </div>
              <div className="text-[11px] text-slate-500 leading-tight">{sp.description_vi}</div>
              {locked && (
                <div className="mt-1 text-[11px] text-brand-600 font-semibold">
                  🔒 Cần 100 EXP (hiện: {totalExp})
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4"
            onClick={() => setSelected(null)}
          >
            <motion.div
              initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selected.form_1_sprite} alt={selected.species} className="w-20 h-20" />
                <div>
                  <h3 className="font-semibold text-slate-800 text-lg">{selected.display_name_vi}</h3>
                  <p className="text-xs text-slate-600">{selected.description_vi}</p>
                </div>
              </div>
              <label className="text-xs font-semibold text-slate-700 uppercase">Đặt tên (tuỳ chọn)</label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={`Mặc định: ${selected.display_name_vi}`}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setSelected(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm"
                >Hủy</button>
                <button
                  onClick={() => adopt.mutate()}
                  disabled={adopt.isPending}
                  className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {adopt.isPending ? 'Đang…' : 'Nhận nuôi'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HistoryTab({ petId }: { petId: string }) {
  const { data, isLoading } = useQuery<{ data: ExpEvent[] }>({
    queryKey: ['pet-exp-history', petId],
    queryFn: () => api.get(`/api/v1/me/pets/${petId}/exp-history`),
  });
  if (isLoading) return <div className="text-sm text-slate-500">Đang tải…</div>;
  if (!data?.data?.length) return <div className="text-sm text-slate-500 italic">Chưa có sự kiện EXP nào.</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr className="text-xs font-mono uppercase text-slate-500">
            <th className="px-3 py-2 text-left">Thời gian</th>
            <th className="px-3 py-2 text-left">Loại</th>
            <th className="px-3 py-2 text-right">EXP</th>
            <th className="px-3 py-2 text-left">Tham chiếu</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.data.map((e, i) => (
            <tr key={i}>
              <td className="px-3 py-1.5 text-xs text-slate-600">{new Date(e.created_at).toLocaleString('vi-VN')}</td>
              <td className="px-3 py-1.5">
                <span className="text-xs font-semibold text-slate-700">{labelEvent(e.event_type)}</span>
              </td>
              <td className="px-3 py-1.5 text-right font-bold text-emerald-700">+{e.exp_delta}</td>
              <td className="px-3 py-1.5 text-xs font-mono text-slate-500">{e.source_ref ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function labelEvent(t: string): string {
  switch (t) {
    case 'quote_submitted':   return '📝 Báo giá';
    case 'quote_won':         return '🏆 Trúng thầu';
    case 'interaction_feed':  return '🍖 Cho ăn';
    case 'interaction_pet':   return '💚 Vuốt ve';
    case 'interaction_play':  return '🎾 Chơi';
    case 'daily_login':       return '📅 Đăng nhập hằng ngày';
    default:                  return t;
  }
}
