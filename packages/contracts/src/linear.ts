import * as Schema from "effect/Schema";

/**
 * Linear issues, read through the user's `linear` CLI (schpet/linear-cli).
 * The CLI owns authentication, so T3 never stores a Linear API key.
 */

export const LinearLabel = Schema.Struct({
  name: Schema.String,
  color: Schema.String,
});
export type LinearLabel = typeof LinearLabel.Type;

export const LinearIssueSummary = Schema.Struct({
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  stateName: Schema.String,
  stateType: Schema.String,
  stateColor: Schema.String,
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: Schema.optional(Schema.Number),
  priorityLabel: Schema.optional(Schema.String),
  assigneeName: Schema.optional(Schema.String),
  teamKey: Schema.optional(Schema.String),
  /** Points. */
  estimate: Schema.optional(Schema.Number),
  labels: Schema.optional(Schema.Array(LinearLabel)),
  cycleNumber: Schema.optional(Schema.Number),
  cycleName: Schema.optional(Schema.String),
  cycleIsActive: Schema.optional(Schema.Boolean),
  projectName: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});
export type LinearIssueSummary = typeof LinearIssueSummary.Type;

export const LinearIssueComment = Schema.Struct({
  id: Schema.String,
  author: Schema.String,
  body: Schema.String,
  createdAt: Schema.String,
});
export type LinearIssueComment = typeof LinearIssueComment.Type;

export const LinearIssueDetail = Schema.Struct({
  ...LinearIssueSummary.fields,
  description: Schema.String,
  branchName: Schema.optional(Schema.String),
  teamName: Schema.optional(Schema.String),
  dueDate: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  creatorName: Schema.optional(Schema.String),
  parent: Schema.optional(LinearIssueSummary),
  children: Schema.Array(LinearIssueSummary),
  comments: Schema.Array(LinearIssueComment),
});
export type LinearIssueDetail = typeof LinearIssueDetail.Type;

/** Workflow state types, which every team shares whatever its states are named. */
export const LinearStateType = Schema.Literals([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);
export type LinearStateType = typeof LinearStateType.Type;

export const LinearCycleFilter = Schema.Literals(["active", "next", "previous"]);
export type LinearCycleFilter = typeof LinearCycleFilter.Type;

/** Filters for `linear issue query`; each one left out does not filter. */
export const LinearListIssuesInput = Schema.Struct({
  search: Schema.optional(Schema.String),
  /** `@me`, a username, or `none` for unassigned issues. */
  assignee: Schema.optional(Schema.String),
  /** A team key; issues from every team otherwise. */
  team: Schema.optional(Schema.String),
  /** Label names an issue must all carry. */
  labels: Schema.optional(Schema.Array(Schema.String)),
  cycle: Schema.optional(LinearCycleFilter),
  /** Defaults to the open types: triage, backlog, unstarted, and started. */
  states: Schema.optional(Schema.Array(LinearStateType)),
});
export type LinearListIssuesInput = typeof LinearListIssuesInput.Type;

export const LinearListIssuesResult = Schema.Struct({
  issues: Schema.Array(LinearIssueSummary),
});
export type LinearListIssuesResult = typeof LinearListIssuesResult.Type;

export const LinearFilterOptions = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      /** What `--assignee` takes. */
      name: Schema.String,
      displayName: Schema.String,
      isMe: Schema.Boolean,
    }),
  ),
  labels: Schema.Array(
    Schema.Struct({
      ...LinearLabel.fields,
      /** Absent for workspace labels. */
      teamKey: Schema.optional(Schema.String),
    }),
  ),
  teams: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      name: Schema.String,
      cyclesEnabled: Schema.Boolean,
    }),
  ),
});
export type LinearFilterOptions = typeof LinearFilterOptions.Type;

export const LinearGetIssueInput = Schema.Struct({
  identifier: Schema.String,
});
export type LinearGetIssueInput = typeof LinearGetIssueInput.Type;

export const LinearProjectSummary = Schema.Struct({
  /** Linear's short slug ID, which `linear project view` and project URLs use. */
  slugId: Schema.String,
  name: Schema.String,
  url: Schema.String,
  statusName: Schema.String,
  statusType: Schema.String,
  statusColor: Schema.String,
  description: Schema.String,
  leadName: Schema.optional(Schema.String),
  targetDate: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});
export type LinearProjectSummary = typeof LinearProjectSummary.Type;

export const LinearProjectDetail = Schema.Struct({
  ...LinearProjectSummary.fields,
  content: Schema.String,
  /** Completed share of the project's scope, 0 to 1. */
  progress: Schema.optional(Schema.Number),
  issues: Schema.Array(LinearIssueSummary),
});
export type LinearProjectDetail = typeof LinearProjectDetail.Type;

export const LinearListProjectsResult = Schema.Struct({
  projects: Schema.Array(LinearProjectSummary),
});
export type LinearListProjectsResult = typeof LinearListProjectsResult.Type;

export const LinearGetProjectInput = Schema.Struct({
  /** Slug ID, UUID, or exact name. */
  project: Schema.String,
});
export type LinearGetProjectInput = typeof LinearGetProjectInput.Type;

export const LinearCliErrorReason = Schema.Literals(["missing", "unauthenticated", "failed"]);
export type LinearCliErrorReason = typeof LinearCliErrorReason.Type;

export class LinearCliError extends Schema.TaggedError<LinearCliError>()("LinearCliError", {
  reason: LinearCliErrorReason,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Linear CLI ${this.reason}: ${this.detail}`;
  }
}
