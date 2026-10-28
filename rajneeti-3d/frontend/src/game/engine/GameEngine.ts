import {
  ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Scene, ShadowGenerator,
  TransformNode, Vector3, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';
import { inputState } from '../controllers/input';
import { LOCATIONS, WORLD_HALF_SIZE } from '../../data/world';
import { daylightAt } from '../../simulation/calendar/clock';
import { animateCharacter, createCharacter, type AnimState, type Character } from './character';
import { buildWorld, type WorldBuild } from './world';
import { resolveCircle } from './collision';
import { ProtestScene } from './protestScene';
import type { ProtestView, Reaction } from '../../simulation/world/protests';

export type Quality = 'low' | 'medium' | 'high';

export interface EngineHooks {
  onNearby: (label: string | null) => void;
  onInteract: (id: string) => void;
  onPosition: (x: number, z: number, rotY: number) => void;
}

export interface EngineOptions {
  quality: Quality;
  party: { name: string; abbreviation: string; color: string };
  playerColors: { body: string; skin: string; hair: string; legs: string };
  spawn: { x: number; z: number; rotY: number };
}

interface Interactable {
  id: string;
  label: string;
  radius: number;
  pos: () => { x: number; z: number };
}

interface Npc {
  ch: Character;
  anim: AnimState;
  waypoints?: { x: number; z: number }[];
  wp: number;
  talking: boolean;
  escort?: boolean;
}

const PLAYER_RADIUS = 0.55;
const GRAVITY = -22;
const JUMP_SPEED = 8;
const WALK = 4.5;
const RUN = 8.5;

const SKY_DAY = new Color3(0.53, 0.81, 0.98);
const SKY_NIGHT = new Color3(0.04, 0.06, 0.16);

function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class GameEngine {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private camTarget: TransformNode;
  private sun: DirectionalLight;
  private hemi: HemisphericLight;
  private world: WorldBuild;
  private player: Character;
  private playerAnim: AnimState = { phase: 0, moveAmount: 0, running: false, airborne: false, wave: 0, turn: 0, time: 0 };
  private protest: ProtestScene;
  private npcs: Npc[] = [];
  private interactables: Interactable[] = [];
  private px: number;
  private pz: number;
  private py = 0;
  private vy = 0;
  private rotY: number;
  private blocked = false;
  private nearbyId: string | null = null;
  private reportTimer = 0;
  private inOffice = false;
  private escortActive = false;
  private convoyMeshes: TransformNode[] = [];
  private onResize = () => this.engine.resize();

  constructor(canvas: HTMLCanvasElement, private hooks: EngineHooks, opts: EngineOptions) {
    this.engine = new Engine(canvas, opts.quality !== 'low', { adaptToDeviceRatio: true, preserveDrawingBuffer: false });
    if (opts.quality === 'low') this.engine.setHardwareScalingLevel(1.4);
    this.scene = new Scene(this.engine);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.006;

    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), this.scene);
    this.hemi.groundColor = new Color3(0.45, 0.42, 0.5);
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.4), this.scene);
    this.sun.position = new Vector3(40, 60, 30);

    this.world = buildWorld(this.scene, opts.party);

    if (opts.quality !== 'low') {
      const sg = new ShadowGenerator(opts.quality === 'high' ? 2048 : 1024, this.sun);
      sg.useBlurExponentialShadowMap = true;
      sg.blurKernel = opts.quality === 'high' ? 24 : 12;
      this.world.casters.forEach((m) => sg.addShadowCaster(m));
      this.player = createCharacter(this.scene, 'player', opts.playerColors);
      this.player.meshes.forEach((m) => sg.addShadowCaster(m));
    } else {
      this.player = createCharacter(this.scene, 'player', opts.playerColors);
    }

    this.protest = new ProtestScene(this.scene, opts.quality);

    this.px = opts.spawn.x;
    this.pz = opts.spawn.z;
    this.rotY = opts.spawn.rotY;
    this.createConvoy(opts.party.color);

    // Camera follows an invisible node that trails the player smoothly.
    this.camTarget = new TransformNode('camTarget', this.scene);
    this.camTarget.position.set(this.px, 1.8, this.pz);
    this.camera = new ArcRotateCamera('cam', Math.PI / 2, 1.15, 13, this.camTarget.position.clone(), this.scene);
    this.camera.lockedTarget = this.camTarget;
    this.camera.lowerRadiusLimit = 6;
    this.camera.upperRadiusLimit = 20;
    this.camera.lowerBetaLimit = 0.35;
    this.camera.upperBetaLimit = 1.45;
    this.camera.panningSensibility = 0;
    this.camera.angularSensibilityX = 700;
    this.camera.angularSensibilityY = 700;
    this.camera.wheelPrecision = 30;
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.camera.attachControl(canvas, true);
    this.camera.minZ = 0.3;
    this.camera.maxZ = 220;

    this.spawnNpcs(opts.party.color);
    this.interactables.push(
      { id: 'hq-door', label: 'Enter Party Headquarters', radius: 3.2, pos: () => ({ x: LOCATIONS[0].x, z: LOCATIONS[0].z + 6.5 }) },
      { id: 'gov', label: 'Press E to Enter Government Office', radius: 4, pos: () => ({ x: LOCATIONS[1].x, z: LOCATIONS[1].z + 6.5 }) },
      { id: 'office-exit', label: 'Press E to Exit Government Office', radius: 3, pos: () => ({ x: LOCATIONS[1].x, z: LOCATIONS[1].z + 17 }) },
      { id: 'pm-chair', label: 'Press E to Sit in the PM Chair', radius: 2.2, pos: () => ({ x: LOCATIONS[1].x, z: LOCATIONS[1].z + 8.9 }) },
      { id: 'election', label: 'Election Commission', radius: 4, pos: () => ({ x: LOCATIONS[2].x, z: LOCATIONS[2].z + 6 }) },
      { id: 'rally', label: 'Rally Ground', radius: 6, pos: () => ({ x: LOCATIONS[4].x, z: LOCATIONS[4].z }) },
      { id: 'park', label: 'Public Park', radius: 5, pos: () => ({ x: LOCATIONS[3].x + 8, z: LOCATIONS[3].z }) },
      { id: 'ministry', label: 'Enter Coalition Ministry Office', radius: 4, pos: () => ({ x: LOCATIONS[5].x, z: LOCATIONS[5].z + 6 }) },
      { id: 'parliament-building', label: 'Enter Parliament Chamber', radius: 4, pos: () => ({ x: LOCATIONS[6].x, z: LOCATIONS[6].z + 6 }) },
    );

    this.setTimeOfDay(6 * 60);
    this.scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.05, this.engine.getDeltaTime() / 1000)));
    this.engine.runRenderLoop(() => this.scene.render());
    window.addEventListener('resize', this.onResize);
  }

  private spawnNpcs(partyColor: string): void {
    const mk = (name: string, x: number, z: number, colors: { body: string; skin: string; hair: string; legs: string }, waypoints?: { x: number; z: number }[]): Npc => {
      const ch = createCharacter(this.scene, name, colors);
      ch.root.position.set(x, 0, z);
      this.world.casters.push(...ch.meshes);
      return { ch, anim: { phase: Math.random() * 6, moveAmount: 0, running: false, airborne: false, wave: 0, turn: 0, time: 0 }, waypoints, wp: 0, talking: false };
    };
    const secretary = mk('secretary', 4.5, -9.5, { body: partyColor, skin: '#c68642', hair: '#1b1b1b', legs: '#2b2f4a' });
    secretary.ch.root.rotation.y = 0;
    const citizen = mk('citizen', -10, 8, { body: '#4ecdc4', skin: '#e0ac69', hair: '#5a3a22', legs: '#3a4a8a' }, [
      { x: -12, z: 7.5 }, { x: 12, z: 7.5 },
    ]);
    // Two security officers guard the Prime Minister's door at all times.
    const gov = LOCATIONS[1];
    const guards = [-1.9, 1.9].map((dx, i) => mk(`guard-${i}`, gov.x + dx, gov.z + 5.5, { body: '#1f3a8a', skin: i ? '#8d5524' : '#c68642', hair: '#111111', legs: '#14213d' }));
    const escort = Array.from({ length: 12 }, (_, i) => mk(`pm-escort-${i}`, this.px, this.pz, { body: '#1f3a8a', skin: i % 2 ? '#c68642' : '#d9a066', hair: '#111111', legs: '#14213d' }));
    escort.forEach((n) => { n.escort = true; n.ch.root.setEnabled(false); });
    this.npcs.push(secretary, citizen, ...guards, ...escort);
    this.interactables.push(
      { id: 'npc-secretary', label: 'Talk to Meera Joshi (Secretary)', radius: 2.6, pos: () => ({ x: secretary.ch.root.position.x, z: secretary.ch.root.position.z }) },
      { id: 'npc-guard', label: 'Talk to the security officer', radius: 2.6, pos: () => ({ x: guards[0].ch.root.position.x, z: guards[0].ch.root.position.z }) },
      { id: 'npc-citizen', label: 'Talk to Ravi (Shopkeeper)', radius: 2.6, pos: () => ({ x: citizen.ch.root.position.x, z: citizen.ch.root.position.z }) },
    );
    this.npcs[0].talking = false;
  }

  setBlocked(b: boolean): void { this.blocked = b; }
  setPrimeMinister(active: boolean): void {
    this.escortActive = active;
    this.npcs.filter((n) => n.escort).forEach((n) => n.ch.root.setEnabled(active && !this.inOffice));
    this.convoyMeshes.forEach((m) => m.setEnabled(active && !this.inOffice));
  }

  private createConvoy(partyColor: string): void {
    const bodyMat = new StandardMaterial('pmVehicleBody', this.scene); bodyMat.diffuseColor = Color3.FromHexString(partyColor);
    const glassMat = new StandardMaterial('pmVehicleGlass', this.scene); glassMat.diffuseColor = new Color3(0.08, 0.12, 0.2);
    const make = (name: string, x: number, z: number, scale: Vector3, mat: StandardMaterial): TransformNode => {
      const mesh = MeshBuilder.CreateBox(name, { width: scale.x, height: scale.y, depth: scale.z }, this.scene);
      mesh.material = mat; mesh.position.set(x, scale.y / 2, z); mesh.setEnabled(false); this.convoyMeshes.push(mesh); return mesh;
    };
    make('pm-official-vehicle', this.px, this.pz - 3.4, new Vector3(2.2, 0.8, 4.2), bodyMat);
    make('pm-vehicle-roof', this.px, this.pz - 3.4, new Vector3(1.5, 0.35, 1.5), glassMat);
  }
  enterOffice(): void { if (this.inOffice) return; this.inOffice = true; this.px = LOCATIONS[1].x; this.pz = LOCATIONS[1].z + 12; this.npcs.filter((n) => n.escort).forEach((n) => n.ch.root.setEnabled(false)); }
  exitOffice(): void { if (!this.inOffice) return; this.inOffice = false; this.px = LOCATIONS[1].x; this.pz = LOCATIONS[1].z + 6.5; this.npcs.filter((n) => n.escort).forEach((n) => n.ch.root.setEnabled(this.escortActive)); }

  /** Shows, updates or removes the crowd outside the Prime Minister's building. */
  setProtest(view: ProtestView | null): void { this.protest.setView(view); }

  /** The crowd cheers, jeers or clashes in response to a government decision. */
  reactCrowd(kind: Reaction): void { this.protest.react(kind); }

  setTimeOfDay(minutes: number): void {
    const day = daylightAt(minutes);
    const hour = minutes / 60;
    const a = Math.max(0, Math.min(1, (hour - 6) / 12)) * Math.PI;
    this.sun.direction.set(-Math.cos(a) * 0.9, -Math.max(0.35, Math.sin(a)), -0.4);
    this.sun.intensity = 0.15 + day * 0.95;
    this.hemi.intensity = 0.35 + day * 0.45;
    const sky = Color3.Lerp(SKY_NIGHT, SKY_DAY, day);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = sky;
    this.world.lampMaterial.emissiveColor = day < 0.35 ? new Color3(1, 0.9, 0.5) : Color3.Black();
  }

  getPosition(): { x: number; z: number; rotY: number } { return { x: this.px, z: this.pz, rotY: this.rotY }; }

  private collide(x: number, z: number): { x: number; z: number } {
    let cx = x, cz = z;
    for (const c of this.world.colliders) {
      const r = resolveCircle(cx, cz, PLAYER_RADIUS, c);
      cx = r.x; cz = r.z;
    }
    const lim = WORLD_HALF_SIZE - 1;
    return { x: Math.max(-lim, Math.min(lim, cx)), z: Math.max(-lim, Math.min(lim, cz)) };
  }

  private update(dt: number): void {
    const a = this.playerAnim;
    a.time += dt;

    // Movement relative to the camera
    const mx = this.blocked ? 0 : inputState.moveX;
    const my = this.blocked ? 0 : inputState.moveY;
    let mag = Math.hypot(mx, my);
    if (mag > 1) mag = 1;
    const fx = -Math.cos(this.camera.alpha), fz = -Math.sin(this.camera.alpha);
    const rx = fz, rz = -fx;
    let dx = 0, dz = 0;
    if (mag > 0.05) {
      const n = Math.hypot(mx, my);
      dx = ((fx * my + rx * mx) / n) * mag;
      dz = ((fz * my + rz * mx) / n) * mag;
    }
    const running = inputState.run && mag > 0.05;
    const speed = running ? RUN : WALK;

    if (mag > 0.05) {
      const target = Math.atan2(dx, dz);
      const diff = angleDelta(this.rotY, target);
      this.rotY += diff * Math.min(1, dt * 12);
      a.turn = Math.max(-1, Math.min(1, diff));
    } else {
      a.turn *= 0.8;
    }

    const next = this.collide(this.px + dx * speed * dt, this.pz + dz * speed * dt);
    this.px = next.x;
    this.pz = next.z;

    // Gravity and ground detection (flat ground at y = 0)
    const grounded = this.py <= 0.001;
    if (grounded && !this.blocked && inputState.jump) this.vy = JUMP_SPEED;
    if (!grounded || this.vy > 0) {
      this.vy += GRAVITY * dt;
      this.py += this.vy * dt;
      if (this.py <= 0) { this.py = 0; this.vy = 0; }
    }

    // Interaction
    this.updateInteractables();
    if (inputState.interactPressed) {
      inputState.interactPressed = false;
      if (!this.blocked && this.nearbyId) {
        a.wave = 0.7;
        this.hooks.onInteract(this.nearbyId);
      }
    }
    if (a.wave > 0) a.wave -= dt;

    // Animation
    a.moveAmount += (mag - a.moveAmount) * Math.min(1, dt * 10);
    a.running = running;
    a.airborne = this.py > 0.05;
    a.phase += dt * (running ? 14 : 9) * Math.max(0.3, mag);
    this.player.root.position.set(this.px, this.py, this.pz);
    this.player.root.rotation.y = this.rotY;
    animateCharacter(this.player, a);

    this.updateNpcs(dt);
    if (this.escortActive && !this.inOffice) {
      const vehicle = this.convoyMeshes[0]; const roof = this.convoyMeshes[1];
      vehicle.position.x += (this.px - vehicle.position.x) * Math.min(1, dt * 6); vehicle.position.z += (this.pz - 3.4 - vehicle.position.z) * Math.min(1, dt * 6); vehicle.rotation.y = this.rotY;
      roof.position.x = vehicle.position.x; roof.position.z = vehicle.position.z; roof.rotation.y = vehicle.rotation.y;
    }
    this.protest.update(dt, this.camera.position.x, this.camera.position.z);

    // Smooth camera follow
    const k = 1 - Math.exp(-dt * 9);
    this.camTarget.position.x += (this.px - this.camTarget.position.x) * k;
    this.camTarget.position.z += (this.pz - this.camTarget.position.z) * k;
    this.camTarget.position.y += (this.py + 1.8 - this.camTarget.position.y) * k;

    this.reportTimer += dt;
    if (this.reportTimer > 0.25) {
      this.reportTimer = 0;
      this.hooks.onPosition(this.px, this.pz, this.rotY);
    }
  }

  private updateInteractables(): void {
    let best: Interactable | null = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      if (this.inOffice ? it.id === 'gov' : ['office-exit', 'pm-chair'].includes(it.id)) continue;
      const p = it.pos();
      const d = Math.hypot(p.x - this.px, p.z - this.pz);
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    const id = best ? best.id : null;
    if (id !== this.nearbyId) {
      this.nearbyId = id;
      this.hooks.onNearby(best ? best.label : null);
    }
  }

  private updateNpcs(dt: number): void {
    for (const n of this.npcs) {
      const pos = n.ch.root.position;
      const toPlayer = Math.hypot(this.px - pos.x, this.pz - pos.z);
      let moving = false;
      if (n.escort) {
        const idx = this.npcs.filter((x) => x.escort).indexOf(n);
        const angle = (idx / 12) * Math.PI * 2;
        const tx = this.px + Math.cos(angle) * 2.8;
        const tz = this.pz + Math.sin(angle) * 2.8;
        const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
        if (d > 0.45) { pos.x += dx / d * 2.2 * dt; pos.z += dz / d * 2.2 * dt; moving = true; }
        n.ch.root.rotation.y = Math.atan2(this.px - pos.x, this.pz - pos.z);
      } else if (toPlayer < 6) {
        // Face the player while they are close
        const target = Math.atan2(this.px - pos.x, this.pz - pos.z);
        n.ch.root.rotation.y += angleDelta(n.ch.root.rotation.y, target) * Math.min(1, dt * 6);
      } else if (n.waypoints) {
        const w = n.waypoints[n.wp];
        const dx = w.x - pos.x, dz = w.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) n.wp = (n.wp + 1) % n.waypoints.length;
        else {
          pos.x += (dx / d) * 1.6 * dt;
          pos.z += (dz / d) * 1.6 * dt;
          n.ch.root.rotation.y += angleDelta(n.ch.root.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
          moving = true;
        }
      }
      n.anim.time += dt;
      n.anim.moveAmount += ((moving ? 0.6 : 0) - n.anim.moveAmount) * Math.min(1, dt * 8);
      n.anim.phase += dt * 7;
      animateCharacter(n.ch, n.anim);
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.engine.stopRenderLoop();
    this.protest.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
