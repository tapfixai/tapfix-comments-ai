import "dotenv/config";
import nodeCrypto from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import cron from "node-cron";
import { z } from "zod";
import { analyzeComment, validateReply } from "./safety.js";
import {
  latestBatchRunFromDb,
  getConnectedUser,
  getConnectedYouTubeCredentials,
  listProcessedCommentIds,
  listBatchRunsFromDb,
  listLogsFromDb,
  markCommentProcessed,
  persistBatchRun,
  persistLog,
  updateConnectedUserTokens,
  upsertConnectedUser,
} from "./db.js";

const server = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

await server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://127.0.0.1:5173",
  credentials: true,
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
const processedCommentIds = new Set();
const SESSION_COOKIE_NAME = "tapfix_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
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

const youtubeDryRunSchema = z.object({
  maxResults: z.number().int().min(1).max(100).optional(),
  scanLimit: z.number().int().min(1).max(1000).optional(),
  includeThreadsWithReplies: z.boolean().optional(),
  includeProcessed: z.boolean().optional(),
  pageToken: z.string().optional(),
}).optional();

const youtubeReplySchema = z.object({
  reply: z.string().min(1).max(120),
});

const regenerateReplySchema = z.object({
  comment: z.string().min(1),
  detectedLanguage: z.string().optional(),
  category: z.string().optional(),
  tone: z.string().optional(),
  voiceProfile: z.string().optional(),
  usedReplies: z.array(z.string()).optional(),
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

server.get("/api/auth/status", async (request) => {
  const sessionUserId = getSessionUserId(request);
  const connectedUser = sessionUserId ? await getConnectedUser(sessionUserId) : null;
  return {
    googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    connected: Boolean(connectedUser),
    user: connectedUser,
    authUrl: `${getPublicApiUrl(request)}/auth/google`,
    redirectUri: getGoogleRedirectUri(request),
  };
});

server.get("/auth/google", async (request, reply) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return reply.code(503).send({ error: "missing_google_oauth_config" });
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", getGoogleRedirectUri(request));
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
        redirect_uri: getGoogleRedirectUri(request),
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
    if (!connectedUser?.id) {
      throw new Error("connected_user_save_failed");
    }

    addLog("oauth", `Connected YouTube channel ${channel.title || channel.id}`);
    setSessionCookie(reply, connectedUser.id);
    return reply.redirect(`${getPanelUrl()}?youtube=connected&channel=${encodeURIComponent(connectedUser?.youtubeChannelTitle || channel.title || channel.id)}`);
  } catch (error) {
    console.error("Google OAuth callback failed", error);
    addLog("oauth_error", error.message || "Google OAuth failed");
    return reply.redirect(`${getPanelUrl()}?youtube=error&reason=${encodeURIComponent(error.message || "oauth_failed")}`);
  }
});

server.get("/api/settings", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  return settings;
});

server.patch("/api/settings", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  Object.assign(settings, request.body);
  addLog("settings", "Settings updated");
  return settings;
});

server.get("/api/logs", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const dbLogs = await listLogsFromDb();
  if (dbLogs) {
    return dbLogs;
  }

  return logs.slice(-100).reverse();
});

server.get("/api/comments/batch-runs", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

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
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const requestedSource = request.query?.source;
  const source = requestedSource === "youtube" || requestedSource === "manual" ? requestedSource : null;
  const dbLatest = await latestBatchRunFromDb(source, source === "youtube" ? { minTotal: 1 } : {});
  if (dbLatest) {
    return dbLatest;
  }

  const latest = source
    ? [...batchRuns].reverse().find((run) => run.source === source && (source !== "youtube" || run.total > 0))
    : batchRuns.at(-1);
  if (!latest) {
    return reply.code(404).send({ error: "no_batch_runs" });
  }
  return latest;
});

server.get("/api/insights", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const latestRun = await latestBatchRunFromDb();
  const results = latestRun?.results || batchRuns.at(-1)?.results || [];
  return buildCommentInsights(results, latestRun);
});

server.post("/api/comments/regenerate-reply", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const parsed = regenerateReplySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_regenerate_request", details: parsed.error.flatten() });
  }

  const comment = {
    id: `regen_${crypto.randomUUID()}`,
    videoId: "manual-test",
    text: parsed.data.comment,
    authorName: "Viewer",
  };
  const analysis = {
    action: "reply",
    category: parsed.data.category || "safe",
    detectedLanguage: parsed.data.detectedLanguage || settings.fallbackLanguage,
    replyLanguage: parsed.data.detectedLanguage || settings.fallbackLanguage,
    languageConfidence: 0.9,
    reply: "Thanks for watching, happy you liked it.",
  };

  try {
    if (process.env.OPENAI_API_KEY) {
      const aiSafety = await classifyOpenAISafety(comment, analysis);
      if (aiSafety.action === "delete") {
        return { reply: "DELETE", action: "delete", source: "openai_safety" };
      }
      if (aiSafety.action === "review") {
        return { reply: "REVIEW", action: "review", source: "openai_safety" };
      }
    }

    const rawReply = process.env.OPENAI_API_KEY
      ? await generateOpenAIReply(comment, analysis, {
        tone: parsed.data.tone,
        voiceProfile: parsed.data.voiceProfile,
        regenerate: true,
      })
      : makeReplyUnique(analysis.reply, new Set(parsed.data.usedReplies || []), analysis.detectedLanguage);
    const cleanedReply = cleanAiReply(rawReply);

    if (cleanedReply === "DELETE") {
      return { reply: "DELETE", action: "delete", source: process.env.OPENAI_API_KEY ? "openai" : "rules" };
    }

    const replySafety = validateReply(cleanedReply, settings.maxReplyLength);
    if (!replySafety.safe) {
      return reply.code(422).send({ error: "unsafe_reply", reason: replySafety.reason });
    }

    return {
      reply: makeReplyUnique(cleanedReply, new Set(parsed.data.usedReplies || []), analysis.detectedLanguage),
      action: "reply",
      source: process.env.OPENAI_API_KEY ? "openai" : "rules",
    };
  } catch (error) {
    addLog("regenerate_error", error.message || "Reply regeneration failed");
    return reply.code(502).send({ error: "regenerate_failed", message: error.message || "Reply regeneration failed" });
  }
});

