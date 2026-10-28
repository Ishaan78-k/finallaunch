import { useRef } from 'react';
import { setTouchMove, setTouchRun, triggerInteract } from '../game/controllers/input';
import { useGameStore } from '../state/gameStore';

function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const R = 48;

  const update = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el || !knob.current) return;
    const r = el.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    setTouchMove(dx / R, -dy / R);
  };
  const end = () => {
    active.current = null;
    if (knob.current) knob.current.style.transform = 'translate(0,0)';
    setTouchMove(0, 0);
  };

  return (
    <div
      ref={base}
      className="pointer-events-auto relative h-32 w-32 rounded-full border-4 border-ink bg-white/50"
      onPointerDown={(e) => { active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); update(e); }}
      onPointerMove={(e) => { if (active.current === e.pointerId) update(e); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div ref={knob} className="absolute left-1/2 top-1/2 -ml-8 -mt-8 h-16 w-16 rounded-full border-4 border-ink bg-saffron" />
    </div>
  );
}

export function MobileControls() {
  const setPanel = useGameStore((s) => s.setPanel);
  const round = 'pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border-4 border-ink bg-paper text-sm font-extrabold shadow-[0_4px_0_#1d2340] active:translate-y-1';
  return (
    <>
      <div className="absolute bottom-6 left-6"><Joystick /></div>
      <div className="pointer-events-none absolute bottom-6 right-4 grid grid-cols-2 gap-3">
        <button className={round} onPointerDown={() => setTouchRun(true)} onPointerUp={() => setTouchRun(false)} onPointerCancel={() => setTouchRun(false)}>Run</button>
        <button className={`${round} !bg-saffron`} onPointerDown={() => triggerInteract()}>Act</button>
        <button className={round} onClick={() => setPanel('phone')}>Phone</button>
        <button className={round} onClick={() => setPanel('map')}>Map</button>
        <button className={`${round} col-span-2 w-full !rounded-2xl`} onClick={() => setPanel('pause')}>Pause</button>
      </div>
    </>
  );
}
