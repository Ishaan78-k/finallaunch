import { useState } from 'react';
import { useGameStore } from '../state/gameStore';

const COLORS = ['#ff9f1c', '#1fa9a0', '#6c8ef5', '#e0457b', '#5cc26a', '#a78bfa'];
const PRONOUNS = ['he/him', 'she/her', 'they/them'];

export function CreateScreen() {
  const startNewGame = useGameStore((s) => s.startNewGame);
  const goTo = useGameStore((s) => s.goTo);
  const [name, setName] = useState('Arjun Rao');
  const [pronouns, setPronouns] = useState(PRONOUNS[0]);
  const [partyName, setPartyName] = useState('Bharat Vikas Dal');
  const [abbr, setAbbr] = useState('BVD');
  const [color, setColor] = useState(COLORS[0]);

  const valid = name.trim().length > 1 && partyName.trim().length > 2 && abbr.trim().length >= 2;

  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-gradient-to-b from-[#7fd3ff] to-[#ffe9b8] p-4">
      <div className="panel w-full max-w-lg">
        <h2 className="mb-1 text-3xl font-extrabold">Your Leader and Party</h2>
        <p className="mb-4 text-sm">Appearance and symbol options arrive in Phase 2; party colour decides your outfit and headquarters.</p>
        <label className="block font-bold">Leader name
          <input className="mt-1 w-full rounded-xl border-4 border-ink bg-white px-3 py-2" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="mt-3 font-bold">Form of address
          <div className="mt-1 flex gap-2">
            {PRONOUNS.map((p) => (
              <button key={p} className={`btn flex-1 !px-2 ${pronouns === p ? 'btn-primary' : ''}`} onClick={() => setPronouns(p)}>{p}</button>
            ))}
          </div>
        </div>
        <label className="mt-3 block font-bold">Party name
          <input className="mt-1 w-full rounded-xl border-4 border-ink bg-white px-3 py-2" maxLength={32} value={partyName} onChange={(e) => setPartyName(e.target.value)} />
        </label>
        <label className="mt-3 block font-bold">Abbreviation
          <input className="mt-1 w-32 rounded-xl border-4 border-ink bg-white px-3 py-2 uppercase" maxLength={5} value={abbr} onChange={(e) => setAbbr(e.target.value.toUpperCase())} />
        </label>
        <div className="mt-3 font-bold">Party colour
          <div className="mt-1 flex gap-2">
            {COLORS.map((c) => (
              <button key={c} aria-label={`Colour ${c}`} className={`h-11 w-11 rounded-full border-4 ${color === c ? 'border-ink ring-4 ring-ink/30' : 'border-white'}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button className="btn" onClick={() => goTo('menu')}>Back</button>
          <button className="btn btn-primary flex-1" disabled={!valid} onClick={() => startNewGame({ name: name.trim(), pronouns }, { name: partyName.trim(), abbreviation: abbr.trim(), color })}>Start Game</button>
        </div>
      </div>
    </div>
  );
}
