-- Wipes ALL Capital Increase data from the database.
-- Preserves shareholders, non-CI subscriptions/allocations, investments,
-- dividends, users, and everything else.
--
-- How to run:
--   Option A (MySQL CLI on Windows, port 3307, password @Test1234):
--     mysql -h 127.0.0.1 -P 3307 -u root -p"@Test1234" share_management < wipe-ci.sql
--
--   Option B (MySQL Workbench / DBeaver / phpMyAdmin):
--     open this file, run as a script against the share_management database.

USE share_management;

START TRANSACTION;

-- Safety: refuse if any Investment is linked to a CI allocation
SELECT COUNT(*) INTO @linked
  FROM investments
  WHERE allocation_id IN (SELECT id FROM allocations WHERE capital_increase_id IS NOT NULL);

-- (If @linked > 0, you should ROLLBACK and reverse those payments first.)

DELETE FROM ci_additional_requests;
DELETE FROM allocations WHERE capital_increase_id IS NOT NULL;
DELETE FROM subscriptions WHERE capital_increase_id IS NOT NULL; -- hard delete (ignores soft delete)
DELETE FROM capital_increases;

COMMIT;

-- Verify
SELECT COUNT(*) AS remaining_capital_increases FROM capital_increases;
SELECT COUNT(*) AS remaining_ci_subscriptions FROM subscriptions WHERE capital_increase_id IS NOT NULL;
SELECT COUNT(*) AS remaining_ci_allocations FROM allocations WHERE capital_increase_id IS NOT NULL;
SELECT COUNT(*) AS remaining_additional_requests FROM ci_additional_requests;
