export interface WorldLocation {
  id: string;
  label: string;
  x: number;
  z: number;
  color: string;
}

/** Shared between the 3D scene and the 2D map so they never disagree. */
export const LOCATIONS: WorldLocation[] = [
  { id: 'hq', label: 'Party Headquarters', x: 0, z: -18, color: '#ff9f1c' },
  { id: 'gov', label: 'Government Administrative Building', x: 30, z: -18, color: '#6c8ef5' },
  { id: 'election', label: 'Election Commission Office', x: -30, z: -18, color: '#1fa9a0' },
  { id: 'park', label: 'Public Park', x: -28, z: 18, color: '#5cc26a' },
  { id: 'rally', label: 'Rally Ground', x: 30, z: 20, color: '#e0457b' },
  { id: 'ministry', label: 'Coalition Ministry Office', x: 0, z: 22, color: '#9b5de5' },
  { id: 'parliament', label: 'Parliament Chamber', x: -30, z: 22, color: '#f4a261' },
];
export const WORLD_HALF_SIZE = 55;
