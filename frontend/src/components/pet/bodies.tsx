'use client';

// ─── Body rig 9 loài — anime chibi NGUYÊN BẢN (không sao chép IP nào) ───────
//
// Mỗi loài là 1 component nhận { form, palette, face, lively }:
//   - form 1 = baby (tối giản), form 2 = teen (+phụ kiện), form 3 = adult
//     (+chi tiết "trưởng thành": bờm dài, cánh lớn, tầng cánh hoa...)
//   - face      = khuôn mặt dùng chung (expressions.tsx), body đặt vào tâm đầu
//   - lively    = bật loop CSS (vẫy đuôi/vỗ cánh/lắc lá) — tắt khi
//                 reduced-motion hoặc render avatar tĩnh
//
// Toạ độ stage 200×200, mặt đất y≈168, thân canh giữa x=100.
// Muốn thay artwork 1 loài: sửa đúng component loài đó, giữ nguyên vị trí
// đặt face (translate tâm đầu) là biểu cảm/animation tự khớp.

import type { ReactNode } from 'react';
import { INK, type PetForm, type PetPalette } from './pet-dna';

export interface PetBodyProps {
  form: PetForm;
  palette: PetPalette;
  face: ReactNode;
  lively?: boolean;
}

const O = { stroke: INK, strokeWidth: 3, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
const o2 = { stroke: INK, strokeWidth: 2.2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };

const cls = (lively: boolean | undefined, name: string) => (lively ? `pet-part ${name}` : 'pet-part');

// ═══ 1. CHÓ — cún vàng tai cụp, đuôi xoáy ═══════════════════════

export function BodyDog({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* đuôi xoáy — vẫy */}
      <g className={cls(lively, 'pet-wag')} style={{ transformOrigin: '72px 140px' }}>
        <path
          d={form === 3
            ? 'M74 140 Q52 132 54 114 Q56 100 70 102 Q64 112 68 120 Q74 128 82 128 Z'
            : 'M76 142 Q58 136 60 120 Q62 110 72 112 Q68 120 72 127 Q77 133 84 132 Z'}
          fill={p.body} {...O}
        />
        {form === 3 && <path d="M60 116 Q62 108 70 106" fill="none" {...o2} stroke={p.dark} />}
      </g>

      {/* thân + chân */}
      <ellipse cx={100} cy={142} rx={29} ry={24} fill={p.body} {...O} />
      <ellipse cx={100} cy={148} rx={17} ry={14} fill={p.belly} stroke="none" />
      {form === 3 && (
        <path d="M88 126 Q100 134 112 126 Q108 138 100 138 Q92 138 88 126 Z" fill={p.belly} stroke="none" opacity={0.9} />
      )}
      <ellipse cx={83} cy={164} rx={9} ry={5.5} fill={p.body} {...o2} />
      <ellipse cx={117} cy={164} rx={9} ry={5.5} fill={p.body} {...o2} />

      {/* vòng cổ (form 2) / khăn bandana (form 3) */}
      {form === 2 && (
        <g>
          <path d="M76 121 Q100 133 124 121 Q124 128 100 138 Q76 128 76 121 Z" fill={p.extra} {...o2} />
          <circle cx={100} cy={134} r={4.2} fill="#fbbf24" {...o2} />
        </g>
      )}
      {form === 3 && (
        <g>
          <path d="M73 119 Q100 132 127 119 L122 130 Q100 140 78 130 Z" fill={p.extra} {...o2} />
          <path d="M96 131 L104 131 L102 146 L96 143 Z" fill={p.extra} {...o2} />
        </g>
      )}

      {/* tai cụp — baby ngắn, adult dài hơi vểnh */}
      <g className={cls(lively, 'pet-flick')} style={{ transformOrigin: '74px 62px' }}>
        <path
          d={form === 1
            ? 'M78 58 Q62 60 62 80 Q62 92 74 92 Q80 84 80 68 Z'
            : 'M79 55 Q58 56 57 82 Q57 98 72 96 Q80 86 81 66 Z'}
          fill={p.dark} {...O}
        />
      </g>
      <g className={cls(lively, 'pet-flick')} style={{ transformOrigin: '126px 62px', animationDelay: '0.3s' }}>
        <path
          d={form === 1
            ? 'M122 58 Q138 60 138 80 Q138 92 126 92 Q120 84 120 68 Z'
            : 'M121 55 Q142 56 143 82 Q143 98 128 96 Q120 86 119 66 Z'}
          fill={p.dark} {...O}
        />
      </g>

      {/* đầu + mõm */}
      <circle cx={100} cy={88} r={38} fill={p.body} {...O} />
      <ellipse cx={100} cy={103} rx={14.5} ry={10.5} fill={p.belly} stroke="none" />
      {/* vệt lông trán (form ≥ 2) */}
      {form >= 2 && <path d="M92 53 Q100 46 108 53 Q104 58 100 57 Q96 58 92 53 Z" fill={p.dark} stroke="none" opacity={0.85} />}

      <g transform="translate(100,88)">{face}</g>
    </g>
  );
}