server.post("/api/comments/analyze", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const parsed = commentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_comment", details: parsed.error.flatten() });
  }

  const result = await analyzeCommentWithAi(parsed.data);
  addLog("analyze", `${parsed.data.id}: ${result.action} (${result.category}, ${result.detectedLanguage})`);
  return result;
});

server.post("/api/comments/analyze-batch", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const parsed = batchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_batch", details: parsed.error.flatten() });
  }

  const run = await createDryRun(parsed.data.comments);
  addLog("batch_analyze", `Analyzed ${run.total} comments: ${run.replies} replies, ${run.reviews} reviews, ${run.deletes} deletes`);
  return run;
});

server.post("/api/youtube/comments/dry-run", async (request, reply) => {
  const sessionUser = await requireSession(request, reply);
  if (!sessionUser) {
    return reply;
  }

  const parsed = youtubeDryRunSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_youtube_dry_run", details: parsed.error.flatten() });
  }

  const connectedUser = await getConnectedYouTubeCredentials(sessionUser.id);
  if (!connectedUser) {
    return reply.code(409).send({ error: "youtube_not_connected", message: "Connect YouTube first" });
  }

  try {
    const accessToken = await getValidYouTubeAccessToken(connectedUser);
    const requestedLimit = parsed.data?.maxResults || 25;
    const scanLimit = parsed.data?.scanLimit || requestedLimit;
    const includeThreadsWithReplies = parsed.data?.includeThreadsWithReplies === true;
    const includeProcessed = parsed.data?.includeProcessed === true;
    const comments = includeProcessed || includeThreadsWithReplies
      ? await fetchLatestYouTubeComments({
        accessToken,
        channelId: connectedUser.youtubeChannelId,
        maxResults: scanLimit,
        pageToken: parsed.data?.pageToken,
      })
      : await findNewUnansweredYouTubeComments({
        accessToken,
        channelId: connectedUser.youtubeChannelId,
        requestedLimit,
        pageToken: parsed.data?.pageToken,
      });
    const scannedComments = comments.items;
    const candidateComments = includeThreadsWithReplies || comments.candidateItems
      ? comments.candidateItems || scannedComments
      : scannedComments.filter((comment) => !comment.hasCreatorReply);
    const availableComments = includeProcessed || comments.availableItems
      ? comments.availableItems || candidateComments
      : await filterUnprocessedComments(candidateComments);
    const reviewComments = availableComments.slice(0, requestedLimit);
    const processedSkippedCount = includeProcessed
      ? 0
      : comments.processedSkippedCount ?? Math.max(candidateComments.length - availableComments.length, 0);

    if (!includeProcessed && !includeThreadsWithReplies && reviewComments.length === 0) {
      const emptyRun = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        total: 0,
        replies: 0,
        reviews: 0,
        deletes: 0,
        results: [],
        source: "youtube",
        channelId: connectedUser.youtubeChannelId,
        channelTitle: connectedUser.youtubeChannelTitle,
        scannedCount: scannedComments.length,
        candidateCount: candidateComments.length,
        skippedThreadsWithCreatorReplies: scannedComments.length - candidateComments.length,
        processedSkippedCount,
        scanLimit: comments.scanLimit || scanLimit,
        includeProcessed,
        includeThreadsWithReplies,
        nextPageToken: comments.nextPageToken,
        notPersisted: true,
      };
      addLog("youtube_empty_search", `Found 0 new YouTube comments from ${connectedUser.youtubeChannelTitle || connectedUser.youtubeChannelId} after scanning ${scannedComments.length}`);
      return emptyRun;
    }

    const run = await createDryRun(reviewComments, {
      source: "youtube",
      channelId: connectedUser.youtubeChannelId,
      channelTitle: connectedUser.youtubeChannelTitle,
      scannedCount: scannedComments.length,
      candidateCount: candidateComments.length,
      skippedThreadsWithCreatorReplies: scannedComments.length - candidateComments.length,
      processedSkippedCount,
      scanLimit: comments.scanLimit || scanLimit,
      includeProcessed,
      includeThreadsWithReplies,
      nextPageToken: comments.nextPageToken,
    });

    addLog("youtube_dry_run", `Analyzed ${run.total} ${includeProcessed ? "latest" : "new"} YouTube comments from ${connectedUser.youtubeChannelTitle || connectedUser.youtubeChannelId} after scanning ${scannedComments.length}`);
    return run;
  } catch (error) {
    const statusCode = Number(error.statusCode || 502);
    addLog("youtube_dry_run_error", error.userMessage || error.message || "YouTube dry-run failed");
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 502).send({
      error: "youtube_dry_run_failed",
      message: error.userMessage || error.message || "YouTube dry-run failed",
      details: error.details,
    });
  }
});

