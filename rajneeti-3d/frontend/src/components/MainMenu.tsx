import { useEffect, useState } from 'react';
import { useGameStore, type Quality } from '../state/gameStore';
import { latestSave, listSaves, readSave } from '../services/saveService';
import { SAVE_SLOTS, type SaveSlotId } from '../data/constants';
import type { SaveData } from '../services/saveSchema';

type Modal = null | 'load' | 'settings' | 'howto' | 'credits';

function Backdrop() {
  // Lightweight animated "city" backdrop in CSS so the menu loads instantly; the 3D city loads on New Game.
  const buildings = [60, 120, 90, 160, 110, 70, 140, 100, 80, 130];
  return (
    <div className="absolute inset-0 overflow-hidden bg-gradient-to-b from-[#7fd3ff] to-[#ffe9b8]">
      <div className="absolute left-[8%] top-[10%] h-24 w-24 rounded-full bg-[#ffd34d] shadow-[0_0_60px_#ffd34d]" />
      <div className="menu-cloud absolute top-[14%] h-10 w-40 rounded-full bg-white/90" style={{ animationDuration: '60s' }} />
      <div className="menu-cloud absolute top-[26%] h-8 w-28 rounded-full bg-white/80" style={{ animationDuration: '90s', animationDelay: '-30s' }} />
      <div className="absolute bottom-0 flex w-full items-end justify-around px-2">
        {buildings.map((h, i) => (
          <div key={i} className="w-[9%] rounded-t-lg border-4 border-ink" style={{ height: h * 2, background: ['#ff9f1c', '#6c8ef5', '#1fa9a0', '#e0457b', '#ffd166'][i % 5] }} />
        ))}
      </div>
      <div className="absolute bottom-0 h-8 w-full border-t-4 border-ink bg-[#5b5f73]" />
      <style>{`@keyframes drift{from{transform:translateX(-20vw)}to{transform:translateX(120vw)}} .menu-cloud{animation:drift linear infinite}`}</style>
    </div>
  );
}

export function MainMenu() {
  const goTo = useGameStore((s) => s.goTo);
  const applySave = useGameStore((s) => s.applySave);
  const quality = useGameStore((s) => s.quality);
  const setQuality = useGameStore((s) => s.setQuality);
  const [modal, setModal] = useState<Modal>(null);
  const [latest, setLatest] = useState<SaveData | null>(null);
  const [slots, setSlots] = useState<Record<SaveSlotId, SaveData | null> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    latestSave().then(setLatest).catch(() => setLatest(null));
  }, []);

  useEffect(() => {
    if (modal === 'load') listSaves().then(setSlots).catch(() => setError('Could not read saved games.'));
  }, [modal]);

  const loadSlot = async (slot: SaveSlotId) => {
    try {
      const data = await readSave(slot);
      if (!data) { setError('That save is empty or corrupted.'); return; }
      applySave(data);
    } catch {
      setError('Could not read that save.');
    }
  };

  return (
    <div className="absolute inset-0">
      <Backdrop />
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-6 px-4">
        <div className="text-center">
          <h1 className="text-6xl font-extrabold tracking-tight text-ink drop-shadow-[0_4px_0_#fff8ea] sm:text-8xl">RAJNEETI 3D</h1>
          <p className="mt-1 text-2xl font-bold text-berry sm:text-3xl">Rise to Power</p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <button className="btn btn-primary" onClick={() => goTo('create')}>New Game</button>
          <button className="btn" disabled={!latest} onClick={() => latest && applySave(latest)}>Continue Game</button>
          <button className="btn" onClick={() => { setError(null); setModal('load'); }}>Load Game</button>
          <button className="btn" onClick={() => setModal('settings')}>Settings</button>
          <button className="btn" onClick={() => setModal('howto')}>How to Play</button>
          <button className="btn" onClick={() => setModal('credits')}>Credits</button>
          <button className="btn" onClick={() => { window.location.href = '/'; }}>Exit / Return to Website</button>
        </div>
      </div>

      {modal && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-ink/60 p-4" onClick={() => setModal(null)}>
          <div className="panel max-h-[85vh] w-full max-w-md overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {modal === 'load' && (
              <>
                <h2 className="mb-3 text-2xl font-extrabold">Load Game</h2>
                {error && <p className="mb-2 font-bold text-berry">{error}</p>}
                <div className="flex flex-col gap-2">
                  {SAVE_SLOTS.map((slot, i) => {
                    const s = slots?.[slot];
                    return (
                      <button key={slot} className="btn text-left" disabled={!s} onClick={() => loadSlot(slot)}>
                        Slot {i + 1}: {s ? `${s.player.name} — Day ${s.clock.day}, ${new Date(s.savedAt).toLocaleString()}` : 'Empty'}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {modal === 'settings' && (
              <>
                <h2 className="mb-3 text-2xl font-extrabold">Settings</h2>
                <p className="mb-2 font-bold">Graphics quality (applies on next game start)</p>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as Quality[]).map((q) => (
                    <button key={q} className={`btn flex-1 capitalize ${quality === q ? 'btn-primary' : ''}`} onClick={() => setQuality(q)}>{q}</button>
                  ))}
                </div>
                <p className="mt-3 text-sm">Low disables shadows and renders at reduced resolution, recommended for phones.</p>
              </>
            )}
            {modal === 'howto' && (
              <>
                <h2 className="mb-3 text-2xl font-extrabold">How to Play</h2>
                <ul className="list-disc space-y-1 pl-5">
                  <li>WASD to move, Shift to run, Space to jump, drag the mouse to turn the camera.</li>
                  <li>E to interact with people and buildings when a prompt appears.</li>
                  <li>P party dashboard, I smartphone, M map, Esc pause.</li>
                  <li>On touch screens use the joystick, drag to turn, and the on-screen buttons.</li>
                  <li>Phase 1 goal: enter your headquarters and meet your secretary.</li>
                </ul>
              </>
            )}
            {modal === 'credits' && (
              <>
                <h2 className="mb-3 text-2xl font-extrabold">Credits</h2>
                <p>RAJNEETI 3D is a work of fiction. All parties, people and places are invented.</p>
                <p className="mt-2">Built with React, TypeScript, Vite, Tailwind CSS and Babylon.js.</p>
              </>
            )}
            <button className="btn mt-4 w-full" onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
