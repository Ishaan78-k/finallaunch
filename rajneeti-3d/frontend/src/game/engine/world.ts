import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';
import { LOCATIONS, WORLD_HALF_SIZE } from '../../data/world';
import type { Collider } from './collision';


export interface WorldBuild {
  colliders: Collider[];
  casters: AbstractMesh[];
  ground: Mesh;
  lampMaterial: StandardMaterial;
}

function mat(scene: Scene, hex: string, emissive = false): StandardMaterial {
  const m = new StandardMaterial(`mat-${hex}-${Math.random().toString(36).slice(2, 7)}`, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  if (emissive) m.emissiveColor = Color3.FromHexString(hex);
  return m;
}

/** Small deterministic PRNG so the city looks identical every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSign(scene: Scene, lines: string[], bg: string, fg: string, w: number, h: number): Mesh {
  const tex = new DynamicTexture('sign', { width: 512, height: Math.round((512 * h) / w) }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const cw = 512;
  const ch = Math.round((512 * h) / w);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, cw - 12, ch - 12);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lh = ch / (lines.length + 0.6);
  lines.forEach((line, i) => {
    ctx.font = `bold ${Math.floor(lh * 0.62)}px "Baloo 2", "Trebuchet MS", sans-serif`;
    ctx.fillText(line, cw / 2, lh * (i + 0.85), cw - 40);
  });
  tex.update();
  const m = new StandardMaterial('signMat', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.disableLighting = true;
  const plane = MeshBuilder.CreatePlane('sign', { width: w, height: h }, scene);
  plane.material = m;
  plane.rotation.y = Math.PI; // face +z, toward the spawn point
  return plane;
}

export interface PartyStyle { name: string; abbreviation: string; color: string }

export function buildWorld(scene: Scene, party: PartyStyle): WorldBuild {
  const colliders: Collider[] = [];
  const casters: AbstractMesh[] = [];

  // Ground
  const ground = MeshBuilder.CreateGround('ground', { width: WORLD_HALF_SIZE * 2, height: WORLD_HALF_SIZE * 2 }, scene);
  ground.material = mat(scene, '#7ed957');
  ground.receiveShadows = true;

  const flat = (name: string, x: number, z: number, w: number, d: number, hex: string, y: number): void => {
    const m = MeshBuilder.CreateBox(name, { width: w, height: 0.1, depth: d }, scene);
    m.position.set(x, y, z);
    m.material = mat(scene, hex);
    m.receiveShadows = true;
  };

  // Roads, sidewalks, plaza, parking
  flat('road-main', 0, 0, WORLD_HALF_SIZE * 2, 8, '#5b5f73', 0.03);
  flat('road-south', 0, 30, 6, 52, '#5b5f73', 0.03);
  flat('walk-n', 0, -5.5, WORLD_HALF_SIZE * 2, 3, '#e6dcc8', 0.05);
  flat('walk-s', 0, 5.5, WORLD_HALF_SIZE * 2, 3, '#e6dcc8', 0.05);
  flat('plaza', 0, -10, 14, 7, '#f0e6d2', 0.06);
  flat('parking', 14, -8, 12, 6, '#6e7288', 0.05);
  for (let i = 0; i < 4; i++) flat(`line-${i}`, 9 + i * 3.4, -8, 0.15, 5, '#ffffff', 0.12);
  for (let i = -5; i <= 5; i++) flat(`dash-${i}`, i * 10, 0, 4, 0.3, '#ffe08a', 0.1);

  const addBuilding = (
    name: string, x: number, z: number, w: number, d: number, h: number, color: string, roofColor: string, label?: string[],
  ): void => {
    const body = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    body.position.set(x, h / 2, z);
    body.material = mat(scene, color);
    body.receiveShadows = true;
    const roof = MeshBuilder.CreateBox(`${name}-roof`, { width: w + 0.8, height: 0.7, depth: d + 0.8 }, scene);
    roof.position.set(x, h + 0.35, z);
    roof.material = mat(scene, roofColor);
    const door = MeshBuilder.CreateBox(`${name}-door`, { width: 2, height: 2.6, depth: 0.2 }, scene);
    door.position.set(x, 1.3, z + d / 2 + 0.05);
    door.material = mat(scene, '#5a3a22');
    const windowMat = mat(scene, '#bfe9ff', true);
    const rows = Math.max(1, Math.floor((h - 2) / 3));
    for (let r = 0; r < rows; r++) {
      for (const fx of [-0.3, 0.3]) {
        const win = MeshBuilder.CreateBox(`${name}-win`, { width: 1.6, height: 1.4, depth: 0.15 }, scene);
        win.position.set(x + fx * w * 0.8, 2.2 + r * 3, z + d / 2 + 0.05);
        win.material = windowMat;
      }
    }
    if (label) {
      const sign = makeSign(scene, label, color, '#fffdf5', Math.min(w - 1, 9), 2.2);
      sign.position.set(x, h - 1.5, z + d / 2 + 0.2);
    }
    casters.push(body, roof);
    colliders.push({ minX: x - w / 2 - 0.1, maxX: x + w / 2 + 0.1, minZ: z - d / 2 - 0.1, maxZ: z + d / 2 + 0.1 });
  };

  const loc = (id: string) => LOCATIONS.find((l) => l.id === id)!;
  const hq = loc('hq');
  addBuilding('hq', hq.x, hq.z, 16, 10, 9, party.color, '#1d2340', [party.name, `${party.abbreviation} Headquarters`]);
  const gov = loc('gov');
  addBuilding('gov', gov.x, gov.z, 14, 10, 11, '#6c8ef5', '#2f3f8f', ['Government', 'Administrative Building']);
  // Phase 7 office interior: kept as a separate room volume so the exterior remains intact.
  const officeX = gov.x, officeZ = gov.z + 12;
  flat('office-floor', officeX, officeZ, 18, 14, '#d8c7a5', 0.08);
  for (const [x, z, w, d] of [[officeX, officeZ - 7, 18, 0.35], [officeX, officeZ + 7, 18, 0.35], [officeX - 9, officeZ, 0.35, 14], [officeX + 9, officeZ, 0.35, 14]] as [number, number, number, number][]) flat('office-wall', x, z, w, d, '#efe8d5', 2.2);
  const officeWood = mat(scene, '#6b4226');
  const table = MeshBuilder.CreateBox('cabinet-conference-table', { width: 12, height: 0.75, depth: 3.6 }, scene); table.position.set(officeX, 0.9, officeZ); table.material = officeWood; casters.push(table);
  const chairMat = mat(scene, '#243b6b');
  for (let i = 0; i < 13; i++) { const pm = i === 0; const x = pm ? officeX : officeX - 5.5 + ((i - 1) % 6) * 2.2; const z = pm ? officeZ - 3.1 : officeZ + (i < 7 ? -2.2 : 2.2); const chair = MeshBuilder.CreateBox(`cabinet-chair-${i}`, { width: 1.25, height: 1.1, depth: 1.25 }, scene); chair.position.set(x, 0.6, z); chair.material = pm ? mat(scene, '#b7862a') : chairMat; casters.push(chair); }
  const winMat = mat(scene, '#bfe9ff', true);
  for (let i = -3; i <= 3; i += 2) { const win = MeshBuilder.CreateBox('office-window', { width: 1.4, height: 1.5, depth: 0.08 }, scene); win.position.set(officeX + i * 2, 3.2, officeZ - 6.8); win.material = winMat; }
  const lamp = MeshBuilder.CreateSphere('office-chandelier', { diameter: 1.1, segments: 8 }, scene); lamp.position.set(officeX, 4.8, officeZ); lamp.material = mat(scene, '#fff1b0', true);
  const seal = MeshBuilder.CreateCylinder('government-seal', { height: 0.12, diameter: 2.5, tessellation: 32 }, scene); seal.position.set(officeX, 2.6, officeZ + 6.75); seal.rotation.x = Math.PI / 2; seal.material = mat(scene, '#d4af37', true);
  const el = loc('election');
  addBuilding('election', el.x, el.z, 12, 9, 8, '#1fa9a0', '#0e5f5a', ['Election Commission', 'Office']);

  // Party flag on HQ
  const pole = MeshBuilder.CreateCylinder('flag-pole', { height: 6, diameter: 0.2 }, scene);
  pole.position.set(hq.x + 6, 12, hq.z);
  pole.material = mat(scene, '#d9d9d9');
  const flag = MeshBuilder.CreateBox('flag', { width: 2.6, height: 1.6, depth: 0.1 }, scene);
  flag.position.set(hq.x + 7.4, 14.2, hq.z);
  flag.material = mat(scene, party.color, true);

  // Commercial street (decorative) and residential neighbourhood (decorative)
  const shopColors = ['#ff6b6b', '#ffd166', '#4ecdc4', '#a78bfa', '#ff9f1c', '#6bcB77'];
  for (let i = 0; i < 6; i++) {
    const x = -25 + i * 10;
    addBuilding(`shop-${i}`, x, -40, 8, 7, 5 + (i % 3), shopColors[i], '#3a3350', i === 2 ? ['Commercial', 'Street'] : undefined);
  }
  for (const [i, [x, z]] of ([[-14, 28], [14, 28], [-14, 40], [14, 40]] as [number, number][]).entries()) {
    addBuilding(`house-${i}`, x, z, 7, 6, 4, ['#ffb4a2', '#cdb4db', '#bde0fe', '#fde68a'][i], '#8d5a44', i === 0 ? ['Residential', 'Homes'] : undefined);
  }

  // Park
  const park = loc('park');
  const lawn = MeshBuilder.CreateDisc('park-lawn', { radius: 12, tessellation: 32 }, scene);
  lawn.rotation.x = Math.PI / 2;
  lawn.position.set(park.x, 0.06, park.z);
  lawn.material = mat(scene, '#4ea84a');
  const pond = MeshBuilder.CreateDisc('pond', { radius: 3.5, tessellation: 24 }, scene);
  pond.rotation.x = Math.PI / 2;
  pond.position.set(park.x, 0.09, park.z);
  pond.material = mat(scene, '#5fc8f0');
  colliders.push({ minX: park.x - 3.4, maxX: park.x + 3.4, minZ: park.z - 3.4, maxZ: park.z + 3.4 });
  for (const [bx, bz] of [[-6, 6], [6, 6], [0, -8]] as [number, number][]) {
    const bench = MeshBuilder.CreateBox('bench', { width: 2.2, height: 0.5, depth: 0.7 }, scene);
    bench.position.set(park.x + bx, 0.4, park.z + bz);
    bench.material = mat(scene, '#8d5a44');
    colliders.push({ minX: park.x + bx - 1.1, maxX: park.x + bx + 1.1, minZ: park.z + bz - 0.35, maxZ: park.z + bz + 0.35 });
  }

  // Rally ground (decorative until Phase 3)
  const rally = loc('rally');
  const field = MeshBuilder.CreateDisc('rally-field', { radius: 11, tessellation: 32 }, scene);
  field.rotation.x = Math.PI / 2;
  field.position.set(rally.x, 0.06, rally.z);
  field.material = mat(scene, '#d8c590');
  const stage = MeshBuilder.CreateBox('stage', { width: 10, height: 1.2, depth: 4 }, scene);
  stage.position.set(rally.x, 0.6, rally.z - 8);
  stage.material = mat(scene, party.color);
  casters.push(stage);
  colliders.push({ minX: rally.x - 5, maxX: rally.x + 5, minZ: rally.z - 10, maxZ: rally.z - 6 });

  // Trees (instanced)
  const rand = mulberry32(2024);
  const trunk = MeshBuilder.CreateCylinder('tree-trunk', { height: 2, diameter: 0.6 }, scene);
  trunk.material = mat(scene, '#8d5a44');
  const crown = MeshBuilder.CreateSphere('tree-crown', { diameter: 3.6, segments: 8 }, scene);
  crown.material = mat(scene, '#3fae5a');
  const treeSpots: [number, number][] = [];
  const blocked = (x: number, z: number): boolean => {
    if (Math.abs(z) < 7.5) return true;
    if (Math.abs(x) < 4 && z > 0) return true;
    return colliders.some((c) => x > c.minX - 3 && x < c.maxX + 3 && z > c.minZ - 3 && z < c.maxZ + 3);
  };
  let tries = 0;
  while (treeSpots.length < 40 && tries++ < 600) {
    const x = (rand() * 2 - 1) * (WORLD_HALF_SIZE - 3);
    const z = (rand() * 2 - 1) * (WORLD_HALF_SIZE - 3);
    if (!blocked(x, z)) treeSpots.push([x, z]);
  }
  treeSpots.forEach(([x, z], i) => {
    const s = 0.85 + rand() * 0.5;
    const t = i === 0 ? trunk : trunk.createInstance(`trunk-${i}`);
    const c = i === 0 ? crown : crown.createInstance(`crown-${i}`);
    t.position.set(x, 1 * s, z);
    t.scaling.set(s, s, s);
    c.position.set(x, 3 * s, z);
    c.scaling.set(s, s, s);
    casters.push(c);
    colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
  });

  // Streetlights share one material so day/night can switch them all at once
  const lampMaterial = mat(scene, '#fff1b0');
  lampMaterial.emissiveColor = Color3.Black();
  const lampPoleMat = mat(scene, '#3a3a4a');
  const lamps = new TransformNode('lamps', scene);
  for (let x = -48; x <= 48; x += 12) {
    const p = MeshBuilder.CreateCylinder('lamp-pole', { height: 5, diameter: 0.25 }, scene);
    p.position.set(x, 2.5, -6.6);
    p.material = lampPoleMat;
    p.parent = lamps;
    const b = MeshBuilder.CreateSphere('lamp-bulb', { diameter: 0.8, segments: 6 }, scene);
    b.position.set(x, 5.2, -6.6);
    b.material = lampMaterial;
    b.parent = lamps;
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: -6.8, maxZ: -6.4 });
  }

  return { colliders, casters, ground, lampMaterial };
}
