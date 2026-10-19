import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  LinearIssueDetail,
  LinearProjectDetail,
  ProjectId,
} from "@t3tools/contracts";
import { ArrowLeftIcon, ArrowUpRightIcon, MessageSquarePlusIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { type LinearRef, useLinearThreadStore } from "~/linearThreadStore";
import { linearEnvironment } from "~/state/linear";
import { useEnvironmentQuery } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import {
  cycleLabel,
  IssueRow,
  LabelChip,
  LinearUnavailable,
  ProjectRow,
  StateDot,
} from "./linearPresentation";

interface DetailProps {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  onBack: () => void;
  /** Opens a related issue or project on top of this view. */
  onOpen: (ref: LinearRef) => void;
}

/** The prompt a new thread starts with: enough of the work for the agent to begin. */
function workPrompt(heading: string, url: string, body: string): string {
  const trimmed = body.trim();
  return [heading, url, trimmed ? `\n${trimmed}` : ""].filter(Boolean).join("\n");
}

/** Starts a thread in the current project with `prompt` drafted, linked to `ref`. */
function StartThreadButton(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  linearRef: LinearRef;
  prompt: string;
  label: string;
}) {
  const newThread = useNewThreadHandler();
  const { environmentId, projectId, linearRef, prompt } = props;
  const start = async () => {
    if (projectId === null) return;
    const session = await newThread(scopeProjectRef(environmentId, projectId)).catch(() => null);
    if (session === null) return;
    useComposerDraftStore.getState().setPrompt(session.draftId, prompt);
    useLinearThreadStore
      .getState()
      .link(scopeThreadRef(environmentId, session.threadId), linearRef);
  };
  return (
    <Button
      size="sm"
      variant="outline"
      className="self-start"
      disabled={projectId === null}
      onClick={() => void start()}
    >
      <MessageSquarePlusIcon className="size-3.5" />
      {props.label}
    </Button>
  );
}

function DetailFrame(props: {
  label: string;
  url: string | undefined;
  onBack: () => void;
  query: {
    data: unknown;
    error: string | null;
    failure: unknown;
    isPending: boolean;
    refresh: () => void;
  };
  children: ReactNode;
}) {
  const { query } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-1 border-b border-border/60 px-1.5 py-1">
        <Button size="xs" variant="ghost" onClick={props.onBack}>
          <ArrowLeftIcon className="size-3.5" />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground">
          {props.label}
        </span>
        {props.url ? (
          <Button
            size="xs"
            variant="ghost"
            render={<a href={props.url} target="_blank" rel="noopener noreferrer" />}
          >
            <ArrowUpRightIcon className="size-3.5" />
            Open
          </Button>
        ) : null}
      </header>
      {query.data === null ? (
        query.error ? (
          <LinearUnavailable
            failure={query.failure}
            error={query.error}
            onRetry={query.refresh}
            refreshing={query.isPending}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        )
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <article className="flex flex-col gap-3 p-3">{props.children}</article>
        </ScrollArea>
      )}
    </div>
  );
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t border-border/60 pt-3">
      <h3 className="px-2 text-xs font-medium text-muted-foreground">{props.title}</h3>
      {props.children}
    </section>
  );
}

function Property(props: { name: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{props.name}</dt>
      <dd className="min-w-0 truncate text-foreground/90">{props.children}</dd>
    </>
  );
}

