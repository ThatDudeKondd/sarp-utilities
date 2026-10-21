import "dotenv/config";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  release: process.env.SENTRY_RELEASE,
  debug: process.env.SENTRY_DEBUG as boolean | undefined,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    graphQL: { document: false, variables: false },
  },
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
  integrations: [nodeProfilingIntegration()],
  // profile only while a sampled trace is running
  profileSessionSampleRate: 1.0,
  profileLifecycle: "trace",
});

if (process.env.SENTRY_TEST) {
  Sentry.captureException(new Error("Sentry test event"));
  // proves tracing without needing a Discord command
  Sentry.startSpan({ name: "sentry-test-span", op: "test" }, () => {});
}
