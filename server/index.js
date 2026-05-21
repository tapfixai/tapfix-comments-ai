import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import cron from "node-cron";
import { z } from "zod";
import { analyzeComment, validateReply } from "./safety.js";
import {
  latestBatchRunFromDb,
  getConnectedUser,
  listBatchRunsFromDb,
  listLogsFromDb,
  persistBatchRun,
  persistLog,
  upsertConnectedUser,
} from "./db.js";

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
const googleScopes = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

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

server.get("/api/auth/status", async () => {
  const connectedUser = await getConnectedUser();
  return {
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    connected: Boolean(connectedUser),
    user: connectedUser,
    authUrl: `${getPublicApiUrl()}/auth/google`,
    redirectUri: getGoogleRedirectUri(),
  };
});

server.get("/auth/google", async (request, reply) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return reply.code(503).send({ error: "missing_google_oauth_config" });
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", getGoogleRedirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", googleScopes.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");

  return reply.redirect(authUrl.toString());
});

server.get("/auth/google/callback", async (request, reply) => {
  const code = request.query?.code;
  if (!code) {
    return reply.redirect(`${getPanelUrl()}?youtube=error&reason=missing_code`);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: getGoogleRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`token_exchange_failed_${tokenResponse.status}`);
    }

    const tokens = await tokenResponse.json();
    const [profile, channel] = await Promise.all([
      fetchGoogleProfile(tokens.access_token),
      fetchYouTubeChannel(tokens.access_token),
    ]);

    if (!channel?.id) {
      throw new Error("youtube_channel_not_found");
    }

    const connectedUser = await upsertConnectedUser({
      id: crypto.randomUUID(),
      googleEmail: profile.email || `youtube-${channel.id}@unknown.local`,
      youtubeChannelId: channel.id,
      youtubeChannelTitle: channel.title,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
    });

    addLog("oauth", `Connected YouTube channel ${channel.title || channel.id}`);
    return reply.redirect(`${getPanelUrl()}?youtube=connected&channel=${encodeURIComponent(connectedUser?.youtubeChannelTitle || channel.title || channel.id)}`);
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    addLog("oauth_error", error.message || "Google OAuth failed");
    return reply.redirect(`${getPanelUrl()}?youtube=error&reason=${encodeURIComponent(error.message || "oauth_failed")}`);
  }
});

server.get("/api/settings", async () => settings);

server.patch("/api/settings", async (request) => {
  Object.assign(settings, request.body);
  addLog("settings", "Settings updated");
  return settings;
});

server.get("/api/logs", async () => {
  const dbLogs = await listLogsFromDb();
  if (dbLogs) {
    return dbLogs;
  }

  return logs.slice(-100).reverse();
});

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
      resultsCount: run.resultsCount,
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
  const log = {
    id: crypto.randomUUID(),
    action,
    message,
    createdAt: new Date().toISOString(),
  };

  logs.push(log);
  void persistLog(log);
}

function getPublicApiUrl() {
  return process.env.PUBLIC_API_URL || `http://127.0.0.1:${port}`;
}

function getPanelUrl() {
  return process.env.WEB_ORIGIN || "http://127.0.0.1:5173";
}

function getGoogleRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${getPublicApiUrl()}/auth/google/callback`;
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    return {};
  }
  return response.json();
}

async function fetchYouTubeChannel(accessToken) {
  const response = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`youtube_channel_request_failed_${response.status}`);
  }
  const data = await response.json();
  const channel = data.items?.[0];
  if (!channel) {
    return null;
  }
  return {
    id: channel.id,
    title: channel.snippet?.title || channel.id,
  };
}

server.listen({ port, host });
