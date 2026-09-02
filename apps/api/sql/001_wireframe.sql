-- MySQL 8+. 로컬=배포 동일. HTML/JSON 본문은 파일, 여기는 메타만.

CREATE TABLE IF NOT EXISTS wireframe_run (
  run_id          VARCHAR(64)  NOT NULL PRIMARY KEY,
  project_slug    VARCHAR(128) NOT NULL,
  kind            VARCHAR(32)  NOT NULL DEFAULT 'wireframe',
  title           VARCHAR(255) NOT NULL,
  status          ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
  prd_path        VARCHAR(512) NOT NULL,
  manifest_path   VARCHAR(512) NOT NULL,
  domain_path     VARCHAR(512) NULL,
  confirmed_at    DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_status (project_slug, status)
);

CREATE TABLE IF NOT EXISTS wireframe_artifact (
  run_id          VARCHAR(64)  NOT NULL,
  artifact_id     VARCHAR(64)  NOT NULL,
  label           VARCHAR(255) NOT NULL,
  file_path       VARCHAR(512) NOT NULL,
  locked          TINYINT(1)   NOT NULL DEFAULT 0,
  sort_order      INT          NOT NULL DEFAULT 0,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, artifact_id),
  CONSTRAINT fk_art_run FOREIGN KEY (run_id) REFERENCES wireframe_run(run_id)
);

CREATE TABLE IF NOT EXISTS wireframe_instruction (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id          VARCHAR(64)  NOT NULL,
  artifact_id     VARCHAR(64)  NOT NULL,
  body            TEXT         NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_run_art (run_id, artifact_id)
);
