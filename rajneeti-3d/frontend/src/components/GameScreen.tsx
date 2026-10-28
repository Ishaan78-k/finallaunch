import { useEffect, useRef, useState } from 'react';
import { GameEngine } from '../game/engine/GameEngine';
import { attachKeyboard } from '../game/controllers/input';
import { useGameStore } from '../state/gameStore';
import { viewOf } from '../simulation/world/protests';
import { Hud } from './Hud';
import { MobileControls } from './MobileControls';
import { CandidatePanel } from '../ui/CandidatePanel';
import { ElectionPanel } from '../ui/ElectionPanel';
import { GovernmentPanel } from '../ui/GovernmentPanel';
import { OppositionPanel } from '../ui/OppositionPanel';
import { Dashboard, DialoguePanel, MapPanel, ParliamentPanel, PausePanel, Phone, WarRoomPanel } from '../ui/Panels';

const INTERACT_MESSAGES: Record<string, string> = {
  rally: 'Campaign rallies are booked from the Election & Campaign Centre (dashboard or Election Commission).',
  park: 'A quiet park. Citizens gather here — talk to them to learn what matters.',
};

const isTouch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

export function GameScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [nearby, setNearby] = useState<string | null>(null);
  const sessionId = useGameStore((s) => s.sessionId);
  const panel = useGameStore((s) => s.panel);
  const minutes = useGameStore((s) => s.clock.minutes);
  const protest = useGameStore((s) => s.government?.protests.active ?? null);
  const reactionSeq = useGameStore((s) => s.crowdReaction?.seq ?? 0);

  // Create the 3D engine once per game session
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = useGameStore.getState();
    const engine = new GameEngine(
      canvas,
      {
        onNearby: setNearby,
        onPosition: (x, z, rotY) => useGameStore.getState().setPosition({ x, z, rotY }),
        onInteract: (id) => {
          const g = useGameStore.getState();
          if (id === 'hq-door') {
            g.completeObjective('enter-hq');
            g.setPanel('dashboard');
          } else if (id === 'npc-secretary') g.openDialogue('secretary');
          else if (id === 'npc-citizen') g.openDialogue('citizen');
          else if (id === 'npc-guard') {
            const a = g.government?.protests.active;
            g.showToast(!a ? 'Officer: All quiet outside the Prime Minister\'s office.'
              : a.status === 'dispersing' ? 'Officer: The crowd is going home.'
              : `Officer: ${a.size.toLocaleString()} people outside, ${a.intensity >= 70 ? 'it is getting ugly' : a.intensity >= 35 ? 'tempers are rising' : 'calm so far'}.`);
          }
          else if (id === 'election') g.setPanel('election');
          else if (id === 'parliament-building') { g.setPanel('parliament'); }
          else if (id === 'ministry') {
            if (g.election?.government?.playerRole === 'partner' && g.government) g.setPanel('government');
            else g.showToast('This office is available only to a junior coalition partner with assigned ministries.');
          }
          else if (id === 'gov') {
            if (g.election?.stage === 'formed') { engineRef.current?.enterOffice(); g.showToast('Government Office entered. Walk to the PM chair for a cabinet meeting.'); }
            else g.showToast('The Government Building opens once a government has been formed.');
          } else if (id === 'office-exit') engineRef.current?.exitOffice();
          else if (id === 'pm-chair') { g.showToast('Cabinet meeting seated. Use the Government Office tabs to decide budgets, policies, protests and coalition issues.'); g.setPanel('government'); }
          else if (INTERACT_MESSAGES[id]) g.showToast(INTERACT_MESSAGES[id]);
        },
      },
      {
        quality: st.quality,
        party: st.party,
        playerColors: { body: st.party.color, skin: '#d9a066', hair: '#2a1b12', legs: '#2b2f4a' },
        spawn: st.position,
      },
    );
    engine.setTimeOfDay(st.clock.minutes);
    engineRef.current = engine;
    engine.setPrimeMinister(!!st.election?.government && st.election.government.playerRole === 'leader');
    const detach = attachKeyboard();
    return () => {
      detach();
      engine.dispose();
      engineRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const g = useGameStore.getState();
    engineRef.current?.setPrimeMinister(!!g.election?.government && g.election.government.playerRole === 'leader');
  }, [useGameStore((s) => s.election?.government?.playerRole), sessionId]);

  // The crowd outside the Prime Minister's building follows the protest state
  useEffect(() => { engineRef.current?.setProtest(viewOf(protest)); }, [protest, sessionId]);
  useEffect(() => {
    const r = useGameStore.getState().crowdReaction;
    if (r && reactionSeq > 0) engineRef.current?.reactCrowd(r.kind);
  }, [reactionSeq]);

  useEffect(() => { engineRef.current?.setBlocked(panel !== null); }, [panel]);
  useEffect(() => { engineRef.current?.setTimeOfDay(minutes); }, [minutes]);

  // In-game clock
  useEffect(() => {
    const id = setInterval(() => useGameStore.getState().tick(0.25), 250);
    return () => clearInterval(id);
  }, []);

  // Hotkeys for panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = useGameStore.getState();
      if (e.code === 'Escape') {
        if (g.panel === null) g.setPanel('pause');
        else if (g.panel !== 'dialogue') g.setPanel(null);
        return;
      }
      if (g.panel === 'dialogue' || g.panel === 'pause') return;
      if (e.code === 'KeyP') g.togglePanel('dashboard');
      else if (e.code === 'KeyI') g.togglePanel('phone');
      else if (e.code === 'KeyM') g.togglePanel('map');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const quit = () => {
    const g = useGameStore.getState();
    g.setPanel(null);
    g.goTo('menu');
  };

  return (
    <div className="absolute inset-0">
      <canvas ref={canvasRef} />
      <Hud nearby={nearby} />
      {isTouch && !panel && <MobileControls />}
      {panel === 'dashboard' && <Dashboard />}
      {panel === 'candidates' && <CandidatePanel />}
      {panel === 'election' && <ElectionPanel />}
      {panel === 'government' && <GovernmentPanel />}
      {panel === 'opposition' && <OppositionPanel />}
      {panel === 'phone' && <Phone />}
      {panel === 'map' && <MapPanel />}
      {panel === 'parliament' && <ParliamentPanel />}
      {panel === 'war-room' && <WarRoomPanel />}
      {panel === 'dialogue' && <DialoguePanel />}
      {panel === 'pause' && <PausePanel onQuit={quit} />}
      {!isTouch && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl bg-paper/80 px-3 py-1 text-sm font-bold">
          WASD move · Shift run · Space jump · E interact · P dashboard · I phone · M map · Esc pause
        </div>
      )}
    </div>
  );
}
