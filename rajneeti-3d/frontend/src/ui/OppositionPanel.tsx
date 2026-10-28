import { useMemo } from 'react';
import { buildElectionContext, useGameStore } from '../state/gameStore';
import { Modal } from './Panels';
import { MAJORITY_SEATS } from '../data/constants';
import { IND_ID, PLAYER_ID } from '../simulation/election/types';
import { NO_CONFIDENCE_APPROVAL, NO_CONFIDENCE_COOLDOWN, OPPOSITION_ACTIONS, actionReady, governmentSupport } from '../simulation/world/opposition';

function Meter({ name, value, color, note }: { name: string; value: number; color: string; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-white p-2">
      <div className="flex justify-between text-sm font-bold"><span>{name}</span><span>{value}%</span></div>
      <div className="mt-1 h-4 overflow-hidden rounded-full border-2 border-ink bg-white"><div className="h-full" style={{ width: `${value}%`, background: color }} /></div>
      {note && <div className="mt-1 text-xs opacity-70">{note}</div>}
    </div>
  );
}

export function OppositionPanel() {
  const s = useGameStore();
  const opp = s.opposition;
  const outcome = s.election;
  const gov = outcome?.government ?? null;
  const ec = useMemo(() => buildElectionContext(s), [s.seed, s.clock.day, s.members, s.assignments, s.term, s.election, s.opposition, s.popularity]);

  if (!opp || !outcome || !gov) {
    return (
      <Modal title="Opposition Office" onClose={() => s.setPanel(null)}>
        <p>You are not leading the opposition. This office opens when another party forms the government and you do not join it.</p>
      </Modal>
    );
  }

  const leader = gov.leaderId === PLAYER_ID ? s.party.name : (gov.leaderId === IND_ID ? 'Independents' : ec.rivals.find((r) => r.id === gov.leaderId)?.name ?? gov.leaderId);
  const ideologies: Record<string, typeof ec.player.ideology> = { [PLAYER_ID]: ec.player.ideology, [IND_ID]: 'centrist-governance' };
  for (const r of ec.rivals) ideologies[r.id] = r.ideology;
  const support = governmentSupport({ seed: ec.seed, government: gov, seats: outcome.result.seats, ideologies }, opp.rulingApproval, s.clock.day);
  const motionWait = opp.motionDay === null ? 0 : Math.max(0, NO_CONFIDENCE_COOLDOWN - (s.clock.day - opp.motionDay));
  const motionWhy = opp.rulingFallen ? 'The government has fallen.'
    : motionWait > 0 ? `Wait ${motionWait} more days`
    : opp.rulingApproval >= NO_CONFIDENCE_APPROVAL ? `Needs ruling approval below ${NO_CONFIDENCE_APPROVAL}%`
    : null;

  return (
    <Modal title="Leader of the Opposition" onClose={() => s.setPanel(null)} wide>
      <p className="mb-2 font-bold">{leader} leads a {gov.type} government with {gov.seats} seats. You hold {outcome.result.seats[PLAYER_ID] ?? 0}.</p>

      {opp.rulingFallen && (
        <div className="mb-3 rounded-xl border-2 border-ink bg-[#bdf0c4] p-3 font-bold">
          The government has fallen. The country must vote again.
          <button className="btn btn-primary mt-2 block" onClick={() => { s.callEarlyElection(); s.setPanel('election'); }}>Call an early election</button>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Meter name="Ruling government approval" value={opp.rulingApproval} color="#d62839" note={`A motion of no confidence needs this below ${NO_CONFIDENCE_APPROVAL}%.`} />
        <Meter name="Your standing as opposition" value={opp.standing} color={s.party.color} note={`Your party popularity is ${s.popularity}%.`} />
      </div>

      <h3 className="mb-1 mt-3 text-lg font-extrabold">Take action <span className="text-sm font-bold opacity-70">(party funds ₹{s.funds} crore)</span></h3>
      <ul className="space-y-2">
        {OPPOSITION_ACTIONS.map((a) => {
          const wait = actionReady(opp, a.id, s.clock.day);
          return (
            <li key={a.id} className="rounded-xl border-2 border-ink bg-white p-2">
              <div className="font-extrabold">{a.name} <span className="text-sm font-bold opacity-70">₹{a.cost} crore</span></div>
              <div className="text-sm">{a.text}</div>
              <button className="btn mt-1" disabled={opp.rulingFallen || wait > 0 || a.cost > s.funds} onClick={() => s.oppose(a.id)}>
                {wait > 0 ? `Ready in ${wait} days` : a.cost > s.funds ? 'Not enough funds' : 'Do it'}
              </button>
            </li>
          );
        })}
      </ul>

      <h3 className="mb-1 mt-3 text-lg font-extrabold">No-confidence motion</h3>
      <div className="rounded-xl border-2 border-ink bg-white p-2">
        <div className="text-sm">
          The government has {support.own} seats of its own. If it looks unpopular enough, some of its MPs will rebel. It needs {MAJORITY_SEATS} votes to survive.
          Right now it would likely muster about <b>{support.support}</b>.
        </div>
        <button className="btn btn-primary mt-1" disabled={!!motionWhy} onClick={() => { if (window.confirm('Move a no-confidence motion? If it fails, your standing drops.')) s.noConfidence(); }}>
          {motionWhy ?? 'Move the motion'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn" onClick={() => s.skipDays(7)}>Skip 7 days</button>
        <button className="btn" onClick={() => s.skipDays(30)}>Skip 30 days</button>
        <button className="btn" onClick={() => s.skipDays(90)}>Skip 90 days</button>
        <button className="btn" onClick={() => s.skipDays(365)}>Skip a year</button>
      </div>
      <p className="mt-1 text-xs opacity-70">Day {s.clock.day}. Next scheduled election: Day {s.term.held ? s.term.nextElectionDay : s.term.electionDay}.</p>

      <h3 className="mb-1 mt-3 text-lg font-extrabold">Recent events</h3>
      <ul className="space-y-1 text-sm">
        {opp.history.slice(0, 8).map((h, i) => <li key={i} className="rounded-lg border-2 border-ink bg-white px-2 py-1">{h}</li>)}
      </ul>
    </Modal>
  );
}
