import { describe, expect, it } from "vite-plus/test";

import { linearIssueIdFromBranch, parseLinearUrl } from "./linearThreadStore";

describe("parseLinearUrl", () => {
  it("reads issue IDs from linear.app issue links", () => {
    expect(parseLinearUrl("https://linear.app/acme/issue/ENG-123/fix-the-widget")).toEqual({
      kind: "issue",
      id: "ENG-123",
    });
    expect(parseLinearUrl("https://linear.app/acme/issue/eng-7#comment-1")).toEqual({
      kind: "issue",
      id: "ENG-7",
    });
  });

  it("reads the slug ID from linear.app project links", () => {
    expect(parseLinearUrl("https://linear.app/acme/project/wtfox-trial-b673cd08289b")).toEqual({
      kind: "project",
      id: "b673cd08289b",
    });
    expect(
      parseLinearUrl("https://linear.app/acme/project/wtfox-trial-b673cd08289b/overview"),
    ).toEqual({ kind: "project", id: "b673cd08289b" });
  });

  it("ignores other Linear pages and other hosts", () => {
    expect(parseLinearUrl("https://linear.app/acme/team/ENG/active")).toBeNull();
    expect(parseLinearUrl("https://linear.app/acme/project/launch-plan")).toBeNull();
    expect(parseLinearUrl("https://evil.example/linear.app/acme/issue/ENG-1")).toBeNull();
  });
});

describe("linearIssueIdFromBranch", () => {
  it("finds the ID in Linear's branch names", () => {
    expect(linearIssueIdFromBranch("putt/eng-123-fix-the-widget")).toBe("ENG-123");
    expect(linearIssueIdFromBranch("ENG-42")).toBe("ENG-42");
  });

  it("finds nothing in branches without one", () => {
    expect(linearIssueIdFromBranch("user/putt/fix/debounce-action-buttons")).toBeNull();
    expect(linearIssueIdFromBranch("release/v1.4-2")).toBeNull();
    expect(linearIssueIdFromBranch(null)).toBeNull();
  });
});
