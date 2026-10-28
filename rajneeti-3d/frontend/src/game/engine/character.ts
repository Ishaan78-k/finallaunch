import { Color3, MeshBuilder, StandardMaterial, TransformNode, type AbstractMesh, type Scene } from '@babylonjs/core';

export interface CharacterColors {
  body: string;
  skin: string;
  hair: string;
  legs: string;
}

export interface Character {
  root: TransformNode;
  body: AbstractMesh;
  legL: TransformNode;
  legR: TransformNode;
  armL: TransformNode;
  armR: TransformNode;
  meshes: AbstractMesh[];
}

function mat(scene: Scene, hex: string): StandardMaterial {
  const m = new StandardMaterial(`m-${hex}-${Math.random().toString(36).slice(2, 7)}`, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  return m;
}

/** Cartoon character built from primitives; limbs hang from pivot nodes so they can swing. */
export function createCharacter(scene: Scene, name: string, c: CharacterColors): Character {
  const root = new TransformNode(`${name}-root`, scene);
  const meshes: AbstractMesh[] = [];
  const bodyMat = mat(scene, c.body);
  const skinMat = mat(scene, c.skin);
  const hairMat = mat(scene, c.hair);
  const legMat = mat(scene, c.legs);

  const body = MeshBuilder.CreateCylinder(`${name}-body`, { height: 1.0, diameterTop: 0.8, diameterBottom: 0.95, tessellation: 14 }, scene);
  body.parent = root;
  body.position.y = 1.3;
  body.material = bodyMat;
  meshes.push(body);

  const head = MeshBuilder.CreateSphere(`${name}-head`, { diameter: 0.85, segments: 12 }, scene);
  head.parent = root;
  head.position.y = 2.25;
  head.material = skinMat;
  meshes.push(head);

  const hair = MeshBuilder.CreateSphere(`${name}-hair`, { diameter: 0.9, segments: 10, slice: 0.55 }, scene);
  hair.parent = root;
  hair.position.y = 2.32;
  hair.material = hairMat;
  meshes.push(hair);

  const eyeMat = mat(scene, '#1d2340');
  for (const sx of [-0.15, 0.15]) {
    const eye = MeshBuilder.CreateSphere(`${name}-eye`, { diameter: 0.12, segments: 6 }, scene);
    eye.parent = root;
    eye.position.set(sx, 2.25, 0.38);
    eye.material = eyeMat;
    meshes.push(eye);
  }

  const limb = (label: string, x: number, y: number, w: number, h: number, material: StandardMaterial): TransformNode => {
    const pivot = new TransformNode(`${name}-${label}`, scene);
    pivot.parent = root;
    pivot.position.set(x, y, 0);
    const m = MeshBuilder.CreateBox(`${name}-${label}-mesh`, { width: w, height: h, depth: w }, scene);
    m.parent = pivot;
    m.position.y = -h / 2;
    m.material = material;
    meshes.push(m);
    return pivot;
  };

  const legL = limb('legL', -0.22, 0.8, 0.3, 0.8, legMat);
  const legR = limb('legR', 0.22, 0.8, 0.3, 0.8, legMat);
  const armL = limb('armL', -0.58, 1.75, 0.24, 0.8, bodyMat);
  const armR = limb('armR', 0.58, 1.75, 0.24, 0.8, bodyMat);

  return { root, body, legL, legR, armL, armR, meshes };
}

export interface AnimState {
  phase: number;
  moveAmount: number; // 0..1
  running: boolean;
  airborne: boolean;
  wave: number; // seconds of interaction wave remaining
  turn: number; // -1..1 lean
  time: number;
}

export function animateCharacter(ch: Character, a: AnimState): void {
  const amp = (a.running ? 0.95 : 0.6) * a.moveAmount;
  const swing = Math.sin(a.phase) * amp;
  ch.legL.rotation.x = a.airborne ? 0.5 : swing;
  ch.legR.rotation.x = a.airborne ? -0.4 : -swing;
  ch.armL.rotation.x = a.airborne ? -2.4 : -swing;
  ch.armR.rotation.x = a.airborne ? -2.4 : swing;
  if (a.wave > 0) ch.armR.rotation.x = -1.7 + Math.sin(a.time * 14) * 0.35;
  const idleBreath = a.moveAmount < 0.05 ? Math.sin(a.time * 2.2) * 0.02 : 0;
  ch.body.scaling.y = 1 + idleBreath;
  ch.body.rotation.z += (-a.turn * 0.18 - ch.body.rotation.z) * 0.2;
  ch.body.position.y = 1.3 + Math.abs(Math.sin(a.phase)) * 0.05 * a.moveAmount;
}
