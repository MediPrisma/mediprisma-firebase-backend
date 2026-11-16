import {handleClaudeChat} from "../functions/src/services/claude/handler";

jest.mock("../functions/src/middleware/auth", () => ({
  verifyClientKey: jest.fn(() => true),
  verifyFirebaseIdToken: jest.fn(async () => ({uid: "synthetic-user", isAnonymous: true})),
}));
jest.mock("../functions/src/middleware/appCheck", () => ({
  verifyAppCheck: jest.fn(async () => true),
}));
jest.mock("../functions/src/middleware/quota", () => ({
  checkAndConsumeQuota: jest.fn(async () => true),
}));

describe("Claude owner-funded model routing", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it.each([
    ["claude-haiku-5-5", "claude-haiku-5-5"],
    ["claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001"],
    ["claude-sonnet-5-5", "claude-haiku-5-5"],
    ["claude-opus-5-5", "claude-haiku-5-5"],
    ["claude-fable-5-2", "claude-haiku-5-5"],
  ])("routes %s to %s without funding premium models", async (model, expected) => {
    process.env.ANTHROPIC_API_KEY = "synthetic-server-key";
    const send = jest.fn(async () => ({ok: true, json: async () => ({model: expected})}));
    globalThis.fetch = send as never;
    const res = {status: jest.fn().mockReturnThis(), json: jest.fn()};
    await handleClaudeChat({
      method: "POST", body: {model, messages: [{role: "user", content: "Synthetic question"}]},
    } as never, res as never);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse((send.mock.calls as unknown as [string, RequestInit][])[0][1].body as string).model).toBe(expected);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({model: expected});
  });
});