server.post("/api/youtube/comments/:commentId/reply", async (request, reply) => {
  const sessionUser = await requireSession(request, reply);
  if (!sessionUser) {
    return reply;
  }

  const parsed = youtubeReplySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_reply", details: parsed.error.flatten() });
  }

  const replySafety = validateReply(parsed.data.reply, settings.maxReplyLength);
  if (!replySafety.safe) {
    return reply.code(400).send({ error: "unsafe_reply", reason: replySafety.reason });
  }

  const connectedUser = await getConnectedYouTubeCredentials(sessionUser.id);
  if (!connectedUser) {
    return reply.code(409).send({ error: "youtube_not_connected", message: "Connect YouTube first" });
  }

  try {
    const accessToken = await getValidYouTubeAccessToken(connectedUser);
    const result = await publishYouTubeReply({
      accessToken,
      commentId: request.params.commentId,
      text: parsed.data.reply,
    });
    const videoId = result.snippet?.videoId;
    await rememberProcessedComment({
      commentId: request.params.commentId,
      videoId,
      action: "reply",
      status: "published",
      replyText: parsed.data.reply,
    });

    addLog("youtube_reply", `Published reply to ${request.params.commentId}`);
    return {
      status: "published",
      commentId: request.params.commentId,
      replyId: result.id,
      replyUrl: getYouTubeCommentUrl(result.snippet?.videoId, result.id),
      studioCommentsUrl: getYouTubeStudioCommentsUrl(result.snippet?.videoId),
    };
  } catch (error) {
    const statusCode = Number(error.statusCode || 502);
    addLog("youtube_reply_error", `${request.params.commentId}: ${error.userMessage || error.message || "Reply failed"}`);
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 502).send({
      error: "youtube_reply_failed",
      message: error.userMessage || error.message || "Reply failed",
      details: error.details,
    });
  }
});

server.post("/api/youtube/comments/:commentId/delete", async (request, reply) => {
  const sessionUser = await requireSession(request, reply);
  if (!sessionUser) {
    return reply;
  }

  const connectedUser = await getConnectedYouTubeCredentials(sessionUser.id);
  if (!connectedUser) {
    return reply.code(409).send({ error: "youtube_not_connected", message: "Connect YouTube first" });
  }

  try {
    const accessToken = await getValidYouTubeAccessToken(connectedUser);
    await rejectYouTubeComment({
      accessToken,
      commentId: request.params.commentId,
    });
    await rememberProcessedComment({
      commentId: request.params.commentId,
      videoId: request.body?.videoId,
      action: "delete",
      status: "deleted",
    });

    addLog("youtube_delete", `Deleted comment ${request.params.commentId}`);
    return {
      status: "deleted",
      commentId: request.params.commentId,
    };
  } catch (error) {
    const statusCode = Number(error.statusCode || 502);
    addLog("youtube_delete_error", `${request.params.commentId}: ${error.userMessage || error.message || "Delete failed"}`);
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 502).send({
      error: "youtube_delete_failed",
      message: error.userMessage || error.message || "Delete failed",
      details: error.details,
    });
  }
});

server.post("/api/youtube/comments/:commentId/skip", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  await rememberProcessedComment({
    commentId: request.params.commentId,
    videoId: request.body?.videoId,
    action: "skip",
    status: "skipped",
  });

  addLog("youtube_skip", `Skipped comment ${request.params.commentId}`);
  return {
    status: "skipped",
    commentId: request.params.commentId,
  };
});

server.post("/api/dry-run/comments", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  return server.inject({
    method: "POST",
    url: "/api/comments/analyze-batch",
    payload: request.body,
    headers: {
      "content-type": "application/json",
      cookie: request.headers.cookie || "",
    },
  }).then((response) => reply.code(response.statusCode).send(JSON.parse(response.payload)));
});

