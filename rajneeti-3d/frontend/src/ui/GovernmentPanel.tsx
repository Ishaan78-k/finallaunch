import { useMemo, useState } from 'react';
import { buildElectionContext, buildGovContext, useGameStore } from '../state/gameStore';
import { Modal } from './Panels';
import { MAJORITY_SEATS, TOTAL_CONSTITUENCIES } from '../data/constants';
import { IND_ID, PLAYER_ID } from '../simulation/election/types';
import { canRun, canPropose, groupMinistries, govSeats } from '../simulation/government/state';
import { eligibleMinisters, ministerScore, ministryOwners, cabinetQuality } from '../simulation/government/cabinet';
import { monthlyInterest, monthlyRevenue, monthlySpending } from '../simulation/government/economy';
import { CRISIS_BY_ID, ministerEffect } from '../simulation/world/crises';
import { ProtestTab } from './ProtestTab';
import { BILLS, DEFAULT_SPENDING, MINISTRY_DEFS, SECTORS, TAX_LIMITS, type Taxes } from '../simulation/government/types';

type Tab = 'overview' | 'meetings' | 'crises' | 'protests' | 'budget' | 'cabinet' | 'parliament' | 'allies';

const crore = (n: number): string => `₹${Math.round(n).toLocaleString()} cr`;
const label = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function Stat({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-white p-2">
      <div className="text-xs font-bold opacity-70">{name}</div>
      <div className="text-lg font-extrabold">{value}</div>
      {note && <div className="text-xs opacity-70">{note}</div>}
    </div>
  );
}

function Stepper({ name, value, onMinus, onPlus, minusOff, plusOff }: { name: string; value: string; onMinus: () => void; onPlus: () => void; minusOff?: boolean; plusOff?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-ink bg-white px-2 py-1">
      <span className="font-bold">{name}</span>
      <span className="flex items-center gap-2">
        <button className="btn !px-3 !py-0" disabled={minusOff} onClick={onMinus}>−</button>
        <span className="w-24 text-center font-extrabold">{value}</span>
        <button className="btn !px-3 !py-0" disabled={plusOff} onClick={onPlus}>+</button>
      </span>
    </div>
  );
}

