'use client';

// ─── Hệ biểu cảm khuôn mặt anime dùng chung cho 9 loài ─────────────────────
//
// Toạ độ khuôn mặt: gốc (0,0) = TÂM ĐẦU của pet. Bodies.tsx đặt
// <g transform="translate(...)">{face}</g> vào đúng vị trí đầu từng loài.
// Mắt ±17, miệng y=12, má hồng ±31 — mọi loài dùng chung nên biểu cảm
// đồng bộ 100% (đổi 1 chỗ, 9 loài cùng đổi).
//
// Hiệu ứng sân khấu (tim/sao/Zzz/bát ăn/bóng) vẽ theo toạ độ stage 200×200.

import { motion, type MotionValue } from 'framer-motion';
import { INK, type MouthKind, type PetExpression, type PetPalette } from './pet-dna';

// ─── Helpers ────────────────────────────────────────────────────

/** Path ngôi sao 5 cánh tâm (cx,cy). */
export function starPath(cx: number, cy: number, rOut: number, rIn: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** Path trái tim tâm (0,0), cao ~size. */
export function heartPath(size = 10): string {
  const s = size / 10;
  return `M0 ${3 * s} C ${-5.5 * s} ${-3.5 * s} ${-13 * s} ${2.5 * s} 0 ${11 * s} C ${13 * s} ${2.5 * s} ${5.5 * s} ${-3.5 * s} 0 ${3 * s} Z`;
}

// ─── Mắt ────────────────────────────────────────────────────────

function OpenEye({
  irisColor, lidColor, pupilX, pupilY, lidDown = 0, watery = false, small = false,
}: {
  irisColor: string;
  /** màu nắp mí (= màu thân loài) */
  lidColor: string;
  pupilX?: MotionValue<number> | number;
  pupilY?: MotionValue<number> | number;
  /** 0-1: mí trên sụp xuống bao nhiêu (sleepy) */
  lidDown?: number;
  /** mắt long lanh nhiều highlight (đói/nũng) */
  watery?: boolean;
  /** con ngươi co nhỏ (ngạc nhiên) */
  small?: boolean;
}) {
  const irisR = small ? 3.6 : 5.8;
  return (
    <g>
      {/* lòng trắng */}
      <ellipse cx={0} cy={0} rx={8} ry={9.5} fill="#fff" stroke={INK} strokeWidth={2} />
      {/* mống + ngươi + highlight — nhóm này dịch theo con trỏ (eye-tracking) */}
      <motion.g style={{ x: pupilX ?? 0, y: pupilY ?? 0 }}>
        <circle cx={0} cy={0.5} r={irisR} fill={irisColor} />
        <circle cx={0} cy={0.5} r={irisR * 0.55} fill={INK} />
        <circle cx={-2} cy={-2.4} r={2.1} fill="#fff" />
        <circle cx={2.2} cy={2.4} r={1} fill="#fff" opacity={0.9} />
        {watery && <circle cx={0.5} cy={3.4} r={1.4} fill="#fff" opacity={0.75} />}
      </motion.g>
      {/* mí trên sụp (sleepy) — che phần trên mắt bằng nắp cùng màu thân */}
      {lidDown > 0 && (
        <path
          d={`M-8.4 ${-9.5 + 15 * lidDown} A 8.4 ${10} 0 0 1 8.4 ${-9.5 + 15 * lidDown} L 8.4 -10 L -8.4 -10 Z`}
          fill={lidColor} stroke={INK} strokeWidth={1.6}
        />
      )}
      {/* lông mi trên */}
      <path d="M-7.6 -6.2 Q0 -11 7.6 -6.2" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
    </g>
  );
}

/** Mắt cong ^_^ (joy/eat) */
function ArcEye({ down = false }: { down?: boolean }) {
  return (
    <path
      d={down ? 'M-7 -1 Q0 5 7 -1' : 'M-7 2.5 Q0 -5.5 7 2.5'}
      fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round"
    />
  );
}

function HeartEye() {
  return <path d={heartPath(9)} transform="translate(0,-4)" fill="#f43f5e" stroke={INK} strokeWidth={1.6} />;
}

function StarEye() {
  return <path d={starPath(0, 0, 7.5, 3.2)} fill="#fbbf24" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />;
}

// ─── Miệng theo loài ────────────────────────────────────────────

function Mouth({ kind, expr, palette }: { kind: MouthKind; expr: PetExpression; palette: PetPalette }) {
  const stroke = { fill: 'none', stroke: INK, strokeWidth: 2.4, strokeLinecap: 'round' as const };

  // Mỏ vịt (rộng, dẹt) — biểu cảm bằng độ mở
  if (kind === 'beak-flat') {
    const open = expr === 'eat' || expr === 'joy' || expr === 'surprised' || expr === 'star';
    return (
      <g transform="translate(0,9)">
        <ellipse cx={0} cy={0} rx={13} ry={open ? 7.5 : 5.5} fill={palette.extra} stroke={INK} strokeWidth={2.2} />
        <path d="M-13 -0.5 Q0 3.5 13 -0.5" fill="none" stroke={INK} strokeWidth={1.6} />
        {open && <ellipse cx={0} cy={2.6} rx={5.5} ry={2.6} fill="#c2410c" opacity={0.65} />}
        {expr === 'sad' && <path d="M-9 4.5 Q0 2 9 4.5" {...stroke} strokeWidth={1.8} />}
      </g>
    );
  }

  // Mỏ hải âu (nhỏ, nhọn)
  if (kind === 'beak-small') {
    const open = expr === 'eat' || expr === 'joy' || expr === 'surprised' || expr === 'star';
    return (
      <g transform="translate(0,10)">
        {open ? (
          <>
            <path d="M-7 -2 L7 -2 L0 4 Z" fill={palette.extra} stroke={INK} strokeWidth={2} strokeLinejoin="round" transform="translate(0,-3)" />
            <path d="M-6 1 L6 1 L0 6.5 Z" fill="#e8842a" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          </>
        ) : (
          <path d="M-7 -1.5 L7 -1.5 L0 5.5 Z" fill={palette.extra} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
        )}
        <circle cx={4.4} cy={-0.2} r={0.9} fill="#d64545" />
      </g>
    );
  }

  // Miệng mèo :3
  if (kind === 'cat') {
    return (
      <g transform="translate(0,9)">
        <path d="M0 -3.5 L-2.4 -0.8 Q0 1 2.4 -0.8 Z" fill="#e6739f" stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
        {expr === 'eat' || expr === 'joy' || expr === 'star' ? (
          <path d="M-5.5 2 Q-2.75 6.5 0 2 Q2.75 6.5 5.5 2" {...stroke} />
        ) : expr === 'sad' ? (
          <path d="M-4.5 5 Q0 2 4.5 5" {...stroke} />
        ) : expr === 'surprised' ? (
          <ellipse cx={0} cy={4} rx={2.6} ry={3.2} fill="#8c3a52" stroke={INK} strokeWidth={1.8} />
        ) : (
          <path d="M-5 2 Q-2.5 5.5 0 2 Q2.5 5.5 5 2" {...stroke} strokeWidth={2} />
        )}
      </g>
    );
  }

  // Mõm chó/ngựa: mũi + miệng (mảng mõm sáng do body vẽ phía sau)
  if (kind === 'muzzle') {
    return (
      <g transform="translate(0,7)">
        <path d="M-3.4 0 Q0 -2.6 3.4 0 Q0 3.4 -3.4 0 Z" fill={INK} />
        {expr === 'eat' ? (
          <ellipse cx={0} cy={7} rx={4.6} ry={3.6} fill="#8c3a52" stroke={INK} strokeWidth={2} />
        ) : expr === 'joy' || expr === 'star' || expr === 'love' ? (
          <path d="M-6 4.5 Q0 11 6 4.5" {...stroke} />
        ) : expr === 'sad' ? (
          <path d="M-5 9 Q0 5 5 9" {...stroke} />
        ) : expr === 'surprised' ? (
          <ellipse cx={0} cy={6.5} rx={2.6} ry={3.4} fill="#8c3a52" stroke={INK} strokeWidth={1.8} />
        ) : (
          <path d="M0 1 Q0 4.5 -4 5.5 M0 1 Q0 4.5 4 5.5" {...stroke} strokeWidth={2} />
        )}
      </g>
    );
  }

  // Miệng cá — chu nhỏ
  if (kind === 'fish') {
    if (expr === 'eat' || expr === 'surprised') {
      return <ellipse cx={0} cy={11} rx={3.4} ry={4} fill="#c96f6f" stroke={INK} strokeWidth={2} />;
    }
    if (expr === 'joy' || expr === 'star' || expr === 'love') {
      return <path d="M-5 9.5 Q0 15 5 9.5" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />;
    }
    if (expr === 'sad') {
      return <path d="M-4 13.5 Q0 10 4 13.5" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />;
    }
    return <circle cx={0} cy={11} r={2.2} fill="none" stroke={INK} strokeWidth={2.2} />;
  }

  // default (rồng, hoa, cây)
  if (expr === 'eat') {
    return <ellipse cx={0} cy={12} rx={5} ry={4} fill="#8c3a52" stroke={INK} strokeWidth={2} />;
  }
  if (expr === 'joy' || expr === 'star' || expr === 'love') {
    return (
      <g>
        <path d="M-7 10 Q0 17.5 7 10" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        <path d="M-3.4 13.2 Q0 15.6 3.4 13.2" fill="#e6739f" stroke="none" />
      </g>
    );
  }
  if (expr === 'sad') {
    return <path d="M-5.5 15 Q0 10.5 5.5 15" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />;
  }
  if (expr === 'surprised') {
    return <ellipse cx={0} cy={13} rx={2.8} ry={3.6} fill="#8c3a52" stroke={INK} strokeWidth={2} />;
  }
  if (expr === 'hungry') {
    return (
      <g>
        <path d="M-5.5 11 Q0 15.5 5.5 11" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
        {/* nước miếng thèm ăn */}
        <path d="M4.2 13.2 Q5.6 16.8 4.4 18.4 Q3 16.8 4.2 13.2" fill="#9edbff" stroke={INK} strokeWidth={1} />
      </g>
    );
  }
  return <path d="M-5 11.5 Q0 15.5 5 11.5" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />;
}

// ─── Khuôn mặt tổng hợp ─────────────────────────────────────────

export interface PetFaceProps {
  expr: PetExpression;
  palette: PetPalette;
  mouth: MouthKind;
  /** Đang chớp mắt (AnimatedPet điều khiển bằng timer) */
  blinking?: boolean;
  /** MotionValue dịch con ngươi theo chuột (eye-tracking) */
  pupilX?: MotionValue<number> | number;
  pupilY?: MotionValue<number> | number;
  /** Giãn khoảng cách 2 mắt (cá = mặt rộng) */
  spread?: number;
  /** Màu nắp mí (thường = màu thân) cho sleepy */
  lidColor?: string;
}

export function PetFace({
  expr, palette, mouth, blinking = false, pupilX, pupilY, spread = 1, lidColor,
}: PetFaceProps) {
  const EX = 17 * spread;
  const closed = blinking || expr === 'sleep';
  const lid = lidColor ?? palette.body;

  let eye: React.ReactNode;
  if (closed) eye = <ArcEye down />;
  else if (expr === 'joy' || expr === 'eat') eye = <ArcEye />;
  else if (expr === 'love') eye = <HeartEye />;
  else if (expr === 'star') eye = <StarEye />;
  else if (expr === 'sleepy') eye = <OpenEye irisColor={palette.accent} lidColor={lid} pupilX={pupilX} pupilY={pupilY} lidDown={0.55} />;
  else if (expr === 'hungry') eye = <OpenEye irisColor={palette.accent} lidColor={lid} pupilX={pupilX} pupilY={pupilY} watery />;
  else if (expr === 'surprised') eye = <OpenEye irisColor={palette.accent} lidColor={lid} pupilX={pupilX} pupilY={pupilY} small />;
  else if (expr === 'sad') eye = <OpenEye irisColor={palette.accent} lidColor={lid} pupilX={pupilX} pupilY={pupilY} watery />;
  else eye = <OpenEye irisColor={palette.accent} lidColor={lid} pupilX={pupilX} pupilY={pupilY} />;

  const showBlush = ['happy', 'joy', 'love', 'eat', 'star'].includes(expr);

  return (
    <g>
      <g transform={`translate(${-EX},-2)`}>{eye}</g>
      <g transform={`translate(${EX},-2)`}>{eye}</g>
      {/* mày buồn / ngạc nhiên */}
      {expr === 'sad' && (
        <>
          <path d={`M${-EX - 7} -16 Q${-EX} -13.5 ${-EX + 6.5} -15.5`} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" transform="rotate(-8)" />
          <path d={`M${EX - 6.5} -15.5 Q${EX} -13.5 ${EX + 7} -16`} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" transform="rotate(8)" />
        </>
      )}
      {/* má hồng */}
      {showBlush && (
        <>
          <ellipse cx={-31 * spread} cy={7} rx={6.5} ry={4} fill="#fda4af" opacity={0.75} />
          <ellipse cx={31 * spread} cy={7} rx={6.5} ry={4} fill="#fda4af" opacity={0.75} />
        </>
      )}
      <Mouth kind={mouth} expr={expr} palette={palette} />
    </g>
  );
}

// ─── Hiệu ứng sân khấu (stage 200×200) ──────────────────────────

/** Tim bay lên (vuốt ve / click) */
export function HeartsFx({ count = 3 }: { count?: number }) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => (
        <motion.path
          key={i}
          d={heartPath(9)}
          fill="#fb7185" stroke={INK} strokeWidth={1.2}
          initial={{ x: 100 + (i - 1) * 16, y: 78, scale: 0, opacity: 0 }}
          animate={{ y: 34 - i * 6, scale: [0, 1.15, 1], opacity: [0, 1, 0] }}
          transition={{ duration: 1.3, delay: i * 0.18, ease: 'easeOut' }}
        />
      ))}
    </g>
  );
}