// ═══ 2. MÈO — tai nhọn, ria, đuôi cong chữ S ════════════════════

export function BodyCat({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* đuôi chữ S */}
      <g className={cls(lively, 'pet-wag')} style={{ transformOrigin: '128px 148px' }}>
        <path
          d={form === 3
            ? 'M126 150 Q152 148 152 124 Q152 104 138 100 Q132 104 136 110 Q144 116 143 126 Q142 142 122 142 Z'
            : 'M126 150 Q146 146 146 128 Q146 114 136 112 Q131 116 135 121 Q139 126 138 132 Q136 142 122 142 Z'}
          fill={p.body} {...O}
        />
        {form === 3 && <path d="M138 104 Q146 106 148 116" fill="none" stroke={p.dark} strokeWidth={5} strokeLinecap="round" />}
      </g>

      {/* thân */}
      <ellipse cx={100} cy={144} rx={26} ry={22} fill={p.body} {...O} />
      <ellipse cx={100} cy={150} rx={15} ry={12} fill={p.belly} stroke="none" />
      <ellipse cx={85} cy={164} rx={8} ry={5} fill={p.body} {...o2} />
      <ellipse cx={115} cy={164} rx={8} ry={5} fill={p.body} {...o2} />

      {/* vòng chuông (form 2) / chuông vàng lớn (form 3) */}
      {form >= 2 && (
        <g>
          <path d="M79 122 Q100 133 121 122 Q121 129 100 137 Q79 129 79 122 Z" fill={form === 3 ? '#f6c453' : p.extra} {...o2} />
          <circle cx={100} cy={133} r={form === 3 ? 5 : 4} fill="#fbbf24" {...o2} />
          <circle cx={100} cy={134.5} r={1.2} fill={INK} />
        </g>
      )}

      {/* tai tam giác + lông trong */}
      <g className={cls(lively, 'pet-flick')} style={{ transformOrigin: '76px 60px' }}>
        <path d="M64 70 L72 40 L92 58 Q78 64 64 70 Z" fill={p.body} {...O} />
        <path d="M70 63 L74 48 L86 58 Q78 61 70 63 Z" fill="#fda4af" stroke="none" />
        {form === 3 && <path d="M71 42 L69 34" {...o2} />}
      </g>
      <g className={cls(lively, 'pet-flick')} style={{ transformOrigin: '124px 60px', animationDelay: '0.4s' }}>
        <path d="M136 70 L128 40 L108 58 Q122 64 136 70 Z" fill={p.body} {...O} />
        <path d="M130 63 L126 48 L114 58 Q122 61 130 63 Z" fill="#fda4af" stroke="none" />
        {form === 3 && <path d="M129 42 L131 34" {...o2} />}
      </g>

      {/* đầu */}
      <circle cx={100} cy={90} r={36} fill={p.body} {...O} />
      {/* vằn trán (form ≥ 2) */}
      {form >= 2 && (
        <g stroke={p.dark} strokeWidth={3.4} strokeLinecap="round" opacity={0.8}>
          <path d="M93 56 L93 64" fill="none" />
          <path d="M100 54 L100 63" fill="none" />
          <path d="M107 56 L107 64" fill="none" />
        </g>
      )}
      {/* ria mép */}
      <g stroke={INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.85}>
        <path d="M58 92 L44 89" fill="none" />
        <path d="M58 99 L45 100" fill="none" />
        <path d="M142 92 L156 89" fill="none" />
        <path d="M142 99 L155 100" fill="none" />
      </g>

      <g transform="translate(100,90)">{face}</g>
    </g>
  );
}

