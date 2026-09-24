-- ---------------------------------------------------------------------------
-- `device_snapshots`: what a terminal behind a connector last reported about
-- its own settings.
--
-- Additive only. One new table, no column added to anything that exists, and
-- nothing dropped. A direct installation never writes a row here, so applying
-- this on a server with no connectors changes no behaviour at all.
--
-- ## Why this table exists
--
-- A connector collects commands and does not answer reads, so the cloud has no
-- way to open a socket to a terminal on a hospital LAN. The device editor
-- therefore had nothing to show for a connector site: six tabs of empty fields,
-- each explaining that the value could not be read. Every tab an operator opens
-- has to hold data.
--
-- ## Re-running this is safe
--
-- `CREATE TABLE IF NOT EXISTS` is not enough on its own, and that is a lesson
-- from `001`: if a table of the same name already exists with a different shape,
-- the guard silently does nothing and the migration reports success while the
-- columns the code writes are absent. So the index and the foreign key are each
-- guarded through `information_schema` separately, which also covers a run that
-- half-applied.
--
-- MySQL 8 has no `ADD ... IF NOT EXISTS` (MariaDB does, and the driver package
-- name here is misleading on that point), hence PREPARE/EXECUTE.
--
-- Back up first, every time:
--   mysqldump -u <user> -p <database> > pre-migration-$(date +%F).sql
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS `device_snapshots` (
  `deviceId` INT         NOT NULL,

  -- Keyed by editor tab rather than by ISAPI endpoint, because the tab is what
  -- an operator opens and what has to be either populated or honestly empty.
  -- One tab can need several vendor reads.
  `kind`     VARCHAR(32) NOT NULL,

  -- The driver-contract shape, serialised. `TerminalIdentity`, `ClockReading`,
  -- `DoorSettings` and the rest are already defined as the contract both a
  -- direct installation and the connector return; mirroring them into columns
  -- would be a second copy of that contract, and the copy that drifts is the one
  -- the screen renders.
  --
  -- TEXT rather than JSON: the server never queries inside this value, and JSON
  -- on MariaDB is an alias for LONGTEXT with a validity check that would reject a
  -- payload the driver produced rather than storing it for somebody to look at.
  `payload`  TEXT        NULL,

  -- When the AGENT read the terminal, not when the cloud stored it. Those differ
  -- by the reporting interval, and the editor shows this beside the data: a
  -- cached value presented as live is worse than no value, because somebody
  -- changes a setting at the keypad and the screen stays confidently wrong.
  `readAt`   DATETIME(3) NULL,

  -- Why the most recent attempt failed, kept ALONGSIDE the payload rather than
  -- replacing it. A terminal that was readable an hour ago and refuses now leaves
  -- both facts on screen. Clearing the payload on a failed attempt would turn one
  -- bad read into an empty tab, which is what this table exists to remove.
  `error`    VARCHAR(500) NULL,
  `errorAt`  DATETIME(3)  NULL,

  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`deviceId`, `kind`)
) ENGINE = InnoDB
  DEFAULT CHARACTER SET = utf8mb4
  COLLATE = utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- CASCADE, not RESTRICT.
--
-- The opposite of `devices.agentId`, and for the opposite reason. That column
-- holds a decision somebody made, so losing it silently would repoint a terminal.
-- This table holds data derived from a device: if the device row goes, these rows
-- describe nothing, and keeping them would leave settings on file for a terminal
-- that no longer exists.
-- ---------------------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA    = DATABASE()
       AND TABLE_NAME      = 'device_snapshots'
       AND CONSTRAINT_NAME = 'device_snapshots_deviceId_fkey') = 0,
  'ALTER TABLE `device_snapshots`
     ADD CONSTRAINT `device_snapshots_deviceId_fkey`
     FOREIGN KEY (`deviceId`) REFERENCES `devices` (`id`)
     ON DELETE CASCADE ON UPDATE CASCADE',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Guarded separately, because a half-applied first run would leave the table
-- present and this missing — and `CREATE TABLE IF NOT EXISTS` would then report
-- success without ever creating it.
-- ---------------------------------------------------------------------------
SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'device_snapshots'
       AND INDEX_NAME   = 'device_snapshots_deviceId_idx') = 0,
  'CREATE INDEX `device_snapshots_deviceId_idx` ON `device_snapshots` (`deviceId`)',
  'DO 0'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
