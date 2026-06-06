import pg from "pg";
import { decryptSecret, encryptSecret } from "./secretCrypto.js";

const { Pool } = pg;

let pool = null;
let dbReady = false;
let dbUnavailable = false;

function getPool() {
  if (!process.env.DATABASE_URL || dbUnavailable) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("railway.internal")
        ? false
        : { rejectUnauthorized: false },
    });
  }

  return pool;
}

async function ensureDatabase() {
  const client = getPool();
  if (!client || dbReady) {
    return client;
  }

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS dry_run_batches (
        id TEXT PRIMARY KEY,
        total INTEGER NOT NULL,
        replies INTEGER NOT NULL,
        reviews INTEGER NOT NULL,
        deletes INTEGER NOT NULL,
        source TEXT,
        channel_id TEXT,
        channel_title TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE dry_run_batches
        ADD COLUMN IF NOT EXISTS source TEXT,
        ADD COLUMN IF NOT EXISTS channel_id TEXT,
        ADD COLUMN IF NOT EXISTS channel_title TEXT,
        ADD COLUMN IF NOT EXISTS scanned_count INTEGER,
        ADD COLUMN IF NOT EXISTS candidate_count INTEGER,
        ADD COLUMN IF NOT EXISTS skipped_threads_with_creator_replies INTEGER,
        ADD COLUMN IF NOT EXISTS processed_skipped_count INTEGER,
        ADD COLUMN IF NOT EXISTS include_processed BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS include_threads_with_replies BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS scan_limit INTEGER,
        ADD COLUMN IF NOT EXISTS next_page_token TEXT;

      CREATE TABLE IF NOT EXISTS dry_run_results (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES dry_run_batches(id) ON DELETE CASCADE,
        external_comment_id TEXT,
        video_id TEXT,
        author_name TEXT,
        comment_text TEXT NOT NULL,
        action TEXT NOT NULL,
        safety_category TEXT,
        detected_language TEXT,
        reply_language TEXT,
        language_confidence DOUBLE PRECISION,
        ai_reply TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS dry_run_results_batch_id_idx
        ON dry_run_results(batch_id);

      ALTER TABLE dry_run_results
        ADD COLUMN IF NOT EXISTS video_id TEXT,
        ADD COLUMN IF NOT EXISTS smart_category TEXT,
        ADD COLUMN IF NOT EXISTS decision_reason TEXT,
        ADD COLUMN IF NOT EXISTS reply_source TEXT;

      CREATE TABLE IF NOT EXISTS processed_comments (
        comment_id TEXT PRIMARY KEY,
        video_id TEXT,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        reply_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        google_email TEXT UNIQUE,
        youtube_channel_id TEXT,
        youtube_channel_title TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    dbReady = true;
    return client;
  } catch (error) {
    dbUnavailable = true;
    console.error("Postgres is unavailable; falling back to in-memory storage", error);
    return null;
  }
}

export async function persistBatchRun(run) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  const connection = await client.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(
      `
        INSERT INTO dry_run_batches (
          id,
          total,
          replies,
          reviews,
          deletes,
          source,
          channel_id,
          channel_title,
          scanned_count,
          candidate_count,
          skipped_threads_with_creator_replies,
          processed_skipped_count,
          include_processed,
          include_threads_with_replies,
          scan_limit,
          next_page_token,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        run.id,
        run.total,
        run.replies,
        run.reviews,
        run.deletes,
        run.source,
        run.channelId,
        run.channelTitle,
        run.scannedCount ?? null,
        run.candidateCount ?? null,
        run.skippedThreadsWithCreatorReplies ?? null,
        run.processedSkippedCount ?? null,
        run.includeProcessed ?? false,
        run.includeThreadsWithReplies ?? false,
        run.scanLimit ?? null,
        run.nextPageToken ?? null,
        run.createdAt,
      ],
    );

    for (const result of run.results) {
      await connection.query(
        `
          INSERT INTO dry_run_results (
            id,
            batch_id,
            external_comment_id,
            video_id,
            author_name,
            comment_text,
            action,
            safety_category,
            detected_language,
            reply_language,
            language_confidence,
            ai_reply,
            smart_category,
            decision_reason,
            reply_source
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `,
        [
          crypto.randomUUID(),
          run.id,
          result.id,
          result.videoId,
          result.authorName,
          result.comment,
          result.action,
          result.category,
          result.detectedLanguage,
          result.replyLanguage,
          result.languageConfidence,
          result.reply,
          result.smartCategory,
          result.decisionReason,
          result.replySource,
        ],
      );
    }

    await connection.query("COMMIT");
    return run;
  } catch (error) {
    await connection.query("ROLLBACK");
    console.error("Failed to persist dry-run batch", error);
    return null;
  } finally {
    connection.release();
  }
}

export async function listBatchRunsFromDb(limit = 20) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(
      `
        SELECT
          b.id,
          b.created_at AS "createdAt",
          b.total,
          b.replies,
          b.reviews,
          b.deletes,
          b.source,
          b.channel_id AS "channelId",
          b.channel_title AS "channelTitle",
          b.scanned_count AS "scannedCount",
          b.candidate_count AS "candidateCount",
          b.skipped_threads_with_creator_replies AS "skippedThreadsWithCreatorReplies",
          b.processed_skipped_count AS "processedSkippedCount",
          b.include_processed AS "includeProcessed",
          b.include_threads_with_replies AS "includeThreadsWithReplies",
          b.scan_limit AS "scanLimit",
          b.next_page_token AS "nextPageToken",
          COUNT(r.id)::int AS "resultsCount"
        FROM dry_run_batches b
        LEFT JOIN dry_run_results r ON r.batch_id = b.id
        GROUP BY b.id
        ORDER BY b.created_at DESC
        LIMIT $1
      `,
      [limit],
    );
    return rows;
  } catch (error) {
    console.error("Failed to list dry-run batches", error);
    return null;
  }
}

export async function latestBatchRunFromDb(source = null, options = {}) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const params = [];
    const filters = [];
    if (source) {
      params.push(source);
      filters.push(`source = $${params.length}`);
    }
    if (options.minTotal != null) {
      params.push(options.minTotal);
      filters.push(`total >= $${params.length}`);
    }
    const sourceFilter = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const batchResult = await client.query(
      `
        SELECT
          id,
          created_at AS "createdAt",
          total,
          replies,
          reviews,
          deletes,
          source,
          channel_id AS "channelId",
          channel_title AS "channelTitle",
          scanned_count AS "scannedCount",
          candidate_count AS "candidateCount",
          skipped_threads_with_creator_replies AS "skippedThreadsWithCreatorReplies",
          processed_skipped_count AS "processedSkippedCount",
          include_processed AS "includeProcessed",
          include_threads_with_replies AS "includeThreadsWithReplies",
          scan_limit AS "scanLimit",
          next_page_token AS "nextPageToken"
        FROM dry_run_batches
        ${sourceFilter}
        ORDER BY created_at DESC
        LIMIT 1
      `,
      params,
    );

    const batch = batchResult.rows[0];
    if (!batch) {
      return null;
    }

    const resultsResult = await client.query(
      `
        SELECT
          dry_run_results.id,
          dry_run_results.external_comment_id AS "externalCommentId",
          dry_run_results.video_id AS "videoId",
          dry_run_results.author_name AS "authorName",
          dry_run_results.comment_text AS "commentText",
          dry_run_results.action,
          dry_run_results.safety_category AS "safetyCategory",
          dry_run_results.detected_language AS "detectedLanguage",
          dry_run_results.reply_language AS "replyLanguage",
          dry_run_results.language_confidence AS "languageConfidence",
          dry_run_results.ai_reply AS "aiReply",
          dry_run_results.smart_category AS "smartCategory",
          dry_run_results.decision_reason AS "decisionReason",
          dry_run_results.reply_source AS "replySource",
          pc.action AS "processedAction",
          pc.status AS "processedStatus",
          pc.reply_text AS "processedReplyText",
          pc.updated_at AS "processedAt"
        FROM dry_run_results
        LEFT JOIN processed_comments pc ON pc.comment_id = dry_run_results.external_comment_id
        WHERE batch_id = $1
        ORDER BY dry_run_results.created_at ASC
      `,
      [batch.id],
    );

    return {
      id: batch.id,
      createdAt: batch.createdAt.toISOString(),
      total: batch.total,
      replies: batch.replies,
      reviews: batch.reviews,
      deletes: batch.deletes,
      source: batch.source,
      channelId: batch.channelId,
      channelTitle: batch.channelTitle,
      scannedCount: batch.scannedCount,
      candidateCount: batch.candidateCount,
      skippedThreadsWithCreatorReplies: batch.skippedThreadsWithCreatorReplies,
      processedSkippedCount: batch.processedSkippedCount,
      includeProcessed: batch.includeProcessed,
      includeThreadsWithReplies: batch.includeThreadsWithReplies,
      scanLimit: batch.scanLimit,
      nextPageToken: batch.nextPageToken,
      results: resultsResult.rows.map((result) => ({
        id: result.externalCommentId || result.id,
        videoId: result.videoId,
        videoUrl: getYouTubeVideoUrl(result.videoId),
        commentUrl: getYouTubeCommentUrl(result.videoId, result.externalCommentId || result.id),
        studioCommentsUrl: getYouTubeStudioCommentsUrl(result.videoId),
        comment: result.commentText,
        authorName: result.authorName || "Viewer",
        action: result.action,
        status: result.processedStatus || "pending",
        processedAction: result.processedAction,
        processedAt: result.processedAt ? result.processedAt.toISOString() : null,
        category: result.safetyCategory,
        detectedLanguage: result.detectedLanguage,
        replyLanguage: result.replyLanguage,
        languageConfidence: result.languageConfidence,
        reply: result.processedReplyText || result.aiReply,
        smartCategory: result.smartCategory,
        decisionReason: result.decisionReason,
        replySource: result.replySource,
      })),
    };
  } catch (error) {
    console.error("Failed to load latest dry-run batch", error);
    return null;
  }
}

export async function markCommentProcessed({ commentId, videoId, action, status, replyText }) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(
      `
        INSERT INTO processed_comments (comment_id, video_id, action, status, reply_text, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (comment_id) DO UPDATE SET
          video_id = COALESCE(EXCLUDED.video_id, processed_comments.video_id),
          action = EXCLUDED.action,
          status = EXCLUDED.status,
          reply_text = COALESCE(EXCLUDED.reply_text, processed_comments.reply_text),
          updated_at = NOW()
        RETURNING
          comment_id AS "commentId",
          video_id AS "videoId",
          action,
          status,
          reply_text AS "replyText",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      `,
      [commentId, videoId || null, action, status, replyText || null],
    );

    const row = rows[0];
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error("Failed to mark comment processed", error);
    return null;
  }
}

export async function listProcessedCommentIds() {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query("SELECT comment_id AS \"commentId\" FROM processed_comments");
    return rows.map((row) => row.commentId);
  } catch (error) {
    console.error("Failed to list processed comment IDs", error);
    return null;
  }
}

export async function listKnownCommentIds() {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(`
      SELECT comment_id AS "commentId"
      FROM processed_comments
      WHERE comment_id IS NOT NULL
      UNION
      SELECT external_comment_id AS "commentId"
      FROM dry_run_results
      WHERE external_comment_id IS NOT NULL
    `);
    return rows.map((row) => row.commentId);
  } catch (error) {
    console.error("Failed to list known comment IDs", error);
    return null;
  }
}

export async function persistLog(log) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    await client.query(
      `
        INSERT INTO logs (id, action, message, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
      `,
      [log.id, log.action, log.message, log.createdAt],
    );
    return log;
  } catch (error) {
    console.error("Failed to persist log", error);
    return null;
  }
}

function getYouTubeVideoUrl(videoId) {
  if (!videoId || videoId === "manual-test" || videoId === "unknown-video") {
    return "";
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function getYouTubeCommentUrl(videoId, commentId) {
  const videoUrl = getYouTubeVideoUrl(videoId);
  if (!videoUrl || !commentId) {
    return "";
  }

  return `${videoUrl}&lc=${encodeURIComponent(commentId)}`;
}

function getYouTubeStudioCommentsUrl(videoId) {
  if (!videoId || videoId === "manual-test" || videoId === "unknown-video") {
    return "";
  }

  return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/comments`;
}

export async function listLogsFromDb(limit = 100) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(
      `
        SELECT id, action, message, created_at AS "createdAt"
        FROM logs
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error("Failed to list logs", error);
    return null;
  }
}

export async function upsertConnectedUser(user) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(
      `
        INSERT INTO users (
          id,
          google_email,
          youtube_channel_id,
          youtube_channel_title,
          access_token,
          refresh_token,
          token_expiry,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (google_email) DO UPDATE SET
          youtube_channel_id = EXCLUDED.youtube_channel_id,
          youtube_channel_title = EXCLUDED.youtube_channel_title,
          access_token = EXCLUDED.access_token,
          refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
          token_expiry = EXCLUDED.token_expiry,
          updated_at = NOW()
        RETURNING id, google_email AS "googleEmail", youtube_channel_id AS "youtubeChannelId",
          youtube_channel_title AS "youtubeChannelTitle", created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      [
        user.id,
        user.googleEmail,
        user.youtubeChannelId,
        user.youtubeChannelTitle,
        encryptSecret(user.accessToken),
        encryptSecret(user.refreshToken),
        user.tokenExpiry,
      ],
    );
    return rows[0];
  } catch (error) {
    console.error("Failed to save connected YouTube user", error);
    return null;
  }
}

export async function getConnectedUser(userId = null) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = userId ? await client.query(`
      SELECT id, google_email AS "googleEmail", youtube_channel_id AS "youtubeChannelId",
        youtube_channel_title AS "youtubeChannelTitle", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM users
      WHERE id = $1 AND refresh_token IS NOT NULL
      LIMIT 1
    `, [userId]) : await client.query(`
      SELECT id, google_email AS "googleEmail", youtube_channel_id AS "youtubeChannelId",
        youtube_channel_title AS "youtubeChannelTitle", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM users
      WHERE refresh_token IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const user = rows[0];
    if (!user) {
      return null;
    }

    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error("Failed to load connected YouTube user", error);
    return null;
  }
}

export async function getConnectedYouTubeCredentials(userId = null) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = userId ? await client.query(`
      SELECT
        id,
        google_email AS "googleEmail",
        youtube_channel_id AS "youtubeChannelId",
        youtube_channel_title AS "youtubeChannelTitle",
        access_token AS "accessToken",
        refresh_token AS "refreshToken",
        token_expiry AS "tokenExpiry"
      FROM users
      WHERE id = $1 AND refresh_token IS NOT NULL
      LIMIT 1
    `, [userId]) : await client.query(`
      SELECT
        id,
        google_email AS "googleEmail",
        youtube_channel_id AS "youtubeChannelId",
        youtube_channel_title AS "youtubeChannelTitle",
        access_token AS "accessToken",
        refresh_token AS "refreshToken",
        token_expiry AS "tokenExpiry"
      FROM users
      WHERE refresh_token IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const user = rows[0];
    if (!user) {
      return null;
    }

    return {
      ...user,
      accessToken: decryptSecret(user.accessToken),
      refreshToken: decryptSecret(user.refreshToken),
      tokenExpiry: user.tokenExpiry?.toISOString?.() || user.tokenExpiry,
    };
  } catch (error) {
    console.error("Failed to load connected YouTube credentials", error);
    return null;
  }
}

export async function updateConnectedUserTokens(userId, tokens) {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(
      `
        UPDATE users
        SET
          access_token = COALESCE($2, access_token),
          refresh_token = COALESCE($3, refresh_token),
          token_expiry = COALESCE($4, token_expiry),
          updated_at = NOW()
        WHERE id = $1
        RETURNING id
      `,
      [userId, encryptSecret(tokens.accessToken), encryptSecret(tokens.refreshToken), tokens.tokenExpiry],
    );
    return rows[0] || null;
  } catch (error) {
    console.error("Failed to update YouTube tokens", error);
    return null;
  }
}
