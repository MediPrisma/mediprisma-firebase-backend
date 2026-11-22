export interface FeedbackRequest {
  reportId?: string;
  email: string;
  issueType: string;
  severity: string;
  description: string;
  steps?: string;
  images?: Array<{
    contentType: string;
    data: string;
  }>;
  systemInfo: {
    timestamp: string;
    userAgent: string;
    screenResolution: string;
    viewport?: string;
    devicePixelRatio?: string;
    rootFontSize?: string;
    theme?: string;
    timeZone?: string;
    language: string;
    currentPath: string;
    currentView?: string;
    fhirServerOrigin?: string;
    // Accepted temporarily for older deployed clients. New clients send only
    // the origin so launch paths and query values never enter the email.
    fhirServerUrl?: string;
    appVersion?: string;
    launchSource?: string;
    site?: string;
  };
}
