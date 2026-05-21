import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import cron from "node-cron";
import { z } from "zod";
import { analyzeComment, validateReply } from "./safety.js";
import { latestBatchRunFromDb, listBatchRunsFromDb, persistBatchRun } from "./db.js";

const server = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

await server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://127.0.0.1:5173",
});

await server.register(rateLimit, {
  max: 120,
  timeWindow: "1 minute",
});

const settings = {
  autoReplyEnabled: true,
  autoDeleteEnabled: true,
  autoLikeEnabled: false,
  dailyLimit: 50,
  languageMode: "same_as_commenter",
  fallbackLanguage: "English",
  replyLanguage: "Same as commenter",
  maxReplyLength: 120,
  emojiEnabled: true,
  maxEmoji: 3,
  reviewMode: "full_auto",
};

const logs = [];
const batchRuns = [];

const commentSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
  text: z.string().min(1),
  authorName: z.string().default("Viewer"),
});

const batchSchema = z.object({
  comments: z.array(commentSchema).min(1).max(500),
});

server.get("/health", async () => ({
  status: "ok",
  youtube: process.env.GOOGLE_CLIENT_ID ? "configured" : "missing_oauth_config",
  openai: process.env.OPENAI_API_KEY ? "configured" : "missing_api_key",
}));

server.get("/", async () => ({
  app: "TapFix Comments AI API",
  status: "ok",
  panel: process.env.WEB_ORIGIN || "http://127.0.0.1:5173/",
  health: `${process.env.PUBLIC_API_URL || `http://127.0.0.1:${port}`}/health`,
}));

server.get("/api/settings", async () => settings);

server.patch("/api/settings", async (request) => {
  Object.assign(settings, request.body);
  addLog("settings", "Settings updated");
  return settings;
});

server.get("/api/logs", async () => logs.slice(-100).reverse());

server.get("/api/comments/batch-runs", async () => {
  const dbRuns = await listBatchRunsFromDb();
  if (dbRuns) {
    return dbRuns.map((run) => ({
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      total: run.total,
      replies: run.replies,
      reviews: run.reviews,
      deletes: run.deletes,
      resultsCount: run._count.results,
    }));
  }

  return batchRuns
    .slice(-20)
    .reverse()
    .map(({ results, ...run }) => ({
      ...run,
      resultsCount: results.length,
    }));
});

server.get("/api/comments/batch-runs/latest", async (request, reply) => {
  const dbLatest = await latestBatchRunFromDb();
  if (dbLatest) {
    return dbLatest;
  }

  const latest = batchRuns.at(-1);
  if (!latest) {
    return reply.code(404).send({ error: "no_batch_runs" });
  }
  return latest;
});

server.post("/api/comments/analyze", async (request, reply) => {
  const parsed = commentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_comment", details: parsed.error.flatten() });
  }

  const result = analyzeComment(parsed.data.text);
  addLog("analyze", `${parsed.data.id}: ${result.action} (${result.category}, ${result.detectedLanguage})`);
  return result;
});

server.post("/api/comments/analyze-batch", async (request, reply) => {
  const parsed = batchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_batch", details: parsed.error.flatten() });
  }

  const results = parsed.data.comments.map((comment) => {
    const analysis = analyzeComment(comment.text);
    return {
      id: comment.id,
      comment: comment.text,
      authorName: comment.authorName,
      action: analysis.action,
      category: analysis.category,
      detectedLanguage: analysis.detectedLanguage,
      replyLanguage: analysis.replyLanguage,
      languageConfidence: analysis.languageConfidence,
      reply: analysis.reply,
    };
  });

  const run = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    total: results.length,
    replies: results.filter((item) => item.action === "reply").length,
    reviews: results.filter((item) => item.action === "review").length,
    deletes: results.filter((item) => item.action === "delete").length,
    results,
  };

  batchRuns.push(run);
  if (batchRuns.length > 20) {
    batchRuns.shift();
  }

  await persistBatchRun(run);
  addLog("batch_analyze", `Analyzed ${results.length} comments: ${run.replies} replies, ${run.reviews} reviews, ${run.deletes} deletes`);
  return run;
});

server.post("/api/dry-run/comments", async (request, reply) => {
  return server.inject({
    method: "POST",
    url: "/api/comments/analyze-batch",
    payload: request.body,
    headers: { "content-type": "application/json" },
  }).then((response) => reply.code(response.statusCode).send(JSON.parse(response.payload)));
});

server.post("/api/pipeline/process-comment", async (request, reply) => {
  const parsed = commentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_comment", details: parsed.error.flatten() });
  }

  const analysis = analyzeComment(parsed.data.text);
  if (analysis.action === "review") {
    addLog("review", `Would send ${parsed.data.id} to review: ${analysis.category}`);
    return {
      commentId: parsed.data.id,
      actionTaken: "review",
      deleteStatus: "skipped",
      likeStatus: "skipped",
      replyStatus: "skipped",
      safetyCategory: analysis.category,
      detectedLanguage: analysis.detectedLanguage,
      replyLanguage: analysis.replyLanguage,
      languageConfidence: analysis.languageConfidence,
      aiReply: "REVIEW",
    };
  }

  if (analysis.action === "delete") {
    addLog("delete", `Would delete ${parsed.data.id}: ${analysis.category}`);
    return {
      commentId: parsed.data.id,
      actionTaken: settings.autoDeleteEnabled ? "delete" : "review",
      deleteStatus: settings.autoDeleteEnabled ? "queued" : "skipped",
      likeStatus: "skipped",
      replyStatus: "skipped",
      safetyCategory: analysis.category,
      detectedLanguage: analysis.detectedLanguage,
      replyLanguage: analysis.replyLanguage,
      languageConfidence: analysis.languageConfidence,
      aiReply: "DELETE",
    };
  }

  const generatedReply = analysis.reply;
  const replySafety = validateReply(generatedReply, settings.maxReplyLength);

  if (!replySafety.safe) {
    addLog("skip_reply", `Unsafe generated reply for ${parsed.data.id}: ${replySafety.reason}`);
    return {
      commentId: parsed.data.id,
      actionTaken: "skip",
      skipReason: replySafety.reason,
      safetyCategory: analysis.category,
      detectedLanguage: analysis.detectedLanguage,
      replyLanguage: analysis.replyLanguage,
      languageConfidence: analysis.languageConfidence,
    };
  }

  addLog("reply", `Would publish reply to ${parsed.data.id}`);
  return {
    commentId: parsed.data.id,
    actionTaken: settings.autoReplyEnabled ? "reply" : "review",
    deleteStatus: "skipped",
    likeStatus: settings.autoLikeEnabled ? "queued" : "not_supported",
    replyStatus: settings.autoReplyEnabled ? "queued" : "skipped",
    safetyCategory: analysis.category,
    detectedLanguage: analysis.detectedLanguage,
    replyLanguage: analysis.replyLanguage,
    languageConfidence: analysis.languageConfidence,
    aiReply: generatedReply,
  };
});

cron.schedule("*/10 * * * *", () => {
  addLog("cron", "Scheduled comment check placeholder");
});

function addLog(action, message) {
  logs.push({
    id: crypto.randomUUID(),
    action,
    message,
    createdAt: new Date().toISOString(),
  });
}

server.listen({ port, host });
