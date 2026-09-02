import type { NodeId } from "../../../shared/model";

/**
 * FamilyTree shared types.
 *
 * This file acts as a "namespace" for types used across the FamilyTree feature.
 * - `Base*` types describe the canonical graph shape (view-independent).
 * - `Positioned*` types extend the base shape with layout coordinates (tree/dag).
 */

/**
 * Canonical node shape for the FamilyTree graph (view-independent).
 * `id` encodes `{ personHash, versionIndex }` as a single key.
 */
export type BaseNode = {
  id: NodeId;
  depth: number;
  personHash: string;
  versionIndex: number;
};

/** Canonical edge shape for the FamilyTree graph (view-independent). */
export type BaseEdge = { from: NodeId; to: NodeId };

/** Node with layout coordinates (used by tree/dag layouts). */
export type PositionedNode = BaseNode & { x: number; y: number };
/** Edge used by positioned layouts (same as BaseEdge). */
export type PositionedEdge = BaseEdge;
