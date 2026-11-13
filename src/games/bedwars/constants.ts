export * from '../../engine/constants'
import { TPS } from '../../engine/constants'

/** The product name shown in the window title, menus and chat. Change it once here. */
export const BRAND = 'Gooncraft'

export const MAX_HEALTH = 20
/** Ticks a player cannot be hurt again after a hit. */
export const HURT_TICKS = 10
/** A death within this many ticks of a hit is credited to the attacker (void knocks). */
export const KILL_CREDIT_TICKS = 10 * TPS
export const SPAWN_PROTECTION_TICKS = 3 * TPS
export const RESPAWN_TICKS = 5 * TPS
/** How long a golden apple takes to eat: 1.4 seconds, as in Minecraft. */
export const EAT_TICKS = Math.round(1.4 * TPS)
/** How long a potion takes to drink: 1.6 seconds, a little slower than a bite. */
export const DRINK_TICKS = Math.round(1.6 * TPS)
/** Eating slows you to a shuffle: 70% off your walking speed, and you lose the speed you had. */
export const EAT_SLOWDOWN = 0.3
