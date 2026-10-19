import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { BoxIcon, ListTodo } from "lucide-react";

import {
  type LinearRef,
  openLinearRef,
  useLinearThreadStore,
  useThreadLinearRef,
} from "~/linearThreadStore";
import { useThreadShell } from "~/state/entities";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { ThreadDetailsControl } from "../chat/ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "../chat/threadDetailsPanelStyles";

interface RowSummary {
  title: string;
  label: string;
  statusName: string;
  statusColor: string;
}

function useLinearRefSummary(
  thread: ScopedThreadRef,
  ref: LinearRef | null,
): RowSummary | null | undefined {
  const environmentId = thread.environmentId;
  const issue = useEnvironmentQuery(
    ref?.kind === "issue"
      ? linearEnvironment.issue({ environmentId, input: { identifier: ref.id } })
      : null,
  ).data;
  const project = useEnvironmentQuery(
    ref?.kind === "project"
      ? linearEnvironment.project({ environmentId, input: { project: ref.id } })
      : null,
  ).data;
  if (ref === null) return undefined;
  if (issue) {
    return {
      title: issue.title,
      label: issue.identifier,
      statusName: issue.stateName,
      statusColor: issue.stateColor,
    };
  }
  if (project) {
    return {
      title: project.name,
      label:
        project.progress === undefined
          ? "Project"
          : `Project · ${Math.round(project.progress * 100)}% done`,
      statusName: project.statusName,
      statusColor: project.statusColor,
    };
  }
  return null;
}

/**
 * The thread's Linear issue or project in the thread details panel. Opens it in the Linear
 * panel; a remembered link can be unlinked, an issue read from the branch name follows the branch.
 */
export function ThreadLinearIssueRow({ threadRef }: { threadRef: ScopedThreadRef }) {
  const branch = useThreadShell(threadRef)?.branch;
  const ref = useThreadLinearRef(threadRef, branch);
  const remembered = useLinearThreadStore(
    (state) => state.linkedByThreadKey[scopedThreadKey(threadRef)] !== undefined,
  );
  const summary = useLinearRefSummary(threadRef, ref);

  // A branch ID that Linear does not know is a coincidence, not an issue: show nothing.
  if (ref === null || summary === undefined || (summary === null && !remembered)) return null;
  const Icon = ref.kind === "project" ? BoxIcon : ListTodo;

  return (
    <div className="pb-2">
      <ThreadDetailsControl
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Open ${summary?.title ?? ref.id} in the Linear panel`}
        onClick={() => openLinearRef(threadRef, ref)}
      >
        <Icon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate text-left">{summary?.title ?? ref.id}</span>
      </ThreadDetailsControl>
      <div className="-mt-1 flex h-6 min-w-0 items-center gap-1.5 ps-9 pe-1 text-xs text-muted-foreground">
        <span className="shrink-0 tabular-nums">{summary?.label ?? ref.id}</span>
        {summary ? (
          <span className="inline-flex min-w-0 items-center gap-1 truncate">
            <span
              aria-hidden
              className="inline-block size-2 shrink-0 rounded-full border"
              style={{
                borderColor: summary.statusColor,
                backgroundColor: `${summary.statusColor}55`,
              }}
            />
            {summary.statusName}
          </span>
        ) : null}
        <span className="flex-1" />
        {remembered ? (
          <ThreadDetailsControl
            type="button"
            variant="ghost"
            size="sm"
            part="meta"
            tone="muted"
            onClick={() => useLinearThreadStore.getState().unlink(threadRef)}
          >
            Unlink
          </ThreadDetailsControl>
        ) : null}
      </div>
    </div>
  );
}
