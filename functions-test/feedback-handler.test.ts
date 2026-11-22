const mockSend = jest.fn();
const mockVerifyFirebaseIdToken = jest.fn(async (..._args: unknown[]) => ({
  uid: "test-user",
  isAnonymous: false,
}));
const mockTransactionGet = jest.fn(async () => ({
  data: () => undefined,
}));

jest.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: jest.fn(),
}));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: () => ({doc: () => ({})}),
    runTransaction: async (callback: (tx: unknown) => unknown) => callback({
      get: mockTransactionGet,
      set: jest.fn(),
    }),
  }),
  FieldValue: {serverTimestamp: () => "server-time"},
}));

jest.mock("firebase-functions/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {send: mockSend},
  })),
}));

jest.mock("../functions/src/middleware/auth", () => ({
  verifyClientKey: () => true,
  verifyFirebaseIdToken: (...args: unknown[]) =>
    mockVerifyFirebaseIdToken(...args),
}));

jest.mock("../functions/src/middleware/appCheck", () => ({
  verifyAppCheck: async () => true,
}));

import {handleFeedback} from
  "../functions/src/services/feedback/handler";

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    set: jest.fn(),
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function feedbackRequest(images?: unknown) {
  return {
    method: "POST",
    body: {
      reportId: "FB-20260915-ABCDEF12",
      email: "reporter@example.test",
      issueType: "ai",
      severity: "medium",
      description: "A sufficiently detailed issue description.",
      images,
      systemInfo: {
        timestamp: "2026-09-15T00:00:00.000Z",
        userAgent: "test-browser",
        screenResolution: "1280x720",
        language: "zh-TW",
        currentPath: "/",
        fhirServerUrl: "not-connected",
      },
    },
    header: () => undefined,
  };
}

describe("production feedback handler attachments", () => {
  const oldResendApiKey = process.env.RESEND_API_KEY;
  const oldFeedbackTo = process.env.FEEDBACK_TO_EMAIL;
  const oldFeedbackFrom = process.env.FEEDBACK_FROM_EMAIL;

  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.FEEDBACK_TO_EMAIL = "maintainer@example.test";
    process.env.FEEDBACK_FROM_EMAIL = "MediPrisma <feedback@example.test>";
    mockVerifyFirebaseIdToken.mockReset();
    mockVerifyFirebaseIdToken.mockResolvedValue({
      uid: "test-user",
      isAnonymous: false,
    });
    mockSend.mockReset();
    mockSend.mockResolvedValue({data: {id: "email-1"}, error: null});
  });

  afterAll(() => {
    if (oldResendApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = oldResendApiKey;
    if (oldFeedbackTo === undefined) delete process.env.FEEDBACK_TO_EMAIL;
    else process.env.FEEDBACK_TO_EMAIL = oldFeedbackTo;
    if (oldFeedbackFrom === undefined) delete process.env.FEEDBACK_FROM_EMAIL;
    else process.env.FEEDBACK_FROM_EMAIL = oldFeedbackFrom;
  });

  it("forwards a validated image as a generated-name Resend attachment", async () => {
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]).toString("base64");
    const response = mockResponse();

    await handleFeedback(
      feedbackRequest([{contentType: "image/png", data: pngData}]) as never,
      response as never,
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      success: true,
      emailSent: true,
      reportId: "FB-20260915-ABCDEF12",
    });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "MediPrisma <feedback@example.test>",
        to: ["maintainer@example.test"],
        subject: expect.stringContaining("FB-20260915-ABCDEF12"),
        attachments: [{
          filename: "feedback-image-1.png",
          content: pngData,
          contentType: "image/png",
        }],
      }),
      {idempotencyKey: "FB-20260915-ABCDEF12"},
    );
    expect(mockSend.mock.calls[0][0].subject)
      .toContain("AI 回答或臨床解讀問題");
  });

  it("returns unavailable instead of success when email is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const response = mockResponse();

    await handleFeedback(feedbackRequest() as never, response as never);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      error: "Feedback service unavailable",
      emailSent: false,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rejects values outside the feedback contract", async () => {
    const request = feedbackRequest() as ReturnType<typeof feedbackRequest>;
    request.body.issueType = "<style>bad</style>";
    const response = mockResponse();

    await handleFeedback(request as never, response as never);

    expect(response.statusCode).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("requires a verified Firebase session", async () => {
    mockVerifyFirebaseIdToken.mockImplementationOnce(async (_req, res) => {
      (res as ReturnType<typeof mockResponse>)
        .status(401)
        .json({error: "Unauthorized"});
      return null;
    });
    const response = mockResponse();

    await handleFeedback(feedbackRequest() as never, response as never);

    expect(response.statusCode).toBe(401);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
