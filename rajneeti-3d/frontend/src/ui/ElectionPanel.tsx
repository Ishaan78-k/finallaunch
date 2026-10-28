import { useMemo, useState } from 'react';
import { buildElectionContext, useGameStore } from '../state/gameStore';
import { Modal } from './Panels';
import { MAJORITY_SEATS, MINISTRIES, TOTAL_CONSTITUENCIES } from '../data/constants';
import { MAX_AD_SPEND, MAX_RALLIES, MIN_AD_SPEND, RALLY_COST, campaignOpen, localBoost, nationalBoost } from '../simulation/election/campaign';
import { battlegrounds, pollProjection } from '../simulation/election/model';
import { coalitionOffers, standings } from '../simulation/election/coalition';
import { IND_ID, PLAYER_ID, type ElectionContext, type ElectionResult } from '../simulation/election/types';
import { daysUntilElection } from '../simulation/calendar/clock';
import { windowOf, type TermState } from '../simulation/world/term';

type Tab = 'overview' | 'campaign' | 'alliances' | 'results' | 'government';

interface Meta { name: string; abbreviation: string; color: string }

function metaFor(ctx: ElectionContext, id: string): Meta {
  if (id === PLAYER_ID) return { name: ctx.player.name, abbreviation: ctx.player.abbreviation, color: ctx.player.color };
  if (id === IND_ID) return { name: 'Independents', abbreviation: 'IND', color: '#8a8fa3' };
  const r = ctx.rivals.find((x) => x.id === id);
  return r ? { name: r.name, abbreviation: r.abbreviation, color: r.color } : { name: id, abbreviation: id, color: '#8a8fa3' };
}

const fmt = (n: number): string => n.toLocaleString();
const label = (s: string): string => s.replace(/-/g, ' ');