/** Sao lấp lánh toả tròn (thưởng / tiến hoá) */
export function SparkleBurstFx({ cx = 100, cy = 96, big = false }: { cx?: number; cy?: number; big?: boolean }) {
  const n = big ? 8 : 6;
  return (
    <g>
      {Array.from({ length: n }).map((_, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = big ? 62 : 48;
        return (
          <motion.path
            key={i}
            d={starPath(0, 0, big ? 7 : 5, big ? 3 : 2.2)}
            fill={i % 2 ? '#fbbf24' : '#fde68a'} stroke={INK} strokeWidth={1}
            initial={{ x: cx, y: cy, scale: 0, opacity: 0 }}
            animate={{
              x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
              scale: [0, 1.2, 0.8, 0], opacity: [0, 1, 1, 0], rotate: 120,
            }}
            transition={{ duration: big ? 1.15 : 0.9, delay: i * 0.04, ease: 'easeOut' }}
          />
        );
      })}
    </g>
  );
}

/** Vòng sáng level-up nở ra */
export function LevelUpRingFx() {
  return (
    <g>
      <motion.circle
        cx={100} cy={110} r={30} fill="none" stroke="#fbbf24" strokeWidth={4}
        initial={{ scale: 0.4, opacity: 0.9 }}
        animate={{ scale: 2.6, opacity: 0 }}
        transition={{ duration: 1, ease: 'easeOut' }}
        style={{ transformOrigin: '100px 110px' }}
      />
      <motion.circle
        cx={100} cy={110} r={30} fill="none" stroke="#f59e0b" strokeWidth={2.5}
        initial={{ scale: 0.3, opacity: 0.8 }}
        animate={{ scale: 2.1, opacity: 0 }}
        transition={{ duration: 1, delay: 0.18, ease: 'easeOut' }}
        style={{ transformOrigin: '100px 110px' }}
      />
    </g>
  );
}

