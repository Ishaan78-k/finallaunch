import { useState } from 'react';
import { useGameStore } from '../state/gameStore';
import {
  CAUSE_BY_ID, POLICE, electionEffect, promiseMet, publicAnger, type PoliceLevel,
} from '../simulation/world/protests';

const crore = (n: number): string => `₹${Math.round(n).toLocaleString()} cr`;

function Meter({ name, value, color, note }: { name: string; value: number; color: string; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-white p-2">
      <div className="flex justify-between text-sm font-bold"><span>{name}</span><span>{Math.round(value)}%</span></div>
      <div className="mt-1 h-4 overflow-hidden rounded-full border-2 border-ink bg-white"><div className="h-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /></div>
      {note && <div className="mt-1 text-xs opacity-70">{note}</div>}
    </div>
  );
}

/** The Protests tab of the Prime Minister's Office: the crowd outside, police posture, promises and what it all means for the next election. */
export function ProtestTab() {
  const gov = useGameStore((s) => s.government);
  const day = useGameStore((s) => s.clock.day);
  const respondProtest = useGameStore((s) => s.respondProtest);
  const [police, setPolice] = useState<PoliceLevel>('standard');
  if (!gov) return null;
  const p = gov.protests;
  const a = p.active;
  const anger = publicAnger(gov, day);
  const effect = electionEffect(gov);
  const fallen = gov.status !== 'governing';
  const def = a ? CAUSE_BY_ID[a.cause] : null;
  const pol = POLICE.find((x) => x.id === police)!;
  const pending = p.promises.filter((x) => x.status === 'pending');
  const done = p.promises.filter((x) => x.status !== 'pending').slice(-6).reverse();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Meter name="Public anger" value={anger.index} color={anger.index > 60 ? '#e0457b' : anger.index > 30 ? '#ff9f1c' : '#5cc26a'} note={`Biggest worry: ${CAUSE_BY_ID[anger.top].name.toLowerCase()}`} />
        <Meter name="Trust in police" value={p.policeTrust} color="#6c8ef5" />
        <Meter name="Lingering unrest" value={p.unrest} color="#a78bfa" />
      </div>
      <div className="rounded-xl border-2 border-ink bg-white p-2 text-sm">
        Effect on the next election vote: <b>{effect > 0 ? '+' : ''}{effect} points</b>. Kept promises help; broken promises and unrest hurt.
      </div>

      {a && def && (
        <div className="rounded-xl border-2 border-ink bg-[#fff3d6] p-3">
          <div className="text-lg font-extrabold">{def.name}: {a.size.toLocaleString()} people</div>
          <p className="text-sm">{def.text}</p>
          <div className="mt-2"><Meter name="Crowd anger" value={a.intensity} color={a.intensity >= 70 ? '#e0457b' : '#ff9f1c'} /></div>
          {a.status === 'open' ? (
            <>
              <p className="mt-2 text-sm font-bold">Answer before Day {a.deadline} ({Math.max(0, a.deadline - day)} days left) or the crowd gets worse.</p>
              <div className="mt-2 text-sm font-bold">Police posture</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {POLICE.map((x) => (
                  <button key={x.id} className={`rounded-xl border-2 border-ink p-2 text-left ${police === x.id ? 'bg-saffron' : 'bg-white'}`} onClick={() => setPolice(x.id)} disabled={fallen}>
                    <div className="font-bold">{x.label} · {x.cost ? crore(x.cost) : 'free'}</div>
                    <div className="text-xs opacity-80">{x.note}</div>
                  </button>
                ))}
              </div>
              <div className="mt-3 text-sm font-bold">Your answer</div>
              <div className="mt-1 space-y-1">
                {def.options.map((o, i) => (
                  <button key={o.label} className="btn w-full !justify-start text-left" disabled={fallen || o.cost + pol.cost > gov.treasury} onClick={() => respondProtest(i, police)}>
                    <span className="block font-bold">{o.label}</span>
                    <span className="block text-xs font-normal">{o.note} Total with police: {crore(o.cost + pol.cost)}.</span>
                  </button>
                ))}
              </div>
              <div className="mt-1 text-xs opacity-70">Treasury: {crore(gov.treasury)}</div>
            </>
          ) : (
            <p className="mt-2 text-sm font-bold">The crowd is going home. {a.outcome === 'clash' ? 'There were clashes.' : a.outcome === 'damage' ? 'Some property was damaged.' : 'It stayed peaceful.'}</p>
          )}
        </div>
      )}
      {!a && <p className="rounded-xl border-2 border-ink bg-white p-2 text-sm">No protest outside right now. Watch public anger: jobs, prices, taxes, services, farm spending, scandals and broken promises all feed it.</p>}

      <div>
        <div className="font-bold">Government promises</div>
        {pending.length === 0 && done.length === 0 && <p className="text-sm opacity-70">You have not promised anything yet.</p>}
        <ul className="space-y-1">
          {pending.map((x) => {
            const ok = promiseMet(x, gov);
            return (
              <li key={x.id} className="rounded-xl border-2 border-ink bg-white p-2 text-sm">
                <b>{x.text}</b> by Day {x.deadline} ({Math.max(0, x.deadline - day)} days left).{' '}
                <span className={ok ? 'font-bold text-green-700' : 'font-bold text-berry'}>{ok ? 'On track right now' : 'Not met yet'}</span>
              </li>
            );
          })}
          {done.map((x) => (
            <li key={x.id} className="rounded-xl border-2 border-ink bg-white p-2 text-sm opacity-80">{x.status === 'kept' ? '✔ Kept' : '✘ Broken'}: {x.text}</li>
          ))}
        </ul>
      </div>

      {p.log.length > 0 && (
        <div>
          <div className="font-bold">Past protests</div>
          <ul className="space-y-1 text-sm">
            {[...p.log].reverse().slice(0, 5).map((r) => (
              <li key={`${r.cause}-${r.day}`} className="rounded-xl border-2 border-ink bg-white p-2">
                Day {r.day}: {CAUSE_BY_ID[r.cause].name}, {r.size.toLocaleString()} people. {r.choice === null ? 'No answer.' : CAUSE_BY_ID[r.cause].options[r.choice].label + '.'} Police: {r.police}.{' '}
                {r.outcome === 'clash' ? `Clashes: ${r.injuries.toLocaleString()} injured, ${r.arrests.toLocaleString()} arrested.` : r.outcome === 'damage' ? 'Property damage.' : 'Peaceful.'} Approval {r.approvalChange > 0 ? '+' : ''}{r.approvalChange}.
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
