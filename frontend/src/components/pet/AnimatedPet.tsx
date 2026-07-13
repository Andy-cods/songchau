'use client';

// ─── AnimatedPet — sinh vật anime sống động (state machine) ────────────────
//
// Pet redesign 2026-07-13 (Thang). Component trung tâm của module pet:
//
//   <AnimatedPet species="cat" form={2} size={180} interactive
//                action={action} onActionDone={...} mood="hungry" />
//
// - action (controlled): 'eat' | 'play' | 'stroke' | 'levelup' | 'refuse'
//   → chạy choreography nhiều phase rồi gọi onActionDone().
//   'eat': thức ăn rơi xuống → pet chạy lại gần → nhai (bát vơi dần)
//          → nhảy vui + lấp lánh → về chỗ. Loài trong chậu (hoa/cây) được
//          TƯỚI NƯỚC thay vì bát ăn; cá koi lướt tới thay vì nhảy.
// - mood (idle): 'content' | 'hungry' | 'sad' | 'sleepy' — suy ra từ dữ liệu
//   (last_fed_at...) ở phía trang gọi.
// - interactive: mắt nhìn theo con trỏ, click = nhún + tim, hover = vẫy
//   đuôi nhanh (CSS .pet-stage), không đụng chuột 75s = ngủ gật (Zzz).
// - Tôn trọng prefers-reduced-motion: chỉ đổi biểu cảm, không di chuyển.
// - animated=false: render tĩnh 100% (không timer/framer) — dùng cho avatar.

import {
  useCallback, useEffect, useMemo, useRef, useState, type CSSProperties,
} from 'react';
import { AnimatePresence, motion, useReducedMotion, useSpring } from 'framer-motion';
import {
  FORM_SCALE, PET_DNA, type PetExpression, type PetForm, type PetSpecies,
} from './pet-dna';
import { PET_BODIES } from './bodies';
import {
  BallFx, ExclaimFx, FoodBowlFx, HeartsFx, LevelUpRingFx, PetFace,
  SparkleBurstFx, SweatDropFx, ZzzFx,
} from './expressions';

export type PetAction = 'eat' | 'play' | 'stroke' | 'levelup' | 'refuse';
export type PetMood = 'content' | 'hungry' | 'sad' | 'sleepy';

type Phase =
  | 'idle' | 'nap'
  | 'eat:appear' | 'eat:approach' | 'eat:chew' | 'eat:yum'
  | 'play:in' | 'play:jump' | 'play:joy'
  | 'stroke' | 'levelup' | 'refuse';

export interface AnimatedPetProps {
  species: PetSpecies;
  form: PetForm;
  /** Cạnh vuông px (viewBox luôn 200×200) */
  size?: number;
  /** Hành động đang chạy — parent set rồi chờ onActionDone để clear */
  action?: PetAction | null;
  onActionDone?: () => void;
  mood?: PetMood;
  interactive?: boolean;
  /** false = render tĩnh tuyệt đối (avatar, danh sách) — không timer nào chạy */
  animated?: boolean;
  /** Biểu cảm cố định khi animated=false */
  staticExpr?: PetExpression;
  showShadow?: boolean;
  className?: string;
  onPetClick?: () => void;
}

// Thời lượng từng phase (ms) — chỉnh nhịp choreography tại đây.
const PHASE_MS: Record<string, number> = {
  'eat:appear': 500, 'eat:approach': 700, 'eat:chew': 2100, 'eat:yum': 900,
  'play:in': 450, 'play:jump': 1650, 'play:joy': 700,
  stroke: 1900, levelup: 1700, refuse: 1300,
};

const NAP_AFTER_MS = 75_000;

