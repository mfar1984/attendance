-- ---------------------------------------------------------------------------
-- Self-update state on `device_agents`.
--
-- Three nullable columns. Additive, nothing dropped, and an installation with no
-- connectors is unaffected.
--
-- ## Why this is not a queued command
--
-- `device_commands` is keyed on a terminal, and an update is about the connector.
-- An agent with no devices assigned could not be sent one — which is exactly the
-- connector most likely to be freshly installed and behind. So the request lives
-- on the agent row and rides the heartbeat reply.
--
-- It also survives better here. A connector that was offline when the operator
-- pressed the button finds the request waiting on its next heartbeat, rather than
-- somebody having to notice and re-queue it.
--
-- ## Why there is no `updateCompletedAt`
--
-- A successful update has nothing to report: the connector exits, systemd brings
-- it back on the new code, and the proof is the `version` column changing on the
-- next heartbeat. Recording success separately would create a second source for
-- the same fact, and the two can disagree — a connector that reported success and
-- then failed to start would read as updated while running nothing.
--
-- Only failure needs words, because a failed update leaves the old process
-- running and therefore able to speak.
--
-- Back up first, every time:
--   mysqldump -u <user> -p <database> > pre-migration-$(date +%F).sql
-- ---------------------------------------------------------------------------

-- When an operator asked. Cleared once the reported version matches the target,
-- which is what makes pressing the button twice harmless.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'device_agents'
       AND COLUMN_NAME  = 'updateRequestedAt') = 0,
  'ALTER TABLE `device_agents` ADD COLUMN `updateRequestedAt` DATETIME(3) NULL AFTER `version`',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Why the last attempt did not happen, in the connector's own words.
--
-- `git pull` refused, the build failed, the compiled entry point was missing. Each
-- is something the operator has to read, because each has a different answer and
-- none of them is visible from the cloud.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'device_agents'
       AND COLUMN_NAME  = 'updateError') = 0,
  'ALTER TABLE `device_agents` ADD COLUMN `updateError` VARCHAR(500) NULL AFTER `updateRequestedAt`',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'device_agents'
       AND COLUMN_NAME  = 'updateErrorAt') = 0,
  'ALTER TABLE `device_agents` ADD COLUMN `updateErrorAt` DATETIME(3) NULL AFTER `updateError`',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
