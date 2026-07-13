'use client';

// Phase 6 "Full Vision" (Thang 2026-05-12) — trang Pet gamification.
// Pet redesign 2026-07-13: pixel-sprite → rig SVG anime-chibi nguyên bản
// (components/pet). Pet giờ SỐNG: chớp mắt, nhìn theo chuột, vẫy đuôi khi
// hover, chạy lại ăn khi cho ăn, chơi bóng, tim khi vuốt ve, burst level-up,
// lắc đầu khi còn no (429), ngủ gật khi bị bỏ quên. Reduced-motion: chỉ đổi
// biểu cảm. API/DB giữ nguyên 100%.
//
// Layout:
//  - Hero: sân khấu pet (AnimatedPet interactive) + tên + EXP + mood + nút
//  - Tabs: Đàn của tôi / Cửa hàng / Lịch sử EXP

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Crown, Drumstick, Gamepad2, Heart, Lock, RefreshCw, Sparkles, Star, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AnimatedPet, type PetAction, type PetMood } from '@/components/pet/AnimatedPet';
import { PET_DNA, isPetSpecies, type PetForm, type PetSpecies } from '@/components/pet/pet-dna';

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

// ─── Helpers ────────────────────────────────────────────────────

function asSpecies(s: string): PetSpecies {
  return isPetSpecies(s) ? s : 'dog';
}

function asForm(f: number): PetForm {
  return (f === 2 || f === 3 ? f : 1) as PetForm;
}

const HOUR = 3_600_000;

/** Suy ra tâm trạng idle từ dấu thời gian tương tác. */
function petMood(pet: Pet): PetMood {
  const now = Date.now();
  const since = (iso: string | null) => (iso ? now - new Date(iso).getTime() : Infinity);
  const fed = since(pet.last_fed_at);
  const touched = Math.min(fed, since(pet.last_pet_at), since(pet.last_play_at));
  if (fed > 8 * HOUR) return 'hungry';     // >8h chưa ăn → đói
  if (touched > 24 * HOUR) return 'sad';   // >24h không ai ngó → tủi thân
  return 'content';
}

