import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockRunApiRuntimeOneShot = vi.fn();
const mockFindTaskById = vi.fn();
const mockUpdateTask = vi.fn();
const mockGetProjectConfig = vi.fn();

vi.mock("../services/runtime.js", () => ({
  runApiRuntimeOneShot: (...args: unknown[]) => mockRunApiRuntimeOneShot(...args),
}));

vi.mock("@aif/data", () => ({
  findTaskById: (id: string) => mockFindTaskById(id),
  updateTask: (...args: unknown[]) => mockUpdateTask(...args),
}));

// Keep broadcast / payload conversion as no-ops so the runner can be tested in isolation.
vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
}));
vi.mock("../repositories/tasks.js", () => ({
  toTaskBroadcastPayload: (t: { id: string }) => ({ id: t.id }),
}));

vi.mock("@aif/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared")>();
  return {
    ...actual,
    getProjectConfig: (...args: unknown[]) => mockGetProjectConfig(...args),
  };
});

const { runQaQuery, computeQaBranchSlug, buildQaPrompt } = await import("../services/qaRunner.js");

const BRANCH = "feature/foo";

function writeArtifacts(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "change-summary.md"), "# Change Summary\nstuff");
  writeFileSync(join(dir, "test-plan.md"), "# Test Plan\nsteps");
  writeFileSync(join(dir, "test-cases.md"), "# Test Cases\ncases");
}

describe("computeQaBranchSlug", () => {
  it("matches the aif-qa skill slug for feature/foo", () => {
    expect(computeQaBranchSlug("feature/foo", process.cwd())).toBe("feature-foo-a72ccce7");
  });

  it("matches the aif-qa skill slug for feature-foo (distinct hash from feature/foo)", () => {
    expect(computeQaBranchSlug("feature-foo", process.cwd())).toBe("feature-foo-6f80dfc6");
  });
});

describe("buildQaPrompt", () => {
  it("embeds the three exact artifact paths", () => {
    const dir = "/abs/qa/feature-foo-a72ccce7";
    const prompt = buildQaPrompt(dir);
    expect(prompt).toContain(join(dir, "change-summary.md"));
    expect(prompt).toContain(join(dir, "test-plan.md"));
    expect(prompt).toContain(join(dir, "test-cases.md"));
  });
});

describe("runQaQuery", () => {
  let root: string;

  beforeEach(() => {
    mockRunApiRuntimeOneShot.mockReset();
    mockFindTaskById.mockReset();
    mockUpdateTask.mockReset();
    mockGetProjectConfig.mockReset();
    root = mkdtempSync(join(tmpdir(), "qa-runner-test-"));
    mockGetProjectConfig.mockReturnValue({ paths: { qa: ".ai-factory/qa/" } });
    // findTaskById returns the same baseline task on every call (running/done/error reads).
    mockFindTaskById.mockReturnValue({ id: "t1", branchName: BRANCH, qaStatus: "idle" });
    mockRunApiRuntimeOneShot.mockResolvedValue({ result: { outputText: "ok" }, context: {} });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns ok:false when task not found (never throws)", async () => {
    mockFindTaskById.mockReturnValue(undefined);
    const res = await runQaQuery({ projectId: "p1", taskId: "missing", executionRoot: root });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(mockRunApiRuntimeOneShot).not.toHaveBeenCalled();
  });

  it("fails loud when task has no branchName (does not guess via git)", async () => {
    mockFindTaskById.mockReturnValue({ id: "t1", branchName: null, qaStatus: "idle" });
    const res = await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/branchName/);
    expect(mockRunApiRuntimeOneShot).not.toHaveBeenCalled();
  });

  it("calls runtime with qa workflow contract", async () => {
    const slug = computeQaBranchSlug(BRANCH, root);
    writeArtifacts(join(root, ".ai-factory/qa", slug));
    await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    const arg = mockRunApiRuntimeOneShot.mock.calls[0][0];
    expect(arg.workflowKind).toBe("qa");
    expect(arg.projectRoot).toBe(root);
    expect(arg.fallbackSlashCommand).toBe("/aif-qa --all");
    expect(arg.usageContext).toEqual({ source: "qa" });
  });

  it("sets qaStatus running BEFORE the runtime call", async () => {
    const slug = computeQaBranchSlug(BRANCH, root);
    writeArtifacts(join(root, ".ai-factory/qa", slug));
    await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    expect(mockUpdateTask).toHaveBeenCalledWith("t1", { qaStatus: "running" });
    expect(mockUpdateTask.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunApiRuntimeOneShot.mock.invocationCallOrder[0],
    );
  });

  it("persists qaStatus done + three artifacts on success", async () => {
    const slug = computeQaBranchSlug(BRANCH, root);
    writeArtifacts(join(root, ".ai-factory/qa", slug));
    const res = await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    expect(res.ok).toBe(true);
    expect(mockUpdateTask).toHaveBeenCalledWith("t1", {
      qaStatus: "done",
      qaChangeSummary: "# Change Summary\nstuff",
      qaTestPlan: "# Test Plan\nsteps",
      qaTestCases: "# Test Cases\ncases",
    });
  });

  it("reads artifacts from a custom cfg.paths.qa override", async () => {
    mockGetProjectConfig.mockReturnValue({ paths: { qa: "custom/qa-out/" } });
    const slug = computeQaBranchSlug(BRANCH, root);
    writeArtifacts(join(root, "custom/qa-out", slug));
    const res = await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    expect(res.ok).toBe(true);
    const doneCall = mockUpdateTask.mock.calls.find((c) => c[1]?.qaStatus === "done");
    expect(doneCall?.[1].qaChangeSummary).toBe("# Change Summary\nstuff");
  });

  it("stores null for a missing artifact without throwing (Nullable Cast Rule)", async () => {
    const slug = computeQaBranchSlug(BRANCH, root);
    const dir = join(root, ".ai-factory/qa", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "change-summary.md"), "# only summary");
    // test-plan.md and test-cases.md intentionally missing
    const res = await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    expect(res.ok).toBe(true);
    const doneCall = mockUpdateTask.mock.calls.find((c) => c[1]?.qaStatus === "done");
    expect(doneCall?.[1].qaChangeSummary).toBe("# only summary");
    expect(doneCall?.[1].qaTestPlan).toBeNull();
    expect(doneCall?.[1].qaTestCases).toBeNull();
  });

  it("sets qaStatus error and returns ok:false when runtime throws", async () => {
    mockRunApiRuntimeOneShot.mockRejectedValue(new Error("boom"));
    const res = await runQaQuery({ projectId: "p1", taskId: "t1", executionRoot: root });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("boom");
    expect(mockUpdateTask).toHaveBeenCalledWith("t1", { qaStatus: "error" });
  });
});
