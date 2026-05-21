import pg from "pg";

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
        ADD COLUMN IF NOT EXISTS channel_title TEXT;

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
        ADD COLUMN IF NOT EXISTS video_id TEXT;

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
        INSERT INTO dry_run_batches (id, total, replies, reviews, deletes, source, channel_id, channel_title, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `,
      [run.id, run.total, run.replies, run.reviews, run.deletes, run.source, run.channelId, run.channelTitle, run.createdAt],
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
            ai_reply
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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

export async function latestBatchRunFromDb() {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
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
          channel_title AS "channelTitle"
        FROM dry_run_batches
        ORDER BY created_at DESC
        LIMIT 1
      `,
    );

    const batch = batchResult.rows[0];
    if (!batch) {
      return null;
    }

    const resultsResult = await client.query(
      `
        SELECT
          id,
          external_comment_id AS "externalCommentId",
          video_id AS "videoId",
          author_name AS "authorName",
          comment_text AS "commentText",
          action,
          safety_category AS "safetyCategory",
          detected_language AS "detectedLanguage",
          reply_language AS "replyLanguage",
          language_confidence AS "languageConfidence",
          ai_reply AS "aiReply"
        FROM dry_run_results
        WHERE batch_id = $1
        ORDER BY created_at ASC
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
      results: resultsResult.rows.map((result) => ({
        id: result.externalCommentId || result.id,
        videoId: result.videoId,
        comment: result.commentText,
        authorName: result.authorName || "Viewer",
        action: result.action,
        category: result.safetyCategory,
        detectedLanguage: result.detectedLanguage,
        replyLanguage: result.replyLanguage,
        languageConfidence: result.languageConfidence,
        reply: result.aiReply,
      })),
    };
  } catch (error) {
    console.error("Failed to load latest dry-run batch", error);
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
        user.accessToken,
        user.refreshToken,
        user.tokenExpiry,
      ],
    );
    return rows[0];
  } catch (error) {
    console.error("Failed to save connected YouTube user", error);
    return null;
  }
}

export async function getConnectedUser() {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(`
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

export async function getConnectedYouTubeCredentials() {
  const client = await ensureDatabase();
  if (!client) {
    return null;
  }

  try {
    const { rows } = await client.query(`
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
      [userId, tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry],
    );
    return rows[0] || null;
  } catch (error) {
    console.error("Failed to update YouTube tokens", error);
    return null;
  }
}
