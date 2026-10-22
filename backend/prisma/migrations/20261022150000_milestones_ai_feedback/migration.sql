-- AlterTable: AI answer quality tracking (AIR-004, AIR-007)
ALTER TABLE "ai_interaction_logs" ADD COLUMN "confidence" DOUBLE PRECISION,
ADD COLUMN "fallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "flagged_at" TIMESTAMPTZ(6);

-- CreateTable: project milestones (FR-017)
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "due_date" DATE,
    "completed_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
