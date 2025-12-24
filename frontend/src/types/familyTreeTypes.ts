import type * as d3 from 'd3'
import type { NodeId } from './graph'

/**
 * FamilyTree shared types.
 *
 * This file acts as a "namespace" for types used across the FamilyTree feature.
 * - `Base*` types describe the canonical graph shape (view-independent).
 * - `Positioned*` types extend the base shape with layout coordinates (tree/dag).
 * - `Force*` types extend the base shape with d3-force simulation fields.
 */

/**
 * Canonical node shape for the FamilyTree graph (view-independent).
 * `id` encodes `{ personHash, versionIndex }` as a single key.
 */
export type BaseNode = {
  id: NodeId
  depth: number
  personHash: string
  versionIndex: number
}

/** Canonical edge shape for the FamilyTree graph (view-independent). */
export type BaseEdge = { from: NodeId; to: NodeId }

/** Node with layout coordinates (used by tree/dag layouts). */
export type PositionedNode = BaseNode & { x: number; y: number }
/** Edge used by positioned layouts (same as BaseEdge). */
export type PositionedEdge = BaseEdge

/**
 * Node used by d3-force.
 * d3 mutates/assigns `x/y/vx/vy` during initialization & each tick.
 */
export type ForceNode = d3.SimulationNodeDatum & BaseNode

/**
 * Link used by d3-force.
 * - `source/target` start as ids, then are replaced by node object references by d3-forceLink().
 * - `from/to` are stable endpoints we keep for keying/debugging (d3 won't mutate these).
 */
export type ForceLink = d3.SimulationLinkDatum<ForceNode> & {
  from: NodeId
  to: NodeId
  source: NodeId | ForceNode
  target: NodeId | ForceNode
}
