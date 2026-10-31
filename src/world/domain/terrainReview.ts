import type { GenerationJob } from "../../contracts/image-generation-contract.js";

/** A human decision applies only to this completed image; machine measurements remain unchanged. */
export function canReviewTerrain(job?: GenerationJob | null): job is GenerationJob & { image_url: string } {
  return !!job?.job_id && job.provider === "qwen" && job.request_status === "succeeded" &&
    !!job.image_url && job.background_removal?.status === "needs_review";
}

export function hasTerrainApproval(job?: GenerationJob | null): boolean {
  const review = job?.manual_review;
  return canReviewTerrain(job) && review?.decision === "approved" && review.job_id === job.job_id &&
    review.image_url === job.image_url && review.source_sha256 === job.background_removal?.source_sha256 &&
    Number.isFinite(Date.parse(review.reviewed_at));
}

export function terrainUsable(job?: GenerationJob | null): boolean {
  return !!job?.image_url && job.request_status === "succeeded" &&
    (job.provider !== "qwen" || job.background_removal?.status === "ready" || hasTerrainApproval(job));
}

export function approveTerrain(job: GenerationJob, reviewedAt = new Date().toISOString()): GenerationJob {
  if (!canReviewTerrain(job)) throw new Error("该图片尚未完成或不属于待审核结果，不能手动通过。");
  return { ...job, manual_review: { decision: "approved", job_id: job.job_id, image_url: job.image_url,
    source_sha256: job.background_removal?.source_sha256, reviewed_at: reviewedAt } };
}