server.post("/api/pipeline/process-comment", async (request, reply) => {
  if (!await requireSession(request, reply)) {
    return reply;
  }

  const parsed = commentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_comment", details: parsed.error.flatten() });
  }

  const analysis = await analyzeCommentWithAi(parsed.data);
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

async function rememberProcessedComment({ commentId, videoId, action, status, replyText }) {
  processedCommentIds.add(commentId);
  await markCommentProcessed({ commentId, videoId, action, status, replyText });
}

async function filterUnprocessedComments(comments) {
  const dbKnownIds = await listProcessedCommentIds();
  const knownIds = new Set(processedCommentIds);
  for (const id of dbKnownIds || []) {
    knownIds.add(id);
  }
  return comments.filter((comment) => comment?.id && !knownIds.has(comment.id));
}

async function createDryRun(comments, meta = {}) {
  const usedReplies = new Set();
  const results = [];

  for (const comment of comments) {
    if (comment.hasCreatorReply) {
      await rememberProcessedComment({
        commentId: comment.id,
        videoId: comment.videoId,
        action: "reply",
        status: "published",
        replyText: "Already answered in YouTube Studio",
      });

      results.push({
        id: comment.id,
        videoId: comment.videoId,
        videoUrl: getYouTubeVideoUrl(comment.videoId),
        commentUrl: getYouTubeCommentUrl(comment.videoId, comment.id),
        studioCommentsUrl: getYouTubeStudioCommentsUrl(comment.videoId),
        comment: comment.text,
        authorName: comment.authorName || "Viewer",
        action: "reply",
        status: "published",
        processedAction: "reply",
        category: "already_answered",
        detectedLanguage: "Unknown",
        replyLanguage: null,
        languageConfidence: null,
        reply: "Already answered in YouTube Studio",
        smartCategory: "already_answered",
        decisionReason: "This thread already has a creator reply in YouTube Studio, so TapFix will not publish another reply.",
        replySource: "youtube",
      });
      continue;
    }

    const analysis = await analyzeCommentWithAi(comment);
    const smartCategory = getSmartCategory(comment.text, analysis);
    const reply = analysis.action === "reply"
      ? makeReplyUnique(analysis.reply, usedReplies, analysis.detectedLanguage)
      : analysis.reply;

    results.push({
      id: comment.id,
      videoId: comment.videoId,
      videoUrl: getYouTubeVideoUrl(comment.videoId),
      commentUrl: getYouTubeCommentUrl(comment.videoId, comment.id),
      studioCommentsUrl: getYouTubeStudioCommentsUrl(comment.videoId),
      comment: comment.text,
      authorName: comment.authorName || "Viewer",
      action: analysis.action,
      category: analysis.category,
      detectedLanguage: analysis.detectedLanguage,
      replyLanguage: analysis.replyLanguage,
      languageConfidence: analysis.languageConfidence,
      reply,
      smartCategory,
      decisionReason: getDecisionReason(comment.text, analysis, smartCategory),
      replySource: analysis.replySource,
    });

    if (meta.source === "youtube") {
      await rememberProcessedComment({
        commentId: comment.id,
        videoId: comment.videoId,
        action: analysis.action,
        status: "pending",
        replyText: reply,
      });
    }
  }

  const run = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    total: results.length,
    replies: results.filter((item) => item.action === "reply").length,
    reviews: results.filter((item) => item.action === "review").length,
    deletes: results.filter((item) => item.action === "delete").length,
    results,
    ...meta,
  };

  batchRuns.push(run);
  if (batchRuns.length > 20) {
    batchRuns.shift();
  }

  await persistBatchRun(run);
  return run;
}

async function analyzeCommentWithAi(comment) {
  const analysis = analyzeComment(comment.text);
  if (analysis.action !== "reply" || !process.env.OPENAI_API_KEY) {
    return {
      ...analysis,
      replySource: "rules",
    };
  }

  try {
    const aiSafety = await classifyOpenAISafety(comment, analysis);
    if (aiSafety.action === "delete") {
      addLog("ai_safety_delete", `${comment.id}: ${aiSafety.category}`);
      return {
        ...analysis,
        action: "delete",
        category: aiSafety.category,
        replyLanguage: null,
        reply: "DELETE",
        replySource: "openai_safety",
      };
    }
    if (aiSafety.action === "review") {
      addLog("ai_safety_review", `${comment.id}: ${aiSafety.category}`);
      return {
        ...analysis,
        action: "review",
        category: aiSafety.category,
        replyLanguage: null,
        reply: "REVIEW",
        replySource: "openai_safety",
      };
    }

    const aiReply = await generateOpenAIReply(comment, analysis);
    const cleanedReply = cleanAiReply(aiReply);

    if (cleanedReply === "DELETE") {
      addLog("ai_delete", `${comment.id}: OpenAI returned DELETE during reply generation`);
      return {
        ...analysis,
        action: "delete",
        category: "ai_flagged_unsafe",
        replyLanguage: null,
        reply: "DELETE",
        replySource: "openai",
      };
    }

    const generatedReplySafety = validateAiGeneratedReply(cleanedReply, comment.text);
    if (!generatedReplySafety.safe) {
      addLog("ai_reply_rejected", `${comment.id}: ${generatedReplySafety.reason}`);
      return {
        ...analysis,
        replySource: "rules_fallback",
      };
    }

    const replySafety = validateReply(cleanedReply, settings.maxReplyLength);
    if (!replySafety.safe) {
      addLog("ai_reply_rejected", `${comment.id}: ${replySafety.reason}`);
      return {
        ...analysis,
        action: "review",
        category: `ai_reply_${replySafety.reason}`,
        replyLanguage: null,
        reply: "REVIEW",
        replySource: "openai",
      };
    }

    return {
      ...analysis,
      reply: cleanedReply,
      replySource: "openai",
    };
  } catch (error) {
    addLog("openai_error", `${comment.id}: ${error.message || "OpenAI reply failed"}`);
    return {
      ...analysis,
      replySource: "rules_fallback",
    };
  }
}