export function AnimatedPet({
  species, form, size = 160,
  action = null, onActionDone,
  mood = 'content',
  interactive = false,
  animated = true,
  staticExpr = 'happy',
  showShadow = true,
  className,
  onPetClick,
}: AnimatedPetProps) {
  const dna = PET_DNA[species];
  const Body = PET_BODIES[species];
  const prefersReduced = useReducedMotion();
  const reduced = !!prefersReduced || !animated;

  const [phase, setPhase] = useState<Phase>('idle');
  const [bites, setBites] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const [refuseSad, setRefuseSad] = useState(false);
  const [boopCount, setBoopCount] = useState(0); // click hearts (key AnimatePresence)
  const [hovered, setHovered] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const napTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionRef = useRef<PetAction | null>(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const after = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // Con ngươi nhìn theo chuột — spring cho mượt, không re-render React.
  const pupilX = useSpring(0, { stiffness: 260, damping: 22 });
  const pupilY = useSpring(0, { stiffness: 260, damping: 22 });

  // ── Nap (ngủ gật khi bị bỏ quên) ──────────────────────────────
  const armNapTimer = useCallback(() => {
    if (!interactive || reduced) return;
    if (napTimer.current) clearTimeout(napTimer.current);
    napTimer.current = setTimeout(() => {
      // chỉ ngủ khi đang rảnh
      setPhase((p) => (p === 'idle' ? 'nap' : p));
    }, NAP_AFTER_MS);
  }, [interactive, reduced]);

  const wake = useCallback(() => {
    setPhase((p) => (p === 'nap' ? 'idle' : p));
    armNapTimer();
  }, [armNapTimer]);

  useEffect(() => {
    armNapTimer();
    return () => {
      if (napTimer.current) clearTimeout(napTimer.current);
    };
  }, [armNapTimer]);

  // ── Chớp mắt tự nhiên (2.6–6s ngẫu nhiên) ─────────────────────
  useEffect(() => {
    if (reduced) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        if (!alive) return;
        setBlinking(true);
        setTimeout(() => alive && setBlinking(false), 130);
        loop();
      }, 2600 + Math.random() * 3400);
    };
    loop();
    return () => { alive = false; clearTimeout(t); };
  }, [reduced]);

  // ── Choreography theo action ──────────────────────────────────
  useEffect(() => {
    actionRef.current = action;
    if (!action) return;
    clearTimers();
    setRefuseSad(false);
    wake();

    const done = () => {
      setPhase('idle');
      setBites(0);
      onActionDone?.();
    };

    if (reduced) {
      // Reduced-motion: giữ biểu cảm tương ứng trong thời gian ngắn rồi xong.
      const exprPhase: Phase =
        action === 'eat' ? 'eat:chew'
        : action === 'play' ? 'play:joy'
        : action === 'stroke' ? 'stroke'
        : action === 'levelup' ? 'levelup' : 'refuse';
      setPhase(exprPhase);
      after(900, done);
      return clearTimers;
    }

    if (action === 'eat') {
      setBites(0);
      setPhase('eat:appear');
      after(PHASE_MS['eat:appear'], () => setPhase('eat:approach'));
      after(PHASE_MS['eat:appear'] + PHASE_MS['eat:approach'], () => setPhase('eat:chew'));
      const chewStart = PHASE_MS['eat:appear'] + PHASE_MS['eat:approach'];
      after(chewStart + 600, () => setBites(1));
      after(chewStart + 1250, () => setBites(2));
      after(chewStart + 1850, () => setBites(3));
      after(chewStart + PHASE_MS['eat:chew'], () => setPhase('eat:yum'));
      after(chewStart + PHASE_MS['eat:chew'] + PHASE_MS['eat:yum'], done);
    } else if (action === 'play') {
      setPhase('play:in');
      after(PHASE_MS['play:in'], () => setPhase('play:jump'));
      after(PHASE_MS['play:in'] + PHASE_MS['play:jump'], () => setPhase('play:joy'));
      after(PHASE_MS['play:in'] + PHASE_MS['play:jump'] + PHASE_MS['play:joy'], done);
    } else if (action === 'stroke') {
      setPhase('stroke');
      after(PHASE_MS.stroke, done);
    } else if (action === 'levelup') {
      setPhase('levelup');
      after(PHASE_MS.levelup, done);
    } else if (action === 'refuse') {
      setPhase('refuse');
      after(550, () => setRefuseSad(true));
      after(PHASE_MS.refuse, done);
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  useEffect(() => () => clearTimers(), []);

  // ── Eye tracking ──────────────────────────────────────────────
  const wrapRef = useRef<HTMLDivElement>(null);
  const handleMove = (e: React.MouseEvent) => {
    if (!interactive || reduced) return;
    wake();
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;   // -1..1
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    pupilX.set(Math.max(-1, Math.min(1, nx)) * 3);
    pupilY.set(Math.max(-1, Math.min(1, ny)) * 2.2);
  };
  const handleLeave = () => {
    setHovered(false);
    pupilX.set(0);
    pupilY.set(0);
  };

  const handleClick = () => {
    if (!interactive) return;
    wake();
    if (phase === 'idle') setBoopCount((c) => c + 1);
    onPetClick?.();
  };

  // ── Biểu cảm hiện tại ─────────────────────────────────────────
  const expr: PetExpression = useMemo(() => {
    if (!animated) return staticExpr;
    switch (phase) {
      case 'nap': return 'sleep';
      case 'eat:appear': return 'surprised';
      case 'eat:approach': return 'hungry';
      case 'eat:chew': return 'eat';
      case 'eat:yum': return 'joy';
      case 'play:in': return 'surprised';
      case 'play:jump': return 'joy';
      case 'play:joy': return 'star';
      case 'stroke': return 'love';
      case 'levelup': return 'star';
      case 'refuse': return refuseSad ? 'sad' : 'surprised';
      default: break;
    }
    if (boopCount > 0 && hovered) return 'happy';
    if (mood === 'hungry') return 'hungry';
    if (mood === 'sad') return 'sad';
    if (mood === 'sleepy') return 'sleepy';
    return hovered ? 'happy' : 'neutral';
  }, [animated, staticExpr, phase, refuseSad, mood, hovered, boopCount]);

  // ── Chuyển động thân theo phase ───────────────────────────────
  const rooted = !!dna.rooted;
  const floats = !!dna.floats;
  const approachX = rooted ? 0 : 32;

  const bodyMotion = useMemo(() => {
    if (reduced) return { animate: { x: 0, y: 0, rotate: 0 }, transition: { duration: 0.2 } };
    switch (phase) {
      case 'eat:approach':
        return {
          animate: { x: approachX, y: floats ? [0, -4, 2, -3, 0] : [0, -9, 0, -7, 0], rotate: 0 },
          transition: { duration: 0.68, ease: 'easeOut' as const },
        };
      case 'eat:chew':
        return {
          animate: { x: approachX, y: [0, 1.6, 0], rotate: 0 },
          transition: { y: { duration: 0.5, repeat: Infinity }, x: { duration: 0.15 } },
        };
      case 'eat:yum':
        return {
          animate: { x: 0, y: [0, -15, 0], rotate: 0 },
          transition: { duration: 0.75, ease: 'easeOut' as const },
        };
      case 'play:jump':
        return {
          animate: { x: 0, y: [0, -28, 0, -28, 0, -12, 0], rotate: [0, 4, 0, -4, 0, 2, 0] },
          transition: { duration: 1.62, ease: 'easeInOut' as const },
        };
      case 'play:joy':
      case 'levelup':
        return {
          animate: { x: 0, y: [0, -24, 0, -14, 0], rotate: 0 },
          transition: { duration: 1.1, ease: 'easeOut' as const },
        };
      case 'stroke':
        return {
          animate: { x: 0, y: 0, rotate: [0, -3.5, 3.5, -2.5, 0] },
          transition: { duration: 1.8, ease: 'easeInOut' as const },
        };
      case 'refuse':
        return {
          animate: { x: [0, -6, 6, -5, 5, 0], y: 0, rotate: 0 },
          transition: { duration: 0.55 },
        };
      case 'nap':
        return {
          animate: { x: 0, y: [0, 1.5, 0], rotate: rooted ? 0 : 2 },
          transition: { y: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' as const } },
        };
      default: // idle — thở/lơ lửng
        return {
          animate: { x: 0, y: floats ? [0, -7, 0] : [0, -3.5, 0], rotate: 0 },
          transition: { duration: floats ? 3.2 : 2.8, repeat: Infinity, ease: 'easeInOut' as const },
        };
    }
  }, [phase, reduced, approachX, floats, rooted]);

  const scale = FORM_SCALE[form];
  const eating = phase.startsWith('eat:');
  const showFood = animated && (eating || (reduced && phase === 'eat:chew'));
  const showBall = animated && phase.startsWith('play:') && !reduced;

  const face = (
    <PetFace
      expr={expr}
      palette={dna.palette}
      mouth={dna.mouth}
      blinking={blinking && expr !== 'sleep' && expr !== 'joy' && expr !== 'eat'}
      pupilX={interactive && !reduced ? pupilX : undefined}
      pupilY={interactive && !reduced ? pupilY : undefined}
      spread={species === 'koi' ? 1.15 : 1}
      lidColor={dna.palette.body}
    />
  );

  const stageStyle: CSSProperties = { width: size, height: size };

  return (
    <div
      ref={wrapRef}
      className={`pet-stage relative select-none ${interactive ? 'cursor-pointer' : ''} ${className ?? ''}`}
      style={stageStyle}
      onMouseMove={handleMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={handleLeave}
      onClick={handleClick}
      role={interactive ? 'button' : 'img'}
      aria-label={`Pet ${dna.nameVi} form ${form}`}
    >
      <svg viewBox="0 0 200 200" width={size} height={size} style={{ overflow: 'visible' }}>
        {/* bóng đổ mặt đất */}
        {showShadow && (
          <ellipse
            cx={100} cy={floats ? 178 : 171}
            rx={floats ? 26 : 34} ry={5}
            fill="#0f172a" opacity={0.13}
          />
        )}

        {/* pet — scale theo form quanh điểm chạm đất, squash khi click */}
        <g transform={`translate(100 168) scale(${scale}) translate(-100 -168)`}>
          <motion.g {...bodyMotion}>
            <motion.g
              whileTap={interactive && !reduced ? { scaleY: 0.9, scaleX: 1.06 } : undefined}
              style={{ transformOrigin: '100px 168px' }}
            >
              <Body form={form} palette={dna.palette} face={face} lively={animated && !reduced} />
            </motion.g>
          </motion.g>
        </g>

        {/* hiệu ứng sân khấu */}
        {showFood && phase !== 'eat:yum' && (
          <motion.g
            initial={reduced ? false : { y: -26, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 17 }}
          >
            <FoodBowlFx palette={dna.palette} bites={bites} watering={rooted} />
          </motion.g>
        )}
        {showBall && <BallFx palette={dna.palette} bouncing={phase === 'play:jump' || phase === 'play:in'} />}

        {!reduced && (
          <>
            {phase === 'stroke' && <HeartsFx />}
            {(phase === 'eat:yum' || phase === 'play:joy') && <SparkleBurstFx />}
            {phase === 'levelup' && (
              <>
                <LevelUpRingFx />
                <SparkleBurstFx big />
              </>
            )}
            {phase === 'refuse' && (
              <>
                <ExclaimFx />
                <SweatDropFx />
              </>
            )}
            {phase === 'nap' && <ZzzFx />}
            {/* tim khi click/boop */}
            <AnimatePresence>
              {boopCount > 0 && phase === 'idle' && (
                <motion.g key={boopCount} exit={{ opacity: 0 }}>
                  <HeartsFx count={1} />
                </motion.g>
              )}
            </AnimatePresence>
          </>
        )}
      </svg>
    </div>
  );
}
