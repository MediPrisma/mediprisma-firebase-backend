import type {FeedbackRequest} from "./types";

/**
 * HTML-escape a value before interpolating into the email template.
 * Every request field is attacker-controlled.
 * @param {unknown} value - Raw value.
 * @return {string} Escaped string.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Badge CSS classes must come from these allowlists, never raw input
export const ISSUE_TYPES = new Set(
  ["bug", "ai", "ui", "data", "performance", "privacy", "feature", "other"],
);
export const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

/**
 * Get localized label for issue type.
 * @param {string} type - Issue type code.
 * @return {string} Localized label.
 */
export function getIssueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    bug: "功能錯誤 (Bug)",
    ai: "AI 回答或臨床解讀問題 (AI Response / Clinical Interpretation)",
    ui: "介面與操作問題 (UI/UX)",
    data: "資料顯示問題 (Data)",
    performance: "速度或穩定性問題 (Performance)",
    privacy: "病安或隱私疑慮 (Safety / Privacy)",
    feature: "功能建議 (Feature Request)",
    other: "其他 (Other)",
  };
  return labels[type] || type;
}

/**
 * Get localized label for severity level.
 * @param {string} severity - Severity level code.
 * @return {string} Localized label.
 */
export function getSeverityLabel(severity: string): string {
  const labels: Record<string, string> = {
    low: "仍可繼續使用 (Low impact)",
    medium: "部分操作受影響 (Medium impact)",
    high: "無法完成工作 (High impact)",
    critical: "疑似病安或隱私事件 (Safety / Privacy)",
  };
  return labels[severity] || severity;
}

/**
 * Generate HTML email content for feedback.
 * @param {string} email - Reporter email.
 * @param {string} issueType - Issue type.
 * @param {string} severity - Severity level.
 * @param {string} description - Issue description.
 * @param {string | undefined} steps - Steps to reproduce.
 * @param {object} systemInfo - System information.
 * @param {number} imageCount - Number of attached screenshots.
 * @param {string} reportId - User-visible report reference.
 * @return {string} HTML email content.
 */
