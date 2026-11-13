import {
  BoxGeometry,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  type Object3D,
  type Texture,
} from 'three'
import { TEAM_COLORS, type TeamId } from '../blocks'
import { item, placedBlock } from '../items'
import type { AtlasLayout } from '../../../engine/render/atlas-layout'
import { blockCube } from '../../../engine/render/entities'
import { artFor, drawItemArt, DEFAULT_HAND_POSE, HAND_POSE } from './icons'
import { heldItemMesh } from './held-art'
import { setBoxUV } from './avatar'

/** The first-person arm and held item, drawn in its own scene over the world. */
export class ViewModel {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(70, 1, 0.01, 10)
  private hand = new Group()
  private arm: Mesh
  private held: Object3D | null = null
  private heldKey = ''
  private swing = 1
  private bob = 0
  private walk = 0
  private equip = 1
  private shieldUp = 0
  /** 0 while not eating, rising to 1 as the hand comes up to the mouth. */
  private eatUp = 0
  /** Seconds the current bite has been going, for the chewing bob. */
  private eatTime = 0
  /** Same, for a potion: the bottle comes up and tips to the mouth while you drink. */
  private drinkUp = 0
  private drinkTime = 0
  private artTextures = new Map<string, Texture>()
  private armMat = new MeshLambertMaterial({ color: '#d9a066' })
  private armOverMat = new MeshLambertMaterial({ transparent: true, alphaTest: 0.5, visible: false })

  constructor(
    private readonly atlas: Texture,
    private readonly layout: AtlasLayout,
  ) {
    this.scene.add(new HemisphereLight(0xffffff, 0x8899aa, 2.2))
    const sun = new DirectionalLight(0xffffff, 1.2)
    sun.position.set(0.4, 1, 0.3)
    this.scene.add(sun)
    // Your own right arm, wearing your skin: the 4×12×4 arm box of the skin texture,
    // laid along the view with the hand forward, plus its outer (armour) layer.
    const s = 0.0275
    const base = new BoxGeometry(4 * s, 12 * s, 4 * s)
    setBoxUV(base, 40, 16, 4, 12, 4)
    const over = new BoxGeometry(4.6 * s, 12.4 * s, 4.6 * s)
    setBoxUV(over, 40, 32, 4, 12, 4)
    this.arm = new Mesh(base, this.armMat)
    const outer = new Mesh(over, this.armOverMat)
    for (const m of [this.arm, outer]) {
      m.rotation.x = Math.PI / 2
      m.position.set(0, -0.02, 0.12)
    }
    this.hand.add(this.arm, outer)
    this.hand.position.set(0.4, -0.36, -0.8)
    this.hand.rotation.set(0.15, 0.2, 0)
    this.scene.add(this.hand)
  }

  /** Dresses the arm in your skin texture (from your third-person figure). */
  setSkin(skin: Texture | null) {
    if (!skin || this.armMat.map === skin) return
    this.armMat.map = skin
    this.armMat.color.set('#ffffff')
    this.armOverMat.map = skin
    this.armOverMat.visible = true
    this.armMat.needsUpdate = this.armOverMat.needsUpdate = true
  }

  /** Ticks since the swing began (20 when idle), for the third-person figure. */
  swingTicks(): number {
    return this.swing >= 1 ? 20 : Math.floor(this.swing * 6)
  }

  /** Starts a swing; called on every attack, dig or place. A new click late in a swing restarts it cleanly. */
  swingNow() {
    if (this.swing >= 0.6) this.swing = 0
  }

  setHeld(id: string | null, team: TeamId | null) {
    const key = `${id}:${team}`
    if (key === this.heldKey) return
    // Switching items dips the hand out of view and brings the new one up.
    if (this.heldKey) this.equip = 0
    this.heldKey = key
    ;(this.arm.material as MeshLambertMaterial).color.set(team ? TEAM_COLORS[team] : '#9a9a9a')
    if (this.held) this.hand.remove(this.held)
    this.held = null
    const def = item(id ?? undefined)
    if (!def) return
    const block = def.kind === 'block' ? placedBlock(def, team ?? 'red') : def.kind === 'tnt' ? def.block : undefined
    if (block !== undefined) {
      const m = new Mesh(blockCube(this.layout, block), new MeshLambertMaterial({ map: this.atlas, alphaTest: 0.5 }))
      m.scale.setScalar(0.22)
      m.position.set(-0.02, 0.08, -0.06)
      m.rotation.set(0.1, 0.7, 0)
      this.held = m
    } else {
      // Pose comes from the art tables: grip pixel, offset and rotation per drawing.
      const pose = HAND_POSE[def.tool ?? def.kind] ?? DEFAULT_HAND_POSE
      const m = heldItemMesh(artFor(def.id) ?? [], this.artFor(def.id), 0.36, pose.grip)
      m.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
      m.rotation.set(pose.rot[0], pose.rot[1], pose.rot[2])
      this.held = m
    }
    this.hand.add(this.held)
  }

