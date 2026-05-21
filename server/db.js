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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS dry_run_results (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES dry_run_batches(id) ON DELETE CASCADE,
        external_comment_id TEXT,
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

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        INSERT INTO dry_run_batches (id, total, replies, reviews, deletes, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING
      `,
      [run.id, run.total, run.replies, run.reviews, run.deletes, run.createdAt],
    );

    for (const result of run.results) {
      await connection.query(
        `
          INSERT INTO dry_run_results (
            id,
            batch_id,
            external_comment_id,
            author_name,
            comment_text,
            action,
            safety_category,
            detected_language,
            reply_language,
            language_confidence,
            ai_reply
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          crypto.randomUUID(),
          run.id,
          result.id,
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
        SELECT id, created_at AS "createdAt", total, replies, reviews, deletes
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
      results: resultsResult.rows.map((result) => ({
        id: result.externalCommentId || result.id,
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
