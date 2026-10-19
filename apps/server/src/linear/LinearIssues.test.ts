import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as LinearIssues from "./LinearIssues.ts";

const output = (stdout: string, code = 0, stderr = "") => ({
  stdout,
  stderr,
  code: ChildProcessSpawner.ExitCode(code),
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

const layerWith = (
  run: ProcessRunner.ProcessRunner["Service"]["run"],
): Layer.Layer<LinearIssues.LinearIssues> =>
  LinearIssues.layer.pipe(
    Layer.provide(Layer.succeed(ProcessRunner.ProcessRunner, { run })),
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "t3code-linear-test-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
    Layer.orDie,
  );

const issueRow = {
  identifier: "ENG-1",
  title: "Fix the widget",
  url: "https://linear.app/acme/issue/ENG-1",
  priorityLabel: "High",
  updatedAt: "2026-10-01T00:00:00.000Z",
  state: { name: "In Progress", type: "started", color: "#f2c94c" },
  assignee: { name: "alice", displayName: "Alice" },
  team: { key: "ENG" },
  labels: [],
};

it.effect("lists my open issues through `linear issue query --json`", () => {
  const calls: Array<ReadonlyArray<string>> = [];
  return Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const result = yield* linear.listIssues({ assignee: "@me" });
    expect(result.issues).toEqual([
      {
        identifier: "ENG-1",
        title: "Fix the widget",
        url: "https://linear.app/acme/issue/ENG-1",
        stateName: "In Progress",
        stateType: "started",
        stateColor: "#f2c94c",
        priorityLabel: "High",
        assigneeName: "Alice",
        teamKey: "ENG",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    expect(calls[0]).toEqual(expect.arrayContaining(["issue", "query", "--json", "@me"]));
  }).pipe(
    Effect.provide(
      layerWith((input) =>
        Effect.sync(() => {
          calls.push(input.args);
          return output(JSON.stringify([issueRow]));
        }),
      ),
    ),
  );
});

it.effect("reads an issue's description and comments in either connection shape", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const issue = yield* linear.getIssue("ENG-1");
    expect(issue.description).toBe("## Body");
    expect(issue.comments).toEqual([
      { id: "c1", author: "Bob", body: "Looks good", createdAt: "2026-10-02T00:00:00.000Z" },
    ]);
  }).pipe(
    Effect.provide(
      layerWith(() =>
        Effect.succeed(
          output(
            JSON.stringify({
              ...issueRow,
              description: "## Body",
              comments: {
                nodes: [
                  {
                    id: "c1",
                    body: "Looks good",
                    createdAt: "2026-10-02T00:00:00.000Z",
                    user: { name: "bob", displayName: "Bob" },
                  },
                ],
              },
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("rejects identifiers that could be read as CLI flags", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const error = yield* Effect.flip(linear.getIssue("--web"));
    expect(error.reason).toBe("failed");
  }).pipe(Effect.provide(layerWith(() => Effect.die("the CLI must not run")))),
);

it.effect("reports a signed-out CLI as unauthenticated", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const error = yield* Effect.flip(linear.listIssues({}));
    expect(error.reason).toBe("unauthenticated");
  }).pipe(
    Effect.provide(
      layerWith(() =>
        Effect.succeed(output("", 1, "✗ Failed to get user info: No API key configured\n")),
      ),
    ),
  ),
);

it.effect("reports a missing CLI with an install hint", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const error = yield* Effect.flip(linear.listIssues({ assignee: "@me" }));
    expect(error.reason).toBe("missing");
    expect(error.detail).toContain("brew install");
  }).pipe(
    Effect.provide(
      layerWith((input) =>
        Effect.fail(
          new ProcessRunner.ProcessSpawnError({
            command: input.command,
            argumentCount: input.args.length,
            cause: new Error("ENOENT"),
          }),
        ),
      ),
    ),
  ),
);

it.effect("reads a project and its issues from a project-scoped issue query", () => {
  const calls: Array<ReadonlyArray<string>> = [];
  return Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const project = yield* linear.getProject("WTFox Trial");
    expect(project).toMatchObject({
      slugId: "b673cd08289b",
      name: "WTFox Trial",
      statusName: "In Progress",
      content: "## Problem",
      progress: 0.5,
    });
    expect(project.issues.map((issue) => issue.identifier)).toEqual(["ENG-1"]);
    // The name is resolved once; the issue query uses the slug ID it resolved to.
    expect(calls[1]).toEqual(expect.arrayContaining(["--project", "b673cd08289b"]));
  }).pipe(
    Effect.provide(
      layerWith((input) =>
        Effect.sync(() => {
          calls.push(input.args);
          return input.args[0] === "project"
            ? output(
                JSON.stringify({
                  slugId: "b673cd08289b",
                  name: "WTFox Trial",
                  url: "https://linear.app/acme/project/wtfox-trial-b673cd08289b",
                  content: "## Problem",
                  progress: 0.5,
                  status: { name: "In Progress", type: "started", color: "#F2C94C" },
                }),
              )
            : output(JSON.stringify([issueRow]));
        }),
      ),
    ),
  );
});

it.effect("rejects project references that could be read as CLI flags", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const error = yield* Effect.flip(linear.getProject("--web"));
    expect(error.reason).toBe("failed");
  }).pipe(Effect.provide(layerWith(() => Effect.die("the CLI must not run")))),
);

