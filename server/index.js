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
  getConnectedYouTubeCredentials,
  listBatchRunsFromDb,
  listLogsFromDb,
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

const youtubeDryRunSchema = z.object({
  maxResults: z.number().int().min(1).max(100).optional(),
}).optional();

const youtubeReplySchema = z.object({
  reply: z.string().min(1).max(120),
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
  const connectedUser = await getConnectedUser();
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

  const result = await analyzeCommentWithAi(parsed.data);
  addLog("analyze", `${parsed.data.id}: ${result.action} (${result.category}, ${result.detectedLanguage})`);
  return result;
});

server.post("/api/comments/analyze-batch", async (request, reply) => {
  const parsed = batchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_batch", details: parsed.error.flatten() });
  }

  const run = await createDryRun(parsed.data.comments);
  addLog("batch_analyze", `Analyzed ${run.total} comments: ${run.replies} replies, ${run.reviews} reviews, ${run.deletes} deletes`);
  return run;
});

server.post("/api/youtube/comments/dry-run", async (request, reply) => {
  const parsed = youtubeDryRunSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_youtube_dry_run", details: parsed.error.flatten() });
  }

  const connectedUser = await getConnectedYouTubeCredentials();
  if (!connectedUser) {
    return reply.code(409).send({ error: "youtube_not_connected", message: "Connect YouTube first" });
  }

  try {
    const accessToken = await getValidYouTubeAccessToken(connectedUser);
    const comments = await fetchLatestYouTubeComments({
      accessToken,
      channelId: connectedUser.youtubeChannelId,
      maxResults: parsed.data?.maxResults || 25,
    });

    if (!comments.length) {
      addLog("youtube_dry_run", `No recent YouTube comments found for ${connectedUser.youtubeChannelTitle || connectedUser.youtubeChannelId}`);
      return {
        id: crypto.randomUUID(),
        source: "youtube",
        channelTitle: connectedUser.youtubeChannelTitle,
        channelId: connectedUser.youtubeChannelId,
        createdAt: new Date().toISOString(),
        total: 0,
        replies: 0,
        reviews: 0,
        deletes: 0,
        results: [],
      };
    }

    const run = await createDryRun(comments, {
      source: "youtube",
      channelId: connectedUser.youtubeChannelId,
      channelTitle: connectedUser.youtubeChannelTitle,
    });

    addLog("youtube_dry_run", `Analyzed ${run.total} YouTube comments from ${connectedUser.youtubeChannelTitle || connectedUser.youtubeChannelId}`);
    return run;
  } catch (error) {
    const statusCode = Number(error.statusCode || 502);
    addLog("youtube_dry_run_error", error.message || "YouTube dry-run failed");
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 502).send({
      error: "youtube_dry_run_failed",
      message: error.message || "YouTube dry-run failed",
      details: error.details,
    });
  }
});

server.post("/api/youtube/comments/:commentId/reply", async (request, reply) => {
  const parsed = youtubeReplySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_reply", details: parsed.error.flatten() });
  }

  const replySafety = validateReply(parsed.data.reply, settings.maxReplyLength);
  if (!replySafety.safe) {
    return reply.code(400).send({ error: "unsafe_reply", reason: replySafety.reason });
  }

  const connectedUser = await getConnectedYouTubeCredentials();
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
    addLog("youtube_reply_error", `${request.params.commentId}: ${error.message || "Reply failed"}`);
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 502).send({
      error: "youtube_reply_failed",
      message: error.message || "Reply failed",
      details: error.details,
    });
  }
});

server.post("/api/youtube/comments/:commentId/delete", async (request, reply) => {
  const connectedUser = await getConnectedYouTubeCredentials();
  if (!connectedUser) {
    return reply.code(409).send({ error: "youtube_not_connected", message: "Connect YouTube first" });
  }

  try {
    const accessToken = await getValidYouTubeAccessToken(connectedUser);
    await deleteYouTubeComment({
      accessToken,
      commentId: request.params.commentId,
    });

    addLog("youtube_delete", `Deleted comment ${request.params.commentId}`);
    return {
      status: "deleted",
      commentId: request.params.commentId,
    };
  } catch (error) {
    const statusCode = Number(error.statusCode || 502);
    addLog("youtube_delete_error", `${request.params.commentId}: ${error.message || "Delete failed"}`);
    return reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 502).send({
      error: "youtube_delete_failed",
      message: error.message || "Delete failed",
      details: error.details,
    });
  }
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

async function createDryRun(comments, meta = {}) {
  const usedReplies = new Set();
  const results = [];

  for (const comment of comments) {
    const analysis = await analyzeCommentWithAi(comment);
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
      replySource: analysis.replySource,
    });
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
    const aiReply = await generateOpenAIReply(comment, analysis);
    const cleanedReply = cleanAiReply(aiReply);

    if (cleanedReply === "DELETE") {
      return {
        ...analysis,
        action: "delete",
        category: "ai_delete",
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

async function generateOpenAIReply(comment, analysis) {
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
        `Keep it under ${settings.maxReplyLength} characters.`,
        `Use 0-${settings.maxEmoji} emoji maximum.`,
        "If the comment is negative, sexual, spammy, aggressive, political, duplicated, contains links, unclear, or unsafe, return exactly DELETE.",
        "Return only the reply text or DELETE. No quotes, no explanation.",
      ].join("\n"),
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

async function fetchLatestYouTubeComments({ accessToken, channelId, maxResults }) {
  const comments = [];
  let pageToken = "";

  while (comments.length < maxResults) {
    const remaining = maxResults - comments.length;
    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("allThreadsRelatedToChannelId", channelId);
    url.searchParams.set("maxResults", String(Math.min(100, remaining)));
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
      const errorMessage = payload.error?.message || `youtube_comments_request_failed_${response.status}`;
      const error = new Error(errorMessage);
      error.statusCode = response.status;
      error.details = payload;
      throw error;
    }

    const pageComments = (payload.items || [])
      .map((item) => {
        const topLevelComment = item.snippet?.topLevelComment;
        const snippet = topLevelComment?.snippet;
        const text = snippet?.textOriginal || snippet?.textDisplay || "";

        return {
          id: topLevelComment?.id || item.id,
          videoId: item.snippet?.videoId || "unknown-video",
          text,
          authorName: snippet?.authorDisplayName || "Viewer",
        };
      })
      .filter((comment) => comment.id && comment.text);

    comments.push(...pageComments);

    pageToken = payload.nextPageToken || "";
    if (!pageToken || !pageComments.length) {
      break;
    }
  }

  return comments.slice(0, maxResults);
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
    const errorMessage = payload.error?.message || `youtube_reply_request_failed_${response.status}`;
    const error = new Error(errorMessage);
    error.statusCode = response.status;
    error.details = payload;
    throw error;
  }

  return payload;
}

async function deleteYouTubeComment({ accessToken, commentId }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/comments");
  url.searchParams.set("id", commentId);

  const response = await fetch(url, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = payload.error?.message || `youtube_delete_request_failed_${response.status}`;
    const error = new Error(errorMessage);
    error.statusCode = response.status;
    error.details = payload;
    throw error;
  }

  return true;
}

server.listen({ port, host });