function SeatBars({ ctx, seats, note }: { ctx: ElectionContext; seats: Record<string, number>; note?: string }) {
  const ids = [PLAYER_ID, ...ctx.rivals.map((r) => r.id), IND_ID].filter((id) => id !== IND_ID || (seats[IND_ID] ?? 0) > 0);
  ids.sort((a, b) => (seats[b] ?? 0) - (seats[a] ?? 0));
  return (
    <div className="space-y-1">
      {ids.map((id) => {
        const m = metaFor(ctx, id);
        const n = seats[id] ?? 0;
        return (
          <div key={id} className="flex items-center gap-2 text-sm">
            <span className="w-14 shrink-0 font-bold">{m.abbreviation}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded-full border-2 border-ink bg-white">
              <div className="h-full" style={{ width: `${(n / TOTAL_CONSTITUENCIES) * 100}%`, background: m.color }} />
              <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${(MAJORITY_SEATS / TOTAL_CONSTITUENCIES) * 100}%` }} title={`Majority: ${MAJORITY_SEATS}`} />
            </div>
            <span className="w-8 text-right font-bold">{n}</span>
          </div>
        );
      })}
      <div className="text-xs opacity-70">The black line marks the {MAJORITY_SEATS} seats needed for a majority. {note}</div>
    </div>
  );
}

function seasonLine(day: number, t: TermState): string {
  if (t.held) return `This election has been held. The next one is due on Day ${t.nextElectionDay}.`;
  if (day < t.campaignStartDay) return `Campaign season opens on Day ${t.campaignStartDay} (${t.campaignStartDay - day} days away).`;
  if (campaignOpen(day, windowOf(t))) return `Campaign season is open until Day ${t.electionDay - 1}. Rallies and ads can still change seats.`;
  return `Election day has arrived (Day ${t.electionDay}).`;
}

export function ElectionPanel() {
  const s = useGameStore();
  const [tab, setTab] = useState<Tab>(s.term.held && s.election ? (s.election.stage === 'hung' ? 'government' : 'results') : 'overview');
  const ctx = useMemo(
    () => buildElectionContext(s),
    [s.seed, s.clock.day, s.constituencies, s.members, s.assignments, s.party, s.popularity, s.campaign, s.term, s.election, s.government, s.opposition],
  );
  const held = s.term.held;
  const term = s.term;
  const poll = useMemo(() => (held ? null : pollProjection(ctx)), [ctx, held]);
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'campaign', label: 'Campaign', show: !held },
    { id: 'alliances', label: 'Political Alliances', show: !held },
    { id: 'results', label: 'Results', show: !!s.election },
    { id: 'government', label: 'Government', show: !!s.election },
  ];
  const assigned = Object.keys(s.assignments).length;
  const day = s.clock.day;

  return (
    <Modal title="Election & Campaign Centre" onClose={() => s.setPanel(null)} wide>
      <div className="mb-3 flex flex-wrap gap-1">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} className={`btn !min-h-0 !px-3 !py-1 text-base ${tab === t.id ? 'btn-primary' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <span className="chip ml-auto">Funds ₹{s.funds} crore</span>
      </div>

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-ink bg-white p-2">
            <div className="font-extrabold">{held ? `Election ${term.number} has been held.` : `Election ${term.number} in ${daysUntilElection(s.clock, term.electionDay)} days (Day ${term.electionDay})`}</div>
            <div className="text-sm">{seasonLine(day, term)}</div>
            {!held && assigned < TOTAL_CONSTITUENCIES && <div className="mt-1 text-sm font-bold text-berry">{TOTAL_CONSTITUENCIES - assigned} constituencies have no official candidate. You get no votes in those seats.</div>}
          </div>
          {poll ? <><h3 className="text-lg font-extrabold">Poll estimate</h3><SeatBars ctx={ctx} seats={poll.seats} note="Polls are rough and can be wrong by many seats." /></> : s.election && <SeatBars ctx={ctx} seats={s.election.result.seats} />}
          {!held && (
            <div className="flex flex-col gap-2">
              {day < term.campaignStartDay && <button className="btn" onClick={() => s.jumpToDay(term.campaignStartDay)}>Fast-forward to campaign season (Day {term.campaignStartDay})</button>}
              {day < term.electionDay && <button className="btn" onClick={() => { if (window.confirm('Skip ahead to election day? Campaign time you skip cannot be used.')) s.jumpToDay(term.electionDay); }}>Fast-forward to election day (Day {term.electionDay})</button>}
              <button className="btn btn-primary" disabled={day < term.electionDay} onClick={() => { s.holdElection(); setTab('results'); }}>
                {day < term.electionDay ? `Voting opens on Day ${term.electionDay}` : 'Hold the national election'}
              </button>
            </div>
          )}
          {s.pastElections.length > 0 && (
            <div>
              <h3 className="text-lg font-extrabold">Election history</h3>
              <ul className="space-y-1 text-sm">
                {[...s.pastElections].reverse().map((p) => (
                  <li key={p.term} className="rounded-lg border-2 border-ink bg-white px-2 py-1">
                    <span className="font-bold">Election {p.term}{p.early ? ' (early)' : ''}, Day {p.day}:</span> you won {p.seats[PLAYER_ID] ?? 0} seats ({p.voteShare[PLAYER_ID] ?? 0}%).{' '}
                    {p.leaderId ? (p.playerRole === 'leader' ? 'You formed the government.' : `${metaFor(ctx, p.leaderId).name} led the government (you were ${p.playerRole === 'partner' ? 'a junior partner' : 'in opposition'}).`) : 'Hung parliament.'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'campaign' && !held && <CampaignTab ctx={ctx} poll={poll!} />}
      {tab === 'alliances' && !held && <AllianceTab ctx={ctx} />} 
      {tab === 'results' && s.election && <ResultsTab ctx={ctx} result={s.election.result} />}
      {tab === 'government' && s.election && <GovernmentTab ctx={ctx} />}
    </Modal>
  );
}


function AllianceTab({ ctx }: { ctx: ElectionContext }) {
  const s = useGameStore();
  const seats = s.constituencies.slice(0, 24);
  return <div className="space-y-3"><div className="rounded-xl border-2 border-ink bg-white p-2"><b>Pre-election alliance negotiations</b><p className="text-sm">Send a proposal, then allocate selected constituencies to an accepted partner. Your party will not contest an offered seat.</p></div>{ctx.rivals.map((r) => { const joined = s.preElectionAlliances.includes(r.id); return <div key={r.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-white p-2"><div><b>{r.name} ({r.abbreviation})</b><div className="text-sm">Strength {r.strength}% · ideology {label(r.ideology)} · leader style: {r.personality} · {joined ? 'Alliance agreed' : 'No agreement'}</div></div><button className="btn btn-primary !min-h-0 !py-1" disabled={joined} onClick={() => s.proposeAlliance(r.id)}>{joined ? 'Partner' : 'Send proposal'}</button></div>; })}<h3 className="text-lg font-extrabold">Seat-sharing table</h3>{s.preElectionAlliances.length === 0 && <p className="text-sm">Accept an alliance before allocating seats.</p>}{seats.map((c) => <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border-2 border-ink bg-white px-2 py-1 text-sm"><span><b>{c.id}</b> {c.name}</span><select className="rounded-lg border-2 border-ink bg-white px-1" value={s.seatSharing[c.id] ?? 'PLAYER'} onChange={(e) => e.target.value !== 'PLAYER' && s.setSeatShare(c.id, e.target.value)}><option value="PLAYER">Your party</option>{s.preElectionAlliances.map((id) => <option key={id} value={id}>{id}</option>)}</select></div>)}</div>;
}

function CampaignTab({ ctx, poll }: { ctx: ElectionContext; poll: ElectionResult }) {
  const s = useGameStore();
  const open = campaignOpen(s.clock.day, windowOf(s.term));
  const spots = useMemo(() => battlegrounds(poll, 12), [poll]);
  const nameOf = (id: string): string => s.constituencies.find((c) => c.id === id)?.name ?? id;
  return (
    <div className="space-y-3">
      <p className="text-sm">{seasonLine(s.clock.day, s.term)} You have spent ₹{s.campaign.totalSpent} crore so far. Spending has diminishing returns, so target close races.</p>
      <div className="rounded-xl border-2 border-ink bg-white p-2">
        <div className="font-extrabold">National advertising</div>
        <div className="text-sm">Spent ₹{s.campaign.nationalSpend} crore · adds about +{nationalBoost(s.campaign.nationalSpend).toFixed(1)} popularity points in every seat (max 4).</div>
        <div className="mt-1 flex flex-wrap gap-2">
          {[2, 5, 10].map((n) => <button key={n} className="btn !min-h-0 !py-1 text-base" disabled={!open} onClick={() => s.nationalAds(n)}>₹{n} crore</button>)}
        </div>
      </div>
      <h3 className="text-lg font-extrabold">Closest races where you stand</h3>
      {spots.length === 0 && <p className="text-sm">You have no official candidates yet. Assign tickets in the Candidate Selection Room first.</p>}
      <ul className="space-y-2">
        {spots.map((b) => {
          const l = s.campaign.local[b.constituencyId];
          const leading = b.leader === PLAYER_ID;
          return (
            <li key={b.constituencyId} className="rounded-xl border-2 border-ink bg-white p-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-bold">{b.constituencyId} {nameOf(b.constituencyId)}</span>
                <span className={`chip ${leading ? '' : 'opacity-80'}`}>{leading ? `You lead by ${b.marginPct}` : `You trail by ${b.marginPct}`} · your share {b.playerShare}%</span>
              </div>
              <div className="text-sm">Rallies {l?.rallies ?? 0}/{MAX_RALLIES} · ads ₹{l?.adSpend ?? 0}/{MAX_AD_SPEND} crore · boost +{localBoost(l).toFixed(1)}</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <button className="btn !min-h-0 !py-1 text-base" disabled={!open} onClick={() => s.rallyAt(b.constituencyId)}>Rally (₹{RALLY_COST} crore)</button>
                <button className="btn !min-h-0 !py-1 text-base" disabled={!open} onClick={() => s.adsAt(b.constituencyId, 1)}>Ads (₹1 crore)</button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs opacity-70">Minimum ad purchase ₹{MIN_AD_SPEND} crore. Each rally lifts turnout slightly too.</p>
    </div>
  );
}

function ResultsTab({ ctx, result }: { ctx: ElectionContext; result: ElectionResult }) {
  const s = useGameStore();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string>(result.constituencies[0]?.constituencyId ?? '');
  const rows = result.constituencies.filter((r) => {
    const c = s.constituencies.find((x) => x.id === r.constituencyId);
    const text = `${r.constituencyId} ${c?.name ?? ''}`.toLowerCase();
    return text.includes(q.toLowerCase());
  });
  const sel = result.constituencies.find((r) => r.constituencyId === selected);
  const selName = s.constituencies.find((c) => c.id === selected)?.name ?? '';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border-2 border-ink bg-white p-2"><div className="text-sm font-bold opacity-70">Your seats</div><div className="text-xl font-extrabold">{result.seats[PLAYER_ID] ?? 0} / {TOTAL_CONSTITUENCIES}</div></div>
        <div className="rounded-xl border-2 border-ink bg-white p-2"><div className="text-sm font-bold opacity-70">Your vote share</div><div className="text-xl font-extrabold">{result.voteShare[PLAYER_ID] ?? 0}%</div></div>
        <div className="rounded-xl border-2 border-ink bg-white p-2"><div className="text-sm font-bold opacity-70">Turnout</div><div className="text-xl font-extrabold">{result.turnout}%</div></div>
      </div>
      <SeatBars ctx={ctx} seats={result.seats} />
      <div className="text-sm">
        {[PLAYER_ID, ...ctx.rivals.map((r) => r.id), IND_ID].map((id) => `${metaFor(ctx, id).abbreviation} ${result.voteShare[id] ?? 0}%`).join(' · ')}
      </div>
      <h3 className="text-lg font-extrabold">Constituency results</h3>
      <input className="w-full rounded-lg border-2 border-ink bg-white px-2 py-1" placeholder="Search constituency" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="max-h-48 overflow-y-auto rounded-lg border-2 border-ink bg-white">
        {rows.map((r) => (
          <li key={r.constituencyId}>
            <button className={`flex w-full justify-between gap-2 px-2 py-1 text-left ${r.constituencyId === selected ? 'bg-saffron/60' : ''}`} onClick={() => setSelected(r.constituencyId)}>
              <span className="font-bold">{r.constituencyId} {s.constituencies.find((c) => c.id === r.constituencyId)?.name}</span>
              <span className="text-sm">{metaFor(ctx, r.winnerParty).abbreviation} +{fmt(r.margin)}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="p-2 text-sm">No constituency matches.</li>}
      </ul>
      {sel && (
        <div className="rounded-xl border-2 border-ink bg-white p-2">
          <div className="font-extrabold">{sel.constituencyId} {selName} <span className="text-sm font-bold opacity-70">{fmt(sel.cast)} of {fmt(sel.eligible)} voted</span></div>
          <ul className="mt-1 space-y-1 text-sm">
            {sel.entries.map((e, i) => (
              <li key={e.key} className="flex justify-between gap-2">
                <span className={i === 0 ? 'font-extrabold' : ''}>{i === 0 ? '★ ' : ''}{e.candidateName} <span className="opacity-70">({metaFor(ctx, e.partyId).abbreviation})</span></span>
                <span>{fmt(e.votes)} · {e.share}%</span>
              </li>
            ))}
          </ul>
          {!sel.playerContested && <div className="mt-1 text-sm font-bold text-berry">Your party had no candidate here.</div>}
        </div>
      )}
    </div>
  );
}

function GovernmentTab({ ctx }: { ctx: ElectionContext }) {
  const s = useGameStore();
  const election = s.election;
  const [picked, setPicked] = useState<string[]>([]);
  if (!election) return null;
  const mySeats = election.result.seats[PLAYER_ID] ?? 0;

  if (election.stage === 'formed' && election.government) {
    const g = election.government;
    const group = [g.leaderId, ...g.partners];
    return (
      <div className="space-y-2">
        <div className="rounded-xl border-2 border-ink bg-white p-2">
          <div className="text-xl font-extrabold">{metaFor(ctx, g.leaderId).name} leads a {g.type} government</div>
          <div className="text-sm">{g.seats} seats{g.type === 'minority' ? ` (short of ${MAJORITY_SEATS}; it survives on outside support)` : ''}</div>
          <div className="mt-1 font-bold">{g.playerRole === 'leader' ? 'You are the head of government.' : g.playerRole === 'partner' ? 'Your party is a junior coalition partner.' : 'You lead the opposition.'}</div>
        </div>
        <ul className="space-y-1">
          {group.map((id) => (
            <li key={id} className="flex items-center justify-between rounded-lg border-2 border-ink bg-white px-2 py-1">
              <span className="flex items-center gap-2 font-bold"><span className="h-4 w-4 rounded-full border-2 border-ink" style={{ background: metaFor(ctx, id).color }} />{metaFor(ctx, id).name}{id === g.leaderId ? ' (leader)' : ''}</span>
              <span className="text-sm">{election.result.seats[id] ?? 0} seats · {g.ministries[id] ?? 0} of {MINISTRIES} ministries</span>
            </li>
          ))}
        </ul>
        {g.playerRole === 'leader'
            ? <button className="btn btn-primary mt-2" onClick={() => s.setPanel('government')}>Open the Prime Minister's Office</button>
            : <p className="text-sm">Prime Minister mode is available when you lead the government.</p>}
      </div>
    );
  }

  const offers = coalitionOffers(election.result, ctx.rivals, ctx.player, s.seed);
  const blocs = standings(election.result, ctx.rivals, ctx.player);
  const total = mySeats + picked.reduce((sum, id) => sum + (blocs.find((b) => b.id === id)?.seats ?? 0), 0);
  const toggle = (id: string): void => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-ink bg-white p-2">
        <div className="text-xl font-extrabold">Hung parliament</div>
        <div className="text-sm">No party has {MAJORITY_SEATS} seats. You hold {mySeats}. Choose partners to reach a majority, or sit in opposition and let the others try.</div>
        <div className="mt-1 font-bold">Your group: {total} / {MAJORITY_SEATS} seats</div>
      </div>
      <ul className="space-y-2">
        {offers.map((o) => (
          <li key={o.bloc.id} className="rounded-xl border-2 border-ink bg-white p-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={picked.includes(o.bloc.id)} onChange={() => toggle(o.bloc.id)} />
              <span className="h-4 w-4 rounded-full border-2 border-ink" style={{ background: o.bloc.color }} />
              <span className="font-bold">{o.bloc.name}</span>
              <span className="ml-auto text-sm">{o.bloc.seats} seats</span>
            </label>
            <div className="text-sm">{label(o.bloc.ideology)} · outlook match {Math.round(o.compatibility * 100)}% · {o.willing ? 'open to a deal with you' : 'unlikely to join you'}</div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <button className="btn btn-primary" disabled={picked.length === 0} onClick={() => s.negotiateCoalition(picked)}>Try to form a government with these partners</button>
        <button className="btn" onClick={() => { if (window.confirm('Sit in opposition? The other parties will form a government without you.')) s.joinOpposition(); }}>Sit in opposition</button>
      </div>
      <p className="text-xs opacity-70">If the largest party in a group is not yours, it leads the government and you join as a junior partner. A deal fails if any partner refuses to serve under the leader.</p>
    </div>
  );
}