async function classifyOpenAISafety(comment, analysis) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      instructions: [
        "You are a strict multilingual safety classifier for a YouTube ASMR comment moderation tool.",
        "Classify the viewer comment before any reply is generated.",
        "Return DELETE for sexual harassment, sexualized requests, explicit sexual content, porn references, fetish requests, body-part requests, requests about transparent clothing, underwear, strings, nudity, undressing, or suggestive clothing in any language.",
        "Return DELETE for spam, channel promotion, links, hate, threats, or political bait.",
        "Return REVIEW for ambiguous comments where the language or intent is unclear but not obviously safe.",
        "Return REPLY only for safe praise, normal questions, harmless conversation, emoji reactions, or mild non-sexual appearance compliments.",
        "Output exactly one line in this format: ACTION|category",
        "ACTION must be DELETE, REVIEW, or REPLY.",
      ].join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Viewer comment: ${comment.text}`,
                `Rules action: ${analysis.action}`,
                `Rules category: ${analysis.category}`,
                `Detected language: ${analysis.detectedLanguage}`,
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 40,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `openai_safety_failed_${response.status}`);
  }

  const outputText = extractOpenAIText(payload).trim();
  const [rawAction, rawCategory] = outputText.split("|").map((part) => String(part || "").trim());
  const action = rawAction.toLowerCase();
  if (action === "delete") {
    return { action: "delete", category: rawCategory || "ai_safety_delete" };
  }
  if (action === "review") {
    return { action: "review", category: rawCategory || "ai_safety_review" };
  }
  return { action: "reply", category: rawCategory || analysis.category || "safe" };
}

async function generateOpenAIReply(comment, analysis, options = {}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.2",
      instructions: [
        "You are replying to comments on a YouTube ASMR channel.",
        "Write a short, warm, natural reply in the same language as the viewer comment.",
        "Do not sound like a bot. Do not include links. Do not sell anything.",
        "Do not copy the viewer comment. Do not reply with only emoji.",
        "For emoji-only positive comments, write a short thank-you sentence instead of echoing emoji.",
        options.tone ? `Tone preset: ${options.tone}.` : "",
        options.voiceProfile ? `Creator voice profile: ${options.voiceProfile}` : "",
        options.regenerate ? "Generate a fresh alternative. Avoid generic repeated thank-you wording." : "",
        `Keep it under ${settings.maxReplyLength} characters.`,
        `Use 0-${settings.maxEmoji} emoji maximum.`,
        "If the comment is explicit sexual harassment, spammy, aggressive, political, duplicated, contains links, or clearly unsafe, return exactly DELETE.",
        "Do not return DELETE for simple praise, emoji reactions, mild appearance compliments, short positive comments, or unclear but non-harmful comments.",
        "Return only the reply text or DELETE. No quotes, no explanation.",
      ].filter(Boolean).join("\n"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Viewer comment: ${comment.text}`,
                `Detected language: ${analysis.detectedLanguage}`,
                `Safety category: ${analysis.category}`,
              ].join("\n"),
            },
          ],
        },
      ],
      max_output_tokens: 80,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `openai_request_failed_${response.status}`);
  }

  const outputText = extractOpenAIText(payload);
  if (!outputText) {
    throw new Error("openai_empty_reply");
  }
  return outputText;
}

function validateAiGeneratedReply(reply, commentText) {
  const normalizedReply = normalizeForComparison(reply);
  const normalizedComment = normalizeForComparison(commentText);

  if (!normalizedReply) {
    return { safe: false, reason: "empty_ai_reply" };
  }

  if (normalizedReply === normalizedComment) {
    return { safe: false, reason: "copied_comment" };
  }

  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(reply.trim())) {
    return { safe: false, reason: "emoji_only_reply" };
  }

  return { safe: true };
}

