import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { projects, tasks } from "@aif/shared";
import { createTestDb } from "@aif/shared/server";

const testDb = { current: createTestDb() };

vi.mock("@aif/shared/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aif/shared/server")>();
  return {
    ...actual,
    getDb: () => testDb.current,
  };
});

vi.mock("../ws.js", () => ({
  broadcast: vi.fn(),
  setupWebSocket: vi.fn(() => ({ injectWebSocket: vi.fn(), upgradeWebSocket: vi.fn() })),
  getInjectWebSocket: vi.fn(),
}));

// Prevent the fire-and-forget runner from executing the real runtime.
const mockRunQaQuery = vi.fn();
vi.mock("../services/qaRunner.js", () => ({
  runQaQuery: (...args: unknown[]) => mockRunQaQuery(...args),
}));

const { tasksRouter } = await import("../routes/tasks.js");

function createApp() {
  const app = new Hono();
  app.route("/tasks", tasksRouter);
  return app;
}

function seedTask(overrides: Record<string, unknown> = {}) {
  const db = testDb.current;
  db.insert(projects).values({ id: "p1", name: "P1", rootPath: "/tmp/p1" }).run();
  db.insert(tasks)
    .values({
      id: "t1",
      projectId: "p1",
      title: "Task 1",
      branchName: "feature/foo",
      qaStatus: "idle",
      ...overrides,
    })
    .run();
}

describe("POST /tasks/:id/run-qa", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    testDb.current = createTestDb();
    app = createApp();
    mockRunQaQuery.mockReset();
    mockRunQaQuery.mockResolvedValue({ ok: true });
  });

  it("returns 404 when task not found", async () => {
    const res = await app.request("/tasks/missing/run-qa", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when project not found", async () => {
    testDb.current
      .insert(tasks)
      .values({ id: "t1", projectId: "ghost", title: "T", branchName: "feature/foo" })
      .run();
    const res = await app.request("/tasks/t1/run-qa", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 409 when QA already running", async () => {
    seedTask({ qaStatus: "running" });
    const res = await app.request("/tasks/t1/run-qa", { method: "POST" });
    expect(res.status).toBe(409);
    expect(mockRunQaQuery).not.toHaveBeenCalled();
  });

  it("returns 409 when task has no branchName", async () => {
    seedTask({ branchName: null });
    const res = await app.request("/tasks/t1/run-qa", { method: "POST" });
    expect(res.status).toBe(409);
    expect(mockRunQaQuery).not.toHaveBeenCalled();
  });

  it("returns 202 and triggers the runner on a valid request", async () => {
    seedTask();
    const res = await app.request("/tasks/t1/run-qa", { method: "POST" });
    expect(res.status).toBe(202);
    // Fire-and-forget: allow the async import + invocation to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunQaQuery).toHaveBeenCalledWith({
      projectId: "p1",
      taskId: "t1",
      executionRoot: "/tmp/p1",
    });
  });

  it("uses worktreePath as executionRoot when present", async () => {
    seedTask({ worktreePath: "/tmp/wt/t1" });
    const res = await app.request("/tasks/t1/run-qa", { method: "POST" });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunQaQuery).toHaveBeenCalledWith({
      projectId: "p1",
      taskId: "t1",
      executionRoot: "/tmp/wt/t1",
    });
  });
});