function IssueBody({
  issue,
  environmentId,
  projectId,
  onOpen,
}: Omit<DetailProps, "onBack"> & { issue: LinearIssueDetail }) {
  const openIssue = (id: string) => onOpen({ kind: "issue", id });
  return (
    <>
      <h2 className="text-base font-semibold">{issue.title}</h2>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-xs">
        <Property name="Status">
          <span className="inline-flex items-center gap-1.5">
            <StateDot color={issue.stateColor} label={issue.stateName} />
            {issue.stateName}
          </span>
        </Property>
        <Property name="Priority">{issue.priorityLabel ?? "No priority"}</Property>
        <Property name="Assignee">{issue.assigneeName ?? "Unassigned"}</Property>
        <Property name="Points">{issue.estimate ?? "None"}</Property>
        {cycleLabel(issue) ? (
          <Property name="Cycle">
            {cycleLabel(issue)}
            {issue.cycleIsActive ? " (current)" : ""}
          </Property>
        ) : null}
        {issue.labels && issue.labels.length > 0 ? (
          <Property name="Labels">
            <span className="flex flex-wrap gap-1">
              {issue.labels.map((label) => (
                <LabelChip key={label.name} label={label} />
              ))}
            </span>
          </Property>
        ) : null}
        {issue.teamName || issue.teamKey ? (
          <Property name="Team">{issue.teamName ?? issue.teamKey}</Property>
        ) : null}
        {issue.dueDate ? <Property name="Due">{issue.dueDate}</Property> : null}
        {issue.creatorName ? (
          <Property name="Created">
            {issue.creatorName}
            {issue.createdAt ? ` · ${formatRelativeTimeLabel(issue.createdAt)}` : ""}
          </Property>
        ) : null}
      </dl>
      <StartThreadButton
        environmentId={environmentId}
        projectId={projectId}
        linearRef={{ kind: "issue", id: issue.identifier }}
        prompt={workPrompt(
          `Work on Linear issue ${issue.identifier}: ${issue.title}`,
          issue.url,
          issue.description,
        )}
        label="Start thread from issue"
      />
      {issue.projectName || issue.parent ? (
        <div className="-mx-2 flex flex-col">
          {issue.projectName ? (
            <ProjectRow
              project={{
                // `linear project view` accepts a project's name as well as its slug ID.
                slugId: issue.projectName,
                name: issue.projectName,
                statusName: "Project",
                statusColor: "currentColor",
              }}
              onSelect={(project) => onOpen({ kind: "project", id: project })}
            />
          ) : null}
          {issue.parent ? <IssueRow issue={issue.parent} onSelect={openIssue} /> : null}
        </div>
      ) : null}
      {issue.description.trim() ? (
        <ChatMarkdown text={issue.description} cwd={undefined} environmentId={environmentId} />
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
      {issue.children.length > 0 ? (
        <Section
          title={`${issue.children.length} sub-issue${issue.children.length === 1 ? "" : "s"}`}
        >
          <div className="-mx-2 flex flex-col">
            {issue.children.map((child) => (
              <IssueRow key={child.identifier} issue={child} onSelect={openIssue} />
            ))}
          </div>
        </Section>
      ) : null}
      {issue.comments.length > 0 ? (
        <Section
          title={`${issue.comments.length} comment${issue.comments.length === 1 ? "" : "s"}`}
        >
          {issue.comments.map((comment) => (
            <div key={comment.id} className="flex flex-col gap-1 px-2">
              <div className="text-2xs text-muted-foreground">
                <span className="font-medium text-foreground">{comment.author}</span>
                {comment.createdAt ? ` · ${formatRelativeTimeLabel(comment.createdAt)}` : ""}
              </div>
              <ChatMarkdown text={comment.body} cwd={undefined} environmentId={environmentId} />
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

export function IssueDetail(props: DetailProps & { identifier: string }) {
  const query = useEnvironmentQuery(
    linearEnvironment.issue({
      environmentId: props.environmentId,
      input: { identifier: props.identifier },
    }),
  );
  return (
    <DetailFrame label={props.identifier} url={query.data?.url} onBack={props.onBack} query={query}>
      {query.data ? <IssueBody {...props} issue={query.data} /> : null}
    </DetailFrame>
  );
}

function ProjectBody({
  project,
  environmentId,
  projectId,
  onOpen,
}: Omit<DetailProps, "onBack"> & { project: LinearProjectDetail }) {
  const open = project.issues.filter(
    (issue) => issue.stateType !== "completed" && issue.stateType !== "canceled",
  );
  const done = project.issues.length - open.length;
  return (
    <>
      <h2 className="text-base font-semibold">{project.name}</h2>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <StateDot color={project.statusColor} label={project.statusName} />
          {project.statusName}
        </span>
        {project.progress !== undefined ? (
          <span>{Math.round(project.progress * 100)}% done</span>
        ) : null}
        {project.leadName ? <span>Lead: {project.leadName}</span> : null}
        {project.targetDate ? <span>Target {project.targetDate}</span> : null}
      </div>
      <StartThreadButton
        environmentId={environmentId}
        projectId={projectId}
        linearRef={{ kind: "project", id: project.slugId }}
        prompt={workPrompt(
          `Work on Linear project "${project.name}"`,
          project.url,
          project.content,
        )}
        label="Start thread from project"
      />
      {project.content.trim() ? (
        <ChatMarkdown text={project.content} cwd={undefined} environmentId={environmentId} />
      ) : (
        <p className="text-sm text-muted-foreground">No description.</p>
      )}
      <Section
        title={`${open.length} open issue${open.length === 1 ? "" : "s"}${done > 0 ? ` · ${done} done` : ""}`}
      >
        <div className="-mx-2 flex flex-col">
          {open.map((issue) => (
            <IssueRow
              key={issue.identifier}
              issue={issue}
              onSelect={(id) => onOpen({ kind: "issue", id })}
            />
          ))}
        </div>
      </Section>
    </>
  );
}

export function ProjectDetail(props: DetailProps & { project: string }) {
  const query = useEnvironmentQuery(
    linearEnvironment.project({
      environmentId: props.environmentId,
      input: { project: props.project },
    }),
  );
  return (
    <DetailFrame
      label={query.data?.name ?? "Project"}
      url={query.data?.url}
      onBack={props.onBack}
      query={query}
    >
      {query.data ? <ProjectBody {...props} project={query.data} /> : null}
    </DetailFrame>
  );
}
