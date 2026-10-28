import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, type Scene } from '@babylonjs/core';
import { LOCATIONS } from '../../data/world';
import { Rng, hashString } from '../../simulation/core/rng';
import { POLICE_BY_ID, crowdAgents, type Reaction, type ProtestView } from '../../simulation/world/protests';

type Quality = 'low' | 'medium' | 'high';

const CROWD_CAP: Record<Quality, number> = { low: 36, medium: 80, high: 150 };
const POLICE_CAP: Record<Quality, number> = { low: 24, medium: 54, high: 60 };
const MAX_SIGN_CARRIERS = 40;
const SIGN_SETS = 4;
const UPDATE_STEP = 1 / 20; // crowd animates at 20 Hz; the render loop stays at full speed
const CULL_DISTANCE = 110;

const GOV = LOCATIONS.find((l) => l.id === 'gov')!;
const FRONT_Z = GOV.z + 5; // front face of the Prime Minister's building
const BARRIER_Z = FRONT_Z + 1.9;
const POLICE_Z = FRONT_Z + 1;
const CROWD_Z0 = FRONT_Z + 2.9;
const CROWD_Z1 = FRONT_Z + 7;
const CROWD_HALF_W = 10;

const SHIRTS = ['#ff6b6b', '#ffd166', '#4ecdc4', '#a78bfa', '#ff9f1c', '#6bcb77', '#f4f1de', '#5aa9e6'];
const SKINS = ['#e0ac69', '#c68642', '#8d5524', '#f1c27d', '#d9a066'];
const SIGN_BG = ['#fff7d6', '#ffd6d6', '#d6f0ff', '#e2ffd6'];

function hex(h: string): [number, number, number] { const c = Color3.FromHexString(h); return [c.r, c.g, c.b]; }

function mat(scene: Scene, color: string, emissive = false): StandardMaterial {
  const m = new StandardMaterial(`pm-${color}`, scene);
  m.diffuseColor = Color3.FromHexString(color);
  m.specularColor = Color3.Black();
  if (emissive) m.emissiveColor = Color3.FromHexString(color).scale(0.6);
  return m;
}

/** Writes a translate + Y-rotate + scale matrix straight into a thin-instance buffer (no allocations). */
function put(buf: Float32Array, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rot: number): void {
  const c = Math.cos(rot), s = Math.sin(rot), o = i * 16;
  buf[o] = sx * c; buf[o + 1] = 0; buf[o + 2] = -sx * s; buf[o + 3] = 0;
  buf[o + 4] = 0; buf[o + 5] = sy; buf[o + 6] = 0; buf[o + 7] = 0;
  buf[o + 8] = sz * s; buf[o + 9] = 0; buf[o + 10] = sz * c; buf[o + 11] = 0;
  buf[o + 12] = x; buf[o + 13] = y; buf[o + 14] = z; buf[o + 15] = 1;
}

