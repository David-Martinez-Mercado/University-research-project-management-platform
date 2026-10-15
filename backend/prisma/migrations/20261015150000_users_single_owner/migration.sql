-- At most one owner (the Administrator created by POST /auth/bootstrap-owner).
-- Written by hand: Prisma cannot express partial indexes. Guarantees the bootstrap
-- endpoint cannot create a second owner even under concurrent requests.
CREATE UNIQUE INDEX "users_single_owner_idx" ON "users" ("is_owner") WHERE "is_owner" = true;
