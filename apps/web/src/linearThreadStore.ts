import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { useRightPanelStore } from "./rightPanelStore";

/** A Linear issue by ID (`ENG-123`) or a project by slug ID. */
export type LinearRef = { kind: "issue"; id: string } | { kind: "project"; id: string };

/** The issue list's filters, shared by every thread's panel. */
export interface LinearIssueFilters {
  /** `@me`, `any`, `none` (unassigned), or a username. */
  assignee: string;
  status: "open" | "todo" | "in-progress" | "backlog" | "done" | "all";
  cycle: "any" | "active" | "next" | "previous";
  /** A label name, or null for any. */
  label: string | null;
  /** A team key, or null for every team. */
  team: string | null;
}

export const DEFAULT_LINEAR_ISSUE_FILTERS: LinearIssueFilters = {
  assignee: "@me",
  status: "open",
  cycle: "any",
  label: null,
  team: null,
};

export const linearRefKey = (ref: LinearRef) => `${ref.kind}:${ref.id}`;

/**
 * What Linear work belongs to a thread, and what its Linear panel shows.
 *
 * The link is remembered on this device when a thread is started from an issue or project, or a
 * Linear link in the thread is opened. Without one, an issue ID in the thread's branch is used.
 */
interface LinearThreadStoreState {
  /** Issue or project the thread is about, by thread key. */
  linkedByThreadKey: Record<string, LinearRef>;
  /** The panel's detail views, innermost last; empty or absent shows the list. */
  stackByThreadKey: Record<string, ReadonlyArray<LinearRef>>;
  link: (thread: ScopedThreadRef, ref: LinearRef) => void;
  unlink: (thread: ScopedThreadRef) => void;
  /** Opens `ref` in the panel; `push` keeps the current view to go back to. */
  show: (thread: ScopedThreadRef, ref: LinearRef, mode: "push" | "replace") => void;
  back: (thread: ScopedThreadRef) => void;
  issueFilters: LinearIssueFilters;
  setIssueFilters: (patch: Partial<LinearIssueFilters>) => void;
}

const omit = <A>(record: Record<string, A>, key: string) => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

export const useLinearThreadStore = create<LinearThreadStoreState>()(
  persist(
    (set) => ({
      linkedByThreadKey: {},
      stackByThreadKey: {},
      issueFilters: DEFAULT_LINEAR_ISSUE_FILTERS,
      setIssueFilters: (patch) =>
        set((state) => ({ issueFilters: { ...state.issueFilters, ...patch } })),
      link: (thread, ref) =>
        set((state) => ({
          linkedByThreadKey: { ...state.linkedByThreadKey, [scopedThreadKey(thread)]: ref },
        })),
      unlink: (thread) =>
        set((state) => ({
          linkedByThreadKey: omit(state.linkedByThreadKey, scopedThreadKey(thread)),
        })),
      show: (thread, ref, mode) =>
        set((state) => {
          const key = scopedThreadKey(thread);
          const stack = mode === "push" ? (state.stackByThreadKey[key] ?? []) : [];
          return { stackByThreadKey: { ...state.stackByThreadKey, [key]: [...stack, ref] } };
        }),
      back: (thread) =>
        set((state) => {
          const key = scopedThreadKey(thread);
          const stack = state.stackByThreadKey[key] ?? [];
          return {
            stackByThreadKey:
              stack.length <= 1
                ? omit(state.stackByThreadKey, key)
                : { ...state.stackByThreadKey, [key]: stack.slice(0, -1) },
          };
        }),
    }),
    {
      name: "t3code:linear-thread:v1",
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        linkedByThreadKey: state.linkedByThreadKey,
        issueFilters: state.issueFilters,
      }),
      // Version 1 linked threads to bare issue IDs.
      migrate: (persisted, version) => {
        const linked = (persisted as { linkedByThreadKey?: Record<string, unknown> } | null)
          ?.linkedByThreadKey;
        if (version >= 2 || !linked) {
          return persisted as { linkedByThreadKey: {}; issueFilters: LinearIssueFilters };
        }
        const linkedByThreadKey: Record<string, LinearRef> = {};
        for (const [key, value] of Object.entries(linked)) {
          if (typeof value === "string") linkedByThreadKey[key] = { kind: "issue", id: value };
        }
        return { linkedByThreadKey, issueFilters: DEFAULT_LINEAR_ISSUE_FILTERS };
      },
      // Filters saved before a field existed take its default.
      merge: (persisted, current) => {
        const saved = persisted as Partial<LinearThreadStoreState> | undefined;
        return {
          ...current,
          ...saved,
          issueFilters: { ...DEFAULT_LINEAR_ISSUE_FILTERS, ...saved?.issueFilters },
        };
      },
    },
  ),
);

const LINEAR_ISSUE_URL = /^https?:\/\/linear\.app\/[^/]+\/issue\/([a-z][a-z0-9]*-\d+)(?:[/?#]|$)/i;
/** Project URLs end their slug with the project's slug ID: `/project/launch-plan-b673cd08289b`. */
const LINEAR_PROJECT_URL =
  /^https?:\/\/linear\.app\/[^/]+\/project\/(?:[^/?#]*-)?([0-9a-f]{8,})(?:[/?#]|$)/i;
const BRANCH_ISSUE_ID = /(?:^|[/_-])([a-z][a-z0-9]{0,9}-\d+)(?=$|[/_-])/i;

/** The issue or project a linear.app URL points at. */
export function parseLinearUrl(url: string): LinearRef | null {
  const trimmed = url.trim();
  const issue = LINEAR_ISSUE_URL.exec(trimmed)?.[1];
  if (issue) return { kind: "issue", id: issue.toUpperCase() };
  const project = LINEAR_PROJECT_URL.exec(trimmed)?.[1];
  return project ? { kind: "project", id: project.toLowerCase() } : null;
}

/** A Linear issue ID in a branch name, as Linear's "copy git branch name" writes it. */
export function linearIssueIdFromBranch(branch: string | null | undefined): string | null {
  return branch ? (BRANCH_ISSUE_ID.exec(branch)?.[1]?.toUpperCase() ?? null) : null;
}

/** Opens the thread's Linear panel on an issue or project and links the thread to it. */
export function openLinearRef(thread: ScopedThreadRef, ref: LinearRef) {
  const store = useLinearThreadStore.getState();
  store.link(thread, ref);
  store.show(thread, ref, "replace");
  useRightPanelStore.getState().open(thread, "linear");
}

/** The thread's Linear work: the remembered link first, then an issue ID in the branch name. */
export function useThreadLinearRef(
  thread: ScopedThreadRef | null,
  branch: string | null | undefined,
): LinearRef | null {
  const linked = useLinearThreadStore((state) =>
    thread ? state.linkedByThreadKey[scopedThreadKey(thread)] : undefined,
  );
  if (linked) return linked;
  const issueId = linearIssueIdFromBranch(branch);
  return issueId ? { kind: "issue", id: issueId } : null;
}