/** Zzz khi ngủ — loop */
export function ZzzFx() {
  return (
    <g fontFamily="inherit" fontWeight={800} fill="#818cf8" stroke={INK} strokeWidth={0.6}>
      {[0, 1, 2].map((i) => (
        <motion.text
          key={i}
          fontSize={13 + i * 4}
          initial={{ x: 132 + i * 12, y: 66 - i * 14, opacity: 0 }}
          animate={{ opacity: [0, 1, 0], y: 56 - i * 16 }}
          transition={{ duration: 2.2, delay: i * 0.55, repeat: Infinity, repeatDelay: 0.4 }}
        >
          z
        </motion.text>
      ))}
    </g>
  );
}

/** Giọt mồ hôi (bối rối / bị từ chối) */
export function SweatDropFx() {
  return (
    <motion.path
      d="M138 52 Q145 63 141.5 69 Q135 69 134 61 Q134.6 55.5 138 52 Z"
      fill="#9edbff" stroke={INK} strokeWidth={1.6}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: [0, 1, 1, 0], y: [0, 4, 8, 12] }}
      transition={{ duration: 1.1 }}
    />
  );
}

/** Dấu "!" giật mình */
export function ExclaimFx() {
  return (
    <motion.g
      initial={{ scale: 0, y: 4 }}
      animate={{ scale: [0, 1.25, 1], y: 0 }}
      transition={{ duration: 0.35 }}
      style={{ transformOrigin: '146px 46px' }}
    >
      <rect x={143} y={30} width={6} height={16} rx={3} fill="#f59e0b" stroke={INK} strokeWidth={1.6} />
      <circle cx={146} cy={52} r={3.4} fill="#f59e0b" stroke={INK} strokeWidth={1.6} />
    </motion.g>
  );
}

