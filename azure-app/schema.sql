-- ============================================================================
-- HR System on Azure SQL (akarahr2) — step 2: users / permissions / employees / movements
-- Same tables and columns as Supabase (sql/schema.sql + schema_rbac.sql + later alters), translated to T-SQL.
-- Users are keyed by e-mail (Microsoft login) instead of the Supabase auth user id; the old id is kept
-- in supabase_user_id so movements.created_by can still be matched.
-- Run by the app (/api/admin/setup) — idempotent, safe to run again.
-- ============================================================================

IF OBJECT_ID('dbo.app_roles') IS NULL
CREATE TABLE dbo.app_roles (
  [key]        NVARCHAR(64)  NOT NULL PRIMARY KEY,
  label        NVARCHAR(200) NOT NULL,
  description  NVARCHAR(1000) NULL,
  is_system    BIT NOT NULL DEFAULT 0,
  sort_order   INT NOT NULL DEFAULT 100,
  created_at   DATETIMEOFFSET NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID('dbo.permissions') IS NULL
CREATE TABLE dbo.permissions (
  [key]        NVARCHAR(100) NOT NULL PRIMARY KEY,
  category     NVARCHAR(20)  NOT NULL,
  label        NVARCHAR(300) NOT NULL,
  description  NVARCHAR(1000) NULL,
  sort_order   INT NOT NULL DEFAULT 100
);

IF OBJECT_ID('dbo.role_permissions') IS NULL
CREATE TABLE dbo.role_permissions (
  role_key NVARCHAR(64)  NOT NULL,
  perm_key NVARCHAR(100) NOT NULL,
  CONSTRAINT pk_role_permissions PRIMARY KEY (role_key, perm_key)
);

IF OBJECT_ID('dbo.user_roles') IS NULL
CREATE TABLE dbo.user_roles (
  email            NVARCHAR(320) NOT NULL PRIMARY KEY,   -- lower-case
  name             NVARCHAR(300) NULL,
  role             NVARCHAR(64)  NOT NULL DEFAULT 'user',
  supabase_user_id UNIQUEIDENTIFIER NULL,
  created_at       DATETIMEOFFSET NULL DEFAULT SYSDATETIMEOFFSET()
);

IF OBJECT_ID('dbo.employees') IS NULL
CREATE TABLE dbo.employees (
  emp_code        NVARCHAR(50) NOT NULL PRIMARY KEY,
  status          NVARCHAR(50)  NULL,
  firstname_th    NVARCHAR(200) NULL,
  lastname_th     NVARCHAR(200) NULL,
  firstname_en    NVARCHAR(200) NULL,
  lastname_en     NVARCHAR(200) NULL,
  gender          NVARCHAR(50)  NULL,
  nationality     NVARCHAR(100) NULL,
  dob             DATE NULL,
  phone           NVARCHAR(100) NULL,
  division        NVARCHAR(200) NULL,
  department      NVARCHAR(200) NULL,
  section         NVARCHAR(200) NULL,
  team            NVARCHAR(200) NULL,
  position        NVARCHAR(300) NULL,
  job_level       NVARCHAR(50)  NULL,
  site            NVARCHAR(200) NULL,
  contract_type   NVARCHAR(100) NULL,
  join_date       DATE NULL,
  effective_date  DATE NULL,
  end_date        DATE NULL,
  salary          DECIMAL(14,2) NULL,
  remark          NVARCHAR(MAX) NULL,
  manager_code    NVARCHAR(50)  NULL,
  dotted_manager_code NVARCHAR(50) NULL,
  shift_allowance_override BIT NULL,
  created_at      DATETIMEOFFSET NULL,
  updated_at      DATETIMEOFFSET NULL
);

IF OBJECT_ID('dbo.movements') IS NULL
CREATE TABLE dbo.movements (
  id               UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  emp_code         NVARCHAR(50)  NULL,
  name             NVARCHAR(400) NOT NULL,
  type             NVARCHAR(100) NOT NULL,
  date             DATE NULL,
  from_dept        NVARCHAR(500) NULL,
  to_dept          NVARCHAR(500) NULL,
  reason           NVARCHAR(MAX) NULL,
  salary           DECIMAL(14,2) NULL,
  cost_center      NVARCHAR(100) NULL,
  recorded_by      NVARCHAR(300) NULL,
  created_by       UNIQUEIDENTIFIER NULL,
  job_level        NVARCHAR(50)  NULL,
  org_from         NVARCHAR(MAX) NULL,   -- JSON
  org_to           NVARCHAR(MAX) NULL,   -- JSON
  attachment_name  NVARCHAR(500) NULL,
  attachment_path  NVARCHAR(1000) NULL,
  sep_confirmed_at DATETIMEOFFSET NULL,
  sep_confirmed_by NVARCHAR(300) NULL,
  created_at       DATETIMEOFFSET NULL,
  updated_at       DATETIMEOFFSET NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_movements_emp')
  CREATE INDEX ix_movements_emp ON dbo.movements (emp_code, date);

-- import log: who copied what from Supabase, when, how many rows
IF OBJECT_ID('dbo.migration_log') IS NULL
CREATE TABLE dbo.migration_log (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  table_name  NVARCHAR(100) NOT NULL,
  row_count   INT NOT NULL,
  imported_by NVARCHAR(320) NOT NULL,
  imported_at DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
);
