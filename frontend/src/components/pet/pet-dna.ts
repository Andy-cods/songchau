// ─── Pet DNA — bảng "gen" của 9 loài thú cưng ERP ──────────────────────────
//
// Pet redesign 2026-07-13 (Thang): thay pixel-sprite tĩnh bằng rig SVG
// anime-chibi NGUYÊN BẢN render inline (không dùng tài sản có bản quyền).
// File này là single source of truth về:
//   - palette màu từng loài (pastel anime + outline ấm)
//   - đặc điểm cơ thể (kiểu mồm, có đuôi/cánh/chân hay không)
//   - metadata form (baby/teen/adult scale)
//
// Muốn đổi artwork loài nào → sửa palette ở đây + hình khối trong bodies.tsx.
// DB (pet_species_catalog) giữ nguyên — species key khớp 1-1 với DB.

export type PetSpecies =
  | 'dog' | 'cat' | 'koi' | 'seagull' | 'duck'
  | 'horse' | 'flower' | 'plant' | 'dragon';

export type PetForm = 1 | 2 | 3;

/** Biểu cảm khuôn mặt — dùng chung cho mọi loài. */
export type PetExpression =
  | 'neutral'    // idle thường
  | 'happy'      // vui nhẹ (mặc định avatar)
  | 'joy'        // cực vui — mắt cong ^_^
  | 'hungry'     // đói — mắt to long lanh, miệng chảy nước
  | 'sad'        // buồn — mày cụp, khoé miệng trễ
  | 'sleepy'     // gà gật — mí sụp một nửa
  | 'sleep'      // ngủ — mắt nhắm hẳn
  | 'eat'        // đang nhai
  | 'love'       // được vuốt ve — mắt trái tim
  | 'star'       // nhận thưởng / level up — mắt sao
  | 'surprised'; // giật mình (bị từ chối cho ăn khi no)

/** Kiểu miệng theo loài — quyết định render mồm/mỏ/mõm trong expressions. */
export type MouthKind = 'default' | 'cat' | 'muzzle' | 'beak-flat' | 'beak-small' | 'fish';

export interface PetPalette {
  /** Màu thân chính */
  body: string;
  /** Màu bụng / mảng sáng */
  belly: string;
  /** Màu đậm (tai trong, vân, bóng khối) */
  dark: string;
  /** Màu accent thương hiệu loài (khớp color_theme trong DB) */
  accent: string;
  /** Màu phụ kiện (vòng cổ, chậu, vây...) */
  extra: string;
}

export interface PetDNA {
  species: PetSpecies;
  nameVi: string;
  mouth: MouthKind;
  palette: PetPalette;
  /** Loài bay/bơi — không ngồi chạm đất, idle = lơ lửng */
  floats?: boolean;
  /** Loài thực vật trong chậu — không di chuyển khi ăn, thức ăn = bình tưới */
  rooted?: boolean;
}

/** Outline chung toàn hệ — nét dày ấm kiểu anime. */
export const INK = '#3b3049';
export const INK_SOFT = '#5a4f6e';

export const PET_DNA: Record<PetSpecies, PetDNA> = {
  dog: {
    species: 'dog', nameVi: 'Chó', mouth: 'muzzle',
    palette: { body: '#f6c473', belly: '#fdeccb', dark: '#dd9a44', accent: '#f59e0b', extra: '#ef6a6a' },
  },
  cat: {
    species: 'cat', nameVi: 'Mèo', mouth: 'cat',
    palette: { body: '#f6bcd3', belly: '#fdeaf2', dark: '#d585ab', accent: '#ec4899', extra: '#8f7df0' },
  },
  koi: {
    species: 'koi', nameVi: 'Cá Koi', mouth: 'fish', floats: true,
    palette: { body: '#fff4ec', belly: '#ffffff', dark: '#f0c9b4', accent: '#ef4444', extra: '#ff9d7e' },
  },
  seagull: {
    species: 'seagull', nameVi: 'Hải âu', mouth: 'beak-small',
    palette: { body: '#f4f8fd', belly: '#ffffff', dark: '#a9c6e8', accent: '#3b82f6', extra: '#ffb347' },
  },
  duck: {
    species: 'duck', nameVi: 'Vịt', mouth: 'beak-flat',
    palette: { body: '#ffe184', belly: '#fff4c2', dark: '#e8bc3f', accent: '#eab308', extra: '#ff9f43' },
  },
  horse: {
    species: 'horse', nameVi: 'Ngựa', mouth: 'muzzle',
    palette: { body: '#cbaaf6', belly: '#efe8fd', dark: '#a37fe3', accent: '#a855f7', extra: '#7c5cd6' },
  },
  flower: {
    species: 'flower', nameVi: 'Hoa', mouth: 'default', rooted: true,
    palette: { body: '#fb8fa5', belly: '#ffe3b3', dark: '#e26380', accent: '#f43f5e', extra: '#52c47d' },
  },
  plant: {
    species: 'plant', nameVi: 'Cây', mouth: 'default', rooted: true,
    palette: { body: '#8ce3b3', belly: '#d9f8e8', dark: '#3fb57e', accent: '#10b981', extra: '#d98457' },
  },
  dragon: {
    species: 'dragon', nameVi: 'Rồng', mouth: 'default',
    palette: { body: '#f58a8a', belly: '#ffe7d1', dark: '#d95656', accent: '#dc2626', extra: '#fbbf24' },
  },
};

export const PET_SPECIES_LIST = Object.keys(PET_DNA) as PetSpecies[];

export function isPetSpecies(s: string | null | undefined): s is PetSpecies {
  return !!s && s in PET_DNA;
}

/** Scale thân theo form: baby nhỏ, adult lớn + phụ kiện (vẽ trong bodies). */
export const FORM_SCALE: Record<PetForm, number> = { 1: 0.82, 2: 1, 3: 1.1 };

/**
 * Parse đường dẫn sprite pixel cũ ("/pets/cat_2.svg") → {species, form}.
 * Dùng cho dữ liệu legacy (pet_species_catalog.form_X_sprite, avatar_url cũ)
 * để mọi nơi từng trỏ file pixel giờ render được rig anime mới.
 */
export function parsePetSprite(url: string | null | undefined): { species: PetSpecies; form: PetForm } | null {
  if (!url) return null;
  const m = /\/pets\/([a-z]+)_([123])\.svg$/i.exec(url);
  if (!m || !isPetSpecies(m[1])) return null;
  return { species: m[1] as PetSpecies, form: Number(m[2]) as PetForm };
}

/** Roles được BE cho phép gọi /me/pets (pet.py require_role) — dùng để tránh 403. */
export const PET_ALLOWED_ROLES = new Set([
  'admin', 'manager', 'staff', 'sales', 'procurement', 'warehouse', 'accountant',
]);
