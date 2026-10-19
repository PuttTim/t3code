import type { LinearIssueSummary, LinearLabel, LinearProjectSummary } from "@t3tools/contracts";
import { BoxIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { RefreshIcon } from "../ui/refresh-icon";

/** Names the fix for each CLI failure, since the raw CLI text rarely does. */
function failureTitle(failure: unknown): string {
  const reason =
    typeof failure === "object" && failure !== null && "_tag" in failure
      ? (failure as { _tag: string; reason?: string }).reason
      : undefined;
  switch (reason) {
    case "missing":
      return "Linear CLI not installed";
    case "unauthenticated":
      return "Sign in to the Linear CLI";
    default:
      return "Could not load from Linear";
  }
}

export function LinearUnavailable(props: {
  failure: unknown;
  error: string;
  onRetry: () => void;
  refreshing: boolean;
}) {
  return (
    <Empty className="scrollbar-gutter-both min-h-0 justify-center-safe overflow-y-auto">
      <EmptyHeader>
        <EmptyTitle>{failureTitle(props.failure)}</EmptyTitle>
        <EmptyDescription className="whitespace-pre-wrap">{props.error}</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" variant="outline" onClick={props.onRetry} disabled={props.refreshing}>
        <RefreshIcon size="sm" refreshing={props.refreshing} />
        Retry
      </Button>
    </Empty>
  );
}

export function StateDot({ color, label }: { color: string; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block size-2.5 shrink-0 rounded-full border"
      style={{ borderColor: color, backgroundColor: `${color}55` }}
    />
  );
}

export function LabelChip({ label }: { label: LinearLabel }) {
  return (
    <span className="inline-flex max-w-32 items-center gap-1 rounded-full border border-border/70 px-1.5 py-px text-2xs text-muted-foreground">
      <span
        aria-hidden
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** "Sprint 12" style cycle name, Linear's own when the team named it. */
export function cycleLabel(issue: Pick<LinearIssueSummary, "cycleName" | "cycleNumber">) {
  return issue.cycleName ?? (issue.cycleNumber === undefined ? null : `Cycle ${issue.cycleNumber}`);
}

const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none";

export function IssueRow({
  issue,
  onSelect,
}: {
  issue: LinearIssueSummary;
  onSelect: (identifier: string) => void;
}) {
  return (
    <button type="button" onClick={() => onSelect(issue.identifier)} className={ROW_CLASS}>
      <StateDot color={issue.stateColor} label={issue.stateName} />
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">{issue.identifier}</span>
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {issue.labels && issue.labels.length > 0 ? (
        <span
          className="flex shrink-0 -space-x-0.5"
          aria-label={issue.labels.map((label) => label.name).join(", ")}
        >
          {issue.labels.slice(0, 4).map((label) => (
            <span
              key={label.name}
              aria-hidden
              className="inline-block size-2 rounded-full ring-1 ring-background"
              style={{ backgroundColor: label.color }}
            />
          ))}
        </span>
      ) : null}
      {issue.estimate !== undefined ? (
        <span
          className="shrink-0 rounded border border-border/70 px-1 text-2xs tabular-nums text-muted-foreground"
          aria-label={`${issue.estimate} points`}
        >
          {issue.estimate}
        </span>
      ) : null}
      {issue.assigneeName ? (
        <span
          className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground"
          aria-label={`Assigned to ${issue.assigneeName}`}
        >
          {initials(issue.assigneeName)}
        </span>
      ) : issue.updatedAt ? (
        <span className="shrink-0 text-2xs text-muted-foreground">
          {formatRelativeTimeLabel(issue.updatedAt)}
        </span>
      ) : null}
    </button>
  );
}

export function ProjectRow({
  project,
  onSelect,
}: {
  project: Pick<LinearProjectSummary, "slugId" | "name" | "statusName" | "statusColor"> &
    Partial<Pick<LinearProjectSummary, "leadName">>;
  onSelect: (slugId: string) => void;
}) {
  return (
    <button type="button" onClick={() => onSelect(project.slugId)} className={ROW_CLASS}>
      <BoxIcon aria-hidden className="size-3.5 shrink-0" style={{ color: project.statusColor }} />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      <span className="shrink-0 text-2xs text-muted-foreground">{project.statusName}</span>
    </button>
  );
}
