import type {Request, Response} from "express";
import {createHash, randomBytes} from "crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {Resend} from "resend";
import {
  verifyClientKey,
  verifyFirebaseIdToken,
} from "../../middleware/auth";
import {verifyAppCheck} from "../../middleware/appCheck";
import {parseJsonBody} from "../../utils/parser";
import type {FeedbackRequest} from "./types";
import {validateFeedbackImages} from "./image-attachments";
import {
  getIssueTypeLabel,
  getSeverityLabel,
  generateEmailHTML,
  generatePlainText,
} from "./utils";

const DATABASE_ID = "mediprisma";
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const ensureAdminApp = () => {
  if (getApps().length === 0) {
    initializeApp();
  }
};

// Hash the authenticated uid before storing it. This avoids hospital-wide NAT
// addresses making multiple clinicians share one rate-limit bucket.
const rateLimitKey = (subject: string): string =>
  createHash("sha256")
    .update((process.env.RATE_LIMIT_SALT ?? "mediprisma-feedback") + subject)
    .digest("hex")
    .slice(0, 32);

/**
 * Durable per-user feedback rate limit backed by Firestore. The previous
 * in-memory Map reset on every new serverless instance / cold start, so a
 * scripted flood could blow far past the intended 5/hour by spreading across
 * instances. A Firestore counter is shared by all instances. Fails OPEN on any
 * Firestore error — an infra hiccup must never block a real bug report.
 * @param {string} subject - Verified Firebase uid.
 * @return {Promise<boolean>} true when the caller is over the limit.
 */