function textTexture(scene: Scene, text: string, bg: string, fg: string, w: number, h: number): DynamicTexture {
  const tex = new DynamicTexture('protest-text', { width: w, height: h }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = Math.max(4, h * 0.05);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = Math.floor(h * 0.5);
  ctx.font = `bold ${size}px "Baloo 2", "Trebuchet MS", sans-serif`;
  while (ctx.measureText(text).width > w - 24 && size > 10) { size -= 2; ctx.font = `bold ${size}px "Baloo 2", "Trebuchet MS", sans-serif`; }
  ctx.fillText(text, w / 2, h / 2);
  tex.update();
  return tex;
}

function flatMat(scene: Scene, tex: DynamicTexture): StandardMaterial {
  const m = new StandardMaterial('protest-sign', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.disableLighting = true;
  m.backFaceCulling = false;
  return m;
}

interface Layer { mesh: Mesh; buf: Float32Array }

/**
 * The crowd outside the Prime Minister's building: protesters, signs, banners, barricades and police.
 * Everything is drawn with thin instances (one draw call per kind of object), animated at 20 Hz,
 * capped by the quality setting, and skipped entirely when the camera is far away or nobody is there.
 */
export class ProtestScene {
  private root: TransformNode;
  private ax = GOV.x;
  private cap: number;
  private policeCap: number;
  private body: Layer;
  private head: Layer;
  private stick: Layer;
  private polBody: Layer;
  private polHead: Layer;
  private polShield: Layer;
  private barrier: Layer;
  private signs: Layer[] = [];
  private signAgents: number[][] = [];
  private cause: string | null = null;
  private causeAssets: { dispose: () => void }[] = [];
  private banner: TransformNode | null = null;
  private homeX: Float32Array;
  private homeZ: Float32Array;
  private phase: Float32Array;
  private scale: Float32Array;
  private rank: Float32Array;
  private view: ProtestView | null = null;
  private count = 0;
  private carriers = 0;
  private presence = 0;
  private time = 0;
  private acc = 0;
  private reaction: { kind: Reaction; start: number } | null = null;
  private hidden = true;
  private barrierCount = 0;
  private disposables: { dispose: () => void }[] = [];

  constructor(private scene: Scene, quality: Quality) {
    this.cap = CROWD_CAP[quality];
    this.policeCap = POLICE_CAP[quality];
    this.root = new TransformNode('protest-root', scene);
    this.homeX = new Float32Array(this.cap);
    this.homeZ = new Float32Array(this.cap);
    this.phase = new Float32Array(this.cap);
    this.scale = new Float32Array(this.cap);
    this.rank = new Float32Array(this.cap);

    const bodyMesh = MeshBuilder.CreateCylinder('crowd-body', { height: 1.5, diameterTop: 0.55, diameterBottom: 0.75, tessellation: 8 }, scene);
    const headMesh = MeshBuilder.CreateSphere('crowd-head', { diameter: 0.5, segments: 6 }, scene);
    const stickMesh = MeshBuilder.CreateCylinder('crowd-stick', { height: 1.5, diameter: 0.07, tessellation: 4 }, scene);
    const polBodyMesh = MeshBuilder.CreateCylinder('police-body', { height: 1.55, diameterTop: 0.6, diameterBottom: 0.8, tessellation: 8 }, scene);
    const polHeadMesh = MeshBuilder.CreateSphere('police-head', { diameter: 0.56, segments: 6 }, scene);
    const shieldMesh = MeshBuilder.CreateBox('police-shield', { width: 1, height: 1, depth: 1 }, scene);
    const barrierMesh = MeshBuilder.CreateBox('police-barrier', { width: 1, height: 1, depth: 1 }, scene);

    const white = mat(scene, '#ffffff');
    bodyMesh.material = white;
    headMesh.material = white;
    stickMesh.material = mat(scene, '#8d5a44');
    polBodyMesh.material = mat(scene, '#1f3a8a');
    polHeadMesh.material = mat(scene, '#f2f2f2');
    shieldMesh.material = mat(scene, '#5a6fb8');
    barrierMesh.material = mat(scene, '#e8e8e8');

    this.body = this.layer(bodyMesh, this.cap);
    this.head = this.layer(headMesh, this.cap);
    this.stick = this.layer(stickMesh, MAX_SIGN_CARRIERS);
    this.polBody = this.layer(polBodyMesh, this.policeCap);
    this.polHead = this.layer(polHeadMesh, this.policeCap);
    this.polShield = this.layer(shieldMesh, this.policeCap);
    this.barrier = this.layer(barrierMesh, 12);

    // Static per-instance colours: shirts and skin tones are fixed for the whole session.
    const rng = new Rng(20260);
    const bodyColors = new Float32Array(this.cap * 4);
    const headColors = new Float32Array(this.cap * 4);
    for (let i = 0; i < this.cap; i++) {
      const [r, g, b] = hex(rng.pick(SHIRTS));
      const [hr, hg, hb] = hex(rng.pick(SKINS));
      bodyColors.set([r, g, b, 1], i * 4);
      headColors.set([hr, hg, hb, 1], i * 4);
    }
    this.body.mesh.thinInstanceSetBuffer('color', bodyColors, 4, true);
    this.head.mesh.thinInstanceSetBuffer('color', headColors, 4, true);

    this.placeBarriers();
    this.root.setEnabled(false);
  }

  private layer(mesh: Mesh, capacity: number): Layer {
    const buf = new Float32Array(capacity * 16);
    mesh.parent = this.root;
    mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.alwaysSelectAsActiveMesh = true; // thin instances are not frustum-culled per instance
    mesh.isPickable = false;
    this.disposables.push(mesh);
    return { mesh, buf };
  }

  /** Police barricades in front of the building, with a gap at the door. */
  private placeBarriers(): void {
    let n = 0;
    for (let k = -4; k <= 4; k++) {
      if (Math.abs(k) <= 1) continue; // keep the entrance clear
      put(this.barrier.buf, n++, this.ax + k * 2.3, 0.45, BARRIER_Z, 2.2, 0.9, 0.25, 0);
    }
    this.barrierCount = n;
    this.barrier.mesh.thinInstanceCount = 0;
    this.barrier.mesh.thinInstanceBufferUpdated('matrix');
  }

  setView(view: ProtestView | null): void {
    const prev = this.view;
    if (view && (!prev || prev.key !== view.key)) {
      // A new protest begins: arrive from nothing. A crowd already going home on load is not drawn.
      this.presence = 0;
      this.rebuild(view);
    }
    this.view = view;
    if (view || this.presence > 0) this.wake();
  }

  react(kind: Reaction): void { this.reaction = { kind, start: this.time }; this.wake(); }

  private wake(): void {
    if (this.hidden) { this.hidden = false; this.root.setEnabled(true); }
  }

  private rebuild(view: ProtestView): void {
    this.count = crowdAgents(view.size, this.cap);
    const rng = new Rng(hashString(`crowd:${view.key}`));
    const w = CROWD_HALF_W * 2;
    const d = CROWD_Z1 - CROWD_Z0;
    const cols = Math.max(1, Math.ceil(Math.sqrt((this.count * w) / d)));
    const rows = Math.max(1, Math.ceil(this.count / cols));
    for (let i = 0; i < this.count; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      this.homeX[i] = this.ax - CROWD_HALF_W + ((c + 0.5 + (rng.next() - 0.5) * 0.7) / cols) * w;
      this.homeZ[i] = CROWD_Z0 + ((r + 0.5 + (rng.next() - 0.5) * 0.7) / rows) * d;
      this.phase[i] = rng.next() * Math.PI * 2;
      this.scale[i] = 0.85 + rng.next() * 0.3;
      this.rank[i] = i;
    }
    for (let i = this.count - 1; i > 0; i--) { // seeded shuffle: who leaves first
      const j = rng.int(0, i);
      const t = this.rank[i]; this.rank[i] = this.rank[j]; this.rank[j] = t;
    }
    this.body.mesh.thinInstanceCount = this.count;
    this.head.mesh.thinInstanceCount = this.count;
    this.carriers = Math.min(MAX_SIGN_CARRIERS, Math.round(this.count * 0.4));
    this.stick.mesh.thinInstanceCount = this.carriers;
    // Signs and banners only change when the cause does.
    if (this.cause !== view.cause) this.buildCauseAssets(view);
    this.signAgents = this.signs.map(() => []);
    for (let j = 0; j < this.carriers; j++) this.signAgents[j % SIGN_SETS].push(Math.floor((j * this.count) / this.carriers));
    this.signs.forEach((s, m) => { s.mesh.thinInstanceCount = this.signAgents[m].length; });
    this.barrier.mesh.thinInstanceCount = this.barrierCount;
    this.acc = UPDATE_STEP; // draw the first frame immediately
  }

  private buildCauseAssets(view: ProtestView): void {
    for (const a of this.causeAssets) a.dispose();
    this.causeAssets = [];
    this.signs = [];
    this.cause = view.cause;
    for (let m = 0; m < SIGN_SETS; m++) {
      const tex = textTexture(this.scene, view.signs[m % view.signs.length], SIGN_BG[m], '#1d2340', 256, 160);
      const material = flatMat(this.scene, tex);
      const plane = MeshBuilder.CreatePlane(`protest-sign-${m}`, { width: 1, height: 1 }, this.scene);
      plane.material = material;
      plane.parent = this.root;
      plane.isPickable = false;
      plane.alwaysSelectAsActiveMesh = true;
      const buf = new Float32Array(Math.ceil(MAX_SIGN_CARRIERS / SIGN_SETS) * 16);
      plane.thinInstanceSetBuffer('matrix', buf, 16, false);
      plane.thinInstanceCount = 0;
      this.signs.push({ mesh: plane, buf });
      this.causeAssets.push(plane, material, tex);
    }
    // Two big banners on poles at the edges of the crowd.
    const banner = new TransformNode('protest-banners', this.scene);
    banner.parent = this.root;
    const tex = textTexture(this.scene, view.banner, '#e0457b', '#ffffff', 512, 128);
    const bm = flatMat(this.scene, tex);
    const poleMat = mat(this.scene, '#d9d9d9');
    for (const side of [-1, 1]) {
      const x = this.ax + side * (CROWD_HALF_W - 3.2);
      const z = CROWD_Z1 - 1.2;
      const pl = MeshBuilder.CreateCylinder('banner-pole', { height: 4, diameter: 0.12, tessellation: 6 }, this.scene);
      pl.position.set(x - 2.4, 2, z); pl.material = poleMat; pl.parent = banner;
      const pr = pl.clone('banner-pole2');
      pr.position.set(x + 2.4, 2, z); pr.parent = banner;
      const plane = MeshBuilder.CreatePlane('banner', { width: 4.8, height: 1.3 }, this.scene);
      plane.position.set(x, 3.2, z); plane.rotation.y = Math.PI; plane.material = bm; plane.parent = banner;
      for (const m of [pl, pr, plane]) { m.isPickable = false; m.freezeWorldMatrix(); }
    }
    this.banner = banner;
    this.causeAssets.push(banner, bm, tex, poleMat);
  }

  /** Called every frame; does real work only at 20 Hz and only while the crowd is visible and near the camera. */
  update(dt: number, camX: number, camZ: number): void {
    if (this.hidden) return;
    this.time += dt;
    const v = this.view;
    const leaving = !v || v.mood === 'dispersing' || v.mood === 'clash';
    const target = leaving ? 0 : 1;
    const rate = !v ? 0.3 : v.mood === 'clash' ? 0.025 : v.mood === 'dispersing' ? 0.04 : 0.5;
    this.presence += Math.max(-rate * dt, Math.min(rate * dt, target - this.presence));
    if (this.presence <= 0 && target === 0) {
      this.hidden = true;
      this.root.setEnabled(false);
      for (const l of [this.body, this.head, this.stick, this.polBody, this.polHead, this.polShield, this.barrier, ...this.signs]) l.mesh.thinInstanceCount = 0;
      return;
    }
    this.acc += dt;
    if (this.acc < UPDATE_STEP) return;
    this.acc = 0;
    if (Math.hypot(camX - this.ax, camZ - (CROWD_Z0 + CROWD_Z1) / 2) > CULL_DISTANCE) return;
    this.animate(v);
  }

  private animate(v: ProtestView | null): void {
    const t = this.time;
    const mood = v?.mood ?? 'dispersing';
    let amp = mood === 'calm' ? 0.04 : mood === 'angry' ? 0.12 : mood === 'riot' ? 0.2 : mood === 'clash' ? 0.25 : 0.05;
    let freq = mood === 'calm' ? 2 : mood === 'angry' ? 6 : mood === 'riot' ? 8 : mood === 'clash' ? 10 : 5;
    let shake = mood === 'angry' ? 0.12 : mood === 'riot' || mood === 'clash' ? 0.3 : 0.04;
    let push = mood === 'clash' ? 0.5 : mood === 'riot' ? 0.25 : 0;
    const r = this.reaction;
    if (r) {
      const k = Math.max(0, 1 - (t - r.start) / 3.5);
      if (k <= 0) this.reaction = null;
      else if (r.kind === 'cheer') { amp = Math.max(amp, 0.38 * k); freq = 8.5; shake = 0.08; }
      else if (r.kind === 'anger') { amp = Math.max(amp, 0.22 * k); freq = 9; shake = Math.max(shake, 0.45 * k); }
      else if (r.kind === 'clash') { amp = Math.max(amp, 0.3 * k); freq = 11; shake = Math.max(shake, 0.5 * k); push = Math.max(push, 0.6 * k); }
    }
    const n = this.count;
    const p = this.presence;
    const dir = (x: number): number => (x >= this.ax ? 1 : -1);
    const bb = this.body.buf, hb = this.head.buf, sb = this.stick.buf;
    for (let i = 0; i < n; i++) {
      const s = Math.max(0, Math.min(1, p * n - this.rank[i]));
      const sc = this.scale[i] * s;
      const ph = this.phase[i];
      const bounce = Math.abs(Math.sin(t * freq + ph)) * amp;
      const leave = 1 - p; // people drift away from the building as the crowd thins
      const x = this.homeX[i] + Math.sin(t * freq * 0.5 + ph) * 0.04 + dir(this.homeX[i]) * leave * 10;
      const z = this.homeZ[i] - push * (0.5 + 0.5 * Math.sin(t * 3 + ph)) * 0.8 + leave * 6;
      put(bb, i, x, bounce + 0.75 * sc, z, sc, sc, sc, 0);
      put(hb, i, x, bounce + 1.75 * sc, z, sc, sc, sc, 0);
    }
    for (let j = 0; j < this.carriers; j++) {
      const i = Math.floor((j * n) / this.carriers);
      const s = Math.max(0, Math.min(1, p * n - this.rank[i]));
      const sc = this.scale[i] * s;
      const bounce = Math.abs(Math.sin(t * freq + this.phase[i])) * amp;
      const leave = 1 - p;
      const x = this.homeX[i] + dir(this.homeX[i]) * leave * 10 + 0.3;
      const z = this.homeZ[i] - push * (0.5 + 0.5 * Math.sin(t * 3 + this.phase[i])) * 0.8 + leave * 6;
      put(sb, j, x, bounce + 1.9 * sc, z, sc, sc, sc, 0);
    }
    this.signs.forEach((layer, m) => {
      const list = this.signAgents[m];
      for (let q = 0; q < list.length; q++) {
        const i = list[q];
        const s = Math.max(0, Math.min(1, p * n - this.rank[i]));
        const sc = this.scale[i] * s;
        const bounce = Math.abs(Math.sin(t * freq + this.phase[i])) * amp;
        const leave = 1 - p;
        const x = this.homeX[i] + dir(this.homeX[i]) * leave * 10 + 0.3;
        const z = this.homeZ[i] - push * (0.5 + 0.5 * Math.sin(t * 3 + this.phase[i])) * 0.8 + leave * 6 + 0.12;
        const tilt = Math.PI + Math.sin(t * freq * 0.7 + this.phase[i]) * shake;
        put(layer.buf, q, x, bounce + 2.55 * sc, z, 1.5 * sc, 0.95 * sc, 1, tilt);
      }
      layer.mesh.thinInstanceBufferUpdated('matrix');
    });
    this.body.mesh.thinInstanceBufferUpdated('matrix');
    this.head.mesh.thinInstanceBufferUpdated('matrix');
    this.stick.mesh.thinInstanceBufferUpdated('matrix');
    this.animatePolice(v, Math.min(1, p * 2), t, mood === 'clash' || mood === 'riot');
  }

  private animatePolice(v: ProtestView | null, vis: number, t: number, tense: boolean): void {
    const def = POLICE_BY_ID[v?.police ?? 'standard'];
    const n = Math.min(this.policeCap, def.officers);
    const spacing = Math.min(1.5, 17 / Math.max(1, n));
    const x0 = this.ax - ((n - 1) * spacing) / 2;
    const advance = tense && def.force >= 0.7 ? 0.5 + 0.35 * Math.sin(t * 2.5) : 0;
    const shields = def.force >= 0.3 ? n : 0;
    for (let o = 0; o < n; o++) {
      const x = x0 + o * spacing;
      const z = POLICE_Z + advance;
      const bob = tense ? Math.abs(Math.sin(t * 8 + o)) * 0.08 : 0;
      put(this.polBody.buf, o, x, 0.78 * vis + bob, z, vis, vis, vis, 0);
      put(this.polHead.buf, o, x, 1.8 * vis + bob, z, vis, vis, vis, 0);
      if (o < shields) put(this.polShield.buf, o, x, 0.95 * vis + bob, z + 0.55, 0.8 * vis, 1.2 * vis, 0.1 * vis, 0);
    }
    this.polBody.mesh.thinInstanceCount = n;
    this.polHead.mesh.thinInstanceCount = n;
    this.polShield.mesh.thinInstanceCount = shields;
    this.polBody.mesh.thinInstanceBufferUpdated('matrix');
    this.polHead.mesh.thinInstanceBufferUpdated('matrix');
    this.polShield.mesh.thinInstanceBufferUpdated('matrix');
  }

  dispose(): void {
    for (const a of this.causeAssets) a.dispose();
    for (const d of this.disposables) d.dispose();
    this.root.dispose();
  }
}
