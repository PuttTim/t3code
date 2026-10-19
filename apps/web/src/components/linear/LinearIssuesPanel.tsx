import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  LinearListIssuesInput,
  LinearProjectSummary,
  ProjectId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  DEFAULT_LINEAR_ISSUE_FILTERS,
  type LinearIssueFilters,
  type LinearRef,
  linearRefKey,
  useLinearThreadStore,
} from "~/linearThreadStore";
import { useThreadShell } from "~/state/entities";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { IssueDetail, ProjectDetail } from "./LinearDetailViews";
import { IssueRow, LinearUnavailable, ProjectRow } from "./linearPresentation";

const SEARCH_DEBOUNCE_MS = 300;

type PanelScope = "issues" | "projects" | "linked";

const STATUS_STATES: Record<LinearIssueFilters["status"], LinearListIssuesInput["states"]> = {
  // Left out, the server shows open work: triage, backlog, unstarted, and started.
  open: undefined,
  todo: ["unstarted"],
  "in-progress": ["started"],
  backlog: ["triage", "backlog"],
  done: ["completed"],
  all: ["triage", "backlog", "unstarted", "started", "completed", "canceled"],
};

const STATUS_LABELS: Record<LinearIssueFilters["status"], string> = {
  open: "Open",
  todo: "Todo",
  "in-progress": "In progress",
  backlog: "Backlog",
  done: "Done",
  all: "Any status",
};

/** The select value for "no filter"; label names and team keys are never this. */
const ANY = "__any__";

const CYCLE_LABELS: Record<LinearIssueFilters["cycle"], string> = {
  any: "Any cycle",
  active: "Current cycle",
  next: "Next cycle",
  previous: "Previous cycle",
};

/** The `linear.listIssues` input for the saved filters and a search. */
function issueQueryInput(filters: LinearIssueFilters, search: string): LinearListIssuesInput {
  const states = STATUS_STATES[filters.status];
  return {
    ...(search ? { search } : {}),
    ...(filters.assignee === "any" ? {} : { assignee: filters.assignee }),
    ...(filters.team ? { team: filters.team } : {}),
    ...(filters.label ? { labels: [filters.label] } : {}),
    ...(filters.cycle === "any" ? {} : { cycle: filters.cycle }),
    ...(states ? { states } : {}),
  };
}

