import { describe, expect, test } from 'bun:test'
import { actionFor, bind, DEFAULT_SETTINGS, keyLabel, parseSettings, pixelRatio } from '../src/games/bedwars/client/settings'

describe('settings', () => {
  test('saved values are validated and missing ones fall back to defaults', () => {
    const s = parseSettings({ sensitivity: 99, fov: 'wide', sprintMode: 'toggle', volume: 0.2, keys: { jump: ['KeyJ'], sneak: 'nope' } })
    expect(s.sensitivity).toBe(4)
    expect(s.fov).toBe(DEFAULT_SETTINGS.fov)
    expect(s.sprintMode).toBe('toggle')
    expect(s.volume).toBe(0.2)
    expect(s.keys.jump).toEqual(['KeyJ'])
    expect(s.keys.sneak).toEqual(DEFAULT_SETTINGS.keys.sneak)
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  test('settings saved with the old default sensitivity get the new, faster one', () => {
    expect(DEFAULT_SETTINGS.sensitivity).toBeGreaterThan(1)
    expect(parseSettings({ sensitivity: 1 }).sensitivity).toBe(DEFAULT_SETTINGS.sensitivity)
    // A deliberate choice of 1, saved since, is kept.
    expect(parseSettings({ sensitivity: 1, version: 2 }).sensitivity).toBe(1)
    expect(parseSettings({ sensitivity: 0.7 }).sensitivity).toBe(0.7)
  })

  test('Q drops the held item', () => {
    expect(actionFor(DEFAULT_SETTINGS, 'KeyQ')).toBe('drop')
  })

  test('sprint has a key by default, including one that is safe in a browser', () => {
    expect(DEFAULT_SETTINGS.keys.sprint).toContain('KeyR')
    expect(actionFor(DEFAULT_SETTINGS, 'ControlLeft')).toBe('sprint')
  })

  test('binding a key moves it off any other action', () => {
    const s = bind(DEFAULT_SETTINGS, 'jump', 'KeyE')
    expect(actionFor(s, 'KeyE')).toBe('jump')
    expect(s.keys.inventory).toEqual([])
    expect(s.keys.jump[0]).toBe('KeyE')
  })

  test('labels and quality', () => {
    expect(keyLabel('KeyW')).toBe('W')
    expect(keyLabel('ShiftLeft')).toBe('Left Shift')
    expect(keyLabel('Digit3')).toBe('3')
    expect(pixelRatio('low', 2)).toBe(0.75)
    expect(pixelRatio('high', 3)).toBe(2)
  })

  test('the layout editor saves a spot and a size for every control, including the mini buttons', () => {
    const s = parseSettings({
      touchLayout: { attack: [0.4, -0.5], bag: [-0.9, 0.2], stick: [0, 0], nope: [1, 1] },
      touchSizes: { use: 1.5, jump: 99, sneak: 'big', nope: 2 },
    })
    // Movement is no longer a small nudge: a control may be sent to any corner.
    expect(s.touchLayout.attack).toEqual([0.4, -0.5])
    expect(s.touchLayout.bag).toEqual([-0.9, 0.2])
    expect((s.touchLayout as Record<string, unknown>).nope).toBeUndefined()
    // Sizes are clamped to what the slider offers, and junk is dropped.
    expect(s.touchSizes.use).toBe(1.5)
    expect(s.touchSizes.jump).toBe(2)
    expect(s.touchSizes.sneak).toBeUndefined()
    expect((s.touchSizes as Record<string, unknown>).nope).toBeUndefined()
    expect(parseSettings({}).touchSizes).toEqual({})
  })
})
