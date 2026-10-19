import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Persistence from "../platform/persistence.ts";

/** Linear issues, read on the environment through the user's `linear` CLI. */
export function createLinearEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  return {
    issues: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issues",
      tag: WS_METHODS.linearListIssues,
      staleTimeMs: 60_000,
    }),
    issue: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:issue",
      tag: WS_METHODS.linearGetIssue,
      staleTimeMs: 60_000,
    }),
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:projects",
      tag: WS_METHODS.linearListProjects,
      staleTimeMs: 300_000,
    }),
    project: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:project",
      tag: WS_METHODS.linearGetProject,
      staleTimeMs: 60_000,
    }),
    filterOptions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:filter-options",
      tag: WS_METHODS.linearGetFilterOptions,
      staleTimeMs: 600_000,
    }),
  };
}