export function GovernmentPanel() {
  const s = useGameStore();
  const [tab, setTab] = useState<Tab>('overview');
  const gov = s.government;
  const outcome = s.election;

  const ctx = useMemo(() => buildGovContext(s), [s.seed, s.election, s.members, s.clock.day]);
  const meta = useMemo(() => {
    const ec = buildElectionContext(s);
    const m: Record<string, { name: string; abbreviation: string; color: string }> = {
      [PLAYER_ID]: { name: ec.player.name, abbreviation: ec.player.abbreviation, color: ec.player.color },
      [IND_ID]: { name: 'Independents', abbreviation: 'IND', color: '#8a8fa3' },
    };
    for (const r of ec.rivals) m[r.id] = { name: r.name, abbreviation: r.abbreviation, color: r.color };
    return m;
  }, [s.seed, s.party]);
  const name = (id: string): string => meta[id]?.name ?? id;

  if (!outcome || outcome.stage !== 'formed' || !outcome.government) {
    return (
      <Modal title="Government Office" onClose={() => s.setPanel(null)}>
        <p>No government has been formed yet. Hold the election and settle the coalition first.</p>
      </Modal>
    );
  }
  if (!canRun(outcome.government) || !gov || !ctx) {
    const g = outcome.government;
    return (
      <Modal title="Government Office" onClose={() => s.setPanel(null)}>
        <p className="font-bold">{name(g.leaderId)} leads the government.</p>
        <p className="mt-2">{g.playerRole === 'opposition' ? 'You lead the opposition. Question the government, hold protests, and move a no-confidence motion from the Opposition Office.' : 'Government systems are unavailable until the coalition is formed.'}</p>
        {g.playerRole === 'opposition' && <button className="btn btn-primary mt-3 w-full" onClick={() => s.setPanel('opposition')}>Open the Opposition Office</button>}
      </Modal>
    );
  }

  if (outcome.government.playerRole === 'partner') {
    const partnerPosts = groupMinistries(gov, ctx)[PLAYER_ID] ?? 0;
    const partnerMembers = s.members.filter((m) => m.status === 'active' && m.role !== 'volunteer');
    const owned = Object.entries(ministryOwners({ ...ctx.government, partners: gov.partners, ministries: groupMinistries(gov, ctx) })).filter(([id, owner]) => owner === PLAYER_ID && !gov.ministryRemoved.includes(id)).map(([id]) => id);
    return (
      <Modal title="Coalition Minister Office" onClose={() => s.setPanel(null)} wide>
        <div className="space-y-3">
          <div className="rounded-xl border-2 border-ink bg-[#d8f3dc] p-3"><b>{name(ctx.government.leaderId)}</b> leads the coalition. Your party controls <b>{partnerPosts}</b> ministry post(s) and cannot use PM-only powers.</div>
          <div className="grid grid-cols-2 gap-2"><Stat name="Coalition stability" value={`${Math.round(gov.satisfaction[ctx.government.leaderId] ?? 60)}/100`} /><Stat name="Government approval" value={`${gov.approval}%`} /></div>
          <h3 className="text-lg font-extrabold">Manage Assigned Ministries</h3>
          {gov.ministryRemoved.length > 0 && <div className="rounded-xl border-2 border-ink bg-[#f7c6c6] p-2 text-sm font-bold">The PM/system withdrew: {gov.ministryRemoved.map((id) => MINISTRY_DEFS.find((m) => m.id === id)?.name ?? id).join(', ')}. Improve remaining ministries and negotiate for restoration.</div>}
          {owned.length === 0 && <p className="text-sm font-bold">No ministries are currently assigned to your party.</p>}
          {owned.map((id) => { const d = MINISTRY_DEFS.find((x) => x.id === id); const holder = s.members.find((m) => m.id === gov.cabinet[id]); const metric = gov.ministryMetrics[id] ?? { performance: 55, budget: 500, complaints: 0, ministerSatisfaction: 60 }; return <div key={id} className="rounded-xl border-2 border-ink bg-white p-2"><div className="flex items-center justify-between"><b>{d?.name ?? id}</b><span className="text-sm font-bold">Performance {metric.performance}/100</span></div><div className="text-xs">Budget ₹{Math.round(metric.budget)} cr · Complaints {metric.complaints} · Minister satisfaction {metric.ministerSatisfaction}/100</div><div className="mt-1 flex gap-2"><select className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-white px-2 py-1" value={gov.cabinet[id] ?? ''} onChange={(e) => e.target.value && s.appoint(id, e.target.value)}><option value="">{holder?.name ?? 'Vacant'}</option>{partnerMembers.map((m) => <option key={m.id} value={m.id}>{m.name} · loyalty {m.loyalty}</option>)}</select>{holder && <button className="btn !px-2 !py-0" onClick={() => s.dismiss(id)}>Replace</button>}</div><div className="mt-2 flex flex-wrap gap-1"><button className="btn !px-2 !py-0 text-xs" onClick={() => s.manageMinistry(id, 'fund')}>Allocate budget</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.manageMinistry(id, 'services')}>Improve services</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.manageMinistry(id, 'recruit')}>Recruit staff</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.manageMinistry(id, 'policy')}>New policy</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.manageMinistry(id, 'complaints')}>Address complaints</button></div></div>; })}
          <div className="flex flex-wrap gap-2"><button className="btn" onClick={() => s.skipDays(7)}>Skip 7 days</button><button className="btn btn-primary" onClick={() => s.skipDays(30)}>Skip 30 days</button><button className="btn" onClick={() => s.skipDays(90)}>Skip 90 days</button><button className="btn" onClick={() => s.breakAlliance(PLAYER_ID)}>End Alliance</button></div>
          <h3 className="text-lg font-extrabold">Negotiate with the Prime Minister</h3><button className="btn btn-primary" onClick={() => s.requestMeeting()}>Request PM meeting</button>{gov.meetings.filter((m) => m.status === 'pending').map((m) => <div key={m.id} className="rounded-xl border-2 border-ink bg-white p-2 text-sm"><b>{m.personName}</b>: {m.offer}<div className="mt-1 flex gap-1"><button className="btn !px-2 !py-0 text-xs" onClick={() => s.resolveMeeting(m.id, 'accept')}>Accept</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.resolveMeeting(m.id, 'counter')}>Counteroffer</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.resolveMeeting(m.id, 'postpone')}>Postpone</button><button className="btn !px-2 !py-0 text-xs" onClick={() => s.resolveMeeting(m.id, 'reject')}>Reject</button></div></div>)}
        </div>
      </Modal>
    );
  }

  const owners = ministryOwners({ ...ctx.government, partners: gov.partners, ministries: groupMinistries(gov, ctx) });
  const fallen = gov.status === 'fallen';
  const seats = govSeats(gov, ctx);
  const quality = cabinetQuality(gov.cabinet, owners, s.members);
  const rev = monthlyRevenue(gov.economy, gov.taxes);
  const spend = monthlySpending(gov.spending);
  const interest = monthlyInterest(gov.economy);
  const balance = rev - spend - interest;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'meetings', label: 'Meetings' }, { id: 'crises', label: gov.crisis ? 'Crisis!' : 'Crises' },
    { id: 'protests', label: gov.protests.active?.status === 'open' ? 'Protest!' : 'Protests' }, { id: 'budget', label: 'Budget' }, { id: 'cabinet', label: 'Cabinet' },
    { id: 'parliament', label: 'Parliament' }, { id: 'allies', label: 'Allies' },
  ];

  return (
    <Modal title="Prime Minister's Office" onClose={() => s.setPanel(null)} wide>
      <div className="mb-3 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.id} className={`btn !px-3 !py-1 ${tab === t.id ? 'btn-primary' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {fallen && (
        <div className="mb-3 rounded-xl border-2 border-ink bg-[#f7c6c6] p-3 font-bold">
          The government has fallen. {gov.fallenReason}
          <div className="mt-1 text-sm font-normal">Policy changes are locked. The country must go back to the polls.</div>
          <button className="btn btn-primary mt-2" onClick={() => { s.callEarlyElection(); s.setPanel('election'); }}>Call an early election</button>
        </div>
      )}

      {!fallen && gov.crisis && tab !== 'crises' && (
        <button className="mb-3 w-full rounded-xl border-2 border-ink bg-[#f7c6c6] p-2 text-left font-bold" onClick={() => setTab('crises')}>
          Crisis: {CRISIS_BY_ID[gov.crisis.id].name}. Decide before Day {gov.crisis.deadline}. Tap to respond.
        </button>
      )}

      {!fallen && gov.protests.active?.status === 'open' && tab !== 'protests' && (
        <button className="mb-3 w-full rounded-xl border-2 border-ink bg-[#fff3d6] p-2 text-left font-bold" onClick={() => setTab('protests')}>
          Protest outside: {gov.protests.active.size.toLocaleString()} people. Answer before Day {gov.protests.active.deadline}. Tap to respond.
        </button>
      )}

      {tab === 'protests' && <ProtestTab />}

      {tab === 'meetings' && (
        <div className="space-y-2">
          <p className="text-sm">Private meetings let coalition partners, independents and opposition figures negotiate support, policies and ministry expectations without revealing every secret.</p><button className="btn btn-primary" onClick={() => s.requestMeeting()}>Request a private meeting</button>
          {gov.meetings.filter((m) => m.status === 'pending').map((m) => (
            <div key={m.id} className="rounded-xl border-2 border-ink bg-white p-3">
              <div className="font-extrabold">{m.personName} · {m.topic} negotiation</div>
              <div className="text-sm">From {name(m.fromPartyId)} · Trust {m.trust}/100</div>
              <div className="text-sm italic">“{m.offer}”</div>
              <div className="mt-2 flex flex-wrap gap-1">
                <button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveMeeting(m.id, 'accept')}>Accept</button>
                <button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveMeeting(m.id, 'counter')}>Counteroffer</button>
                <button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveMeeting(m.id, 'postpone')}>Postpone</button>
                <button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveMeeting(m.id, 'reject')}>Reject</button>
              </div>
            </div>
          ))}
          {gov.meetings.filter((m) => m.status === 'pending').length === 0 && <p className="text-sm font-bold">No pending private meetings.</p>}
        </div>
      )}


      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat name="Approval" value={`${gov.approval}%`} />
            <Stat name="Seats behind you" value={`${seats} / ${TOTAL_CONSTITUENCIES}`} note={seats >= MAJORITY_SEATS ? 'Majority' : `${MAJORITY_SEATS - seats} short`} />
            <Stat name="Treasury" value={crore(gov.treasury)} note="Government money, not party funds" />
            <Stat name="Growth" value={`${gov.economy.growth}%`} />
            <Stat name="Inflation" value={`${gov.economy.inflation}%`} />
            <Stat name="Unemployment" value={`${gov.economy.unemployment}%`} />
            <Stat name="Debt" value={crore(gov.economy.debt)} note={`${Math.round((gov.economy.debt / gov.economy.gdp) * 100)}% of GDP`} />
            <Stat name="Monthly balance" value={`${balance >= 0 ? '+' : '−'}${crore(Math.abs(balance))}`} />
            <Stat name="Cabinet quality" value={`${quality}/100`} />
          </div>
          {!fallen && (
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={() => s.skipDays(7)}>Skip 7 days</button>
              <button className="btn btn-primary" onClick={() => s.skipDays(30)}>Skip 30 days (one month)</button>
              <button className="btn" onClick={() => s.skipDays(90)}>Skip 90 days</button>
              <button className="btn" onClick={() => s.skipDays(365)}>Skip a year</button>
            </div>
          )}
          <p className="text-xs opacity-70">Day {s.clock.day}. The economy updates once every 30 days from when your government took office (Day {gov.startDay}). Next update: Day {gov.lastMonthDay + 30}.</p>
          <h3 className="text-lg font-extrabold">Recent events</h3>
          <ul className="space-y-1 text-sm">
            {gov.history.slice(0, 8).map((h, i) => <li key={i} className="rounded-lg border-2 border-ink bg-white px-2 py-1">{h}</li>)}
          </ul>
        </div>
      )}

      {tab === 'crises' && (
        <div className="space-y-3">
          {gov.crisis ? (() => {
            const def = CRISIS_BY_ID[gov.crisis.id];
            const mins = ministryOwners({ ...ctx.government, partners: gov.partners, ministries: groupMinistries(gov, ctx) });
            const eff = ministerEffect(def, gov.cabinet, mins, s.members, PLAYER_ID);
            const mdef = MINISTRY_DEFS.find((m) => m.id === def.ministry);
            return (
              <div className="rounded-xl border-2 border-ink bg-white p-3">
                <div className="text-xl font-extrabold">{def.name}</div>
                <p className="text-sm">{def.text}</p>
                <p className="mt-1 text-xs font-bold opacity-80">
                  Decide by Day {gov.crisis.deadline}. If you wait, it gets worse. {mdef?.name} minister: {mins[def.ministry] !== PLAYER_ID ? 'held by a partner, out of your hands' : eff > 0 ? 'strong, softens the blow' : eff < 0 ? 'weak or missing, makes it worse' : 'average'}.
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {def.options.map((o, i) => (
                    <button key={o.label} className="btn text-left" disabled={fallen || o.cost > gov.treasury} onClick={() => s.respond(i)}>
                      <span className="font-extrabold">{o.label}</span>
                      <span className="block text-sm font-normal">{o.note}{o.cost > gov.treasury ? ' (treasury too low)' : ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })() : <p className="text-sm font-bold">No crisis right now. They arrive without warning, roughly one month in six.</p>}
          <h3 className="text-lg font-extrabold">How you handled past crises</h3>
          {gov.crisisLog.length === 0 && <p className="text-sm">None yet.</p>}
          <ul className="space-y-1 text-sm">
            {[...gov.crisisLog].reverse().map((r, i) => (
              <li key={i} className="rounded-lg border-2 border-ink bg-white px-2 py-1">
                Day {r.day}: <b>{CRISIS_BY_ID[r.id].name}</b> — {r.choice === null ? 'left unanswered' : CRISIS_BY_ID[r.id].options[r.choice].label} ({r.approvalChange >= 0 ? '+' : ''}{r.approvalChange} approval)
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'budget' && (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat name="Revenue / month" value={crore(rev)} />
            <Stat name="Spending / month" value={crore(spend)} />
            <Stat name="Interest / month" value={crore(interest)} />
          </div>
          <div className={`rounded-xl border-2 border-ink p-2 text-sm font-bold ${balance >= 0 ? 'bg-[#bdf0c4]' : 'bg-[#fbe3b0]'}`}>
            {balance >= 0 ? `Surplus of ${crore(balance)} a month.` : `Deficit of ${crore(-balance)} a month. When the treasury is empty, the state borrows and debt grows.`}
          </div>
          <h3 className="text-lg font-extrabold">Taxes</h3>
          {(Object.keys(TAX_LIMITS) as (keyof Taxes)[]).map((k) => (
            <Stepper
              key={k} name={`${label(k === 'gst' ? 'GST' : k)} tax`} value={`${gov.taxes[k]}%`}
              minusOff={fallen || gov.taxes[k] <= TAX_LIMITS[k][0]} plusOff={fallen || gov.taxes[k] >= TAX_LIMITS[k][1]}
              onMinus={() => s.setTax(k, gov.taxes[k] - 1)} onPlus={() => s.setTax(k, gov.taxes[k] + 1)}
            />
          ))}
          <h3 className="text-lg font-extrabold">Monthly spending</h3>
          {SECTORS.map((k) => {
            const step = Math.round(DEFAULT_SPENDING[k] * 0.1);
            return (
              <Stepper
                key={k} name={label(k)} value={crore(gov.spending[k])}
                minusOff={fallen} plusOff={fallen}
                onMinus={() => s.setSector(k, gov.spending[k] - step)} onPlus={() => s.setSector(k, gov.spending[k] + step)}
              />
            );
          })}
          <p className="text-xs opacity-70">Each sector can go from 40% to 200% of its normal level. Infrastructure, education and agriculture help growth; health and welfare help approval; high taxes hurt both.</p>
        </div>
      )}

      {tab === 'cabinet' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-primary" disabled={fallen} onClick={() => s.autoCabinetAll()}>Auto-fill vacant posts with best available</button>
            <span className="text-sm">Cabinet quality: <b>{quality}/100</b>. Vacant posts count as 25.</span>
          </div>
          {MINISTRY_DEFS.map((d) => {
            const owner = owners[d.id];
            const mine = owner === PLAYER_ID;
            const holder = mine ? s.members.find((m) => m.id === gov.cabinet[d.id]) : undefined;
            const options = mine ? eligibleMinisters(s.members, gov.cabinet, d.id).sort((a, b) => ministerScore(b) - ministerScore(a) || a.id.localeCompare(b.id)).slice(0, 40) : [];
            return (
              <div key={d.id} className="rounded-xl border-2 border-ink bg-white p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-extrabold">{d.name}</span>
                  <span className="rounded-full border-2 border-ink px-2 text-xs font-bold" style={{ background: meta[owner]?.color, color: '#fff' }}>{meta[owner]?.abbreviation ?? owner}</span>
                </div>
                {!mine && <div className="text-sm opacity-80">Held by {name(owner)} (coalition partner).</div>}
                {mine && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <select
                      className="min-w-0 flex-1 rounded-lg border-2 border-ink bg-white px-2 py-1" disabled={fallen}
                      value={gov.cabinet[d.id] ?? ''} onChange={(e) => { if (e.target.value) s.appoint(d.id, e.target.value); }}
                    >
                      <option value="">{holder ? holder.name : '— Vacant —'}</option>
                      {options.filter((m) => m.id !== gov.cabinet[d.id]).map((m) => <option key={m.id} value={m.id}>{m.name} (skill {ministerScore(m)})</option>)}
                    </select>
                    {holder && <span className="text-sm font-bold">Skill {ministerScore(holder)}</span>}
                    {holder && <button className="btn !px-3 !py-0" disabled={fallen} onClick={() => s.dismiss(d.id)}>Dismiss</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'parliament' && (
        <div className="space-y-2">
          <p className="text-sm">Every vote is counted seat by seat. Your coalition has <b>{seats}</b> seats; a bill passes if more seats vote yes than no. Partners resent laws far from their outlook.</p>
          {BILLS.map((b) => {
            const why = canPropose(gov, b.id, s.clock.day);
            const last = [...gov.bills].reverse().find((r) => r.billId === b.id);
            return (
              <div key={b.id} className="rounded-xl border-2 border-ink bg-white p-2">
                <div className="font-extrabold">{b.name}</div>
                <div className="text-sm">{b.summary}</div>
                {last && <div className="text-xs font-bold">{last.passed ? 'Law' : 'Defeated'}: {last.yes} yes, {last.no} no, {last.abstain} abstained (Day {last.day}).</div>}
                <button className="btn mt-1" disabled={!!why || fallen} onClick={() => s.propose(b.id)}>{why ?? 'Put it to a vote'}</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'allies' && (
        <div className="space-y-2">
          <p className="text-sm">Partners stay while they feel fairly treated (ministries in line with their seats), the government is popular, and laws suit them. Below 20 they walk out and you may face a confidence vote.</p>
          <div className="rounded-xl border-2 border-ink bg-white p-2">
            <div className="font-extrabold">{name(PLAYER_ID)} (you)</div>
            <div className="text-sm">{ctx.result.seats[PLAYER_ID] ?? 0} seats · {groupMinistries(gov, ctx)[PLAYER_ID] ?? 0} ministries</div>
          </div>
          {gov.partners.length === 0 && <p className="text-sm font-bold">You govern alone.</p>}
          {gov.partners.map((p) => (
            <div key={p} className="rounded-xl border-2 border-ink bg-white p-2">
              <div className="flex items-center justify-between gap-2"><div className="font-extrabold">{name(p)}</div><button className="btn !px-2 !py-0 text-sm" disabled={fallen} onClick={() => s.breakAlliance(p)}>End alliance</button></div>
              <div className="text-sm">{ctx.result.seats[p] ?? 0} seats · {groupMinistries(gov, ctx)[p] ?? 0} ministries</div>
              <div className="mt-1 h-4 overflow-hidden rounded-full border-2 border-ink bg-white">
                <div className="h-full" style={{ width: `${gov.satisfaction[p] ?? 0}%`, background: (gov.satisfaction[p] ?? 0) < 30 ? '#d62839' : '#3a9d4a' }} />
              </div>
              <div className="text-xs">Satisfaction {gov.satisfaction[p] ?? 0}/100</div>
            </div>
          ))}
          <h3 className="mt-4 text-lg font-extrabold">Party switching desk</h3>
          <p className="text-sm">Requests show the politician, constituency, loyalty and stated reason. Anti-defection rules record the decision and trigger political consequences.</p>
          {gov.switchingRequests.filter((r) => r.status === 'pending').map((r) => (
            <div key={r.id} className="rounded-xl border-2 border-ink bg-white p-2">
              <div className="font-extrabold">{r.politicianName} · {r.direction === 'in' ? 'seeks to join the ruling party' : 'may defect to the opposition'}</div>
              <div className="text-sm">Party: {name(r.partyId)} · Constituency: {r.constituency} · Loyalty: {r.loyalty}/100</div>
              <div className="text-sm italic">“{r.reason}”</div>
              <div className="mt-1 flex flex-wrap gap-1"><button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveSwitch(r.id, 'accept')}>Accept</button><button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveSwitch(r.id, 'negotiate')}>Negotiate</button><button className="btn !px-2 !py-0 text-sm" onClick={() => s.resolveSwitch(r.id, 'reject')}>Reject</button></div>
            </div>
          ))}
          <h3 className="mt-4 text-lg font-extrabold">Minister accountability</h3>
          {Object.values(gov.cabinet).map((id) => { const m = s.members.find((x) => x.id === id); return m ? <div key={id} className="flex items-center justify-between rounded-xl border-2 border-ink bg-white p-2"><span>{m.name} · loyalty {m.loyalty}</span><button className="btn !px-2 !py-0 text-sm" onClick={() => s.resign(m.id)}>Minister resigns</button></div> : null; })}
        </div>
      )}
    </Modal>
  );
}
