-- Roles: RESEARCHER and STUDENT become a single self-signup role, USER.
ALTER TYPE "Role" RENAME VALUE 'RESEARCHER' TO 'USER';
UPDATE "users" SET "role" = 'USER' WHERE "role" = 'STUDENT';
CREATE TYPE "Role_new" AS ENUM ('INVESTOR', 'USER', 'JUDGE', 'ADMINISTRATOR');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- Collaborator permissions are now chosen by the project owner: EDITOR (edit) or VIEWER (read-only).
-- Existing collaborators keep what they could already do (edit).
ALTER TYPE "CollaboratorRole" RENAME VALUE 'LEAD' TO 'EDITOR';
ALTER TYPE "CollaboratorRole" RENAME VALUE 'MEMBER' TO 'VIEWER';
UPDATE "project_collaborators" SET "role" = 'EDITOR';
ALTER TABLE "project_collaborators" ALTER COLUMN "role" SET DEFAULT 'EDITOR';