/**
 * Bát thức ăn (hoặc bình tưới cho loài thực vật).
 * bites: 0..3 — mức vơi dần khi pet nhai.
 */
export function FoodBowlFx({ palette, bites = 0, watering = false }: {
  palette: PetPalette; bites?: number; watering?: boolean;
}) {
  if (watering) {
    // Bình tưới nghiêng + giọt nước cho hoa/cây
    return (
      <g transform="translate(146,72) rotate(28)">
        <rect x={-14} y={-10} width={26} height={20} rx={7} fill="#93c5fd" stroke={INK} strokeWidth={2.4} />
        <path d="M-14 -2 L-26 -12 L-22 -15 L-9 -7 Z" fill="#93c5fd" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
        <path d="M-4 -10 Q0 -20 8 -14" fill="none" stroke={INK} strokeWidth={2.4} />
        {[0, 1, 2].map((i) => (
          <motion.circle
            key={i} r={2.2} fill="#60a5fa" stroke={INK} strokeWidth={1}
            initial={{ cx: -26, cy: -10, opacity: 0 }}
            animate={{ cy: [-8, 18], cx: [-27 - i * 3, -30 - i * 4], opacity: [0, 1, 0] }}
            transition={{ duration: 0.8, delay: i * 0.25, repeat: Infinity }}
          />
        ))}
      </g>
    );
  }
  const kibble = Math.max(0, 3 - bites);
  return (
    <g transform="translate(154,157)">
      {/* thức ăn viên */}
      {kibble > 0 && (
        <g>
          {Array.from({ length: kibble }).map((_, i) => (
            <circle key={i} cx={-7 + i * 7} cy={-7 - (i % 2) * 3} r={3.6} fill="#c98a4b" stroke={INK} strokeWidth={1.6} />
          ))}
        </g>
      )}
      {/* bát */}
      <path d="M-17 -4 L17 -4 L13 9 Q0 12 -13 9 Z" fill={palette.accent} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <ellipse cx={0} cy={-4} rx={17} ry={4.6} fill={palette.extra} stroke={INK} strokeWidth={2.2} />
    </g>
  );
}

/** Quả bóng đồ chơi nảy */
export function BallFx({ palette, bouncing = true }: { palette: PetPalette; bouncing?: boolean }) {
  return (
    <motion.g
      initial={{ x: 150, y: 108 }}
      animate={bouncing ? { y: [108, 142, 108, 142, 120, 142] } : { y: 142 }}
      transition={{ duration: 1.6, ease: 'easeIn', times: [0, 0.25, 0.5, 0.72, 0.86, 1] }}
    >
      <circle r={11} fill="#fff" stroke={INK} strokeWidth={2.4} />
      <path d="M-11 0 A 11 11 0 0 1 11 0 Z" fill={palette.accent} stroke={INK} strokeWidth={2.2} />
      <circle r={3.2} fill="#fff" stroke={INK} strokeWidth={2} />
    </motion.g>
  );
}