const isRateLimited = async (subject: string): Promise<boolean> => {
  ensureAdminApp();
  try {
    const db = getFirestore(DATABASE_ID);
    const ref = db.collection("feedbackRateLimits").doc(
      rateLimitKey(`uid:${subject}`),
    );
    return await db.runTransaction(async (tx) => {
      const now = Date.now();
      const data = (await tx.get(ref)).data() as
        | {count?: number; windowStart?: number}
        | undefined;
      const windowStart = data?.windowStart ?? 0;
      const count = data?.count ?? 0;
      // Window elapsed → reset the bucket and allow.
      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        tx.set(ref, {
          count: 1,
          windowStart: now,
          // For an optional Firestore TTL policy on `expireAt` to auto-purge.
          expireAt: new Date(now + RATE_LIMIT_WINDOW_MS),
          lastUpdated: FieldValue.serverTimestamp(),
        });
        return false;
      }
      if (count >= RATE_LIMIT_MAX) {
        return true;
      }
      tx.set(
        ref,
        {count: count + 1, lastUpdated: FieldValue.serverTimestamp()},
        {merge: true},
      );
      return false;
    });
  } catch (error) {
    logger.error("Feedback rate-limit check failed — failing open", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

const MAX_FIELD_LENGTH = 5000;
const MAX_SYSTEM_FIELD_LENGTH = 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REPORT_ID_PATTERN = /^FB-\d{8}-[A-Z0-9]{8}$/;
const ISSUE_TYPE_VALUES = new Set([
  "bug",
  "ai",
  "ui",
  "data",
  "performance",
  "privacy",
  // Kept during the rollout so an older open client is not rejected.
  "feature",
  "other",
]);
const SEVERITY_VALUES = new Set(["low", "medium", "high", "critical"]);

const createReportId = (): string => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `FB-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasValidSystemInfo = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const required = [
    "timestamp",
    "userAgent",
    "screenResolution",
    "language",
    "currentPath",
  ];
  if (required.some((key) =>
    typeof value[key] !== "string" ||
    (value[key] as string).length === 0 ||
    (value[key] as string).length > MAX_SYSTEM_FIELD_LENGTH,
  )) return false;
  if (Number.isNaN(Date.parse(value["timestamp"] as string))) return false;

  const optional = [
    "viewport",
    "devicePixelRatio",
    "rootFontSize",
    "theme",
    "timeZone",
    "currentView",
    "fhirServerOrigin",
    "fhirServerUrl",
    "appVersion",
    "launchSource",
    "site",
  ];
  return optional.every((key) =>
    value[key] === undefined ||
    (typeof value[key] === "string" &&
      (value[key] as string).length <= MAX_SYSTEM_FIELD_LENGTH),
  );
};

export const handleFeedback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  if (req.method !== "POST") {
    res.set("Allow", "POST, OPTIONS");
    res.status(405).send("Method not allowed");
    return;
  }

  if (!verifyClientKey(req, res)) {
    return;
  }

  if (!(await verifyAppCheck(req, res))) {
    return;
  }

  const authedUser = await verifyFirebaseIdToken(req, res);
  if (!authedUser) {
    return;
  }

  if (await isRateLimited(authedUser.uid)) {
    res.set("Retry-After", "3600");
    res.status(429).json({error: "Too many requests"});
    return;
  }

  try {
    let payload: Record<string, unknown>;
    try {
      payload = parseJsonBody(req);
    } catch {
      res.status(400).json({error: "Invalid request"});
      return;
    }
    const body = payload as unknown as FeedbackRequest;

    const {
      email,
      issueType,
      severity,
      description,
      steps,
      images,
      systemInfo,
      reportId: submittedReportId,
    } = body;

    if (
      typeof email !== "string" ||
      !EMAIL_PATTERN.test(email) ||
      typeof issueType !== "string" ||
      !ISSUE_TYPE_VALUES.has(issueType) ||
      typeof severity !== "string" ||
      !SEVERITY_VALUES.has(severity) ||
      typeof description !== "string" ||
      description.trim().length < 20 ||
      (steps !== undefined && typeof steps !== "string") ||
      !hasValidSystemInfo(systemInfo) ||
      (submittedReportId !== undefined &&
        (typeof submittedReportId !== "string" ||
          !REPORT_ID_PATTERN.test(submittedReportId)))
    ) {
      res.status(400).json({error: "Missing required fields"});
      return;
    }
    const reportId = submittedReportId ?? createReportId();

    if (
      String(email).length > 320 ||
      String(description).length > MAX_FIELD_LENGTH ||
      String(steps ?? "").length > MAX_FIELD_LENGTH
    ) {
      res.status(413).json({error: "Payload too large"});
      return;
    }

    const imageValidation = validateFeedbackImages(images);
    if (!imageValidation.ok) {
      res.status(imageValidation.status).json({
        error: imageValidation.status === 413 ?
          "Payload too large" : "Invalid image attachment",
      });
      return;
    }
    const validatedImages = imageValidation.images;

    const resendApiKey = process.env.RESEND_API_KEY;
    const feedbackTo = process.env.FEEDBACK_TO_EMAIL;
    const feedbackFrom = process.env.FEEDBACK_FROM_EMAIL;

    if (!resendApiKey || !feedbackTo || !feedbackFrom) {
      logger.warn(
        "Feedback email delivery is not fully configured",
        {issueType, severity},
      );

      res.status(503).json({
        error: "Feedback service unavailable",
        emailSent: false,
      });
      return;
    }

    const resend = new Resend(resendApiKey);

    const emailContent = generateEmailHTML(
      email,
      issueType,
      severity,
      description,
      steps,
      systemInfo,
      validatedImages.length,
      reportId,
    );

    const plainTextContent = generatePlainText(
      email,
      issueType,
      severity,
      description,
      steps,
      systemInfo,
      validatedImages.length,
      reportId,
    );

    const issueTypeLabel = getIssueTypeLabel(issueType);
    const severityLabel = getSeverityLabel(severity);

    logger.info("Sending feedback email via Resend...");

    const {data, error} = await resend.emails.send(
      {
        from: feedbackFrom,
        to: [feedbackTo],
        replyTo: email,
        subject: `[問題回報 ${reportId}] ${issueTypeLabel} - ${severityLabel}`,
        html: emailContent,
        text: plainTextContent,
        ...(validatedImages.length > 0 && {
          attachments: validatedImages.map((image, index) => ({
            filename: `feedback-image-${index + 1}.${image.extension}`,
            content: image.data,
            contentType: image.contentType,
          })),
        }),
      },
      // Retrying a timed-out request keeps the same report ID, so Resend does
      // not deliver a duplicate email.
      {idempotencyKey: reportId},
    );

    if (error) {
      // Details stay in server logs; callers get a generic error
      logger.error("Resend SDK error:", error);
      res.status(500).json({error: "Internal server error"});
      return;
    }

    logger.info("Feedback email sent, id:", data?.id);

    res.status(200).json({success: true, emailSent: true, reportId});
  } catch (error) {
    logger.error("Feedback handler error:", error);
    res.status(500).json({error: "Internal server error"});
  }
};
