-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worksUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Prd" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prd_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrdRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prdId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "sourceText" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PrdRevision_prdId_fkey" FOREIGN KEY ("prdId") REFERENCES "Prd" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrdRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Wireframe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prdId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "docJson" TEXT NOT NULL,
    "prdRevisionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Wireframe_prdId_fkey" FOREIGN KEY ("prdId") REFERENCES "Prd" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Wireframe_prdRevisionId_fkey" FOREIGN KEY ("prdRevisionId") REFERENCES "PrdRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prdId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "trigger" TEXT NOT NULL,
    "triggeredById" TEXT,
    "wireframeId" TEXT,
    "error" TEXT,
    "cursorAgentId" TEXT,
    "cursorRunId" TEXT,
    "model" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GenerationJob_prdId_fkey" FOREIGN KEY ("prdId") REFERENCES "Prd" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GenerationJob_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_worksUserId_key" ON "User"("worksUserId");

-- CreateIndex
CREATE INDEX "Prd_updatedAt_idx" ON "Prd"("updatedAt");

-- CreateIndex
CREATE INDEX "PrdRevision_prdId_createdAt_idx" ON "PrdRevision"("prdId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrdRevision_prdId_revision_key" ON "PrdRevision"("prdId", "revision");

-- CreateIndex
CREATE INDEX "Wireframe_prdId_createdAt_idx" ON "Wireframe"("prdId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wireframe_prdId_version_key" ON "Wireframe"("prdId", "version");

-- CreateIndex
CREATE INDEX "GenerationJob_prdId_status_idx" ON "GenerationJob"("prdId", "status");

-- CreateIndex
CREATE INDEX "GenerationJob_prdId_createdAt_idx" ON "GenerationJob"("prdId", "createdAt");