// ═══ 3. CÁ KOI — tròn ú, vá đỏ tancho, vây lụa ══════════════════

export function BodyKoi({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* đuôi lụa phía dưới */}
      <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '100px 142px' }}>
        <path
          d={form === 3
            ? 'M92 140 Q76 168 62 172 Q76 150 80 140 Q66 158 52 160 Q70 140 84 132 Q100 146 108 132 Q122 140 140 160 Q126 158 112 144 Q118 156 130 172 Q112 166 100 144 Z'
            : 'M90 138 Q80 158 68 162 Q78 146 84 134 Q100 146 116 134 Q122 146 132 162 Q120 158 110 138 Z'}
          fill={p.extra} {...O} opacity={0.95}
        />
      </g>

      {/* vây hai bên */}
      <g className={cls(lively, 'pet-flick')} style={{ transformOrigin: '62px 116px' }}>
        <path d={form >= 2 ? 'M64 108 Q42 112 36 130 Q52 132 66 122 Z' : 'M64 110 Q48 114 46 128 Q58 128 66 120 Z'} fill={p.extra} {...O} />
      </g>
      <g className={cls(lively, 'pet-flick')} style={{ transformOrigin: '138px 116px', animationDelay: '0.35s' }}>
        <path d={form >= 2 ? 'M136 108 Q158 112 164 130 Q148 132 134 122 Z' : 'M136 110 Q152 114 154 128 Q142 128 134 120 Z'} fill={p.extra} {...O} />
      </g>

      {/* thân cá tròn */}
      <circle cx={100} cy={106} r={40} fill={p.body} {...O} />
      <path d="M66 118 Q100 138 134 118 Q128 142 100 144 Q72 142 66 118 Z" fill={p.belly} stroke="none" />
      {/* vá đỏ đặc trưng */}
      <path d="M78 76 Q94 66 110 74 Q104 88 88 90 Q78 84 78 76 Z" fill={p.accent} stroke="none" opacity={0.92} />
      <path d="M118 96 Q132 92 136 104 Q128 112 118 108 Z" fill={p.accent} stroke="none" opacity={0.85} />
      {/* chấm tancho trán (form 3) */}
      {form === 3 && <circle cx={100} cy={72} r={7} fill={p.accent} {...o2} />}
      {/* vảy gợn (form ≥ 2) */}
      {form >= 2 && (
        <g fill="none" stroke={p.dark} strokeWidth={1.8} opacity={0.6}>
          <path d="M76 104 Q80 108 84 104" />
          <path d="M86 112 Q90 116 94 112" />
          <path d="M110 112 Q114 116 118 112" />
        </g>
      )}
      {/* râu koi (form 3) */}
      {form === 3 && (
        <g fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round">
          <path d="M84 118 Q76 122 76 128" />
          <path d="M116 118 Q124 122 124 128" />
        </g>
      )}

      <g transform="translate(100,96)">{face}</g>
    </g>
  );
}

// ═══ 4. HẢI ÂU — blob trắng, cánh xám, chân cam ═════════════════

