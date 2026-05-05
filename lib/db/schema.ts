import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["pending", "approved", "rejected"]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  status: userStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const jobStatusEnum = pgEnum("job_status", [
  "uploaded",
  "awaiting_validation",
  "approved",
  "running",
  "login_succeeded",
  "failed",
  "awaiting_recovery",
]);

export const platformIdEnum = pgEnum("platform_id", ["orizon_fature"]);

export const jobFlowTypeEnum = pgEnum("job_flow_type", ["short", "complete"]);

export const platforms = pgTable("platforms", {
  id: platformIdEnum("id").primaryKey(),
  name: text("name").notNull(),
  loginUrl: text("login_url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const platformCredentials = pgTable(
  "platform_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platformId: platformIdEnum("platform_id")
      .notNull()
      .references(() => platforms.id),
    label: text("label").notNull(),
    username: text("username").notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("platform_credentials_user_id_idx").on(table.userId),
    uniqueIndex("platform_credentials_user_platform_label_idx").on(
      table.userId,
      table.platformId,
      table.label,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: jobStatusEnum("status").notNull().default("uploaded"),
    flowType: jobFlowTypeEnum("flow_type").notNull().default("short"),
    runId: text("run_id"),
    platformId: platformIdEnum("platform_id").references(() => platforms.id),
    platformCredentialId: text("platform_credential_id").references(
      () => platformCredentials.id,
    ),
    validationHookToken: text("validation_hook_token"),
    errorMessage: text("error_message"),
    pendingStepRecovery: jsonb("pending_step_recovery").$type<PendingStepRecovery | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("jobs_user_id_idx").on(table.userId),
    index("jobs_status_idx").on(table.status),
  ],
);

export type PendingStepRecovery = {
  stepName: string;
  goal: string;
  attemptsUsed: number;
  lastError: string;
  visionSummaries: Array<{ approach: string; outcome: string }>;
  screenshotKey: string | null;
  snapshotKey: string | null;
  context?: { pageId?: string; modalId?: string; elementId?: string };
  suspendedAt: string;
  // Operator's resolution from /api/jobs/[jobId]/resume-recovery, consumed
  // by the step runner on the next workflow run for this job.
  operatorResolution?:
    | { resolution: "retry" }
    | { resolution: "skip" }
    | { resolution: "fail"; reason?: string }
    | { resolution: "manual_selector"; selector: string; verb?: "click" | "fill" | "select" | "check" | "scroll" };
};

export const jobFiles = pgTable(
  "job_files",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: text("size").notNull(),
    checksum: text("checksum").notNull(),
    blobUrl: text("blob_url").notNull(),
    pathname: text("pathname").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("job_files_job_id_idx").on(table.jobId)],
);

export const tissDocuments = pgTable(
  "tiss_documents",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    standardVersion: text("standard_version"),
    transactionType: text("transaction_type"),
    providerName: text("provider_name"),
    providerRegister: text("provider_register"),
    operatorRegister: text("operator_register"),
    batchNumber: text("batch_number"),
    guideCount: text("guide_count"),
    totalAmount: text("total_amount"),
    beneficiaryNames: jsonb("beneficiary_names").$type<string[]>().notNull().default([]),
    rawSummary: jsonb("raw_summary").$type<Record<string, unknown>>().notNull().default({}),
    validatedData: jsonb("validated_data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tiss_documents_job_id_idx").on(table.jobId)],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("job_events_job_id_idx").on(table.jobId)],
);

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  browserVisionEnabled: boolean("browser_vision_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const portalSessionStatusEnum = pgEnum("portal_session_status", [
  "active",
  "closed",
  "expired",
]);

export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    browserbaseSessionId: text("browserbase_session_id").notNull(),
    connectUrl: text("connect_url").notNull(),
    status: portalSessionStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
  },
  (table) => [
    index("portal_sessions_job_id_idx").on(table.jobId),
    index("portal_sessions_user_id_idx").on(table.userId),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_hashed_key_idx").on(table.hashedKey),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("audit_logs_user_id_idx").on(table.userId)],
);

export const usersRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  jobs: many(jobs),
  credentials: many(platformCredentials),
  apiKeys: many(apiKeys),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  user: one(user, { fields: [jobs.userId], references: [user.id] }),
  file: one(jobFiles),
  tissDocument: one(tissDocuments),
  events: many(jobEvents),
}));

export const schema = {
  user,
  session,
  account,
  verification,
  platforms,
  platformCredentials,
  jobs,
  jobFiles,
  tissDocuments,
  jobEvents,
  auditLogs,
  userPreferences,
  portalSessions,
  apiKeys,
};

export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type JobFlowType = (typeof jobFlowTypeEnum.enumValues)[number];
export type PlatformId = (typeof platformIdEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