  private artFor(id: string): Texture {
    let t = this.artTextures.get(id)
    if (!t) {
      const c = document.createElement('canvas')
      c.width = c.height = 16
      drawItemArt(c.getContext('2d')!, id)
      t = new CanvasTexture(c)
      t.magFilter = NearestFilter
      t.minFilter = NearestFilter
      t.colorSpace = SRGBColorSpace
      this.artTextures.set(id, t)
    }
    return t
  }

  /**
   * Per frame: bob with walking speed, raise a shield, play the swing, dip on
   * switching items. While `eating` the item comes up to the mouth and is chewed
   * in an even rhythm for the length of the bite (1.4 s, run by the game); while
   * `drinking` the bottle comes up and tips over toward the mouth (1.6 s).
   */
  frame(dt: number, walking: number, shield: boolean, eating: boolean, aspect: number, draw = 0, drinking = false) {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    this.eatTime = eating ? this.eatTime + dt : 0
    this.eatUp += ((eating ? 1 : 0) - this.eatUp) * Math.min(1, dt * 16)
    this.drinkTime = drinking ? this.drinkTime + dt : 0
    this.drinkUp += ((drinking ? 1 : 0) - this.drinkUp) * Math.min(1, dt * 16)
    // Smooth the walk amount so stopping and starting do not snap the hand.
    this.walk += (walking - this.walk) * Math.min(1, dt * 10)
    this.bob += dt * this.walk * 9
    this.swing = Math.min(1, this.swing + dt / SWING_SECONDS)
    this.equip = Math.min(1, this.equip + dt / EQUIP_SECONDS)
    this.shieldUp += ((shield ? 1 : 0) - this.shieldUp) * Math.min(1, dt * 14)

    // The swing: an arc that chops down and across toward the crosshair and
    // returns, fast out and eased back (sin of p² and of √p).
    const p = this.swing
    const chop = p < 1 ? Math.sin(Math.sqrt(p) * Math.PI) : 0
    const sweep = p < 1 ? Math.sin(p * p * Math.PI) : 0
    const lift = p < 1 ? Math.sin(Math.sqrt(p) * Math.PI * 2) : 0
    const bobX = Math.sin(this.bob) * 0.025 * this.walk
    const bobY = -Math.abs(Math.cos(this.bob)) * 0.03 * this.walk
    const dip = (1 - easeOut(this.equip)) * 0.45
    const sh = this.shieldUp
    // Eating: up to the mouth, tilted so the item faces you, with a slow chew.
    const e = this.eatUp
    const chew = Math.sin(this.eatTime * Math.PI * 2 * 4) * 0.014 * e
    // Drinking: the bottle goes up to the mouth, tips over and back in little sips.
    const d = this.drinkUp
    const sip = Math.sin(this.drinkTime * Math.PI * 2 * 3) * 0.012 * d

    this.hand.position.set(
      0.4 + bobX - chop * 0.24 - sh * 0.24 - draw * 0.15 - e * 0.16 - d * 0.18,
      -0.36 + bobY + lift * 0.1 - dip + sh * 0.08 + draw * 0.06 + e * (0.2 + chew) + d * (0.22 + sip),
      -0.8 - sweep * 0.16 + draw * 0.18 + e * 0.2 + d * 0.16,
    )
    this.hand.rotation.set(
      0.15 - chop * 0.95 + e * 0.42 - chew * 2 + d * 0.2,
      0.2 + sweep * 0.55 + sh * 0.6 + e * 0.5 + d * 0.1,
      -chop * 0.22 + draw * 0.5 - e * 0.12 + d * 1.1,
    )
  }
}

const SWING_SECONDS = 0.28
const EQUIP_SECONDS = 0.18

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t)
}