export function BodySeagull({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* chân que (form ≥ 2 mới lộ chân, baby ngồi bệt) */}
      {form >= 2 && (
        <g stroke={p.extra} strokeWidth={4} strokeLinecap="round">
          <path d="M90 158 L90 168 M84 168 L96 168" fill="none" stroke={INK} strokeWidth={5.4} />
          <path d="M110 158 L110 168 M104 168 L116 168" fill="none" stroke={INK} strokeWidth={5.4} />
          <path d="M90 158 L90 167.5 M84.5 167.5 L95.5 167.5" fill="none" />
          <path d="M110 158 L110 167.5 M104.5 167.5 L115.5 167.5" fill="none" />
        </g>
      )}

      {/* đuôi nhỏ */}
      <path d="M96 156 L104 156 L100 166 Z" transform="translate(-24,-8) rotate(30 100 160)" fill={p.dark} {...o2} />

      {/* thân blob */}
      <ellipse cx={100} cy={118} rx={37} ry={form === 1 ? 40 : 42} fill={p.body} {...O} />
      <ellipse cx={100} cy={136} rx={22} ry={18} fill={p.belly} stroke="none" />
      {/* áo khoác xám lưng (form 3) */}
      {form === 3 && (
        <path d="M64 106 Q100 84 136 106 Q136 92 100 82 Q64 92 64 106 Z" fill={p.dark} stroke="none" opacity={0.75} />
      )}

      {/* cánh hai bên — vỗ nhẹ */}
      <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '68px 112px' }}>
        <path
          d={form >= 2 ? 'M70 104 Q44 106 36 126 Q52 134 70 126 Q64 116 70 104 Z' : 'M70 108 Q52 110 48 126 Q60 131 71 124 Z'}
          fill={p.body} {...O}
        />
        <path d={form >= 2 ? 'M42 122 Q50 128 62 126' : 'M52 122 Q58 126 66 124'} fill="none" stroke={p.dark} strokeWidth={4} strokeLinecap="round" />
      </g>
      <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '132px 112px', animationDelay: '0.15s' }}>
        <path
          d={form >= 2 ? 'M130 104 Q156 106 164 126 Q148 134 130 126 Q136 116 130 104 Z' : 'M130 108 Q148 110 152 126 Q140 131 129 124 Z'}
          fill={p.body} {...O}
        />
        <path d={form >= 2 ? 'M158 122 Q150 128 138 126' : 'M148 122 Q142 126 134 124'} fill="none" stroke={p.dark} strokeWidth={4} strokeLinecap="round" />
      </g>

      {/* mào lông (form 2: 1 cọng, form 3: 3 cọng) */}
      <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '100px 80px' }} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round">
        {form >= 2 && <path d="M100 78 Q102 66 96 60" />}
        {form === 3 && (
          <>
            <path d="M94 80 Q90 70 82 68" />
            <path d="M106 80 Q112 70 118 66" />
          </>
        )}
      </g>

      <g transform="translate(100,102)">{face}</g>
    </g>
  );
}

// ═══ 5. VỊT — blob vàng, chỏm lông, chân màng ═══════════════════

