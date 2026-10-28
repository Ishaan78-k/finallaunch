import { useMemo, useState } from 'react';
import { useGameStore } from '../state/gameStore';
import { suitability } from '../simulation/candidates/suitability';
import { TOTAL_CONSTITUENCIES } from '../data/constants';
import type { Constituency, Member } from '../simulation/parties/types';

type Sort = 'suitability' | 'popularity' | 'loyalty' | 'ambition' | 'name';
const PAGE = 40;

const label = (s: string): string => s.replace(/-/g, ' ');

function Bar({ name, value }: { name: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24 shrink-0 font-bold">{name}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full border-2 border-ink bg-white"><div className="h-full bg-saffron" style={{ width: `${value}%` }} /></div>
      <span className="w-8 text-right font-bold">{Math.round(value)}</span>
    </div>
  );
}

export function CandidatePanel() {
  const members = useGameStore((s) => s.members);
  const constituencies = useGameStore((s) => s.constituencies);
  const assignments = useGameStore((s) => s.assignments);
  const log = useGameStore((s) => s.log);
  const setPanel = useGameStore((s) => s.setPanel);
  const assign = useGameStore((s) => s.assignCandidate);
  const remove = useGameStore((s) => s.removeCandidate);
  const autoAll = useGameStore((s) => s.autoAssignAll);
  const viewMember = useGameStore((s) => s.viewMember);

  const [constId, setConstId] = useState<string>(constituencies[0].id);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [cSearch, setCSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [mSearch, setMSearch] = useState('');
  const [sort, setSort] = useState<Sort>('suitability');
  const [shown, setShown] = useState(PAGE);

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const constituency: Constituency = constituencies.find((c) => c.id === constId) ?? constituencies[0];
  const taken = useMemo(() => new Set(Object.values(assignments)), [assignments]);
  const count = Object.keys(assignments).length;
  const current = assignments[constituency.id] ? byId.get(assignments[constituency.id]) : undefined;

  const visibleConsts = constituencies.filter(
    (c) => (!onlyOpen || !assignments[c.id]) && (c.name.toLowerCase().includes(cSearch.toLowerCase()) || c.id.toLowerCase().includes(cSearch.toLowerCase())),
  );

  const candidates = useMemo(() => {
    const q = mSearch.toLowerCase();
    const list = members
      .filter((m) => m.status === 'active' && !taken.has(m.id) && (m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || m.role.toLowerCase().includes(q)))
      .map((m) => ({ m, s: suitability(m, constituency) }));
    list.sort((a, b) => {
      if (sort === 'name') return a.m.name.localeCompare(b.m.name);
      if (sort === 'suitability') return b.s - a.s;
      return b.m[sort] - a.m[sort];
    });
    return list;
  }, [members, taken, mSearch, sort, constituency]);

  const selected: Member | undefined = memberId ? byId.get(memberId) : undefined;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/40 p-2">
      <div className="panel flex h-full max-h-[96vh] w-full max-w-5xl flex-col gap-2 overflow-hidden !p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xl font-extrabold">Candidate Selection Room</h2>
          <span className="chip">Tickets {count} / {TOTAL_CONSTITUENCIES}</span>
          <button className="btn !min-h-0 !py-1 text-base" onClick={() => { if (window.confirm('Fill every empty constituency automatically? Existing choices are kept.')) autoAll(); }}>Auto-select</button>
          <button className="btn !min-h-0 !px-3 !py-1" onClick={() => setPanel('dashboard')}>Back</button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">
          <section className="flex min-h-0 flex-col gap-1">
            <div className="flex gap-1">
              <input className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-white px-2 py-1" placeholder="Search constituency" value={cSearch} onChange={(e) => setCSearch(e.target.value)} />
              <label className="flex items-center gap-1 text-sm font-bold"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />Open only</label>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border-2 border-ink bg-white">
              {visibleConsts.map((c) => {
                const a = assignments[c.id] ? byId.get(assignments[c.id]) : undefined;
                return (
                  <li key={c.id}>
                    <button className={`flex w-full justify-between gap-2 px-2 py-1 text-left ${c.id === constId ? 'bg-saffron/60' : ''}`} onClick={() => setConstId(c.id)}>
                      <span className="font-bold">{c.id} {c.name}</span>
                      <span className="text-sm">{a ? a.name : <em>open</em>}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="flex min-h-0 flex-col gap-1">
            <div className="flex gap-1">
              <input className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-white px-2 py-1" placeholder="Search candidates" value={mSearch} onChange={(e) => { setMSearch(e.target.value); setShown(PAGE); }} />
              <select className="rounded-lg border-2 border-ink bg-white px-1" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort candidates">
                <option value="suitability">Best fit</option><option value="popularity">Popularity</option><option value="loyalty">Loyalty</option><option value="ambition">Ambition</option><option value="name">Name</option>
              </select>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border-2 border-ink bg-white">
              {candidates.slice(0, shown).map(({ m, s }) => (
                <li key={m.id}>
                  <button className={`flex w-full justify-between gap-2 px-2 py-1 text-left ${m.id === memberId ? 'bg-saffron/60' : ''}`} onClick={() => { setMemberId(m.id); viewMember(m.id); }}>
                    <span className="font-bold">{m.name}</span>
                    <span className="text-sm">fit {s} · pop {m.popularity} · loy {m.loyalty}</span>
                  </button>
                </li>
              ))}
              {candidates.length > shown && <li><button className="w-full py-1 font-bold" onClick={() => setShown((n) => n + PAGE)}>Show more ({candidates.length - shown} left)</button></li>}
              {candidates.length === 0 && <li className="p-2 text-sm">No available candidates match.</li>}
            </ul>
          </section>
        </div>

        <div className="grid gap-2 rounded-xl border-2 border-ink bg-white p-2 md:grid-cols-2">
          <div>
            <div className="font-extrabold">{constituency.name} <span className="text-sm font-bold opacity-70">({constituency.region}, {constituency.profile}, {constituency.classification})</span></div>
            <div className="text-sm">{constituency.eligibleVoters.toLocaleString()} voters · past party vote {constituency.historicalSupport}% · issues: {constituency.issues.join(', ')}</div>
            <Bar name="Economy" value={constituency.economy} /><Bar name="Employment" value={constituency.employment} /><Bar name="Infrastructure" value={constituency.infrastructure} />
            <div className="mt-1 text-sm font-bold">Official candidate: {current ? `${current.name} (fit ${suitability(current, constituency)})` : 'none'}</div>
          </div>
          <div>
            {selected ? (
              <>
                <div className="font-extrabold">{selected.name} <span className="text-sm font-bold opacity-70">{selected.id} · {selected.role}</span></div>
                <div className="text-sm">Age {selected.age} · {selected.experience} yrs · {selected.education} · {label(selected.ideology)} · prefers {selected.preferredConstituency} · last result {selected.previousMargin === null ? 'new' : `${selected.previousMargin > 0 ? '+' : ''}${selected.previousMargin}`}</div>
                <Bar name="Popularity" value={selected.popularity} /><Bar name="Loyalty" value={selected.loyalty} /><Bar name="Ambition" value={selected.ambition} /><Bar name="Campaigning" value={selected.campaigning} />
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="chip">Fit here: {suitability(selected, constituency)}</span>
                  <button className="btn btn-primary !min-h-0 !py-1 text-base" onClick={() => { assign(selected.id, constituency.id); setMemberId(null); }}>{current ? 'Replace candidate' : 'Assign ticket'}</button>
                </div>
              </>
            ) : <p className="text-sm">Select a candidate from the list to compare them with this constituency.</p>}
            {current && <button className="btn !min-h-0 mt-1 !py-1 text-base" onClick={() => remove(constituency.id)}>Remove current candidate</button>}
          </div>
        </div>
        {log.length > 0 && <div className="max-h-16 overflow-y-auto text-sm font-bold">{log.slice(0, 4).map((l, i) => <div key={i}>• {l}</div>)}</div>}
      </div>
    </div>
  );
}