function normalizeForComparison(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function extractOpenAIText(payload) {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
}

function cleanAiReply(reply) {
  const cleaned = String(reply || "")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();

  if (/^delete$/i.test(cleaned)) {
    return "DELETE";
  }

  return cleaned.replace(/\s+/g, " ");
}

function makeReplyUnique(reply, usedReplies, language) {
  if (!usedReplies.has(reply)) {
    usedReplies.add(reply);
    return reply;
  }

  const alternatives = uniqueReplyAlternatives(language);
  const available = alternatives.find((candidate) => !usedReplies.has(candidate));
  if (available) {
    usedReplies.add(available);
    return available;
  }

  usedReplies.add(reply);
  return reply;
}

function uniqueReplyAlternatives(language) {
  if (language === "Portuguese") {
    return [
      "Muito obrigada por assistir.",
      "Fico feliz que voce tenha gostado.",
      "Obrigada pelo carinho ❤️",
    ];
  }

  if (language === "Turkish") {
    return [
      "Cok tesekkurler, begenmene sevindim.",
      "Izledigin icin cok tesekkur ederim.",
      "Cok mutlu oldum, tesekkurler ❤️",
    ];
  }

  return [
    "Thanks for watching, happy you liked it.",
    "So glad you enjoyed it, thank you for being here.",
    "I really appreciate you watching.",
    "Glad you enjoyed this one.",
    "Thank you so much ❤️",
    "Really appreciate it ❤️",
    "That means a lot, thank you.",
    "Happy you liked this one.",
    "Thanks, glad it felt good to watch.",
    "I appreciate the kind comment.",
    "So nice to hear, thank you.",
    "Thanks for spending time here.",
    "Glad this one connected with you.",
    "Thank you, that is really kind.",
    "Happy you enjoyed the video.",
    "Thanks, I appreciate you being here.",
    "So glad you liked the vibe.",
    "Thank you for the sweet comment.",
  ];
}

function getSmartCategory(commentText, analysis) {
  const text = normalizeForComparison(commentText);
  const category = normalizeForComparison(analysis.category);

  if (analysis.action === "delete") {
    if (category.includes("sexual")) return "sexual";
    if (category.includes("link") || category.includes("scam")) return "link";
    if (category.includes("spam")) return "spam";
    if (category.includes("hate") || category.includes("aggressive") || category.includes("toxic")) return "toxic";
    if (category.includes("meaningless")) return "emoji_reaction";
    if (category.includes("unclear")) return "unclear";
    return category || "unsafe";
  }

  if (/\?/.test(commentText) || /\b(what|why|how|where|when|who|can you|could you|do you)\b/i.test(commentText)) {
    return "question";
  }

  if (/\b(more|please|can you|could you|make|do another|request)\b/i.test(commentText)) {
    return "request";
  }

  if (/\b(boring|bad|hate|don't like|dislike|too loud|too slow)\b/i.test(text)) {
    return "criticism";
  }

  if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(commentText.trim())) {
    return "emoji_reaction";
  }

  if (/\b(thanks|thank you|love|beautiful|amazing|perfect|nice|good|relax|relaxing|sleep|great|best)\b/i.test(commentText)) {
    return "praise";
  }

  return "conversation";
}

function getDecisionReason(commentText, analysis, smartCategory) {
  if (analysis.action === "delete") {
    return `Safety filter marked this as ${analysis.category || smartCategory}.`;
  }

  if (analysis.action === "review") {
    return `Needs manual review because the category is ${analysis.category || "unclear"}.`;
  }

  if (smartCategory === "question") {
    return "Safe question. AI can answer warmly without links or sales.";
  }

  if (smartCategory === "request") {
    return "Safe request or suggestion. Good candidate for a friendly reply.";
  }

  if (smartCategory === "emoji_reaction") {
    return "Positive reaction. Reply with a short thank-you instead of copying emoji.";
  }

  return `Safe ${smartCategory}. Reply stays short, natural, and in the viewer language.`;
}

function buildCommentInsights(results, latestRun) {
  const actionCounts = countBy(results, (item) => item.status === "pending" ? item.action : item.status);
  const categoryCounts = countBy(results, (item) => item.smartCategory || item.category || "unknown");
  const videoCounts = countBy(
    results.filter((item) => ["delete", "review"].includes(item.action)),
    (item) => item.videoId || "unknown-video",
  );
  const questions = results
    .filter((item) => (item.smartCategory || "").includes("question") || /\?/.test(item.comment || ""))
    .slice(0, 5);
  const requests = results
    .filter((item) => (item.smartCategory || "").includes("request"))
    .slice(0, 5);
  const totalEstimatedUnits = estimateYouTubeQuotaUnits(results);

  return {
    generatedAt: new Date().toISOString(),
    latestRunId: latestRun?.id || null,
    totals: {
      total: results.length,
      comments: results.length,
      pending: results.filter((item) => (item.status || "pending") === "pending").length,
      replies: results.filter((item) => item.action === "reply").length,
      deletes: results.filter((item) => item.action === "delete").length,
      reviews: results.filter((item) => item.action === "review").length,
    },
    topCategories: toSortedCounts(categoryCounts),
    actionCounts: toSortedCounts(actionCounts),
    videoHotspots: toSortedCounts(videoCounts).slice(0, 5),
    contentIdeas: [...questions, ...requests].slice(0, 6).map((item) => ({
      comment: item.comment,
      videoId: item.videoId,
      idea: getContentIdea(item),
      count: 1,
    })),
    quotaGuard: {
      estimatedUnits: totalEstimatedUnits,
      nextRunAdvice: totalEstimatedUnits > 8000
        ? "High usage. Use smaller batches until quota is increased."
        : "Safe for manual review batches.",
      recommendation: totalEstimatedUnits > 8000
        ? "Small manual batches until quota is increased"
        : "Manual review batches are safe",
      safeDailyRuns: Math.max(1, Math.floor(10000 / Math.max(totalEstimatedUnits, 1))),
      dailyLimit: 10000,
    },
  };
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function toSortedCounts(counts) {
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function estimateYouTubeQuotaUnits(results) {
  const readUnits = Math.max(1, Math.ceil(results.length / 100));
  const writeUnits = results.filter((item) => ["published", "deleted"].includes(item.status)).length * 50;
  return readUnits + writeUnits;
}

function getContentIdea(item) {
  const comment = normalizeForComparison(item.comment);
  if (comment.includes("clean")) return "Consider a cleaning-focused ASMR video.";
  if (comment.includes("sleep")) return "Sleep-focused long-form video may work well.";
  if (comment.includes("sound") || comment.includes("trigger")) return "Repeat or vary this trigger in a future upload.";
  return "Use this viewer comment as a content angle for the next video.";
}

function getPublicApiUrl(request) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return new URL(process.env.GOOGLE_REDIRECT_URI).origin;
  }

  const forwardedHost = request?.headers?.["x-forwarded-host"];
  const hostHeader = forwardedHost || request?.headers?.host;
  if (hostHeader) {
    const proto = request?.headers?.["x-forwarded-proto"] || (hostHeader.includes("127.0.0.1") ? "http" : "https");
    return `${proto}://${hostHeader}`;
  }

  return process.env.PUBLIC_API_URL || `http://127.0.0.1:${port}`;
}

function getPanelUrl() {
  return process.env.WEB_ORIGIN || "http://127.0.0.1:5173";
}

async function requireSession(request, reply) {
  const userId = getSessionUserId(request);
  if (!userId) {
    reply.code(401).send({ error: "auth_required", message: "Connect YouTube first" });
    return null;
  }

  const user = await getConnectedUser(userId);
  if (!user) {
    reply.code(401).send({ error: "auth_required", message: "Reconnect YouTube" });
    return null;
  }

  return user;
}

function setSessionCookie(reply, userId) {
  const isHttps = getPublicApiUrl().startsWith("https://");
  const sameSite = isHttps ? "None" : "Lax";
  const secure = isHttps ? "; Secure" : "";

  reply.header(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${signSessionToken(userId)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=${sameSite}${secure}`,
  );
}

function getSessionUserId(request) {
  const cookies = parseCookies(request.headers.cookie || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

function signSessionToken(userId) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${signValue(payload)}`;
}

function verifySessionToken(token) {
  const [userId, expiresAt, signature] = String(token || "").split(".");
  if (!userId || !expiresAt || !signature || Number(expiresAt) < Date.now()) {
    return null;
  }

  const payload = `${userId}.${expiresAt}`;
  const expected = signValue(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !nodeCrypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  return userId;
}

function signValue(value) {
  const secret = process.env.SESSION_SECRET || process.env.TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET, TOKEN_ENCRYPTION_KEY, or GOOGLE_CLIENT_SECRET is required for API sessions");
  }

  return nodeCrypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function parseCookies(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex === -1) {
        return cookies;
      }

      const name = cookie.slice(0, separatorIndex);
      const value = cookie.slice(separatorIndex + 1);
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getYouTubeVideoUrl(videoId) {
  if (!videoId || videoId === "manual-test" || videoId === "unknown-video") {
    return null;
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function getYouTubeCommentUrl(videoId, commentId) {
  const videoUrl = getYouTubeVideoUrl(videoId);
  if (!videoUrl || !commentId) {
    return null;
  }

  return `${videoUrl}&lc=${encodeURIComponent(commentId)}`;
}

function getYouTubeStudioCommentsUrl(videoId) {
  if (!videoId || videoId === "manual-test" || videoId === "unknown-video") {
    return null;
  }

  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/comments`;
}

function getGoogleRedirectUri(request) {
  return process.env.GOOGLE_REDIRECT_URI || `${getPublicApiUrl(request)}/auth/google/callback`;
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
    throw makeGoogleApiError({ payload: await response.json().catch(() => ({})), status: response.status, fallback: "YouTube channel request failed" });
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

async function getValidYouTubeAccessToken(user) {
  const expiresAt = user.tokenExpiry ? new Date(user.tokenExpiry).getTime() : 0;
  const shouldRefresh = !user.accessToken || !expiresAt || expiresAt - Date.now() < 2 * 60 * 1000;

  if (!shouldRefresh) {
    return user.accessToken;
  }

  if (!user.refreshToken) {
    throw new Error("missing_youtube_refresh_token");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: user.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || `google_token_refresh_failed_${response.status}`);
    error.statusCode = 401;
    error.details = payload;
    throw error;
  }

  const tokenExpiry = new Date(Date.now() + Number(payload.expires_in || 3600) * 1000).toISOString();
  await updateConnectedUserTokens(user.id, {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenExpiry,
  });

  return payload.access_token;
}

async function fetchLatestYouTubeComments({ accessToken, channelId, maxResults, pageToken: initialPageToken = "" }) {
  const comments = [];
  let pageToken = initialPageToken;
  let nextPageToken = "";

  while (comments.length < maxResults) {
    const remaining = maxResults - comments.length;
    const page = await fetchYouTubeCommentsPage({
      accessToken,
      channelId,
      maxResults: Math.min(100, remaining),
      pageToken,
    });
    const pageComments = page.items;

    comments.push(...pageComments);

    nextPageToken = page.nextPageToken || "";
    pageToken = nextPageToken;
    if (!pageToken || !pageComments.length) {
      break;
    }
  }

  return {
    items: comments.slice(0, maxResults),
    nextPageToken,
  };
}

async function findNewUnansweredYouTubeComments({ accessToken, channelId, requestedLimit, pageToken: initialPageToken = "" }) {
  const knownIds = new Set(processedCommentIds);
  for (const id of await listProcessedCommentIds() || []) {
    knownIds.add(id);
  }

  const scannedComments = [];
  const candidateComments = [];
  const availableComments = [];
  let pageToken = initialPageToken;
  let nextPageToken = "";
  const maxPages = 10;

  for (let pageIndex = 0; pageIndex < maxPages && availableComments.length < requestedLimit; pageIndex += 1) {
    const page = await fetchYouTubeCommentsPage({
      accessToken,
      channelId,
      maxResults: 100,
      pageToken,
    });

    scannedComments.push(...page.items);

    for (const comment of page.items) {
      if (comment.hasCreatorReply) {
        continue;
      }
      candidateComments.push(comment);
      if (!knownIds.has(comment.id)) {
        availableComments.push(comment);
      }
    }

    nextPageToken = page.nextPageToken || "";
    pageToken = nextPageToken;
    if (!pageToken || !page.items.length) {
      break;
    }
  }

  return {
    items: scannedComments,
    candidateItems: candidateComments,
    availableItems: availableComments.slice(0, requestedLimit),
    processedSkippedCount: Math.max(candidateComments.length - availableComments.length, 0),
    scanLimit: scannedComments.length,
    nextPageToken,
  };
}

async function fetchYouTubeCommentsPage({ accessToken, channelId, maxResults, pageToken = "" }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  url.searchParams.set("part", "snippet,replies");
  url.searchParams.set("allThreadsRelatedToChannelId", channelId);
  url.searchParams.set("maxResults", String(Math.min(100, maxResults)));
  url.searchParams.set("order", "time");
  url.searchParams.set("textFormat", "plainText");
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }

  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw makeGoogleApiError({ payload, status: response.status, fallback: "YouTube comments request failed" });
  }

  const items = [];
  for (const item of payload.items || []) {
    const topLevelComment = item.snippet?.topLevelComment;
    const snippet = topLevelComment?.snippet;
    const text = snippet?.textOriginal || snippet?.textDisplay || "";
    const replies = item.replies?.comments || [];
    const replyCount = Number(item.snippet?.totalReplyCount || 0);
    const hasInlineCreatorReply = replies.some((reply) => (
      reply.snippet?.authorChannelId?.value === channelId
    ));
    const commentId = topLevelComment?.id || item.id;

    if (!commentId || !text) {
      continue;
    }

    const hasCreatorReply = hasInlineCreatorReply || (
      replyCount > 0
        ? await hasYouTubeCreatorReply({ accessToken, channelId, parentId: commentId })
        : false
    );

    items.push({
      id: commentId,
      videoId: item.snippet?.videoId || "unknown-video",
      text,
      authorName: snippet?.authorDisplayName || "Viewer",
      replyCount,
      hasCreatorReply,
    });
  }

  return {
    items,
    nextPageToken: payload.nextPageToken || "",
  };
}

async function hasYouTubeCreatorReply({ accessToken, channelId, parentId }) {
  let pageToken = "";

  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/comments");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("parentId", parentId);
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("textFormat", "plainText");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw makeGoogleApiError({ payload, status: response.status, fallback: "YouTube replies request failed" });
    }

    if ((payload.items || []).some((reply) => reply.snippet?.authorChannelId?.value === channelId)) {
      return true;
    }

    pageToken = payload.nextPageToken || "";
  } while (pageToken);

  return false;
}

async function publishYouTubeReply({ accessToken, commentId, text }) {
  const response = await fetch("https://www.googleapis.com/youtube/v3/comments?part=snippet", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      snippet: {
        parentId: commentId,
        textOriginal: text,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw makeGoogleApiError({ payload, status: response.status, fallback: "YouTube reply request failed" });
  }

  return payload;
}

async function rejectYouTubeComment({ accessToken, commentId }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/comments/setModerationStatus");
  url.searchParams.set("id", commentId);
  url.searchParams.set("moderationStatus", "rejected");

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw makeGoogleApiError({ payload, status: response.status, fallback: "YouTube delete request failed" });
  }

  return true;
}

function makeGoogleApiError({ payload, status, fallback }) {
  const reason = payload?.error?.errors?.[0]?.reason || payload?.error?.status || payload?.error;
  const rawMessage = payload?.error?.message || fallback || `google_api_request_failed_${status}`;
  const cleanMessage = stripHtml(rawMessage);
  const message = humanizeGoogleApiError(reason, cleanMessage, status);
  const error = new Error(message);
  error.userMessage = message;
  error.statusCode = status;
  error.details = payload;
  error.reason = reason;
  return error;
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeGoogleApiError(reason, message, status) {
  const normalizedReason = String(reason || "").toLowerCase();
  const normalizedMessage = String(message || "").toLowerCase();

  if (
    normalizedReason.includes("quota") ||
    normalizedReason.includes("ratelimit") ||
    normalizedMessage.includes("quota") ||
    normalizedMessage.includes("exceeded")
  ) {
    return "YouTube API quota exceeded. Try again after the daily quota reset or request a quota increase in Google Cloud.";
  }

  if (status === 401 || normalizedReason.includes("auth")) {
    return "YouTube authorization expired. Reconnect YouTube in the panel.";
  }

  if (status === 403 || normalizedReason.includes("forbidden")) {
    return "YouTube API refused this action. Check YouTube permissions, API quota, and OAuth scopes.";
  }

  return message || "YouTube API request failed.";
}

server.listen({ port, host });
