import { useGameStore } from '../state/gameStore';
import { MainMenu } from '../components/MainMenu';
import { CreateScreen } from '../components/CreateScreen';
import { GameScreen } from '../components/GameScreen';

export function App() {
  const screen = useGameStore((s) => s.screen);
  return (
    <div className="relative h-full w-full">
      {screen === 'menu' && <MainMenu />}
      {screen === 'create' && <CreateScreen />}
      {screen === 'playing' && <GameScreen />}
    </div>
  );
}
