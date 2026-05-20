import { PrismaClient } from "@prisma/client";

let prisma = null;

export function getPrisma() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!prisma) {
    prisma = new PrismaClient();
  }

  return prisma;
}

export async function persistBatchRun(run) {
  const client = getPrisma();
  if (!client) {
    return null;
  }

  try {
    return await client.dryRunBatch.create({
      data: {
        id: run.id,
        total: run.total,
        replies: run.replies,
        reviews: run.reviews,
        deletes: run.deletes,
        createdAt: new Date(run.createdAt),
        results: {
          create: run.results.map((result) => ({
            externalCommentId: result.id,
            authorName: result.authorName,
            commentText: result.comment,
            action: result.action,
            safetyCategory: result.category,
            detectedLanguage: result.detectedLanguage,
            replyLanguage: result.replyLanguage,
            languageConfidence: result.languageConfidence,
            aiReply: result.reply,
          })),
        },
      },
    });
  } catch (error) {
    console.error("Failed to persist dry-run batch", error);
    return null;
  }
}

export async function listBatchRunsFromDb(limit = 20) {
  const client = getPrisma();
  if (!client) {
    return null;
  }

  try {
    return await client.dryRunBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        total: true,
        replies: true,
        reviews: true,
        deletes: true,
        _count: { select: { results: true } },
      },
    });
  } catch (error) {
    console.error("Failed to list dry-run batches", error);
    return null;
  }
}

export async function latestBatchRunFromDb() {
  const client = getPrisma();
  if (!client) {
    return null;
  }

  try {
    const batch = await client.dryRunBatch.findFirst({
      orderBy: { createdAt: "desc" },
      include: { results: { orderBy: { createdAt: "asc" } } },
    });

    if (!batch) {
      return null;
    }

    return {
      id: batch.id,
      createdAt: batch.createdAt.toISOString(),
      total: batch.total,
      replies: batch.replies,
      reviews: batch.reviews,
      deletes: batch.deletes,
      results: batch.results.map((result) => ({
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