export function BodyDuck({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* chân màng */}
      <g fill={p.extra} {...o2}>
        <path d="M88 158 L88 164 L80 169 Q88 171 94 168 Z" />
        <path d="M112 158 L112 164 L120 169 Q112 171 106 168 Z" />
      </g>

      {/* đuôi vểnh */}
      <path d="M68 132 Q56 126 54 116 Q64 118 72 124 Z" fill={p.body} {...O} />

      {/* thân blob */}
      <ellipse cx={100} cy={118} rx={38} ry={form === 1 ? 40 : 43} fill={p.body} {...O} />
      <ellipse cx={100} cy={138} rx={23} ry={17} fill={p.belly} stroke="none" />

      {/* yếm lông sang trọng (form 3) */}
      {form === 3 && (
        <path d="M70 118 Q100 136 130 118 Q128 128 100 134 Q72 128 70 118 Z" fill="#7fd8c4" stroke={INK} strokeWidth={2.2} opacity={0.9} />
      )}

      {/* cánh nub */}
      <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '66px 118px' }}>
        <ellipse cx={64} cy={120} rx={11} ry={form >= 2 ? 17 : 13} fill={p.dark} {...o2} transform="rotate(14 64 120)" opacity={0.9} />
      </g>
      <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '134px 118px', animationDelay: '0.15s' }}>
        <ellipse cx={136} cy={120} rx={11} ry={form >= 2 ? 17 : 13} fill={p.dark} {...o2} transform="rotate(-14 136 120)" opacity={0.9} />
      </g>

      {/* chỏm lông đầu */}
      <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '100px 76px' }}>
        <path d="M98 78 Q94 62 102 56 Q104 66 102 74 Z" fill={p.dark} {...o2} />
        {form >= 2 && <path d="M104 76 Q112 62 120 62 Q114 72 108 78 Z" fill={p.dark} {...o2} />}
        {form === 3 && <path d="M94 76 Q84 64 78 66 Q84 74 92 79 Z" fill={p.dark} {...o2} />}
      </g>

      <g transform="translate(100,102)">{face}</g>
    </g>
  );
}

// ═══ 6. NGỰA — pony tím, bờm lụa, sao trán ══════════════════════

export function BodyHorse({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* đuôi bờm */}
      <g className={cls(lively, 'pet-wag')} style={{ transformOrigin: '72px 138px' }}>
        <path
          d={form === 3
            ? 'M74 136 Q52 138 46 160 Q58 162 66 154 Q60 164 66 170 Q80 164 82 146 Z'
            : 'M76 138 Q60 140 56 156 Q66 158 72 152 Q70 160 76 163 Q84 158 84 146 Z'}
          fill={p.extra} {...O}
        />
        <path d={form === 3 ? 'M58 148 Q62 152 60 158' : 'M64 148 Q68 152 66 156'} fill="none" stroke={p.dark} strokeWidth={2.4} strokeLinecap="round" />
      </g>

      {/* thân + chân trước */}
      <ellipse cx={100} cy={142} rx={28} ry={23} fill={p.body} {...O} />
      <ellipse cx={100} cy={148} rx={16} ry={13} fill={p.belly} stroke="none" />
      <g {...o2} fill={p.body}>
        <rect x={78} y={148} width={13} height={18} rx={6} />
        <rect x={109} y={148} width={13} height={18} rx={6} />
      </g>
      <g fill={p.dark}>
        <path d="M78 161 Q84.5 158 91 161 L91 160 Q91 166 84.5 166 Q78 166 78 160 Z" />
        <path d="M109 161 Q115.5 158 122 161 L122 160 Q122 166 115.5 166 Q109 166 109 160 Z" />
      </g>

      {/* tai */}
      <path d="M70 66 L76 44 L92 58 Q80 62 70 66 Z" fill={p.body} {...O} />
      <path d="M130 66 L124 44 L108 58 Q120 62 130 66 Z" fill={p.body} {...O} />

      {/* bờm sau đầu */}
      <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '124px 70px' }}>
        <path
          d={form === 3
            ? 'M118 52 Q142 58 144 92 Q144 116 132 128 Q126 116 130 102 Q122 112 116 108 Q124 96 122 82 Q118 66 110 58 Z'
            : 'M116 54 Q136 62 138 90 Q138 106 130 112 Q126 102 128 92 Q122 82 120 72 Q118 62 110 58 Z'}
          fill={p.extra} {...O}
        />
      </g>

      {/* đầu + mõm */}
      <circle cx={100} cy={88} r={36} fill={p.body} {...O} />
      <ellipse cx={100} cy={104} rx={15} ry={11} fill={p.belly} stroke="none" />
      {/* bờm mái trước trán */}
      <path
        d={form === 3
          ? 'M72 66 Q78 48 98 46 Q92 56 96 62 Q102 50 116 52 Q108 58 110 66 Q92 58 72 66 Z'
          : 'M76 66 Q84 52 100 50 Q94 58 98 64 Q88 60 76 66 Z'}
        fill={p.extra} {...O}
      />
      {/* sao trán (form 3) */}
      {form === 3 && (
        <path d="M100 66 L102.4 71.2 L108 72 L104 76 L105 81.6 L100 79 L95 81.6 L96 76 L92 72 L97.6 71.2 Z" fill="#fff" stroke="none" opacity={0.95} />
      )}

      <g transform="translate(100,90)">{face}</g>
    </g>
  );
}

