-- Fase 2: idempotencia de los eventos offline (lector con SQLite)
-- Uso: mysql -u root -p < db/migraciones/2026-11-23_sync_uuid.sql
USE sistemaaccesofacultad;

ALTER TABLE registroacceso
  ADD COLUMN uuid CHAR(36) DEFAULT NULL COMMENT 'Identificador idempotente del evento offline',
  ADD COLUMN recibido_en DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Momento en que se recibió el evento sincronizado',
  ADD UNIQUE KEY uq_registro_uuid (uuid);

CREATE TABLE IF NOT EXISTS sync_evento (
  uuid CHAR(36) NOT NULL COMMENT 'UUID del evento de la outbox local',
  tipo VARCHAR(30) NOT NULL,
  recibido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Eventos offline ya aplicados (idempotencia)';