const MOOD_CHIP: Record<PetMood, { label: string; cls: string }> = {
  hungry:  { label: '🍖 Đang đói — cho ăn đi!', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  sad:     { label: '🥺 Nhớ bạn lắm rồi',        cls: 'bg-slate-50 text-slate-600 border-slate-200' },
  sleepy:  { label: '😴 Buồn ngủ',               cls: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
  content: { label: '😊 Vui vẻ',                 cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

/** Phút còn lại của cooldown 1h (ước lượng FE — BE vẫn là nguồn sự thật). */
function cooldownLeftMin(lastAt: string | null): number {
  if (!lastAt) return 0;
  const left = HOUR - (Date.now() - new Date(lastAt).getTime());
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

// ─── Page ───────────────────────────────────────────────────────

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

  // Pet đang xem = avatar (hoặc con đầu); tự sửa nếu pet bị thả (delete)
  useEffect(() => {
    const pets = myPets.data?.data;
    if (!pets?.length) return;
    if (!activePetId || !pets.some((p) => p.id === activePetId)) {
      const avatar = pets.find((p) => p.is_avatar) ?? pets[0];
      setActivePetId(avatar.id);
    }
  }, [myPets.data, activePetId]);

  const activePet = myPets.data?.data?.find((p) => p.id === activePetId) ?? null;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-5">
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-amber-500" />
        <h1 className="text-xl font-bold text-slate-800">Hồ sơ + Pet của tôi</h1>
      </div>

      {/* Hero — sân khấu pet */}
      {myPets.isLoading ? (
        <div className="bg-slate-100 rounded-3xl h-72 animate-pulse" />
      ) : !myPets.data?.data?.length ? (
        <EmptyHero onAdopt={() => setActiveTab('shop')} />
      ) : activePet ? (
        <PetHero
          pet={activePet}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['my-pets'] })}
        />
      ) : null}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {([
          { v: 'collection', label: 'Đàn của tôi', icon: Heart },
          { v: 'shop',       label: 'Cửa hàng',    icon: Star },
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
          owned={(myPets.data?.data ?? []).map((p) => p.species)}
          totalExp={(myPets.data?.data ?? []).reduce((s, p) => s + p.exp, 0)}
          onAdopted={() => qc.invalidateQueries({ queryKey: ['my-pets'] })}
        />
      )}
      {activeTab === 'history' && activePet && <HistoryTab petId={activePet.id} />}
    </div>
  );
}

// ─── Hero — pet sống + tương tác ────────────────────────────────

function PetHero({ pet, onRefresh }: { pet: Pet; onRefresh: () => void }) {
  const dna = PET_DNA[asSpecies(pet.species)];
  const expIntoLevel = pet.exp - (pet.level - 1) * 10;
  const pct = Math.min(100, Math.round((expIntoLevel / 10) * 100));
  const mood = petMood(pet);

  // Choreography: action đang chạy trên sân khấu; celebrateRef = có level-up/
  // tiến hoá chờ diễn sau khi ăn/chơi xong; refresh dời tới khi diễn xong để
  // form mới không nhảy vào giữa animation.
  const [action, setAction] = useState<PetAction | null>(null);
  const celebrateRef = useRef(false);
  const needRefreshRef = useRef(false);

  const interact = useMutation({
    mutationFn: (kind: 'feed' | 'pet' | 'play') =>
      api.post(`/api/v1/me/pets/${pet.id}/interact`, { kind }),
    onSuccess: (r: any) => {
      needRefreshRef.current = true;
      if (r.data?.evolved) {
        celebrateRef.current = true;
        toast.success(`🎉 ${pet.nickname} tiến hóa lên Form ${r.data.new_form}!`, { duration: 5000 });
      } else if (r.data?.leveled_up) {
        celebrateRef.current = true;
        toast.success(`⭐ Level up! ${pet.nickname} đạt Lv ${r.data.new_level}`);
      } else {
        toast.success(r.message || 'Pet vui rồi!');
      }
    },
    onError: (e: any) => {
      // 429 "còn no" (hoặc lỗi khác) → pet lắc đầu từ chối
      setAction('refuse');
      toast.error(typeof e?.detail === 'string' ? e.detail : 'Tương tác lỗi');
    },
  });

  const doInteract = (kind: 'feed' | 'pet' | 'play') => {
    if (action || interact.isPending) return; // đang diễn — chờ xong đã
    setAction(kind === 'feed' ? 'eat' : kind === 'pet' ? 'stroke' : 'play');
    interact.mutate(kind);
  };

  const handleActionDone = () => {
    if (celebrateRef.current) {
      celebrateRef.current = false;
      setAction('levelup');
      return;
    }
    setAction(null);
    if (needRefreshRef.current) {
      needRefreshRef.current = false;
      onRefresh();
    }
  };

  const setAvatar = useMutation({
    mutationFn: () => api.post(`/api/v1/me/pets/${pet.id}/set-avatar`, {}),
    onSuccess: () => {
      toast.success('Đã đặt làm avatar — header cập nhật luôn rồi đó!');
      onRefresh();
    },
    onError: (e: any) => toast.error(typeof e?.detail === 'string' ? e.detail : 'Đặt avatar lỗi'),
  });

  const cool = {
    feed: cooldownLeftMin(pet.last_fed_at),
    pet: cooldownLeftMin(pet.last_pet_at),
    play: cooldownLeftMin(pet.last_play_at),
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-sm p-5 md:p-6">
      <div className="flex items-center gap-5 md:gap-8 flex-wrap md:flex-nowrap">
        {/* Sân khấu */}
        <div
          className="relative flex-shrink-0 rounded-2xl mx-auto md:mx-0"
          style={{ background: `radial-gradient(circle at 50% 62%, ${dna.palette.accent}1c 0%, ${dna.palette.accent}08 55%, transparent 78%)` }}
        >
          <AnimatedPet
            species={asSpecies(pet.species)}
            form={asForm(pet.current_form)}
            size={210}
            interactive
            mood={mood}
            action={action}
            onActionDone={handleActionDone}
          />
        </div>

        {/* Thông tin + nút */}
        <div className="flex-1 min-w-[260px]">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono uppercase tracking-wider border mb-2"
            style={{ color: dna.palette.accent, borderColor: `${dna.palette.accent}55`, background: `${dna.palette.accent}0f` }}>
            <Heart className="h-3 w-3" />
            Pet của tôi · {pet.rarity}
          </div>

          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-3xl font-bold text-slate-800">{pet.nickname}</h2>
            <span className="text-sm text-slate-500">{pet.display_name_vi}</span>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-semibold">Lv {pet.level}</span>
            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-xs font-semibold">Form {pet.current_form}</span>
            {pet.is_avatar && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs font-semibold">
                <Crown className="h-3 w-3" />Avatar
              </span>
            )}
          </div>

          {/* Mood */}
          <div className={cn('inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full border text-xs font-medium', MOOD_CHIP[mood].cls)}>
            {MOOD_CHIP[mood].label}
          </div>

          {/* EXP bar */}
          <div className="mt-4 bg-slate-100 rounded-full h-3 overflow-hidden max-w-md border border-slate-200">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-300"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <div className="mt-1.5 text-xs text-slate-500 max-w-md flex justify-between">
            <span>EXP: <strong className="text-slate-700">{pet.exp}</strong> · lên Lv {pet.level + 1} cần {pet.level * 10}</span>
            <span>{pct}%</span>
          </div>
          {pet.current_form < 3 && (
            <div className="mt-1 text-[11px] text-slate-400">
              Tiến hóa Form {pet.current_form + 1} ở Lv {pet.current_form === 1 ? pet.unlock_level_2 : pet.unlock_level_3}
            </div>
          )}

          {/* Nút tương tác */}
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <InteractBtn icon={Drumstick} label="Cho ăn" cooldownMin={cool.feed}
              disabled={!!action || interact.isPending} onClick={() => doInteract('feed')} />
            <InteractBtn icon={Heart} label="Vuốt ve" cooldownMin={cool.pet}
              disabled={!!action || interact.isPending} onClick={() => doInteract('pet')} />
            <InteractBtn icon={Gamepad2} label="Chơi" cooldownMin={cool.play}
              disabled={!!action || interact.isPending} onClick={() => doInteract('play')} />
            {!pet.is_avatar && (
              <button
                onClick={() => setAvatar.mutate()}
                disabled={setAvatar.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-300 shadow-sm active:scale-95 transition-all disabled:opacity-60"
              >
                <Crown className="h-3.5 w-3.5 text-amber-500" />Đặt làm avatar
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Mẹo: rê chuột để pet nhìn theo, click vào pet để &quot;boop&quot; 💛 · mỗi tương tác +1 EXP (cooldown 1 giờ)
          </p>
        </div>
      </div>
    </div>
  );
}

function InteractBtn({ icon: Icon, label, disabled, cooldownMin, onClick }: {
  icon: any; label: string; disabled: boolean; cooldownMin: number; onClick: () => void;
}) {
  const onCooldown = cooldownMin > 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={onCooldown ? `Còn no — khoảng ${cooldownMin} phút nữa` : `+1 EXP`}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-60',
        onCooldown
          ? 'bg-slate-100 text-slate-400 border border-slate-200'
          : 'bg-amber-500 hover:bg-amber-400 text-white',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {onCooldown && <span className="font-mono text-[10px]">({cooldownMin}p)</span>}
    </button>
  );
}

function EmptyHero({ onAdopt }: { onAdopt: () => void }) {
  return (
    <div className="rounded-3xl p-8 bg-white border border-slate-200 shadow-sm text-center">
      <div className="flex justify-center">
        <AnimatedPet species="dog" form={1} size={130} mood="sad" showShadow />
      </div>
      <h2 className="text-lg font-semibold text-slate-800 mt-2">Bạn chưa nuôi pet nào</h2>
      <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
        Mỗi lần báo giá BQMS pet nhận +1 EXP, trúng thầu +5 EXP. Hãy nhận nuôi một bé đầu tiên!
      </p>
      <button
        onClick={onAdopt}
        className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold shadow-md hover:shadow-lg active:scale-95 transition-all"
      >
        <Star className="h-4 w-4" />
        Đến cửa hàng nhận nuôi
      </button>
    </div>
  );
}

// ─── Đàn của tôi ────────────────────────────────────────────────

function MyPetsTab({ pets, activeId, onSelect, onChanged }: {
  pets: Pet[]; activeId: string | null; onSelect: (id: string) => void; onChanged: () => void;
}) {
  const release = useMutation({
    mutationFn: (petId: string) => api.delete(`/api/v1/me/pets/${petId}`),
    onSuccess: () => { toast.success('Đã chia tay pet'); onChanged(); },
    onError: (e: any) => toast.error(typeof e?.detail === 'string' ? e.detail : 'Thả pet lỗi'),
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
              : 'border-slate-200 bg-white hover:border-slate-300',
          )}
        >
          <div className="flex items-center gap-3">
            <AnimatedPet
              species={asSpecies(p.species)} form={asForm(p.current_form)}
              size={72} animated={false} showShadow={false}
            />
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

// ─── Cửa hàng ───────────────────────────────────────────────────

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
    onError: (e: any) => toast.error(typeof e?.detail === 'string' ? e.detail : 'Adopt lỗi'),
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
                locked ? 'border-slate-200 bg-slate-50 opacity-70'
                  : isOwned ? 'border-emerald-300 bg-emerald-50'
                  : 'border-slate-200 bg-white hover:border-amber-400 hover:shadow-md cursor-pointer',
              )}
              onClick={() => !isOwned && !locked && setSelected(sp)}
            >
              <div className="flex items-start justify-between">
                <div className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  {sp.display_name_vi}
                  {sp.rarity === 'rare' && <Star className="h-3 w-3 text-amber-500" />}
                  {sp.rarity === 'legendary' && <Crown className="h-3 w-3 text-brand-500" />}
                </div>
                {locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
                {isOwned && <span className="text-[11px] text-emerald-600 font-semibold">✓ Đã nuôi</span>}
              </div>
              <div className={cn('flex justify-center my-2', locked && 'grayscale')}>
                <AnimatedPet
                  species={asSpecies(sp.species)} form={1}
                  size={92} animated={false} showShadow={false}
                  staticExpr={locked ? 'neutral' : 'happy'}
                />
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
                {/* preview sống — rê chuột là bé nhìn theo */}
                <AnimatedPet species={asSpecies(selected.species)} form={1} size={110} interactive />
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
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold disabled:opacity-60"
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

// ─── Lịch sử EXP ────────────────────────────────────────────────

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