it.effect("reads labels, points, and cycle from issue rows", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const { issues } = yield* linear.listIssues({});
    expect(issues[0]).toMatchObject({
      priority: 2,
      estimate: 3,
      labels: [{ name: "Bug", color: "#ff0000" }],
      cycleNumber: 12,
      cycleIsActive: true,
      projectName: "Launch",
    });
  }).pipe(
    Effect.provide(
      layerWith(() =>
        Effect.succeed(
          output(
            JSON.stringify([
              {
                ...issueRow,
                priority: 2,
                estimate: 3,
                labels: [{ name: "Bug", color: "#ff0000" }],
                cycle: { number: 12, name: null, isActive: true },
                project: { name: "Launch" },
              },
            ]),
          ),
        ),
      ),
    ),
  ),
);

it.effect("filters by cycle within each team that runs cycles", () => {
  const calls: Array<ReadonlyArray<string>> = [];
  return Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const { issues } = yield* linear.listIssues({ cycle: "active", labels: ["Bug"] });
    expect(issues.map((issue) => issue.identifier)).toEqual(["ENG-1"]);
    const queries = calls.filter((args) => args[0] === "issue");
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual(
      expect.arrayContaining(["--team", "ENG", "--cycle", "active", "--label", "Bug"]),
    );
    expect(queries[0]).not.toContain("--all-teams");
  }).pipe(
    Effect.provide(
      layerWith((input) =>
        Effect.sync(() => {
          calls.push(input.args);
          return input.args[0] === "team"
            ? output(
                JSON.stringify([
                  { key: "ENG", name: "Engineering", cyclesEnabled: true },
                  { key: "OPS", name: "Operations", cyclesEnabled: false },
                ]),
              )
            : output(JSON.stringify([issueRow]));
        }),
      ),
    ),
  );
});

it.effect("rejects filter values that could be read as CLI flags", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const error = yield* Effect.flip(linear.listIssues({ labels: ["--web"] }));
    expect(error.reason).toBe("failed");
  }).pipe(Effect.provide(layerWith(() => Effect.die("the CLI must not run")))),
);

it.effect("fills in points and due date the issue view leaves out", () =>
  Effect.gen(function* () {
    const linear = yield* LinearIssues.LinearIssues;
    const issue = yield* linear.getIssue("ENG-1");
    expect(issue).toMatchObject({
      estimate: 5,
      dueDate: "2026-10-20",
      teamName: "Engineering",
      creatorName: "Bob",
      stateName: "In Progress",
    });
  }).pipe(
    Effect.provide(
      layerWith((input) =>
        Effect.succeed(
          input.args[0] === "api"
            ? output(
                JSON.stringify({
                  data: {
                    issue: {
                      estimate: 5,
                      dueDate: "2026-10-20",
                      creator: { displayName: "Bob" },
                      team: { key: "ENG", name: "Engineering" },
                    },
                  },
                }),
              )
            : output(JSON.stringify({ ...issueRow, estimate: null, description: "" })),
        ),
      ),
    ),
  ),
);
