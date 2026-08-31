-- 클론한 프로젝트 MySQL에서 한 번만 실행.
-- 기존 테이블은 건드리지 않는다.

CREATE TABLE IF NOT EXISTS wireframe_issue (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  parentId VARCHAR(64) NULL,
  projectNo VARCHAR(16) NOT NULL,
  projectSlug VARCHAR(128) NOT NULL,
  projectTitle VARCHAR(255) NOT NULL,
  slug VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  issueNo VARCHAR(64) NOT NULL,
  html MEDIUMTEXT NOT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  route VARCHAR(255) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_project_parent (projectNo, parentId),
  INDEX idx_project_slug (projectNo, slug)
);