// ═══ 7. HOA — chậu đất, nụ → bông → đại đoá ═════════════════════

export function BodyFlower({ form, palette: p, face, lively }: PetBodyProps) {
  const petal = (angle: number, rx: number, ry: number, dist: number, fill: string) => (
    <ellipse
      key={`${angle}-${dist}`}
      cx={0} cy={-dist} rx={rx} ry={ry} fill={fill} {...o2}
      transform={`rotate(${angle})`}
    />
  );
  return (
    <g>
      {/* chậu */}
      <g>
        <path d="M78 146 L122 146 L116 170 L84 170 Z" fill={p.extra === '#52c47d' ? '#e08e5a' : p.extra} {...O} />
        <rect x={74} y={140} width={52} height={10} rx={4} fill="#f0a06c" {...o2} />
        <path d="M86 152 L114 152" stroke="#c26b3d" strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </g>

      {/* thân cây + lá */}
      <path d="M100 142 Q98 122 100 104" fill="none" stroke="#3da868" strokeWidth={5.5} strokeLinecap="round" />
      <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '100px 128px' }}>
        <path d="M99 128 Q84 126 78 114 Q94 112 100 124 Z" fill="#52c47d" {...o2} />
        {form >= 2 && <path d="M101 118 Q116 116 122 104 Q106 102 100 114 Z" fill="#52c47d" {...o2} />}
      </g>
      {/* lá tay vẫy (form 3) */}
      {form === 3 && (
        <>
          <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '76px 136px' }}>
            <path d="M78 138 Q58 134 50 120 Q68 116 80 130 Z" fill="#52c47d" {...o2} />
          </g>
          <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '124px 136px', animationDelay: '0.3s' }}>
            <path d="M122 138 Q142 134 150 120 Q132 116 120 130 Z" fill="#52c47d" {...o2} />
          </g>
        </>
      )}

      {/* bông hoa (đầu) */}
      <g transform="translate(100,84)">
        {form === 1 ? (
          // nụ e ấp: 3 cánh chụm
          <g>
            <ellipse cx={0} cy={2} rx={22} ry={26} fill={p.body} {...O} />
            <path d="M-20 -4 Q-12 -22 0 -24 Q-2 -8 -6 2 Z" fill={p.dark} {...o2} opacity={0.9} />
            <path d="M20 -4 Q12 -22 0 -24 Q2 -8 6 2 Z" fill={p.dark} {...o2} opacity={0.9} />
            <path d="M-8 -22 Q0 -30 8 -22 Q4 -12 0 -10 Q-4 -12 -8 -22 Z" fill={p.body} {...o2} />
          </g>
        ) : (
          <g className={cls(lively, 'pet-bloom')}>
            {/* tầng cánh ngoài (form 3) */}
            {form === 3 && [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5].map((a) =>
              petal(a, 12, 20, 30, p.dark),
            )}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => petal(a, 11, 18, 24, p.body))}
            {/* nhị hoa = mặt */}
            <circle cx={0} cy={0} r={form === 3 ? 24 : 22} fill={p.belly} {...O} />
          </g>
        )}
      </g>

      <g transform="translate(100,86)">{face}</g>
    </g>
  );
}

