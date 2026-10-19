import {
  LinearCliError,
  type LinearFilterOptions,
  type LinearIssueComment,
  type LinearIssueDetail,
  type LinearIssueSummary,
  type LinearListIssuesInput,
  type LinearListIssuesResult,
  type LinearListProjectsResult,
  type LinearProjectDetail,
  type LinearProjectSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

/**
 * Reads Linear issues and projects by shelling out to the user's `linear` CLI
 * (https://github.com/schpet/linear-cli). The CLI owns authentication
 * (`linear auth login`), so T3 never sees or stores a Linear API key.
 */
export class LinearIssues extends Context.Service<
  LinearIssues,
  {
    readonly listIssues: (
      input: LinearListIssuesInput,
    ) => Effect.Effect<LinearListIssuesResult, LinearCliError>;
    readonly getIssue: (identifier: string) => Effect.Effect<LinearIssueDetail, LinearCliError>;
    readonly listProjects: Effect.Effect<LinearListProjectsResult, LinearCliError>;
    readonly getProject: (project: string) => Effect.Effect<LinearProjectDetail, LinearCliError>;
    readonly getFilterOptions: Effect.Effect<LinearFilterOptions, LinearCliError>;
  }
>()("t3/linear/LinearIssues") {}

const LINEAR_EXECUTABLE = "linear";
const INSTALL_HINT = "Install the Linear CLI with `brew install schpet/tap/linear`.";
const AUTH_HINT = "Run `linear auth login` in a terminal to sign in.";
const ISSUE_IDENTIFIER = /^[A-Za-z0-9]+-\d+$/;

type Json = Record<string, unknown>;

const decodeCliJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const asRecord = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const PRIORITY_LABELS = ["No priority", "Urgent", "High", "Medium", "Low"];
const OPEN_STATE_TYPES = ["triage", "backlog", "unstarted", "started"] as const;

/** The CLI flattens GraphQL connections to arrays, but accept `{ nodes }` too. */
const asNodes = (value: unknown): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) return value;
  const nodes = asRecord(value)?.nodes;
  return Array.isArray(nodes) ? nodes : [];
};

const toSummary = (raw: unknown): LinearIssueSummary | undefined => {
  const issue = asRecord(raw);
  const identifier = asString(issue?.identifier);
  if (!issue || !identifier) return undefined;
  const state = asRecord(issue.state);
  const assignee = asRecord(issue.assignee);
  const cycle = asRecord(issue.cycle);
  const priority = asNumber(issue.priority);
  const labels = asNodes(issue.labels).flatMap((raw) => {
    const label = asRecord(raw);
    const name = asString(label?.name);
    return name ? [{ name, color: asString(label?.color) ?? "#888888" }] : [];
  });
  return {
    identifier,
    title: asString(issue.title) ?? identifier,
    url: asString(issue.url) ?? "",
    stateName: asString(state?.name) ?? "Unknown",
    stateType: asString(state?.type) ?? "unknown",
    stateColor: asString(state?.color) ?? "#888888",
    priority,
    priorityLabel:
      asString(issue.priorityLabel) ??
      (priority === undefined ? undefined : PRIORITY_LABELS[priority]),
    assigneeName: asString(assignee?.displayName) ?? asString(assignee?.name),
    teamKey: asString(asRecord(issue.team)?.key) ?? identifier.split("-")[0],
    estimate: asNumber(issue.estimate),
    labels: labels.length > 0 ? labels : undefined,
    cycleNumber: asNumber(cycle?.number),
    cycleName: asString(cycle?.name),
    cycleIsActive: typeof cycle?.isActive === "boolean" ? cycle.isActive : undefined,
    projectName: asString(asRecord(issue.project)?.name),
    updatedAt: asString(issue.updatedAt),
  };
};

const toComment = (raw: unknown): LinearIssueComment | undefined => {
  const comment = asRecord(raw);
  const id = asString(comment?.id);
  const body = asString(comment?.body);
  if (!comment || !id || !body) return undefined;
  const user = asRecord(comment.user) ?? asRecord(comment.externalUser);
  return {
    id,
    author: asString(user?.displayName) ?? asString(user?.name) ?? "Unknown",
    body,
    createdAt: asString(comment.createdAt) ?? "",
  };
};

const toProjectSummary = (raw: unknown): LinearProjectSummary | undefined => {
  const project = asRecord(raw);
  const slugId = asString(project?.slugId);
  const name = asString(project?.name);
  if (!project || !slugId || !name) return undefined;
  const status = asRecord(project.status);
  const lead = asRecord(project.lead);
  return {
    slugId,
    name,
    url: asString(project.url) ?? "",
    statusName: asString(status?.name) ?? "Unknown",
    statusType: asString(status?.type) ?? "unknown",
    statusColor: asString(status?.color) ?? asString(project.color) ?? "#888888",
    description: asString(project.description) ?? "",
    leadName: asString(lead?.displayName) ?? asString(lead?.name),
    targetDate: asString(project.targetDate),
    updatedAt: asString(project.updatedAt),
  };
};

