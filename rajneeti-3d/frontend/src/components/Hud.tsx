import { useGameStore } from '../state/gameStore';
import { daysUntilElection, formatTime } from '../simulation/calendar/clock';
import { nextElectionDayOf } from '../simulation/world/term';

export function Hud({ nearby }: { nearby: string | null }) {
  const player = useGameStore((s) => s.player);
  const party = useGameStore((s) => s.party);
  const funds = useGameStore((s) => s.funds);
  const popularity = useGameStore((s) => s.popularity);
  const clock = useGameStore((s) => s.clock);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const skipDay = useGameStore((s) => s.skipDay);
  const toast = useGameStore((s) => s.toast);
  const panel = useGameStore((s) => s.panel);
  const term = useGameStore((s) => s.term);
  const crisis = useGameStore((s) => s.government?.crisis ?? null);
  const protest = useGameStore((s) => (s.government?.protests.active?.status === 'open' ? s.government.protests.active : null));
  const openPanel = useGameStore((s) => s.setPanel);

  return (
    <div className="pointer-events-none absolute inset-0 text-ink">
      <div className="absolute left-3 top-3 flex flex-col gap-1">
        <span className="chip">{player.name}</span>
        <span className="chip" style={{ background: party.color }}>{party.name}</span>
        <span className="chip">Party President</span>
      </div>
      <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
        <span className="chip">Party funds ₹{funds} crore</span>
        <span className="chip">Popularity {popularity}%</span>
        <span className="chip">Day {clock.day} · {formatTime(clock.minutes)}</span>
        <span className="chip">Election in {daysUntilElection(clock, nextElectionDayOf(term))} days</span>
        {crisis && <button className="chip pointer-events-auto !bg-berry text-white" onClick={() => openPanel('government')}>Crisis! Decide now</button>}
        {protest && <button className="chip pointer-events-auto !bg-saffron" onClick={() => openPanel('government')}>Protest outside! {protest.size.toLocaleString()} people</button>}
        <div className="pointer-events-auto flex gap-1">
          {[1, 4, 12].map((v) => (
            <button key={v} className={`chip ${speed === v ? '!bg-saffron' : ''}`} onClick={() => setSpeed(v)}>{v}x</button>
          ))}
          <button className="chip" onClick={skipDay}>Skip day</button>
        </div>
      </div>
      {nearby && !panel && (
        <div className="absolute bottom-44 left-1/2 -translate-x-1/2 rounded-game border-4 border-ink bg-paper px-4 py-2 text-lg font-bold shadow-[0_4px_0_#1d2340] sm:bottom-24">
          <span className="mr-2 rounded-md border-2 border-ink bg-saffron px-2">E</span>{nearby}
        </div>
      )}
      {toast && (
        <div className="absolute left-1/2 top-24 max-w-sm -translate-x-1/2 rounded-game border-4 border-ink bg-white px-4 py-2 text-center font-bold shadow-[0_4px_0_#1d2340]">{toast}</div>
      )}
    </div>
  );
}