// ═══ 8. CÂY — mầm non → chồi lá → cây non đội tán ═══════════════

export function BodyPlant({ form, palette: p, face, lively }: PetBodyProps) {
  return (
    <g>
      {/* chậu */}
      <path d="M76 148 L124 148 L118 170 L82 170 Z" fill={p.extra} {...O} />
      <rect x={72} y={142} width={56} height={10} rx={4} fill="#e89a6b" {...o2} />

      {/* tán cây (form 3) — mây lá phía trên */}
      {form === 3 && (
        <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '100px 56px' }}>
          <circle cx={74} cy={56} r={17} fill={p.dark} {...o2} />
          <circle cx={126} cy={56} r={17} fill={p.dark} {...o2} />
          <circle cx={100} cy={44} r={21} fill={p.body} {...O} />
          <circle cx={84} cy={50} r={14} fill={p.body} stroke="none" />
          <circle cx={116} cy={50} r={14} fill={p.body} stroke="none" />
        </g>
      )}

      {/* lá mầm trên đầu */}
      <g className={cls(lively, 'pet-sway')} style={{ transformOrigin: '100px 78px' }}>
        {form === 1 && (
          <g>
            <path d="M100 80 Q100 68 100 64" fill="none" stroke="#3da868" strokeWidth={4} strokeLinecap="round" />
            <path d="M99 66 Q84 62 80 48 Q96 48 101 62 Z" fill={p.body} {...o2} />
            <path d="M101 66 Q116 62 120 48 Q104 48 99 62 Z" fill={p.body} {...o2} />
          </g>
        )}
        {form === 2 && (
          <g>
            <path d="M100 80 Q100 66 100 60" fill="none" stroke="#3da868" strokeWidth={4.5} strokeLinecap="round" />
            <path d="M99 64 Q80 60 74 42 Q95 43 101 60 Z" fill={p.body} {...o2} />
            <path d="M101 64 Q120 60 126 42 Q105 43 99 60 Z" fill={p.body} {...o2} />
            <path d="M100 60 Q96 46 100 38 Q106 46 100 60 Z" fill={p.dark} {...o2} />
          </g>
        )}
        {form === 3 && <path d="M100 84 Q100 72 100 64" fill="none" stroke="#8a6a4e" strokeWidth={6} strokeLinecap="round" />}
      </g>

      {/* thân mầm (blob mặt) */}
      <ellipse cx={100} cy={116} rx={30} ry={32} fill={p.body} {...O} />
      <ellipse cx={100} cy={130} rx={18} ry={14} fill={p.belly} stroke="none" />
      {/* vân gỗ nhỏ (form 3) */}
      {form === 3 && (
        <g fill="none" stroke={p.dark} strokeWidth={2} opacity={0.65}>
          <path d="M84 134 Q88 137 92 134" />
          <path d="M108 138 Q112 141 116 138" />
        </g>
      )}

      <g transform="translate(100,110)">{face}</g>
    </g>
  );
}

// ═══ 9. RỒNG — legendary: sừng vàng, cánh dơi, đuôi lửa ═════════

