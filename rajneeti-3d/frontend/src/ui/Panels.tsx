import { useEffect, useState, type ReactNode } from 'react';
import { OBJECTIVES, useGameStore, type RecruitmentMethod } from '../state/gameStore';
import { DIALOGUES } from '../data/dialogues';
import { LOCATIONS, WORLD_HALF_SIZE } from '../data/world';
import { MAJORITY_SEATS, SAVE_SLOTS, TOTAL_CONSTITUENCIES, TOTAL_MEMBERS, type SaveSlotId } from '../data/constants';
import { daysUntilElection, formatTime } from '../simulation/calendar/clock';
import { listSaves, writeSave } from '../services/saveService';
import type { SaveData } from '../services/saveSchema';
import { nextElectionDayOf } from '../simulation/world/term';

export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/40 p-3">
      <div className={`panel max-h-[88vh] w-full overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-2xl font-extrabold">{title}</h2>
          {onClose && <button className="btn !px-3 !py-0" onClick={onClose}>✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-white p-2">
      <div className="text-sm font-bold opacity-70">{label}</div>
      <div className="text-xl font-extrabold">{value}</div>
    </div>
  );
}

export function Dashboard() {
  const s = useGameStore();
  return (
    <Modal title="President's Office — Dashboard" onClose={() => s.setPanel(null)} wide>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Party popularity" value={`${s.popularity}%`} />
        <Stat label="Party funds" value={`₹${s.funds} crore`} />
        <Stat label="Election in" value={`${daysUntilElection(s.clock, nextElectionDayOf(s.term))} days`} />
        <Stat label="Total party members" value={`${s.members.filter((m) => m.status === 'active').length}`} />
        <Stat label="Elected MPs" value={`${s.election?.result.seats.PLAYER ?? 0}`} />
        <Stat label="Party workers" value={`${s.members.filter((m) => m.status === 'active' && m.role === 'Party Worker').length}`} />
        <Stat label="Senior leaders" value={`${s.members.filter((m) => m.status === 'active' && !['Party Worker', 'Youth Wing Leader'].includes(m.role)).length}`} />
        <Stat label="Active volunteers" value={`${s.members.filter((m) => m.status === 'active' && m.role === 'Youth Wing Leader').length}`} />
        <Stat label="Constituencies" value={`${TOTAL_CONSTITUENCIES}`} />
        <Stat label="Majority needs" value={`${MAJORITY_SEATS} seats`} />
        <Stat label="Tickets assigned" value={`${Object.keys(s.assignments).length} / ${TOTAL_CONSTITUENCIES}`} />
        <Stat label="Seats won" value={s.election ? `${s.election.result.seats.PLAYER ?? 0} / ${TOTAL_CONSTITUENCIES}` : 'not held yet'} />
        <Stat label="Election cycle" value={`#${s.term.number}${s.term.held ? ' (held)' : ''}`} />
      </div>
      <h3 className="mb-1 mt-4 text-xl font-extrabold">Objectives</h3>
      <ul className="space-y-1">
        {OBJECTIVES.map((o) => {
          const done = !!s.objectives[o.id];
          return (
            <li key={o.id} className={`rounded-lg border-2 border-ink px-3 py-1 font-bold ${done ? 'bg-[#bdf0c4]' : o.available ? 'bg-white' : 'bg-white/50 opacity-60'}`}>
              {done ? '✔ ' : '○ '}{o.label}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 rounded-xl border-2 border-ink bg-white p-3"><h3 className="text-lg font-extrabold">Grow the Party</h3><p className="mb-2 text-sm">Recruitment costs party funds and advances time by seven days. New members do not automatically become MPs or increase parliamentary seats.</p><div className="grid grid-cols-2 gap-1 sm:grid-cols-3">{([['membership-campaign','Membership drive'],['youth-program','Youth programme'],['local-office','Local office'],['door-to-door','Door-to-door'],['social-media','Social media'],['recruit-politician','Recruit politician']] as [RecruitmentMethod, string][]).map(([method, label]) => <button key={method} className="btn !min-h-0 !py-1 text-sm" onClick={() => s.recruitMembers(method)}>{label}</button>)}</div></div>
      <button className="btn btn-primary mt-3 w-full" onClick={() => s.setPanel('candidates')}>Open Candidate Selection Room</button>
      <button className="btn mt-2 w-full" onClick={() => s.setPanel('election')}>Open Election &amp; Campaign Centre</button>
      {s.election?.stage === 'formed' && s.election.government?.playerRole === 'leader' && <button className="btn mt-2 w-full" onClick={() => s.setPanel('government')}>Open the Government Office</button>}
      {s.government && <button className="btn mt-2 w-full" onClick={() => s.setPanel('parliament')}>Open Parliament Chamber</button>}
      {(s.government || s.preElectionAlliances.length > 0) && <button className="btn mt-2 w-full" onClick={() => s.openWarRoom()}>Open Political War Room</button>}
      {s.opposition && <button className="btn mt-2 w-full" onClick={() => s.setPanel('opposition')}>Open the Opposition Office</button>}
      <p className="mt-2 text-sm">The manifesto unlocks in a later phase. Rooms are menu-based for now; 3D interiors are not built yet.</p>
    </Modal>
  );
}

type PhoneApp = 'news' | 'calendar' | 'popularity' | 'finance' | 'save';

export function Phone() {
  const s = useGameStore();
  const [app, setApp] = useState<PhoneApp>('news');
  const [slots, setSlots] = useState<Record<SaveSlotId, SaveData | null> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const nextDay = nextElectionDayOf(s.term);
  const left = daysUntilElection(s.clock, nextDay);

  useEffect(() => {
    if (app === 'save') listSaves().then(setSlots).catch(() => setMsg('Could not read saves.'));
  }, [app]);

  const save = async (slot: SaveSlotId) => {
    try {
      await writeSave(slot, s.toSaveData());
      setMsg(`Saved to ${slot.replace('slot', 'Slot ')}.`);
      setSlots(await listSaves());
    } catch {
      setMsg('Saving failed — is browser storage blocked?');
    }
  };

  const mySeats = s.election?.result.seats.PLAYER ?? 0;
  const news: string[] = [
    ...(s.election ? [s.election.stage === 'hung' ? `Hung parliament: ${s.party.name} holds ${mySeats} seats. Coalition talks are under way.` : `Election result: ${s.party.name} won ${mySeats} of 180 seats.`] : []),
    `${s.term.held ? 'Next election' : `Election ${s.term.number}`}: ${left} days until voters go to the polls.`,
    ...(s.government?.crisis ? ['Breaking: a national crisis is waiting for the Prime Minister.'] : []),
    ...(s.opposition ? [`The ruling party's approval stands at ${s.opposition.rulingApproval}%.`] : []),
    s.popularity >= 50 ? `Polls show ${s.party.name} gaining ground at ${s.popularity}%.` : `${s.party.name} trails at ${s.popularity}% and needs a stronger message.`,
    s.objectives['meet-secretary'] ? 'Party secretary briefs leadership on candidate selection.' : 'Supporters wonder when the party president will meet senior staff.',
  ];

  return (
    <Modal title="Smartphone" onClose={() => s.setPanel(null)}>
      <div className="mb-3 flex flex-wrap gap-1">
        {(['news', 'calendar', 'popularity', 'finance', 'save'] as PhoneApp[]).map((a) => (
          <button key={a} className={`btn !min-h-0 !px-3 !py-1 text-base capitalize ${app === a ? 'btn-primary' : ''}`} onClick={() => setApp(a)}>{a}</button>
        ))}
      </div>
      {app === 'news' && <ul className="list-disc space-y-2 pl-5">{news.map((n) => <li key={n}>{n}</li>)}</ul>}
      {app === 'calendar' && (
        <div className="space-y-1">
          <p>Today: Day {s.clock.day}, {formatTime(s.clock.minutes)}</p>
          <p className="font-bold">National election: Day {nextDay} ({left} days away)</p>
          {s.government?.crisis && <p className="font-bold text-berry">A national crisis needs your decision before Day {s.government.crisis.deadline}.</p>}
          <p className="text-sm">Campaign season opens on Day {s.term.held ? (s.term.nextElectionDay ?? 0) - 90 : s.term.campaignStartDay}.</p>
        </div>
      )}
      {app === 'popularity' && (
        <div>
          <div className="h-6 overflow-hidden rounded-full border-4 border-ink bg-white"><div className="h-full" style={{ width: `${s.popularity}%`, background: s.party.color }} /></div>
          <p className="mt-2 font-bold">{s.popularity}% national popularity</p>
        </div>
      )}
      {app === 'finance' && <p className="font-bold">Party funds: ₹{s.funds} crore. The government treasury is separate and unlocks if you form a government.</p>}
      {app === 'save' && (
        <div className="flex flex-col gap-2">
          {SAVE_SLOTS.map((slot, i) => (
            <button key={slot} className="btn text-left" onClick={() => save(slot)}>
              Save to Slot {i + 1}{slots?.[slot] ? ` (overwrite: Day ${slots[slot]!.clock.day})` : ' (empty)'}
            </button>
          ))}
        </div>
      )}
      {msg && <p className="mt-2 font-bold">{msg}</p>}
      <p className="mt-3 text-xs opacity-70">Contacts, Messages, Elections and Party apps arrive in later phases.</p>
    </Modal>
  );
}

export function WarRoomPanel() {
  const s = useGameStore();
  return <Modal title="Political War Room" onClose={() => s.setPanel(null)} wide><div className="space-y-3"><div className="rounded-xl border-2 border-ink bg-[#fff1c1] p-3"><b>Confidential strategy room</b><p className="text-sm">Coordinate coalition support, bills and emergency negotiations. Actions use the existing meeting and parliament systems.</p></div><div className="grid gap-2 sm:grid-cols-2"><button className="btn btn-primary" onClick={() => { s.requestMeeting(); s.showToast('A confidential leader meeting was requested.'); }}>Call coalition leader</button><button className="btn" onClick={() => { s.setPanel('government'); }}>Review coalition stability</button><button className="btn" onClick={() => { s.setPanel('parliament'); }}>Prepare parliamentary vote</button><button className="btn" onClick={() => s.setPanel('election')}>Review alliances and seat-sharing</button></div><h3 className="text-lg font-extrabold">Breaking News</h3><ul className="list-disc space-y-1 pl-5 text-sm"><li>Coalition leaders are monitoring ministry performance.</li><li>Parliamentary support will depend on party loyalty and ideology.</li><li>Confidential negotiations can change trust and government stability.</li></ul></div></Modal>;
}

export function ParliamentPanel() {
  const s = useGameStore();
  const vote = s.lastVote;
  return <Modal title="Parliament Chamber — Live Vote" onClose={() => s.setPanel(null)} wide>
    <div className="rounded-xl border-4 border-ink bg-[#172554] p-4 text-center text-white"><div className="text-lg font-extrabold">PARLIAMENT LIVE VOTING</div><div className="mt-2 grid grid-cols-3 gap-2"><div className="rounded-lg bg-[#15803d] p-2"><div className="text-2xl font-extrabold">{vote?.yes ?? 0}</div><div>YES</div></div><div className="rounded-lg bg-[#b91c1c] p-2"><div className="text-2xl font-extrabold">{vote?.no ?? 0}</div><div>NO</div></div><div className="rounded-lg bg-[#ca8a04] p-2"><div className="text-2xl font-extrabold">{vote?.abstain ?? 0}</div><div>ABSTAIN</div></div></div><div className="mt-2 font-bold">Required majority: 91 · {vote ? (vote.passed ? 'MOTION PASSED' : 'MOTION DEFEATED') : 'Awaiting a bill or confidence vote'}</div></div>
    {vote && <div className="mt-3 space-y-1">{vote.rows.map((r) => <div key={r.partyId} className="rounded-lg border-2 border-ink bg-white p-2 text-sm"><b>{r.partyId}</b> · {r.seats} MPs <span className="float-right text-green-700">YES {r.yes} · NO {r.no} · ABSTAIN {r.abstain}</span></div>)}</div>}
    {!vote && <p className="mt-3 text-sm">Introduce a bill from the Government Office to begin a recorded floor vote.</p>}
  </Modal>;
}

export function MapPanel() {
  const s = useGameStore();
  const size = WORLD_HALF_SIZE * 2;
  const toXY = (x: number, z: number) => ({ cx: x + WORLD_HALF_SIZE, cy: WORLD_HALF_SIZE - z });
  const me = toXY(s.position.x, s.position.z);
  return (
    <Modal title="City Map" onClose={() => s.setPanel(null)}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full rounded-xl border-4 border-ink bg-[#9be37f]">
        <rect x={0} y={WORLD_HALF_SIZE - 4} width={size} height={8} fill="#5b5f73" />
        <rect x={WORLD_HALF_SIZE - 3} y={WORLD_HALF_SIZE} width={6} height={WORLD_HALF_SIZE} fill="#5b5f73" />
        {LOCATIONS.map((l) => {
          const p = toXY(l.x, l.z);
          return <g key={l.id}><circle cx={p.cx} cy={p.cy} r={3.2} fill={l.color} stroke="#1d2340" strokeWidth={0.8} /></g>;
        })}
        <circle cx={me.cx} cy={me.cy} r={2.4} fill="#fff" stroke="#e0457b" strokeWidth={1.2} />
      </svg>
      <ul className="mt-3 space-y-1">
        {LOCATIONS.map((l) => (
          <li key={l.id} className="flex items-center gap-2 font-bold"><span className="h-4 w-4 rounded-full border-2 border-ink" style={{ background: l.color }} />{l.label}</li>
        ))}
        <li className="flex items-center gap-2 font-bold"><span className="h-4 w-4 rounded-full border-2 border-berry bg-white" />You</li>
      </ul>
      <p className="mt-2 text-sm">Fast travel and vehicles arrive in Phase 5.</p>
    </Modal>
  );
}

export function DialoguePanel() {
  const d = useGameStore((s) => s.dialogue);
  const choose = useGameStore((s) => s.chooseDialogue);
  if (!d) return null;
  const node = DIALOGUES[d.id]?.nodes[d.nodeId];
  if (!node) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-3">
      <div className="panel w-full max-w-2xl">
        <div className="mb-1 text-lg font-extrabold text-berry">{node.speaker}</div>
        <p className="mb-3 text-lg">{node.text}</p>
        <div className="flex flex-col gap-2">
          {node.choices.map((c) => (
            <button key={c.label} className="btn text-left" onClick={() => choose(c)}>{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PausePanel({ onQuit }: { onQuit: () => void }) {
  const setPanel = useGameStore((s) => s.setPanel);
  return (
    <Modal title="Paused">
      <div className="flex flex-col gap-2">
        <button className="btn btn-primary" onClick={() => setPanel(null)}>Resume</button>
        <button className="btn" onClick={() => setPanel('phone')}>Smartphone (save here)</button>
        <button className="btn" onClick={onQuit}>Quit to Main Menu</button>
      </div>
      <p className="mt-3 text-sm">Unsaved progress is lost when you quit. Use the smartphone Save app first.</p>
    </Modal>
  );
}
