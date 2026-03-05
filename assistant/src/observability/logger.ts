import { LOG_FORMAT, LOG_LEVEL, LOG_SERVICE_NAME } from "../config/env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function isLogLevel(value: string): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function resolveLogLevel(value: string): LogLevel {
  return isLogLevel(value) ? value : "info";
}

const minimumLogLevel = resolveLogLevel(LOG_LEVEL);
const outputPretty = LOG_FORMAT === "pretty";

type LogContext = Record<string, unknown>;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minimumLogLevel];
}

function sanitizeContext(context: LogContext): LogContext {
  return Object.entries(context).reduce<LogContext>((output, [key, value]) => {
    if (value === undefined) return output;
    output[key] = value;
    return output;
  }, {});
}

function renderPrettyLine(input: {
  timestamp: string;
  level: LogLevel;
  service: string;
  event: string;
  message: string;
  fields: LogContext;
}): string {
  const pairs = Object.entries(input.fields).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  const fields = pairs.length > 0 ? ` ${pairs.join(" ")}` : "";
  return `${input.timestamp} ${input.level.toUpperCase()} [${input.service}] ${input.event} ${input.message}${fields}`;
}

function writeRecord(input: {
  level: LogLevel;
  event: string;
  message: string;
  context?: LogContext;
}): void {
  if (!shouldLog(input.level)) {
    return;
  }

  const timestamp = new Date().toISOString();
  const fields = sanitizeContext(input.context ?? {});
  const record = {
    timestamp,
    level: input.level,
    service: LOG_SERVICE_NAME,
    event: input.event,
    message: input.message,
    ...fields
  };

  if (outputPretty) {
    process.stdout.write(
      `${renderPrettyLine({
        timestamp,
        level: input.level,
        service: LOG_SERVICE_NAME,
        event: input.event,
        message: input.message,
        fields
      })}\n`
    );
    return;
  }

  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export function createLogger(baseContext: LogContext = {}) {
  const logger = {
    child(context: LogContext) {
      return createLogger({
        ...baseContext,
        ...context
      });
    },
    debug(event: string, message: string, context: LogContext = {}) {
      writeRecord({
        level: "debug",
        event,
        message,
        context: { ...baseContext, ...context }
      });
    },
    info(event: string, message: string, context: LogContext = {}) {
      writeRecord({
        level: "info",
        event,
        message,
        context: { ...baseContext, ...context }
      });
    },
    warn(event: string, message: string, context: LogContext = {}) {
      writeRecord({
        level: "warn",
        event,
        message,
        context: { ...baseContext, ...context }
      });
    },
    error(event: string, message: string, context: LogContext = {}) {
      writeRecord({
        level: "error",
        event,
        message,
        context: { ...baseContext, ...context }
      });
    }
  };

  return logger;
}

export const logger = createLogger();