export function BodyDragon({ form, palette: p, face, lively }: PetBodyProps) {
  const wingD =
    form === 1
      ? { l: 'M70 116 Q54 108 50 96 Q64 98 72 108 Z', r: 'M130 116 Q146 108 150 96 Q136 98 128 108 Z' }
      : form === 2
        ? { l: 'M70 114 Q44 104 40 84 Q52 84 58 92 Q56 82 64 78 Q70 90 74 104 Z', r: 'M130 114 Q156 104 160 84 Q148 84 142 92 Q144 82 136 78 Q130 90 126 104 Z' }
        : { l: 'M68 112 Q34 100 28 72 Q44 72 52 84 Q48 68 60 62 Q66 76 68 90 Q74 98 76 106 Z', r: 'M132 112 Q166 100 172 72 Q156 72 148 84 Q152 68 140 62 Q134 76 132 90 Q126 98 124 106 Z' };

  return (
    <g>
      {/* đuôi + ngọn lửa */}
      <g className={cls(lively, 'pet-wag')} style={{ transformOrigin: '130px 148px' }}>
        <path d="M128 152 Q150 148 156 132 Q158 122 150 118 Q146 126 148 132 Q142 142 124 144 Z" fill={p.body} {...O} />
        <g className={cls(lively, 'pet-flame')} style={{ transformOrigin: '152px 116px' }}>
          <path d="M152 100 Q160 108 158 118 Q152 124 146 118 Q144 108 152 100 Z" fill="#fb923c" {...o2} />
          <path d="M152 106 Q156 110 155 116 Q152 119 149 116 Q148 110 152 106 Z" fill="#fde047" stroke="none" />
        </g>
      </g>

      {/* cánh dơi */}
      <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '72px 108px' }}>
        <path d={wingD.l} fill={p.extra} {...O} />
      </g>
      <g className={cls(lively, 'pet-flap')} style={{ transformOrigin: '128px 108px', animationDelay: '0.12s' }}>
        <path d={wingD.r} fill={p.extra} {...O} />
      </g>

      {/* thân + bụng giáp */}
      <ellipse cx={100} cy={140} rx={30} ry={25} fill={p.body} {...O} />
      <path d="M84 126 Q100 120 116 126 Q120 146 100 152 Q80 146 84 126 Z" fill={p.belly} stroke="none" />
      <g fill="none" stroke={p.dark} strokeWidth={2} opacity={0.55}>
        <path d="M87 134 Q100 138 113 134" />
        <path d="M88 143 Q100 147 112 143" />
      </g>
      <ellipse cx={84} cy={163} rx={9} ry={5.5} fill={p.body} {...o2} />
      <ellipse cx={116} cy={163} rx={9} ry={5.5} fill={p.body} {...o2} />

      {/* sừng — nub → cong vàng */}
      <g fill={p.extra} {...o2}>
        {form === 1 ? (
          <>
            <path d="M76 58 Q74 46 80 42 Q86 48 84 58 Z" />
            <path d="M124 58 Q126 46 120 42 Q114 48 116 58 Z" />
          </>
        ) : (
          <>
            <path d="M74 58 Q66 44 70 30 Q80 36 84 52 Z" />
            <path d="M126 58 Q134 44 130 30 Q120 36 116 52 Z" />
          </>
        )}
      </g>
      {/* gai lưng đầu (form ≥ 2) */}
      {form >= 2 && (
        <g fill={p.dark} {...o2}>
          <path d="M92 50 Q96 40 100 50 Z" />
          <path d="M102 49 Q107 39 111 50 Z" />
        </g>
      )}
      {/* lửa trên đỉnh đầu (form 3) */}
      {form === 3 && (
        <g className={cls(lively, 'pet-flame')} style={{ transformOrigin: '100px 42px' }}>
          <path d="M100 28 Q108 36 105 46 Q100 51 95 46 Q92 36 100 28 Z" fill="#fb923c" {...o2} />
          <path d="M100 34 Q104 38 102 44 Q100 47 98 44 Q96 38 100 34 Z" fill="#fde047" stroke="none" />
        </g>
      )}

      {/* đầu */}
      <circle cx={100} cy={88} r={38} fill={p.body} {...O} />
      <ellipse cx={100} cy={104} rx={16} ry={11} fill={p.belly} stroke="none" />

      <g transform="translate(100,88)">{face}</g>
    </g>
  );
}

// ─── Registry ───────────────────────────────────────────────────

export const PET_BODIES = {
  dog: BodyDog,
  cat: BodyCat,
  koi: BodyKoi,
  seagull: BodySeagull,
  duck: BodyDuck,
  horse: BodyHorse,
  flower: BodyFlower,
  plant: BodyPlant,
  dragon: BodyDragon,
} as const;
