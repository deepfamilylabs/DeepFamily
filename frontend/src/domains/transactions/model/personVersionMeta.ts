import type { PersonVersionOption } from "../hooks/usePersonVersionOptions";

/** Matches the hash abbreviation used across the search results. */
export function shortHash(value: string) {
  return value.length > 20 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

/**
 * Who recorded a version and when. An unminted version publishes no identity,
 * so this is all a contributor has to judge it by.
 */
export function describeVersionOrigin(version: PersonVersionOption) {
  return {
    submitter: version.addedBy ? shortHash(version.addedBy) : "",
    date: version.timestamp ? new Date(version.timestamp * 1000).toLocaleDateString() : "",
  };
}
