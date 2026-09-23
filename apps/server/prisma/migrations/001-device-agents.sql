-- ---------------------------------------------------------------------------
-- On-site connectors: `device_agents`, and `devices.agentId`.
--
-- Additive only. Nothing is dropped, nothing is rewritten, and every existing
-- device row keeps working unchanged because `agentId` defaults to NULL, which
-- means "this server reaches the terminal itself".
--
-- ## Why this folder starts here
--
-- Earlier schema changes on this project were applied ad hoc and never recorded
-- as files. That is the reason this one is: `prisma db push` is forbidden on a
-- populated database because it drops columns it no longer sees without asking,
-- so production changes have to be reviewable SQL, and SQL nobody wrote down is
-- SQL nobody can review or replay on a second install.
--
-- ## Re-running this is safe
--
-- Every statement is guarded against already existing. MySQL 8 has no
-- `ADD COLUMN IF NOT EXISTS` (MariaDB does, and the driver package name here is
-- misleading on that point), so the guards go through `information_schema` with
-- PREPARE/EXECUTE. Worth the verbosity: a migration that half-applies on a second
-- run leaves a state whose only description is the error message.
--
-- Back up first, every time:
--   mysqldump -u <user> -p <database> > pre-migration-$(date +%F).sql
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The agent itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `device_agents` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `name`           VARCHAR(120) NOT NULL,

  -- Stable public identifier, presented on every request. Separate from the
  -- secret so a log line can name the site without holding anything usable.
  `agentKey`       VARCHAR(64)  NOT NULL,

  -- SHA-256 hex of the long-lived credential. Fast hash on purpose: the value is
  -- 192 bits of randomness, so a slow KDF adds latency to a request that arrives
  -- every few seconds and buys nothing against guessing.
  `secretHash`     CHAR(64)     NULL,
  `secretPrefix`   VARCHAR(24)  NULL,

  -- Single-use enrolment token, also SHA-256 hex. Cleared once exchanged.
  `enrolTokenHash` CHAR(64)     NULL,
  `enrolExpiresAt` DATETIME(3)  NULL,
  `enrolledAt`     DATETIME(3)  NULL,

  -- pending | active | revoked. Three states, not a boolean: an unfinished
  -- install and a withdrawn credential need different actions from whoever reads
  -- the screen.
  `status`         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  `revokedAt`      DATETIME(3)  NULL,

  `version`        VARCHAR(32)  NULL,

  -- The agent's own liveness, deliberately not the same as a device's. Without
  -- it, one dead site link reads as fifteen dead terminals.
  `lastSeenAt`     DATETIME(3)  NULL,
  `lastAddress`    VARCHAR(45)  NULL,

  -- LAN address the terminals at this site are pointed at, reported by the agent
  -- because only it knows which interface it is reachable on.
  `lanHost`        VARCHAR(190) NULL,
  `lanPort`        INT          NULL,

  `createdAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `device_agents_agentKey_key` (`agentKey`),
  INDEX `device_agents_status_idx` (`status`)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. devices.agentId — NULL means direct, which is every existing row.
-- ---------------------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'devices'
       AND COLUMN_NAME  = 'agentId') = 0,
  'ALTER TABLE `devices` ADD COLUMN `agentId` INT NULL AFTER `protocol`',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'devices'
       AND INDEX_NAME   = 'devices_agentId_idx') = 0,
  'CREATE INDEX `devices_agentId_idx` ON `devices` (`agentId`)',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- RESTRICT, not SET NULL. Nulling this on delete would silently convert the
-- terminal to direct, and the cloud would start dialling a private address it
-- cannot route: a healthy unit marked offline, backed off to fifteen-minute
-- retries, with nothing naming the deleted agent as the cause.
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA    = DATABASE()
       AND TABLE_NAME      = 'devices'
       AND CONSTRAINT_NAME = 'devices_agentId_fkey') = 0,
  'ALTER TABLE `devices`
     ADD CONSTRAINT `devices_agentId_fkey`
     FOREIGN KEY (`agentId`) REFERENCES `device_agents` (`id`)
     ON DELETE RESTRICT ON UPDATE CASCADE',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
