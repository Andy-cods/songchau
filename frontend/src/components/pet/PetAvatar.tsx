'use client';

// ─── PetAvatar — huy hiệu avatar thú cưng (tĩnh, siêu nhẹ) ─────────────────
//
// Dùng ở header / danh sách nhân sự / mọi nơi hiển thị avatar user.
// animated=false → KHÔNG timer, KHÔNG framer loop: chỉ là SVG tĩnh trong
// vòng tròn màu loài → render hàng chục cái trong bảng không tốn hiệu năng.

import { AnimatedPet } from './AnimatedPet';
import { PET_DNA, type PetForm, type PetSpecies } from './pet-dna';

export interface PetAvatarProps {
  species: PetSpecies;
  form: PetForm;
  /** Đường kính px */
  size?: number;
  className?: string;
  title?: string;
}

export function PetAvatar({ species, form, size = 32, className, title }: PetAvatarProps) {
  const dna = PET_DNA[species];
  return (
    <div
      className={`relative rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white shadow-sm ${className ?? ''}`}
      style={{ width: size, height: size, backgroundColor: `${dna.palette.accent}24` }}
      title={title ?? `Pet ${dna.nameVi}`}
    >
      {/* phóng nhẹ + hạ thấp để pet chiếm trọn khung tròn */}
      <div
        className="absolute left-1/2"
        style={{ transform: 'translateX(-50%)', top: '2%' }}
      >
        <AnimatedPet
          species={species}
          form={form}
          size={size * 1.16}
          animated={false}
          staticExpr="happy"
          showShadow={false}
        />
      </div>
    </div>
  );
}