/**
 * Fields `linear issue view` leaves out, read through `linear api` with a fixed document; the
 * issue ID travels as a GraphQL variable, never inside the document.
 */
const ISSUE_EXTRAS_QUERY = `query IssueExtras($id: String!) {
  issue(id: $id) {
    estimate
    priority
    priorityLabel
    dueDate
    createdAt
    updatedAt
    creator { name displayName }
    team { key name }
    cycle { number name isActive }
    project { name }
  }
}`;

/** A CLI argument value; one starting with `-` would be read as a flag. */
const isArgValue = (value: string) => value.length > 0 && !value.startsWith("-");

/**
 * The view's fields over the extras', one level deep: the view's nested objects select fewer
 * fields (its `team` has no name), and its nulls do not hide the extras' values.
 */
const mergeIssue = (extras: Json, viewed: Json): Json => {
  const merged: Json = { ...extras };
  for (const [key, value] of Object.entries(viewed)) {
    if (value === null || value === undefined) continue;
    const base = asRecord(merged[key]);
    const own = asRecord(value);
    merged[key] = base && own ? { ...base, ...own } : value;
  }
  return merged;
};

const isDefined = <A>(value: A | undefined): value is A => value !== undefined;

const classifyFailure = (stderr: string, stdout: string): LinearCliError => {
  const detail = (stderr.trim() || stdout.trim() || "The Linear CLI exited with an error.")
    .split("\n")
    .slice(0, 6)
    .join("\n");
  return /api key|auth login|unauthori[sz]ed|authentication/i.test(detail)
    ? new LinearCliError({ reason: "unauthenticated", detail: `${detail}\n${AUTH_HINT}` })
    : new LinearCliError({ reason: "failed", detail });
};

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const processRunner = yield* ProcessRunner.ProcessRunner;

  /** Runs a CLI command and decodes its stdout; `api` prints JSON without being asked. */
  const runJson = (args: ReadonlyArray<string>) =>
    processRunner
      .run({
        command: LINEAR_EXECUTABLE,
        args: [...args, ...(args[0] === "api" ? [] : ["--json"]), "--no-input"],
        cwd: config.cwd,
        timeout: "30 seconds",
        maxOutputBytes: 4 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      })
      .pipe(
        Effect.mapError((cause) =>
          cause._tag === "ProcessSpawnError"
            ? new LinearCliError({ reason: "missing", detail: INSTALL_HINT })
            : new LinearCliError({ reason: "failed", detail: cause.message }),
        ),
        Effect.flatMap((output) =>
          output.code === 0
            ? decodeCliJson(output.stdout).pipe(
                Effect.mapError(
                  () =>
                    new LinearCliError({
                      reason: "failed",
                      detail: "The Linear CLI returned output T3 could not read.",
                    }),
                ),
              )
            : Effect.fail(classifyFailure(output.stderr, output.stdout)),
        ),
      );

  const teams = runJson(["team", "list"]).pipe(
    Effect.map((raw) =>
      asNodes(raw).flatMap((value) => {
        const team = asRecord(value);
        const key = asString(team?.key);
        return key
          ? [
              {
                key,
                name: asString(team?.name) ?? key,
                cyclesEnabled: team?.cyclesEnabled === true,
              },
            ]
          : [];
      }),
    ),
  );

  const listIssues: LinearIssues["Service"]["listIssues"] = (input) => {
    const search = input.search?.trim();
    const values = [input.assignee, input.team, ...(input.labels ?? [])].filter(isDefined);
    const invalid = values.find((value) => !isArgValue(value));
    if (invalid !== undefined) {
      return Effect.fail(
        new LinearCliError({ reason: "failed", detail: `Invalid filter: ${invalid}` }),
      );
    }
    const args = ["issue", "query", "--limit", "100"];
    if (input.assignee === "none") args.push("--unassigned");
    else if (input.assignee) args.push("--assignee", input.assignee);
    for (const label of input.labels ?? []) args.push("--label", label);
    if (search) args.push("--search", search);
    // Without a search or a chosen state, hide finished work so the list stays actionable.
    const states = input.states ?? (search ? [] : OPEN_STATE_TYPES);
    for (const state of states) args.push("--state", state);

    const query = (team: string | undefined) =>
      runJson([
        ...args,
        ...(team ? ["--team", team] : ["--all-teams"]),
        ...(input.cycle ? ["--cycle", input.cycle] : []),
      ]).pipe(Effect.map((raw) => asNodes(raw).map(toSummary).filter(isDefined)));

    // The CLI filters by cycle only within one team, and cycles are per team, so a cycle filter
    // across teams asks each team that runs cycles.
    const issues =
      input.cycle && !input.team
        ? teams.pipe(
            Effect.flatMap((all) =>
              Effect.forEach(
                all.filter((team) => team.cyclesEnabled),
                (team) => query(team.key),
                { concurrency: 4 },
              ),
            ),
            Effect.map((perTeam) => perTeam.flat()),
          )
        : query(input.team);
    return issues.pipe(
      Effect.map((list) => ({ issues: list })),
      Effect.withSpan("linear.listIssues"),
    );
  };

  const getIssue: LinearIssues["Service"]["getIssue"] = (identifier) => {
    const id = identifier.trim();
    if (!ISSUE_IDENTIFIER.test(id)) {
      return Effect.fail(
        new LinearCliError({ reason: "failed", detail: `Not a Linear issue ID: ${identifier}` }),
      );
    }
    return Effect.all(
      [
        runJson(["issue", "view", id, "--no-download", "--no-pager"]),
        // Extras are a nicety: an issue still opens if this read fails.
        runJson(["api", ISSUE_EXTRAS_QUERY, "--variable", `id=${id}`]).pipe(
          Effect.map((raw) => asRecord(asRecord(asRecord(raw)?.data)?.issue)),
          Effect.orElseSucceed(() => undefined),
        ),
      ],
      { concurrency: 2 },
    ).pipe(
      Effect.flatMap(([raw, extras]) => {
        const viewed = asRecord(raw);
        const issue = viewed && extras ? mergeIssue(extras, viewed) : viewed;
        const summary = toSummary(issue);
        if (!issue || !summary) {
          return Effect.fail(
            new LinearCliError({ reason: "failed", detail: `Issue ${id} was not found.` }),
          );
        }
        return Effect.succeed({
          ...summary,
          description: asString(issue.description) ?? "",
          branchName: asString(issue.branchName),
          teamName: asString(asRecord(issue.team)?.name),
          dueDate: asString(issue.dueDate),
          createdAt: asString(issue.createdAt),
          creatorName:
            asString(asRecord(issue.creator)?.displayName) ??
            asString(asRecord(issue.creator)?.name),
          parent: toSummary(issue.parent),
          children: asNodes(issue.children).map(toSummary).filter(isDefined),
          comments: asNodes(issue.comments).map(toComment).filter(isDefined),
        } satisfies LinearIssueDetail);
      }),
      Effect.withSpan("linear.getIssue"),
    );
  };

  const listProjects: LinearIssues["Service"]["listProjects"] = runJson([
    "project",
    "list",
    "--all-teams",
  ]).pipe(
    Effect.map((raw) => ({ projects: asNodes(raw).map(toProjectSummary).filter(isDefined) })),
    Effect.withSpan("linear.listProjects"),
  );

  const getProject: LinearIssues["Service"]["getProject"] = (reference) => {
    const ref = reference.trim();
    // A reference is passed as one argument, but one starting with `-` would still read as a flag.
    if (ref.length === 0 || ref.startsWith("-")) {
      return Effect.fail(
        new LinearCliError({ reason: "failed", detail: `Not a Linear project: ${reference}` }),
      );
    }
    return runJson(["project", "view", ref, "--no-pager"]).pipe(
      Effect.flatMap((raw) => {
        const project = asRecord(raw);
        const summary = toProjectSummary(project);
        if (!project || !summary) {
          return Effect.fail(
            new LinearCliError({ reason: "failed", detail: `Project ${ref} was not found.` }),
          );
        }
        // `project view` lists only some of the project's issues, without state colors, so the
        // issue list comes from a query scoped to the project.
        return runJson([
          "issue",
          "query",
          "--all-teams",
          "--project",
          summary.slugId,
          "--limit",
          "100",
        ]).pipe(
          Effect.map(
            (issues) =>
              ({
                ...summary,
                content: asString(project.content) ?? summary.description,
                progress: typeof project.progress === "number" ? project.progress : undefined,
                issues: asNodes(issues).map(toSummary).filter(isDefined),
              }) satisfies LinearProjectDetail,
          ),
        );
      }),
      Effect.withSpan("linear.getProject"),
    );
  };

  const getFilterOptions: LinearIssues["Service"]["getFilterOptions"] = Effect.all(
    [runJson(["user", "list"]), runJson(["label", "list", "--all-teams"]), teams],
    { concurrency: 3 },
  ).pipe(
    Effect.map(([users, labels, teamList]) => ({
      users: asNodes(users).flatMap((value) => {
        const user = asRecord(value);
        const name = asString(user?.name);
        if (!user || !name || user.active === false) return [];
        return [
          { name, displayName: asString(user.displayName) ?? name, isMe: user.isMe === true },
        ];
      }),
      labels: asNodes(labels).flatMap((value) => {
        const label = asRecord(value);
        const name = asString(label?.name);
        return name
          ? [
              {
                name,
                color: asString(label?.color) ?? "#888888",
                teamKey: asString(asRecord(label?.team)?.key),
              },
            ]
          : [];
      }),
      teams: teamList,
    })),
    Effect.withSpan("linear.getFilterOptions"),
  );

  return LinearIssues.of({ listIssues, getIssue, listProjects, getProject, getFilterOptions });
});

export const layer = Layer.effect(LinearIssues, make);