function FilterSelect<Value extends string>(props: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
}) {
  const current = props.options.find((option) => option.value === props.value);
  return (
    <Select
      value={props.value}
      onValueChange={(value) => {
        const next = props.options.find((option) => option.value === value);
        if (next) props.onChange(next.value);
      }}
    >
      <SelectTrigger size="xs" variant="ghost" aria-label={props.label}>
        <SelectValue>{() => current?.label ?? props.label}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** Assignee, status, cycle, label, and team filters for the issue list. */
function IssueFilterBar({ environmentId }: { environmentId: EnvironmentId }) {
  const filters = useLinearThreadStore((state) => state.issueFilters);
  const setFilters = useLinearThreadStore((state) => state.setIssueFilters);
  const options = useEnvironmentQuery(
    linearEnvironment.filterOptions({ environmentId, input: {} }),
  ).data;
  const isDefault = (
    Object.keys(DEFAULT_LINEAR_ISSUE_FILTERS) as Array<keyof LinearIssueFilters>
  ).every((key) => filters[key] === DEFAULT_LINEAR_ISSUE_FILTERS[key]);
  const people = (options?.users ?? []).filter((user) => !user.isMe);
  const teams = options?.teams ?? [];
  return (
    <div className="-mx-1 flex flex-wrap items-center gap-0.5">
      <FilterSelect
        label="Assignee"
        value={filters.assignee}
        options={[
          { value: "@me", label: "Mine" },
          { value: "any", label: "Anyone" },
          { value: "none", label: "Unassigned" },
          ...people.map((user) => ({ value: user.name, label: user.displayName })),
          // A saved person no longer in the workspace still shows as selected.
          ...(["@me", "any", "none"].includes(filters.assignee) ||
          people.some((user) => user.name === filters.assignee)
            ? []
            : [{ value: filters.assignee, label: filters.assignee }]),
        ]}
        onChange={(assignee) => setFilters({ assignee })}
      />
      <FilterSelect
        label="Status"
        value={filters.status}
        options={(Object.keys(STATUS_LABELS) as Array<LinearIssueFilters["status"]>).map(
          (value) => ({ value, label: STATUS_LABELS[value] }),
        )}
        onChange={(status) => setFilters({ status })}
      />
      <FilterSelect
        label="Cycle"
        value={filters.cycle}
        options={(Object.keys(CYCLE_LABELS) as Array<LinearIssueFilters["cycle"]>).map((value) => ({
          value,
          label: CYCLE_LABELS[value],
        }))}
        onChange={(cycle) => setFilters({ cycle })}
      />
      <FilterSelect
        label="Label"
        value={filters.label ?? ANY}
        options={[
          { value: ANY, label: "Any label" },
          ...uniqueLabels(options?.labels ?? [], filters.label).map((name) => ({
            value: name,
            label: name,
          })),
        ]}
        onChange={(label) => setFilters({ label: label === ANY ? null : label })}
      />
      {teams.length > 1 || filters.team ? (
        <FilterSelect
          label="Team"
          value={filters.team ?? ANY}
          options={[
            { value: ANY, label: "All teams" },
            ...teams.map((team) => ({ value: team.key, label: team.name })),
          ]}
          onChange={(team) => setFilters({ team: team === ANY ? null : team })}
        />
      ) : null}
      {isDefault ? null : (
        <Button size="xs" variant="ghost" onClick={() => setFilters(DEFAULT_LINEAR_ISSUE_FILTERS)}>
          Reset
        </Button>
      )}
    </div>
  );
}

/** Label names once each: team labels can share a name across teams. */
function uniqueLabels(
  labels: ReadonlyArray<{ name: string }>,
  selected: string | null,
): ReadonlyArray<string> {
  const names = new Set(labels.map((label) => label.name));
  if (selected) names.add(selected);
  return [...names].toSorted((left, right) => left.localeCompare(right));
}

const EMPTY_STACK: ReadonlyArray<LinearRef> = [];

/** Active projects first, in Linear's own status order. */
const PROJECT_STATUS_ORDER = ["started", "planned", "backlog", "paused", "completed", "canceled"];
const projectStatusRank = (project: LinearProjectSummary) => {
  const rank = PROJECT_STATUS_ORDER.indexOf(project.statusType);
  return rank === -1 ? PROJECT_STATUS_ORDER.length : rank;
};

function ListMessage(props: { title: string; description: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function Loading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}

function IssueList({
  environmentId,
  input,
  onOpen,
}: {
  environmentId: EnvironmentId;
  input: LinearListIssuesInput;
  onOpen: (ref: LinearRef) => void;
}) {
  const query = useEnvironmentQuery(linearEnvironment.issues({ environmentId, input }));
  if (query.error && query.data === null) {
    return (
      <LinearUnavailable
        failure={query.failure}
        error={query.error}
        onRetry={query.refresh}
        refreshing={query.isPending}
      />
    );
  }
  if (query.data === null) return <Loading />;
  if (query.data.issues.length === 0) {
    return (
      <ListMessage
        title="No issues"
        description={
          input.search ? "Nothing matches that search." : "No issues match these filters."
        }
      />
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col p-1.5">
        {query.data.issues.map((issue) => (
          <IssueRow
            key={issue.identifier}
            issue={issue}
            onSelect={(id) => onOpen({ kind: "issue", id })}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function ProjectList({
  environmentId,
  search,
  onOpen,
}: {
  environmentId: EnvironmentId;
  search: string;
  onOpen: (ref: LinearRef) => void;
}) {
  const query = useEnvironmentQuery(linearEnvironment.projects({ environmentId, input: {} }));
  const needle = search.toLowerCase();
  const projects = (query.data?.projects ?? [])
    .filter((project) =>
      // Finished projects stay out of the way unless searched for.
      needle
        ? project.name.toLowerCase().includes(needle)
        : project.statusType !== "completed" && project.statusType !== "canceled",
    )
    .toSorted((left, right) => projectStatusRank(left) - projectStatusRank(right));
  if (query.error && query.data === null) {
    return (
      <LinearUnavailable
        failure={query.failure}
        error={query.error}
        onRetry={query.refresh}
        refreshing={query.isPending}
      />
    );
  }
  if (query.data === null) return <Loading />;
  if (projects.length === 0) {
    return (
      <ListMessage
        title="No projects"
        description={search ? "Nothing matches that search." : "No active projects."}
      />
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col p-1.5">
        {projects.map((project) => (
          <ProjectRow
            key={project.slugId}
            project={project}
            onSelect={(id) => onOpen({ kind: "project", id })}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function LinkedThread({ threadRef }: { threadRef: ScopedThreadRef }) {
  const title = useThreadShell(threadRef)?.title;
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: threadRef.environmentId, threadId: threadRef.threadId }}
      className="min-w-0 truncate hover:text-foreground hover:underline"
    >
      {title ?? "Untitled thread"}
    </Link>
  );
}

function LinkedIssue(props: {
  environmentId: EnvironmentId;
  id: string;
  onOpen: (ref: LinearRef) => void;
}) {
  const issue = useEnvironmentQuery(
    linearEnvironment.issue({
      environmentId: props.environmentId,
      input: { identifier: props.id },
    }),
  ).data;
  return (
    <IssueRow
      issue={
        issue ?? {
          identifier: props.id,
          title: props.id,
          url: "",
          stateName: "Loading",
          stateType: "unknown",
          stateColor: "#888888",
        }
      }
      onSelect={(id) => props.onOpen({ kind: "issue", id })}
    />
  );
}

function LinkedProject(props: {
  environmentId: EnvironmentId;
  id: string;
  onOpen: (ref: LinearRef) => void;
}) {
  const project = useEnvironmentQuery(
    linearEnvironment.project({ environmentId: props.environmentId, input: { project: props.id } }),
  ).data;
  return (
    <ProjectRow
      project={
        project
          ? { ...project, slugId: props.id }
          : { slugId: props.id, name: props.id, statusName: "Loading", statusColor: "#888888" }
      }
      onSelect={(id) => props.onOpen({ kind: "project", id })}
    />
  );
}

/** Issues and projects linked to this environment's threads, with the threads under each. */
function LinkedList({
  environmentId,
  onOpen,
}: {
  environmentId: EnvironmentId;
  onOpen: (ref: LinearRef) => void;
}) {
  const linkedByThreadKey = useLinearThreadStore((state) => state.linkedByThreadKey);
  const byRef = new Map<string, { ref: LinearRef; threads: ScopedThreadRef[] }>();
  for (const [key, ref] of Object.entries(linkedByThreadKey)) {
    const thread = parseScopedThreadKey(key);
    if (thread === null || thread.environmentId !== environmentId) continue;
    const entry = byRef.get(linearRefKey(ref)) ?? { ref, threads: [] };
    entry.threads.push(thread);
    byRef.set(linearRefKey(ref), entry);
  }
  const linked = [...byRef.values()];

  if (linked.length === 0) {
    return (
      <ListMessage
        title="Nothing linked"
        description="Start a thread from an issue or project, or open a Linear link in a thread, to link it here."
      />
    );
  }
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col p-1.5">
        {linked.map(({ ref, threads }) => (
          <div key={linearRefKey(ref)} className="flex min-w-0 flex-col">
            {ref.kind === "issue" ? (
              <LinkedIssue environmentId={environmentId} id={ref.id} onOpen={onOpen} />
            ) : (
              <LinkedProject environmentId={environmentId} id={ref.id} onOpen={onOpen} />
            )}
            <div className="-mt-1 flex min-w-0 flex-wrap gap-x-2 ps-6.5 pe-2 pb-1 text-2xs text-muted-foreground">
              {threads.map((thread) => (
                <LinkedThread key={thread.threadId} threadRef={thread} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/**
 * Linear issues and projects beside a thread, read on the thread's environment through the
 * `linear` CLI, so remote environments use their own machine's Linear sign-in.
 */
export function LinearIssuesPanel({
  threadRef,
  projectId,
}: {
  threadRef: ScopedThreadRef;
  projectId: ProjectId | null;
}) {
  const environmentId = threadRef.environmentId;
  const [scope, setScope] = useState<PanelScope>("issues");
  const filters = useLinearThreadStore((state) => state.issueFilters);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const stack = useLinearThreadStore(
    (state) => state.stackByThreadKey[scopedThreadKey(threadRef)] ?? EMPTY_STACK,
  );
  const open = (ref: LinearRef) => useLinearThreadStore.getState().show(threadRef, ref, "push");
  const back = () => useLinearThreadStore.getState().back(threadRef);
  // The lists below read the same atoms; these only drive the header's refresh button.
  const projectsQuery = useEnvironmentQuery(
    scope === "projects" ? linearEnvironment.projects({ environmentId, input: {} }) : null,
  );
  const issueInput = issueQueryInput(filters, search);
  const issuesQuery = useEnvironmentQuery(
    scope === "issues" ? linearEnvironment.issues({ environmentId, input: issueInput }) : null,
  );
  const listRefresh = scope === "projects" ? projectsQuery : issuesQuery;

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const current = stack.at(-1);
  if (current !== undefined) {
    const detailProps = { environmentId, projectId, onBack: back, onOpen: open };
    return current.kind === "issue" ? (
      <IssueDetail key={linearRefKey(current)} {...detailProps} identifier={current.id} />
    ) : (
      <ProjectDetail key={linearRefKey(current)} {...detailProps} project={current.id} />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-1.5 border-b border-border/60 p-1.5">
        <div className="flex items-center gap-1.5">
          <ToggleGroup
            aria-label="What to show"
            value={[scope]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "issues" || value === "projects" || value === "linked") {
                setScope(value);
              }
            }}
          >
            <Toggle value="issues">Issues</Toggle>
            <Toggle value="projects">Projects</Toggle>
            <Toggle value="linked">Linked</Toggle>
          </ToggleGroup>
          <div className="flex-1" />
          {scope === "linked" ? null : (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Refresh"
              onClick={listRefresh.refresh}
              disabled={listRefresh.isPending}
            >
              <RefreshIcon size="sm" refreshing={listRefresh.isPending} />
            </Button>
          )}
        </div>
        {scope === "linked" ? null : (
          <Input
            size="sm"
            aria-label={scope === "projects" ? "Search projects" : "Search issues"}
            placeholder={scope === "projects" ? "Search projects" : "Search issues"}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        )}
        {scope === "issues" ? <IssueFilterBar environmentId={environmentId} /> : null}
      </header>
      {scope === "linked" ? (
        <LinkedList environmentId={environmentId} onOpen={open} />
      ) : scope === "projects" ? (
        <ProjectList environmentId={environmentId} search={search} onOpen={open} />
      ) : (
        <IssueList environmentId={environmentId} input={issueInput} onOpen={open} />
      )}
    </div>
  );
}
