'use client';

// ─── UserAvatar — avatar người dùng thống nhất toàn ERP ────────────────────
//
// Pet redesign 2026-07-13 (Thang): user đặt pet làm avatar → mọi vị trí
// hiển thị avatar (header, danh sách nhân sự, hồ sơ...) render thú cưng
// anime thay vì vòng tròn initials.
//
// Ưu tiên nguồn:
//   1. petSpecies + petForm (BE users.py trả pet_species/pet_form)
//   2. avatarUrl dạng "/pets/cat_2.svg" (legacy) → parse ra species/form
//   3. avatarUrl ảnh thường → <img>
//   4. initials từ name (style cũ của top-nav)

import { PetAvatar } from '@/components/pet/PetAvatar';
import { isPetSpecies, parsePetSprite, type PetForm } from '@/components/pet/pet-dna';
import { cn } from '@/lib/utils';

export interface UserAvatarProps {
  name?: string | null;
  petSpecies?: string | null;
  petForm?: number | null;
  avatarUrl?: string | null;
  /** Đường kính px (mặc định 32 = h-8) */
  size?: number;
  className?: string;
  title?: string;
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function UserAvatar({
  name, petSpecies, petForm, avatarUrl, size = 32, className, title,
}: UserAvatarProps) {
  // 1) pet trực tiếp từ API
  if (isPetSpecies(petSpecies)) {
    const form = (petForm === 2 || petForm === 3 ? petForm : 1) as PetForm;
    return <PetAvatar species={petSpecies} form={form} size={size} className={className} title={title ?? name ?? undefined} />;
  }

  // 2) legacy sprite path
  const parsed = parsePetSprite(avatarUrl);
  if (parsed) {
    return <PetAvatar species={parsed.species} form={parsed.form} size={size} className={className} title={title ?? name ?? undefined} />;
  }

  // 3) ảnh thật
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ?? 'avatar'}
        title={title ?? name ?? undefined}
        className={cn('rounded-full object-cover flex-shrink-0 ring-2 ring-white shadow-sm', className)}
        style={{ width: size, height: size }}
      />
    );
  }

  // 4) initials fallback — giữ đúng style vòng tròn slate của top-nav cũ
  return (
    <div
      title={title ?? name ?? undefined}
      className={cn(
        'rounded-full bg-slate-800 text-white flex items-center justify-center font-bold flex-shrink-0 ring-2 ring-white shadow-sm',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }}
    >
      {initialsOf(name)}
    </div>
  );
}