export function generateEmailHTML(
  email: string,
  issueType: string,
  severity: string,
  description: string,
  steps: string | undefined,
  systemInfo: FeedbackRequest["systemInfo"],
  imageCount = 0,
  reportId = "unknown",
): string {
  const issueTypeLabel = getIssueTypeLabel(issueType);
  const severityLabel = getSeverityLabel(severity);
  const issueTypeClass = ISSUE_TYPES.has(issueType) ? issueType : "other";
  const severityClass = SEVERITIES.has(severity) ? severity : "medium";
  const timestampFormatted = new Date(
    systemInfo.timestamp,
  ).toLocaleString("zh-TW", {timeZone: "Asia/Taipei"});

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: #3b82f6;
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
    }
    .content {
      background: #f9fafb;
      padding: 20px;
      border: 1px solid #e5e7eb;
    }
    .section { margin-bottom: 20px; }
    .label { font-weight: bold; color: #1f2937; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-bug { background: #fee2e2; color: #991b1b; }
    .badge-ai { background: #e0e7ff; color: #3730a3; }
    .badge-ui { background: #dbeafe; color: #1e40af; }
    .badge-data { background: #e0f2fe; color: #075985; }
    .badge-performance { background: #fef3c7; color: #92400e; }
    .badge-privacy { background: #fee2e2; color: #991b1b; }
    .badge-feature { background: #d1fae5; color: #065f46; }
    .badge-other { background: #e5e7eb; color: #374151; }
    .badge-low { background: #d1fae5; color: #065f46; }
    .badge-medium { background: #fef3c7; color: #92400e; }
    .badge-high { background: #fed7aa; color: #9a3412; }
    .badge-critical { background: #fee2e2; color: #991b1b; }
    .system-info {
      background: white;
      padding: 15px;
      border-radius: 6px;
      font-size: 13px;
    }
    .footer {
      text-align: center;
      padding: 20px;
      color: #6b7280;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🐛 醫療筆記系統 - 問題回報</h2>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">
        Medical Note System - Issue Report
      </p>
    </div>
    
    <div class="content">
      <div class="section">
        <span class="label">回報編號:</span> ${escapeHtml(reportId)}
      </div>
      <div class="section">
        <span class="label">回報者 Email:</span> ${escapeHtml(email)}
      </div>
      
      <div class="section">
        <span class="label">問題類型:</span> 
        <span class="badge badge-${issueTypeClass}">${
  escapeHtml(issueTypeLabel)
}</span>
      </div>
      
      <div class="section">
        <span class="label">影響程度:</span>
        <span class="badge badge-${severityClass}">${
  escapeHtml(severityLabel)
}</span>
      </div>
      
      <div class="section">
        <span class="label">問題描述:</span>
        <div style="
          margin-top: 8px;
          white-space: pre-wrap;
          background: white;
          padding: 12px;
          border-radius: 6px;
        ">${escapeHtml(description)}</div>
      </div>
      
      ${steps ? `
      <div class="section">
        <span class="label">重現步驟:</span>
        <div style="
          margin-top: 8px;
          white-space: pre-wrap;
          background: white;
          padding: 12px;
          border-radius: 6px;
        ">${escapeHtml(steps)}</div>
      </div>
      ` : ""}

      ${imageCount > 0 ? `
      <div class="section">
        <span class="label">圖片附件:</span>
        ${imageCount} 張（請見郵件附件）
      </div>
      ` : ""}
      
      <div class="section">
        <span class="label">系統資訊:</span>
        <div class="system-info">
          <div><strong>時間:</strong> ${escapeHtml(timestampFormatted)}</div>
          <div><strong>瀏覽器:</strong> ${
  escapeHtml(systemInfo.userAgent)
}</div>
          <div><strong>螢幕解析度:</strong> ${
  escapeHtml(systemInfo.screenResolution)
}</div>
          <div><strong>視窗大小:</strong> ${
  escapeHtml(systemInfo.viewport ?? "unknown")
}</div>
          <div><strong>像素比:</strong> ${
  escapeHtml(systemInfo.devicePixelRatio ?? "unknown")
}</div>
          <div><strong>根字級:</strong> ${
  escapeHtml(systemInfo.rootFontSize ?? "unknown")
}</div>
          <div><strong>主題:</strong> ${
  escapeHtml(systemInfo.theme ?? "unknown")
}</div>
          <div><strong>時區:</strong> ${
  escapeHtml(systemInfo.timeZone ?? "unknown")
}</div>
          <div><strong>語言:</strong> ${escapeHtml(systemInfo.language)}</div>
          <div><strong>當前頁面:</strong> ${
  escapeHtml(systemInfo.currentPath)
}</div>
          <div><strong>當前檢視:</strong> ${
  escapeHtml(systemInfo.currentView ?? "unknown")
}</div>
          <div><strong>FHIR Server origin:</strong> ${
  escapeHtml(
    systemInfo.fhirServerOrigin ?? systemInfo.fhirServerUrl ?? "unknown",
  )
}</div>
          <div><strong>應用程式版本:</strong> ${
  escapeHtml(systemInfo.appVersion ?? "unknown")
}</div>
          <div><strong>啟動來源:</strong> ${
  escapeHtml(systemInfo.launchSource ?? "unknown")
}</div>
          <div><strong>站點:</strong> ${
  escapeHtml(systemInfo.site ?? "unknown")
}</div>
        </div>
      </div>
    </div>
    
    <div class="footer">
      <p>此郵件由 MediPrisma 系統自動發送</p>
      <p>This email was automatically sent by MediPrisma system</p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Generate plain text email content for feedback.
 * @param {string} email - Reporter email.
 * @param {string} issueType - Issue type.
 * @param {string} severity - Severity level.
 * @param {string} description - Issue description.
 * @param {string | undefined} steps - Steps to reproduce.
 * @param {object} systemInfo - System information.
 * @param {number} imageCount - Number of attached screenshots.
 * @param {string} reportId - User-visible report reference.
 * @return {string} Plain text email content.
 */
export function generatePlainText(
  email: string,
  issueType: string,
  severity: string,
  description: string,
  steps: string | undefined,
  systemInfo: FeedbackRequest["systemInfo"],
  imageCount = 0,
  reportId = "unknown",
): string {
  const issueTypeLabel = getIssueTypeLabel(issueType);
  const severityLabel = getSeverityLabel(severity);
  const timestampFormatted = new Date(
    systemInfo.timestamp,
  ).toLocaleString("zh-TW", {timeZone: "Asia/Taipei"});

  return `
醫療筆記系統 - 問題回報
Medical Note System - Issue Report

回報編號: ${reportId}
回報者 Email: ${email}
問題類型: ${issueTypeLabel}
影響程度: ${severityLabel}

問題描述:
${description}

${steps ? `重現步驟:\n${steps}\n` : ""}
${imageCount > 0 ? `圖片附件: ${imageCount} 張（請見郵件附件）\n` : ""}

系統資訊:
- 時間: ${timestampFormatted}
- 瀏覽器: ${systemInfo.userAgent}
- 螢幕解析度: ${systemInfo.screenResolution}
- 視窗大小: ${systemInfo.viewport ?? "unknown"}
- 像素比: ${systemInfo.devicePixelRatio ?? "unknown"}
- 根字級: ${systemInfo.rootFontSize ?? "unknown"}
- 主題: ${systemInfo.theme ?? "unknown"}
- 時區: ${systemInfo.timeZone ?? "unknown"}
- 語言: ${systemInfo.language}
- 當前頁面: ${systemInfo.currentPath}
- 當前檢視: ${systemInfo.currentView ?? "unknown"}
- FHIR Server origin: ${
  systemInfo.fhirServerOrigin ?? systemInfo.fhirServerUrl ?? "unknown"
}
- 應用程式版本: ${systemInfo.appVersion ?? "unknown"}
- 啟動來源: ${systemInfo.launchSource ?? "unknown"}
- 站點: ${systemInfo.site ?? "unknown"}

---
此郵件由 MediPrisma 系統自動發送
This email was automatically sent by MediPrisma system
`;
}
