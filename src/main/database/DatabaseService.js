import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {
  FACEBOOK_CRAWL_GROUP_PROFILE_ID,
  FACEBOOK_CRAWL_SETTINGS,
  isSystemVariableProfile,
  SYSTEM_FACEBOOK_VARIABLE_PROFILES,
} from '../../shared/facebookCrawlConfig.js';

/**
 * DatabaseService — Service quản lý toàn bộ tương tác với cơ sở dữ liệu SQLite.
 *
 * Sử dụng thư viện better-sqlite3 (đồng bộ) trong Main Process Electron.
 * Tất cả ID dùng TEXT (UUID v4) thay vì AUTOINCREMENT INTEGER để tương thích
 * với đồng bộ hóa đám mây (Laravel Omnichannel) trong tương lai.
 *
 * Cột is_dirty (INTEGER 0/1) đánh dấu bản ghi đã được đồng bộ lên cloud hay chưa.
 */
class DatabaseService {
  /**
   * @param {string} appDataPath - Đường dẫn thư mục dữ liệu của ứng dụng (userData).
   *   Database sẽ được tạo tại: ${appDataPath}/database/rpa_local.db
   */
  constructor(appDataPath) {
    /** @type {string} Đường dẫn thư mục chứa database */
    this.dbDir = path.join(appDataPath, 'database');
    /** @type {string} Đường dẫn đầy đủ tới file SQLite */
    this.dbPath = path.join(this.dbDir, 'rpa_local.db');
    /** @type {Database|null} Instance better-sqlite3 */
    this.db = null;
  }

  /**
   * Mở kết nối đến database.
   * Tạo thư mục và file database nếu chưa tồn tại.
   * Bật WAL mode (tối ưu concurrent read) và foreign keys ngay sau khi kết nối.
   *
   * @returns {Database} Instance better-sqlite3 đã sẵn sàng.
   */
  open() {
    // Tạo thư mục database nếu chưa tồn tại
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
      console.log(`[DatabaseService] Đã tạo thư mục database: ${this.dbDir}`);
    }

    console.log(`[DatabaseService] Mở kết nối database tại: ${this.dbPath}`);
    this.db = new Database(this.dbPath);

    // Tối ưu: bật WAL journal mode — cải thiện hiệu năng đọc đồng thời
    this.db.pragma('journal_mode = WAL');
    // BẮT BUỘC: Bật foreign keys ngay sau khi mở kết nối
    this.db.pragma('foreign_keys = ON');

    return this.db;
  }

  /**
   * Khởi tạo schema (các bảng dữ liệu) trong một transaction.
   * Phương thức này an toàn để gọi nhiều lần — dùng IF NOT EXISTS.
   *
   * Các bảng được tạo theo đúng thứ tự quan hệ (khóa ngoại) để tránh lỗi tham chiếu.
   */
  /**
   * Kiểm tra và nâng cấp schema nếu cần.
   * Xử lý migration khi cấu trúc bảng thay đổi giữa các phiên bản.
   *
   * Chiến lược:
   * - Nếu bảng scenarios chưa có cột target_url (schema cũ),
   *   drop bảng cũ và tạo lại với schema mới.
   * - Dùng PRAGMA table_info để kiểm tra cột tồn tại.
   */
  _migrateSchema() {
    // Kiểm tra bảng scenarios có tồn tại không
    let tableExists = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios'")
      .get();

    if (tableExists) {
      // Kiểm tra cột target_url có tồn tại không
      const columns = this.db.prepare('PRAGMA table_info(scenarios)').all();
      const hasTargetUrl = columns.some((col) => col.name === 'target_url');

      if (!hasTargetUrl) {
        console.log('[DatabaseService] Phát hiện schema cũ — đang nâng cấp...');
        // Schema cũ (từ connection.js): id, name, description, platform, status, created_at, updated_at
        // Schema mới: id, name, target_url, recorded_width, recorded_height, device_pixel_ratio, is_dirty, updated_at
        // Drop tất cả bảng cũ trước khi tạo lại với schema mới
        // Thứ tự drop: bảng con (có FK) trước, bảng cha sau
        this.db.exec(`
          DROP TABLE IF EXISTS step_execution_logs;
          DROP TABLE IF EXISTS execution_logs;
          DROP TABLE IF EXISTS execution_errors;
          DROP TABLE IF EXISTS campaign_profiles;
          DROP TABLE IF EXISTS campaigns;
          DROP TABLE IF EXISTS scenario_steps;
          DROP TABLE IF EXISTS scenarios;
          DROP TABLE IF EXISTS profiles;
          DROP TABLE IF EXISTS proxies;
          DROP TABLE IF EXISTS accounts;
          DROP TABLE IF EXISTS media_assets;
          DROP TABLE IF EXISTS schedules;
        `);
        console.log('[DatabaseService] Đã xóa bảng cũ, schema mới sẽ được tạo');
        tableExists = null;
      }
    }

    const profilesTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'")
      .get();

    if (profilesTable) {
      this.db.exec(`
        DROP TABLE IF EXISTS campaign_profiles;
        DROP TABLE IF EXISTS profiles;
      `);
      console.log('[DatabaseService] Da xoa bang profiles cu (tai khoan MXH)');
    }

    const scenariosTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios'")
      .get();

    if (scenariosTable) {
      const scenarioColumns = this.db.prepare('PRAGMA table_info(scenarios)').all();
      const hasDescription = scenarioColumns.some((col) => col.name === 'description');
      const hasPlatform = scenarioColumns.some((col) => col.name === 'platform');

      if (!hasDescription) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN description TEXT');
      }

      if (!hasPlatform) {
        this.db.exec("ALTER TABLE scenarios ADD COLUMN platform TEXT DEFAULT 'custom'");
      }

      const hasPreviewPath = scenarioColumns.some((col) => col.name === 'preview_path');
      const hasPreviewManifestPath = scenarioColumns.some((col) => col.name === 'preview_manifest_path');
      const hasPreviewDurationMs = scenarioColumns.some((col) => col.name === 'preview_duration_ms');
      const hasPreviewTrimRanges = scenarioColumns.some((col) => col.name === 'preview_trim_ranges');

      if (!hasPreviewPath) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN preview_path TEXT');
      }

      if (!hasPreviewManifestPath) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN preview_manifest_path TEXT');
      }

      if (!hasPreviewDurationMs) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN preview_duration_ms INTEGER');
      }

      if (!hasPreviewTrimRanges) {
        this.db.exec("ALTER TABLE scenarios ADD COLUMN preview_trim_ranges TEXT DEFAULT '[]'");
      }

      const hasScenarioBrowserProfileId = scenarioColumns.some((col) => col.name === 'browser_profile_id');
      if (!hasScenarioBrowserProfileId) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN browser_profile_id TEXT');
      }

      const hasVariableProfileId = scenarioColumns.some((col) => col.name === 'variable_profile_id');
      if (!hasVariableProfileId) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN variable_profile_id TEXT');
        if (scenarioColumns.some((col) => col.name === 'data_profile_id')) {
          this.db.exec(`
            UPDATE scenarios
            SET variable_profile_id = data_profile_id
            WHERE variable_profile_id IS NULL AND data_profile_id IS NOT NULL
          `);
        }
      }

      const hasLocalVariables = scenarioColumns.some((col) => col.name === 'local_variables');
      if (!hasLocalVariables) {
        this.db.exec("ALTER TABLE scenarios ADD COLUMN local_variables TEXT NOT NULL DEFAULT '[]'");
      }

      if (!scenarioColumns.some((col) => col.name === 'scenario_type')) {
        this.db.exec("ALTER TABLE scenarios ADD COLUMN scenario_type TEXT NOT NULL DEFAULT 'action'");
      }

      if (!scenarioColumns.some((col) => col.name === 'result_type')) {
        this.db.exec("ALTER TABLE scenarios ADD COLUMN result_type TEXT NOT NULL DEFAULT 'simple'");
      }

      if (!scenarioColumns.some((col) => col.name === 'parent_id')) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN parent_id TEXT REFERENCES scenarios(id) ON DELETE SET NULL');
      }

      if (!scenarioColumns.some((col) => col.name === 'dom_check_anchor')) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN dom_check_anchor TEXT');
      }

      if (!scenarioColumns.some((col) => col.name === 'is_pinned')) {
        this.db.exec('ALTER TABLE scenarios ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenarios_meta (
        id          TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        meta_key    TEXT NOT NULL,
        meta_value  TEXT,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(scenario_id, meta_key),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
      );
    `);
    this._migrateScenarioColumnsToMeta();

    const browserProfilesTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='browser_profiles'")
      .get();

    if (browserProfilesTable) {
      const browserProfileColumns = this.db.prepare('PRAGMA table_info(browser_profiles)').all();
      if (!browserProfileColumns.some((col) => col.name === 'imported_at')) {
        this.db.exec('ALTER TABLE browser_profiles ADD COLUMN imported_at TEXT');
      }
      if (!browserProfileColumns.some((col) => col.name === 'import_path')) {
        this.db.exec('ALTER TABLE browser_profiles ADD COLUMN import_path TEXT');
      }
      if (!browserProfileColumns.some((col) => col.name === 'facebook_id')) {
        this.db.exec('ALTER TABLE browser_profiles ADD COLUMN facebook_id TEXT');
      }
      if (!browserProfileColumns.some((col) => col.name === 'has_linkedin')) {
        this.db.exec('ALTER TABLE browser_profiles ADD COLUMN has_linkedin INTEGER NOT NULL DEFAULT 0');
      }
      if (!browserProfileColumns.some((col) => col.name === 'account_detected_at')) {
        this.db.exec('ALTER TABLE browser_profiles ADD COLUMN account_detected_at TEXT');
      }
      if (!browserProfileColumns.some((col) => col.name === 'account_summary')) {
        this.db.exec('ALTER TABLE browser_profiles ADD COLUMN account_summary TEXT');
      }
    }

    const executionLogsTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_logs'")
      .get();

    if (!executionLogsTable) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS execution_logs (
          id                  TEXT PRIMARY KEY,
          scenario_id         TEXT NOT NULL,
          scenario_name       TEXT,
          browser_profile_id  TEXT,
          status              TEXT NOT NULL DEFAULT 'running',
          total_steps         INTEGER NOT NULL DEFAULT 0,
          completed_steps     INTEGER NOT NULL DEFAULT 0,
          failed_steps        INTEGER NOT NULL DEFAULT 0,
          failed_step_index   INTEGER,
          error_message       TEXT,
          result_json         TEXT,
          duration_ms         INTEGER,
          started_at          TEXT NOT NULL,
          finished_at         TEXT,
          is_dirty            INTEGER NOT NULL DEFAULT 1,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );
      `);
    }

    this._migrateScenarioVariablesTable();
    this._migrateVariableProfilesTables();
    this._migrateLocalVariablesAndSamples();
    this._seedSystemFacebookVariableProfiles();
    this._migrateScenarioColumnsToMeta();
    this._migrateExecutionLogsProfileColumns();

    const scenarioStepsTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenario_steps'")
      .get();
    if (scenarioStepsTable) {
      this.db.prepare(`
        UPDATE scenario_steps
        SET action_type = 'input'
        WHERE action_type = 'type'
      `).run();
    }
  }

  _migrateScenarioVariablesTable() {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenario_variables'")
      .get();
    if (!table) return;

    const columns = this.db.prepare('PRAGMA table_info(scenario_variables)').all();
    const hasKey = columns.some((col) => col.name === 'key');
    if (hasKey) return;

    const hasName = columns.some((col) => col.name === 'name');
    if (!hasName) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scenario_variables_new (
        id          TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        key         TEXT NOT NULL,
        value       TEXT,
        UNIQUE(scenario_id, key),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
      );

      INSERT OR REPLACE INTO scenario_variables_new (id, scenario_id, key, value)
      SELECT id, scenario_id, name, value
      FROM scenario_variables;

      DROP TABLE scenario_variables;
      ALTER TABLE scenario_variables_new RENAME TO scenario_variables;
    `);
  }

  _migrateVariableProfilesTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variable_profiles (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL UNIQUE,
        variables_json TEXT NOT NULL DEFAULT '[]',
        is_dirty       INTEGER NOT NULL DEFAULT 1,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const variableProfileColumns = this.db.prepare('PRAGMA table_info(variable_profiles)').all();
    if (!variableProfileColumns.some((col) => col.name === 'variables_json')) {
      this.db.exec("ALTER TABLE variable_profiles ADD COLUMN variables_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!variableProfileColumns.some((col) => col.name === 'is_system')) {
      this.db.exec('ALTER TABLE variable_profiles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0');
    }

    const dataProfilesTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='data_profiles'")
      .get();

    if (dataProfilesTable) {
      const legacyProfiles = this.db
        .prepare('SELECT id, name, is_dirty, updated_at FROM data_profiles ORDER BY updated_at ASC')
        .all();
      const valueRows = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profile_variable_values'")
        .get()
        ? this.db.prepare(`
            SELECT profile_id, variable_key, value
            FROM profile_variable_values
            ORDER BY variable_key ASC
          `).all()
        : [];

      const valuesByProfileId = new Map();
      for (const row of valueRows) {
        if (!valuesByProfileId.has(row.profile_id)) {
          valuesByProfileId.set(row.profile_id, []);
        }
        valuesByProfileId.get(row.profile_id).push({
          key: row.variable_key,
          value: row.value ?? '',
        });
      }

      const insertProfile = this.db.prepare(`
        INSERT OR IGNORE INTO variable_profiles (id, name, variables_json, is_dirty, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const findByName = this.db.prepare('SELECT id FROM variable_profiles WHERE name = ?');

      for (const row of legacyProfiles) {
        let name = String(row.name || '').trim() || 'Profile';
        let suffix = 1;
        while (findByName.get(name) && findByName.get(name).id !== row.id) {
          suffix += 1;
          name = `${String(row.name || 'Profile').trim()} (${suffix})`;
        }
        const variablesJson = serializeVariableEntries(valuesByProfileId.get(row.id) || []);
        insertProfile.run(row.id, name, variablesJson, row.is_dirty ?? 1, row.updated_at);
      }

      this.db.exec('DROP TABLE IF EXISTS profile_variable_values');
      this.db.exec('DROP TABLE IF EXISTS data_profiles');
    } else {
      this.db.exec('DROP TABLE IF EXISTS profile_variable_values');
    }
  }

  _seedSystemFacebookVariableProfiles() {
    const now = new Date().toISOString();
    const insertProfile = this.db.prepare(`
      INSERT OR IGNORE INTO variable_profiles (id, name, variables_json, is_system, is_dirty, updated_at)
      VALUES (?, ?, ?, 1, 0, ?)
    `);
    const updateProfile = this.db.prepare(`
      UPDATE variable_profiles
      SET name = ?, variables_json = ?, is_system = 1, updated_at = ?
      WHERE id = ?
    `);

    for (const profile of SYSTEM_FACEBOOK_VARIABLE_PROFILES) {
      const variablesJson = serializeTemplateKeys(profile.keys.map((key) => ({ key })));
      insertProfile.run(profile.id, profile.name, variablesJson, now);
      updateProfile.run(profile.name, variablesJson, now, profile.id);
    }
  }

  syncFacebookCrawlScenarioBindings(settings = {}) {
    const groupScenarioId = String(settings[FACEBOOK_CRAWL_SETTINGS.groupScenarioId] || '').trim();

    if (groupScenarioId) {
      this.setScenarioVariableProfileId(groupScenarioId, FACEBOOK_CRAWL_GROUP_PROFILE_ID);
    }
  }

  _migrateLocalVariablesAndSamples() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS variable_profile_samples (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL,
        name         TEXT NOT NULL,
        values_json  TEXT NOT NULL DEFAULT '[]',
        is_dirty     INTEGER NOT NULL DEFAULT 1,
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(profile_id, name),
        FOREIGN KEY (profile_id) REFERENCES variable_profiles(id) ON DELETE CASCADE
      );
    `);

    const scenariosTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios'")
      .get();
    if (!scenariosTable) return;

    const scenarioColumns = this.db.prepare('PRAGMA table_info(scenarios)').all();
    if (!scenarioColumns.some((col) => col.name === 'local_variables')) {
      this.db.exec("ALTER TABLE scenarios ADD COLUMN local_variables TEXT NOT NULL DEFAULT '[]'");
    }

    const scenarioVarsTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenario_variables'")
      .get();

    if (scenarioVarsTable) {
      const scenarios = this.db.prepare('SELECT id, local_variables FROM scenarios').all();
      const varsByScenario = this.db
        .prepare('SELECT scenario_id, key, value FROM scenario_variables ORDER BY key ASC')
        .all();

      const grouped = new Map();
      for (const row of varsByScenario) {
        if (!grouped.has(row.scenario_id)) grouped.set(row.scenario_id, []);
        grouped.get(row.scenario_id).push({ key: row.key, value: row.value ?? '' });
      }

      const updateLocal = this.db.prepare(`
        UPDATE scenarios SET local_variables = ?, is_dirty = 1 WHERE id = ?
      `);

      for (const scenario of scenarios) {
        const existing = normalizeVariableEntries(scenario.local_variables);
        if (existing.length > 0) continue;
        const migrated = grouped.get(scenario.id) || [];
        if (migrated.length) {
          updateLocal.run(serializeVariableEntries(migrated), scenario.id);
        }
      }
    }

    const profiles = this.db
      .prepare('SELECT id, variables_json FROM variable_profiles')
      .all();

    const updateTemplate = this.db.prepare(`
      UPDATE variable_profiles
      SET variables_json = ?, is_dirty = 1, updated_at = ?
      WHERE id = ?
    `);
    const findSample = this.db.prepare(`
      SELECT id FROM variable_profile_samples WHERE profile_id = ? AND name = ?
    `);
    const insertSample = this.db.prepare(`
      INSERT INTO variable_profile_samples (id, profile_id, name, values_json, is_dirty, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);

    const now = new Date().toISOString();
    for (const profile of profiles) {
      const entries = normalizeVariableEntries(profile.variables_json);
      const hasValues = entries.some((item) => item.value != null && item.value !== '');
      const keysOnly = entries.map((item) => ({ key: item.key }));

      if (hasValues && !findSample.get(profile.id, 'Default')) {
        insertSample.run(
          crypto.randomUUID(),
          profile.id,
          'Default',
          serializeVariableEntries(entries),
          now,
        );
      }

      updateTemplate.run(serializeTemplateKeys(keysOnly), now, profile.id);
    }
  }

  _migrateExecutionLogsProfileColumns() {
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='execution_logs'")
      .get();
    if (!table) return;

    const columns = this.db.prepare('PRAGMA table_info(execution_logs)').all();
    if (!columns.some((col) => col.name === 'variable_profile_id')) {
      this.db.exec('ALTER TABLE execution_logs ADD COLUMN variable_profile_id TEXT');
    }
    if (!columns.some((col) => col.name === 'variable_profile_name')) {
      this.db.exec('ALTER TABLE execution_logs ADD COLUMN variable_profile_name TEXT');
    }
    if (!columns.some((col) => col.name === 'variable_sample_id')) {
      this.db.exec('ALTER TABLE execution_logs ADD COLUMN variable_sample_id TEXT');
    }
    if (!columns.some((col) => col.name === 'variable_sample_name')) {
      this.db.exec('ALTER TABLE execution_logs ADD COLUMN variable_sample_name TEXT');
    }
    if (!columns.some((col) => col.name === 'result_json')) {
      this.db.exec('ALTER TABLE execution_logs ADD COLUMN result_json TEXT');
    }
  }

  initSchema() {
    if (!this.db) {
      throw new Error('[DatabaseService] Database chưa được mở. Gọi open() trước.');
    }

    // Migration: nếu schema cũ tồn tại, nâng cấp lên schema mới
    this._migrateSchema();

    // Transaction: đảm bảo tất cả bảng được tạo hoặc không bảng nào được tạo
    const createTables = this.db.transaction(() => {
      this.db.exec(`
        -- ============================================================
        -- Bảng proxies: quản lý danh sách proxy dùng cho automation
        -- ============================================================
        CREATE TABLE IF NOT EXISTS proxies (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          protocol      TEXT NOT NULL DEFAULT 'http',
          ip            TEXT NOT NULL,
          port          INTEGER NOT NULL,
          username      TEXT,
          password      TEXT,
          status        TEXT NOT NULL DEFAULT 'active',
          is_dirty      INTEGER NOT NULL DEFAULT 1,
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS browser_profiles (
          id                TEXT PRIMARY KEY,
          browser_key       TEXT NOT NULL,
          browser_name      TEXT NOT NULL,
          profile_name      TEXT NOT NULL,
          executable_path   TEXT NOT NULL,
          user_data_dir     TEXT NOT NULL,
          profile_dir_name  TEXT NOT NULL,
          display_name      TEXT NOT NULL,
          source            TEXT NOT NULL DEFAULT 'scan',
          status            TEXT NOT NULL DEFAULT 'active',
          last_scanned_at   TEXT,
          imported_at       TEXT,
          import_path       TEXT,
          facebook_id       TEXT,
          has_linkedin      INTEGER NOT NULL DEFAULT 0,
          account_detected_at TEXT,
          account_summary   TEXT,
          is_dirty          INTEGER NOT NULL DEFAULT 1,
          updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(browser_key, user_data_dir, profile_dir_name)
        );

        CREATE TABLE IF NOT EXISTS settings (
          option_name   TEXT PRIMARY KEY,
          option_value  TEXT,
          autoload      INTEGER NOT NULL DEFAULT 1,
          updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          description TEXT,
          flow_data   TEXT,
          is_active   INTEGER NOT NULL DEFAULT 1,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- ============================================================
        -- Bảng scenarios: kịch bản tự động hóa
        -- Lưu thông tin viewport gốc để chuyển đổi tọa độ sau này
        -- ============================================================
        CREATE TABLE IF NOT EXISTS scenarios (
          id                  TEXT PRIMARY KEY,
          name                TEXT NOT NULL,
          description         TEXT,
          platform            TEXT DEFAULT 'custom',
          target_url          TEXT,
          recorded_width      INTEGER,
          recorded_height     INTEGER,
          device_pixel_ratio  REAL DEFAULT 1.0,
          preview_path        TEXT,
          preview_manifest_path TEXT,
          preview_duration_ms INTEGER,
          preview_trim_ranges TEXT DEFAULT '[]',
          browser_profile_id TEXT,
          variable_profile_id TEXT,
          local_variables     TEXT NOT NULL DEFAULT '[]',
          scenario_type       TEXT NOT NULL DEFAULT 'action',
          result_type         TEXT NOT NULL DEFAULT 'simple',
          parent_id           TEXT REFERENCES scenarios(id) ON DELETE SET NULL,
          dom_check_anchor    TEXT,
          is_pinned           INTEGER NOT NULL DEFAULT 0,
          is_dirty            INTEGER NOT NULL DEFAULT 1,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scenario_variables (
          id          TEXT PRIMARY KEY,
          scenario_id TEXT NOT NULL,
          key         TEXT NOT NULL,
          value       TEXT,
          UNIQUE(scenario_id, key),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scenarios_meta (
          id          TEXT PRIMARY KEY,
          scenario_id TEXT NOT NULL,
          meta_key    TEXT NOT NULL,
          meta_value  TEXT,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(scenario_id, meta_key),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS variable_profiles (
          id             TEXT PRIMARY KEY,
          name           TEXT NOT NULL UNIQUE,
          variables_json TEXT NOT NULL DEFAULT '[]',
          is_system      INTEGER NOT NULL DEFAULT 0,
          is_dirty       INTEGER NOT NULL DEFAULT 1,
          updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS variable_profile_samples (
          id           TEXT PRIMARY KEY,
          profile_id   TEXT NOT NULL,
          name         TEXT NOT NULL,
          values_json  TEXT NOT NULL DEFAULT '[]',
          is_dirty     INTEGER NOT NULL DEFAULT 1,
          updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(profile_id, name),
          FOREIGN KEY (profile_id) REFERENCES variable_profiles(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- Bảng scenario_steps: các bước hành động trong kịch bản
        -- target_anchor là JSON object chứa thông tin mỏ neo bất biến
        -- (semantic anchor: aria-label, placeholder, role, v.v.)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS scenario_steps (
          id            TEXT PRIMARY KEY,
          scenario_id   TEXT NOT NULL,
          step_order    INTEGER NOT NULL,
          action_type   TEXT NOT NULL,
          target_anchor TEXT,
          delay_ms      INTEGER DEFAULT 300,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS scenario_step_frames (
          id                 TEXT PRIMARY KEY,
          scenario_id        TEXT NOT NULL,
          step_id            TEXT NOT NULL,
          frame_path         TEXT NOT NULL,
          frame_name         TEXT,
          frame_timestamp_ms INTEGER,
          role               TEXT NOT NULL DEFAULT 'associated',
          created_at         TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(step_id, frame_path, role),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
          FOREIGN KEY (step_id) REFERENCES scenario_steps(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- Bảng campaigns: chiến dịch thực thi tự động
        -- Một campaign chạy một kịch bản (scenario) theo lịch trình
        -- ============================================================
        CREATE TABLE IF NOT EXISTS campaigns (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          scenario_id   TEXT NOT NULL,
          status        TEXT NOT NULL DEFAULT 'draft',
          scheduled_at  TEXT,
          is_dirty      INTEGER NOT NULL DEFAULT 1,
          updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- Bảng campaign_profiles: gán profile vào chiến dịch
        -- Một campaign có thể chạy trên nhiều profile khác nhau
        -- ============================================================
        CREATE TABLE IF NOT EXISTS campaign_profiles (
          id          TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          profile_ref TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending',
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
        );

        -- ============================================================
        -- Bảng execution_errors: log lỗi chi tiết khi thực thi
        -- object_id và object_type cho biết đối tượng gây lỗi
        -- (scenario, step, profile, campaign, v.v.)
        -- ============================================================
        CREATE TABLE IF NOT EXISTS execution_errors (
          id          TEXT PRIMARY KEY,
          step_id     TEXT,
          object_id   TEXT NOT NULL,
          object_type TEXT NOT NULL,
          error_code  TEXT,
          message     TEXT,
          screenshot  TEXT,
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (step_id) REFERENCES scenario_steps(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS execution_logs (
          id                    TEXT PRIMARY KEY,
          scenario_id           TEXT NOT NULL,
          scenario_name         TEXT,
          browser_profile_id    TEXT,
          variable_profile_id   TEXT,
          variable_profile_name TEXT,
          variable_sample_id    TEXT,
          variable_sample_name  TEXT,
          status                TEXT NOT NULL DEFAULT 'running',
          total_steps         INTEGER NOT NULL DEFAULT 0,
          completed_steps     INTEGER NOT NULL DEFAULT 0,
          failed_steps        INTEGER NOT NULL DEFAULT 0,
          failed_step_index   INTEGER,
          error_message       TEXT,
          result_json         TEXT,
          duration_ms         INTEGER,
          started_at          TEXT NOT NULL,
          finished_at         TEXT,
          is_dirty            INTEGER NOT NULL DEFAULT 1,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );
      `);
    });

    createTables();
    this._migrateScenarioColumnsToMeta();
    console.log('[DatabaseService] Schema đã được khởi tạo thành công');
  }

  /**
   * Lưu hoặc cập nhật một Scenario và danh sách Steps trong cùng một transaction.
   *
   * Hành vi:
   * - Nếu scenario đã tồn tại (có id): UPDATE scenario, DELETE steps cũ, INSERT steps mới.
   * - Nếu scenario chưa tồn tại: INSERT scenario và INSERT steps.
   * - Toàn bộ thao tác được bọc trong transaction để đảm bảo tính nguyên tử.
   *
   * @param {Object} scenario - Thông tin scenario.
   *   Các trường: { id?, name, target_url?, recorded_width?, recorded_height?, device_pixel_ratio? }
   * @param {Array<Object>} steps - Danh sách các bước.
   *   Mỗi bước: { id?, action_type, target_anchor?, delay_ms? }
   *   Trong đó target_anchor là object (sẽ được JSON.stringify khi ghi DB).
   * @returns {Object} Scenario đã lưu kèm danh sách steps.
   */
  saveScenario(scenario, steps = []) {
    if (!this.db) {
      throw new Error('[DatabaseService] Database chưa được mở. Gọi open() trước.');
    }

    const now = new Date().toISOString();
    const scenarioId = scenario.id || crypto.randomUUID();
    const existingScenario = scenario.id
      ? this.db.prepare('SELECT * FROM scenarios WHERE id = ?').get(scenario.id)
      : null;
    const isNew = !existingScenario;

    // Prepared statements để tối ưu hiệu năng
    const scenarioType = normalizeScenarioType(scenario.scenario_type ?? existingScenario?.scenario_type);
    const parentId = normalizeScenarioParentId(scenarioType, scenario.parent_id ?? existingScenario?.parent_id);
    const scenarioMeta = buildScenarioMetaForStorage(
      scenario,
      existingScenario,
      existingScenario ? this.getScenarioMeta(scenarioId) : {},
    );

    const upsertScenario = isNew
      ? this.db.prepare(`
          INSERT INTO scenarios (
            id, name, description, platform, target_url,
            device_pixel_ratio,
            preview_path, preview_manifest_path, preview_duration_ms, preview_trim_ranges,
            browser_profile_id,
            scenario_type, parent_id,
            is_dirty, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `)
      : this.db.prepare(`
          UPDATE scenarios
          SET name = ?, description = ?, platform = ?, target_url = ?,
              device_pixel_ratio = ?,
              preview_path = ?, preview_manifest_path = ?, preview_duration_ms = ?,
              preview_trim_ranges = ?,
              browser_profile_id = ?,
              scenario_type = ?, parent_id = ?,
              is_dirty = 1, updated_at = ?
          WHERE id = ?
        `);

    const deleteSteps = this.db.prepare(
      'DELETE FROM scenario_steps WHERE scenario_id = ?'
    );

    const insertStep = this.db.prepare(`
      INSERT INTO scenario_steps (id, scenario_id, step_order, action_type, target_anchor, delay_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const replaceScenarioMeta = this._replaceScenarioMetaStatement();

    const previousFramePaths = new Set(
      this.db
        .prepare('SELECT frame_path FROM scenario_step_frames WHERE scenario_id = ?')
        .all(scenarioId)
        .map((row) => row.frame_path)
        .filter(Boolean)
    );
    const nextFramePaths = new Set();

    const deleteStepFrames = this.db.prepare(
      'DELETE FROM scenario_step_frames WHERE scenario_id = ?'
    );

    const insertStepFrame = this.db.prepare(`
      INSERT INTO scenario_step_frames (
        id, scenario_id, step_id, frame_path, frame_name, frame_timestamp_ms, role, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(step_id, frame_path, role) DO UPDATE SET
        frame_name = excluded.frame_name,
        frame_timestamp_ms = excluded.frame_timestamp_ms
    `);

    // Transaction: đảm bảo tính nguyên tử — hoặc tất cả thành công hoặc rollback toàn bộ
    const saveTransaction = this.db.transaction(() => {
      if (isNew) {
        // INSERT scenario mới
        upsertScenario.run(
          scenarioId,
          scenario.name || 'Kịch bản mới',
          scenario.description || null,
          scenario.platform || 'custom',
          scenario.target_url || null,
          scenario.device_pixel_ratio || 1.0,
          scenario.preview_path ?? null,
          scenario.preview_manifest_path ?? null,
          scenario.preview_duration_ms ?? null,
          JSON.stringify(parseJsonArray(scenario.preview_trim_ranges)),
          scenario.browser_profile_id ?? null,
          scenarioType,
          parentId,
          now
        );
      } else {
        // UPDATE scenario đã tồn tại
        upsertScenario.run(
          scenario.name || 'Kịch bản mới',
          scenario.description || null,
          scenario.platform || 'custom',
          scenario.target_url || null,
          scenario.device_pixel_ratio || 1.0,
          scenario.preview_path !== undefined ? scenario.preview_path : existingScenario.preview_path,
          scenario.preview_manifest_path !== undefined ? scenario.preview_manifest_path : existingScenario.preview_manifest_path,
          scenario.preview_duration_ms !== undefined ? scenario.preview_duration_ms : existingScenario.preview_duration_ms,
          scenario.preview_trim_ranges !== undefined
            ? JSON.stringify(parseJsonArray(scenario.preview_trim_ranges))
            : existingScenario.preview_trim_ranges || '[]',
          scenario.browser_profile_id !== undefined
            ? scenario.browser_profile_id
            : existingScenario.browser_profile_id || null,
          scenario.scenario_type !== undefined
            ? normalizeScenarioType(scenario.scenario_type)
            : normalizeScenarioType(existingScenario.scenario_type),
          scenario.parent_id !== undefined
            ? normalizeScenarioParentId(
              scenario.scenario_type !== undefined
                ? normalizeScenarioType(scenario.scenario_type)
                : normalizeScenarioType(existingScenario.scenario_type),
              scenario.parent_id,
            )
            : normalizeScenarioParentId(
              normalizeScenarioType(existingScenario.scenario_type),
              existingScenario.parent_id,
            ),
          now,
          scenarioId
        );
      }

      // Xóa steps cũ và thêm steps mới (thay thế toàn bộ)
      deleteStepFrames.run(scenarioId);
      deleteSteps.run(scenarioId);

      steps.forEach((step, index) => {
        const stepId = step.id || crypto.randomUUID();
        const targetAnchor = step.target_anchor ? parseJsonObject(step.target_anchor) : null;
        const delayMs = Number(step.delay_ms) || 300;
        insertStep.run(
          stepId,
          scenarioId,
          index + 1,
          step.action_type,
          // target_anchor là object — serialize thành JSON string khi ghi DB
          targetAnchor ? JSON.stringify(targetAnchor) : null,
          delayMs,
          now
        );

        const framePath = targetAnchor?.associated_frame;
        if (framePath) {
          nextFramePaths.add(framePath);
          insertStepFrame.run(
            crypto.randomUUID(),
            scenarioId,
            stepId,
            framePath,
            targetAnchor.associated_frame_name || path.basename(framePath),
            Number(targetAnchor.time_offset) || null,
            'associated',
            now
          );
        }
      });

      replaceScenarioMeta(scenarioId, scenarioMeta);
    });

    saveTransaction();
    this._deleteOrphanedScenarioFrames(previousFramePaths, nextFramePaths);

    if (Array.isArray(scenario.preview_manifest_frames)) {
      const manifestPath = scenario.preview_manifest_path || existingScenario?.preview_manifest_path;
      if (manifestPath) {
        // Refuse to clobber an existing non-empty preview with an empty frame list
        // from metadata-only UI saves (e.g. persist-before-record).
        const incomingEmpty = scenario.preview_manifest_frames.length === 0;
        const existingFrames = incomingEmpty ? readPreviewFrames(manifestPath) : [];
        if (!(incomingEmpty && existingFrames.length > 0)) {
          const durationMs = scenario.preview_duration_ms != null
            ? Number(scenario.preview_duration_ms)
            : (scenario.preview_manifest_frames.length
              ? Math.max(...scenario.preview_manifest_frames.map((frame) => Number(frame.time) || 0))
              : 0);
          this.writePreviewManifest(manifestPath, scenario.preview_manifest_frames, durationMs);
        }
      }
    }

    // Trả về dữ liệu đã lưu với steps đã được deserialize
    return this.getScenarioById(scenarioId);
  }

  writePreviewManifest(manifestPath, frames = [], durationMs = 0) {
    if (!manifestPath) return null;

    const manifest = {
      durationMs: Math.max(0, Number(durationMs) || 0),
      frameCount: frames.length,
      frames: frames.map((frame) => ({
        timestamp: Number(frame.time) || 0,
        fileName: frame.name || (frame.path ? path.basename(frame.path) : null),
        filePath: frame.path || null,
        fileUrl: frame.path ? toCacheUrl(frame.path) : frame.url || null,
      })).filter((frame) => frame.filePath),
      createdAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      return manifestPath;
    } catch (error) {
      console.warn(`[DatabaseService] Khong ghi duoc preview manifest: ${manifestPath} - ${error.message}`);
      return null;
    }
  }

  /**
   * Lấy chi tiết một scenario kèm danh sách steps.
   * Steps được sắp xếp theo step_order và target_anchor được parse từ JSON string.
   *
   * @param {string} id - UUID của scenario.
   * @returns {Object|null} Scenario object với trường `steps`, hoặc null nếu không tìm thấy.
   */
  getScenarioById(id) {
    const scenario = this.db
      .prepare('SELECT * FROM scenarios WHERE id = ?')
      .get(id);

    if (!scenario) return null;

    const steps = this.db
      .prepare('SELECT * FROM scenario_steps WHERE scenario_id = ? ORDER BY step_order ASC')
      .all(id);

    const frameRows = this.db
      .prepare('SELECT * FROM scenario_step_frames WHERE scenario_id = ? ORDER BY created_at ASC')
      .all(id);
    const frameByStepId = new Map();
    for (const row of frameRows) {
      if (!frameByStepId.has(row.step_id)) {
        frameByStepId.set(row.step_id, row);
      }
    }

    // Deserialize target_anchor từ JSON string về object
    const stepsDeserialized = steps.map((step) => {
      const targetAnchor = step.target_anchor ? parseJsonObject(step.target_anchor) : {};
      const mappedFrame = frameByStepId.get(step.id);
      if (mappedFrame?.frame_path) {
        targetAnchor.associated_frame = mappedFrame.frame_path;
        targetAnchor.associated_frame_name = mappedFrame.frame_name || path.basename(mappedFrame.frame_path);
        if (mappedFrame.frame_timestamp_ms !== null && mappedFrame.frame_timestamp_ms !== undefined) {
          targetAnchor.time_offset = mappedFrame.frame_timestamp_ms;
        }
      }
      if (targetAnchor?.associated_frame) {
        targetAnchor.associated_frame_url = toCacheUrl(targetAnchor.associated_frame);
      }
      return {
        ...step,
        target_anchor: targetAnchor,
      };
    });

    const scenarioMeta = this.getScenarioMeta(id);

    return {
      ...scenario,
      scenario_type: normalizeScenarioType(scenario.scenario_type),
      result_type: normalizeScenarioResultType(scenarioMeta.result_type ?? scenario.result_type),
      recorded_width: Number(scenarioMeta.recorded_width ?? scenario.recorded_width) || null,
      recorded_height: Number(scenarioMeta.recorded_height ?? scenario.recorded_height) || null,
      variable_profile_id: scenarioMeta.variable_profile_id ?? scenario.variable_profile_id ?? null,
      scenario_meta: scenarioMeta,
      parent_id: scenario.parent_id || null,
      dom_check_anchor: parseDomCheckAnchor(scenarioMeta.dom_check_anchor ?? scenario.dom_check_anchor),
      preview_trim_ranges: parseJsonArray(scenario.preview_trim_ranges),
      preview_url: scenario.preview_path ? toCacheUrl(scenario.preview_path) : null,
      preview_frames: readPreviewFrames(scenario.preview_manifest_path),
      steps: stepsDeserialized,
    };
  }

  getScenarioVariables(scenarioId) {
    return this.getScenarioLocalVariables(scenarioId);
  }

  getScenarioLocalVariables(scenarioId) {
    const existing = this.db.prepare('SELECT id FROM scenarios WHERE id = ?').get(scenarioId);
    if (!existing) return [];

    return normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables).map((item, index) => ({
      id: `${scenarioId}:${item.key}:${index}`,
      scenario_id: scenarioId,
      key: item.key,
      value: item.value ?? '',
      value_type: item.value_type === 'file' ? 'file' : 'text',
    }));
  }

  saveScenarioLocalVariables(scenarioId, variables = []) {
    if (!scenarioId) {
      throw new Error('scenario_id is required.');
    }

    const existing = this.db.prepare('SELECT id FROM scenarios WHERE id = ?').get(scenarioId);
    if (!existing) {
      throw new Error('Khong tim thay kich ban de luu bien.');
    }

    const now = new Date().toISOString();
    const json = serializeVariableEntries(variables);

    this.setScenarioMetaValue(scenarioId, 'local_variables', json);
    const hasLocalVariablesColumn = this.db
      .prepare('PRAGMA table_info(scenarios)')
      .all()
      .some((col) => col.name === 'local_variables');
    if (hasLocalVariablesColumn) {
      this.db.prepare(`
        UPDATE scenarios
        SET local_variables = ?, is_dirty = 1, updated_at = ?
        WHERE id = ?
      `).run(json, now, scenarioId);
    } else {
      this.db.prepare(`
        UPDATE scenarios
        SET is_dirty = 1, updated_at = ?
        WHERE id = ?
      `).run(now, scenarioId);
    }

    return this.getScenarioLocalVariables(scenarioId);
  }

  saveScenarioVariable(variable) {
    const scenarioId = variable.scenario_id;
    const key = String(variable.key || variable.name || '').trim();
    const value = variable.value ?? '';

    if (!scenarioId || !key) {
      throw new Error('scenario_id and key are required.');
    }

    const current = normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables);
    const oldKeyFromId = variable.id
      ? String(variable.id).split(':').slice(1, -1).join(':') || null
      : null;
    const index = current.findIndex((item) => item.key === (oldKeyFromId || key));
    if (index >= 0) {
      if (oldKeyFromId && oldKeyFromId !== key) {
        this._renameVariableProfileKeys(oldKeyFromId, key);
      }
      current[index] = {
        key,
        value,
        value_type: variable.value_type === 'file' ? 'file' : 'text',
      };
    } else {
      current.push({
        key,
        value,
        value_type: variable.value_type === 'file' ? 'file' : 'text',
      });
    }

    return this.saveScenarioLocalVariables(scenarioId, current)
      .find((item) => item.key === key);
  }

  deleteScenarioVariable(id) {
    if (!id) return { success: true, id };

    const parts = String(id).split(':');
    if (parts.length < 2) {
      return { success: true, id };
    }

    const scenarioId = parts[0];
    const key = parts.slice(1, -1).join(':') || parts[1];
    const current = normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables);
    const next = current.filter((item) => item.key !== key);
    this.saveScenarioLocalVariables(scenarioId, next);
    return { success: true, id };
  }

  _renameVariableProfileKeys(oldKey, newKey) {
    const profiles = this.db
      .prepare('SELECT id, variables_json FROM variable_profiles')
      .all();

    const updateTemplate = this.db.prepare(`
      UPDATE variable_profiles
      SET variables_json = ?, is_dirty = 1, updated_at = ?
      WHERE id = ?
    `);

    const samples = this.db
      .prepare('SELECT id, values_json FROM variable_profile_samples')
      .all();

    const updateSample = this.db.prepare(`
      UPDATE variable_profile_samples
      SET values_json = ?, is_dirty = 1, updated_at = ?
      WHERE id = ?
    `);

    const now = new Date().toISOString();
    for (const profile of profiles) {
      const keys = normalizeTemplateKeys(profile.variables_json).map((item) => ({
        key: item.key === oldKey ? newKey : item.key,
      }));
      updateTemplate.run(serializeTemplateKeys(keys), now, profile.id);
    }

    for (const sample of samples) {
      const entries = normalizeVariableEntries(sample.values_json).map((item) => ({
        key: item.key === oldKey ? newKey : item.key,
        value: item.value,
      }));
      updateSample.run(serializeVariableEntries(entries), now, sample.id);
    }
  }

  _mergeTemplateKeysIntoLocalVariables(scenarioId, templateKeys = []) {
    const currentMap = new Map(
      normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables).map((item) => [item.key, item.value ?? '']),
    );

    return normalizeTemplateKeys(templateKeys).map((item) => ({
      key: item.key,
      value: currentMap.get(item.key) ?? '',
    }));
  }

  getVariableProfiles() {
    return this.db
      .prepare(`
        SELECT id, name, variables_json, is_system, updated_at
        FROM variable_profiles
        ORDER BY is_system DESC, name ASC
      `)
      .all()
      .map((profile) => ({
        id: profile.id,
        name: profile.name,
        updated_at: profile.updated_at,
        is_system: Boolean(profile.is_system),
        keys: normalizeTemplateKeys(profile.variables_json).map((item) => item.key),
        variables: normalizeTemplateKeys(profile.variables_json),
      }));
  }

  getVariableProfileById(profileId) {
    const profile = this.db
      .prepare('SELECT id, name, variables_json, is_system, updated_at FROM variable_profiles WHERE id = ?')
      .get(profileId);
    if (!profile) return null;

    const keys = normalizeTemplateKeys(profile.variables_json);
    return {
      id: profile.id,
      name: profile.name,
      updated_at: profile.updated_at,
      is_system: Boolean(profile.is_system),
      keys: keys.map((item) => item.key),
      variables: keys,
    };
  }

  saveVariableProfile(profile) {
    const id = profile.id || crypto.randomUUID();
    const name = String(profile.name || '').trim();
    const now = new Date().toISOString();
    const existingById = profile.id
      ? this.db.prepare('SELECT id, name, variables_json, is_system FROM variable_profiles WHERE id = ?').get(profile.id)
      : null;
    const isSystemProfile = Boolean(existingById?.is_system) || isSystemVariableProfile(id);

    if (isSystemProfile) {
      throw new Error('Khong the chinh sua ho so bien he thong.');
    }

    const hasKeys = Array.isArray(profile.keys)
      || Array.isArray(profile.variables)
      || Array.isArray(profile.values);
    const variablesJson = hasKeys
      ? serializeTemplateKeys(profile.keys || profile.variables || profile.values)
      : null;

    if (!name) {
      throw new Error('Profile name is required.');
    }

    const existingByName = this.db
      .prepare('SELECT id FROM variable_profiles WHERE name = ?')
      .get(name);

    if (profile.id && existingById) {
      if (existingByName && existingByName.id !== profile.id) {
        throw new Error('Da ton tai ho so voi ten nay.');
      }

      this.db.prepare(`
        UPDATE variable_profiles
        SET name = ?,
            variables_json = COALESCE(?, variables_json),
            is_dirty = 1,
            updated_at = ?
        WHERE id = ?
      `).run(name, variablesJson, now, profile.id);

      return this.getVariableProfileById(profile.id);
    }

    if (existingByName) {
      throw new Error('Da ton tai ho so voi ten nay.');
    }

    this.db.prepare(`
      INSERT INTO variable_profiles (id, name, variables_json, is_dirty, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(id, name, variablesJson || '[]', now);

    return this.getVariableProfileById(id);
  }

  saveVariableProfileQuick({ name, keys = [] }) {
    const normalizedKeys = (Array.isArray(keys) ? keys : [])
      .map((item) => (typeof item === 'string' ? item : item?.key || item?.variable_key || ''))
      .map((key) => String(key).trim())
      .filter(Boolean);

    if (!normalizedKeys.length) {
      throw new Error('Can it nhat mot key de luu template.');
    }

    return this.saveVariableProfile({
      name,
      keys: normalizedKeys.map((key) => ({ key })),
    });
  }

  deleteVariableProfile(id) {
    if (isSystemVariableProfile(id)) {
      throw new Error('Khong the xoa ho so bien he thong.');
    }

    this.db.prepare(`
      UPDATE scenarios_meta
      SET meta_value = NULL, updated_at = ?
      WHERE meta_key = 'variable_profile_id' AND meta_value = ?
    `).run(new Date().toISOString(), id);
    this.db.prepare('DELETE FROM variable_profiles WHERE id = ?').run(id);
    return { success: true, id };
  }

  getVariableProfileSamples(profileId = null) {
    if (profileId) {
      return this.db
        .prepare(`
          SELECT s.id, s.profile_id, s.name, s.values_json, s.updated_at, p.name AS profile_name
          FROM variable_profile_samples s
          JOIN variable_profiles p ON p.id = s.profile_id
          WHERE s.profile_id = ?
          ORDER BY s.name ASC
        `)
        .all(profileId)
        .map((row) => this._mapVariableProfileSample(row));
    }

    return this.db
      .prepare(`
        SELECT s.id, s.profile_id, s.name, s.values_json, s.updated_at, p.name AS profile_name
        FROM variable_profile_samples s
        JOIN variable_profiles p ON p.id = s.profile_id
        ORDER BY p.name ASC, s.name ASC
      `)
      .all()
      .map((row) => this._mapVariableProfileSample(row));
  }

  getVariableProfileSampleById(sampleId) {
    const row = this.db
      .prepare(`
        SELECT s.id, s.profile_id, s.name, s.values_json, s.updated_at, p.name AS profile_name
        FROM variable_profile_samples s
        JOIN variable_profiles p ON p.id = s.profile_id
        WHERE s.id = ?
      `)
      .get(sampleId);
    return row ? this._mapVariableProfileSample(row) : null;
  }

  _mapVariableProfileSample(row) {
    return {
      id: row.id,
      profile_id: row.profile_id,
      profile_name: row.profile_name,
      name: row.name,
      updated_at: row.updated_at,
      variables: normalizeVariableEntries(row.values_json),
      values: normalizeVariableEntries(row.values_json),
    };
  }

  saveVariableProfileSample(sample) {
    const id = sample.id || crypto.randomUUID();
    const profileId = sample.profile_id;
    const name = String(sample.name || '').trim();
    const now = new Date().toISOString();
    const valuesJson = serializeVariableEntries(sample.variables || sample.values || []);

    if (!profileId) {
      throw new Error('profile_id is required.');
    }
    if (!name) {
      throw new Error('Sample name is required.');
    }

    const profile = this.getVariableProfileById(profileId);
    if (!profile) {
      throw new Error('Khong tim thay template.');
    }

    this._validateSampleKeys(profile.keys, normalizeVariableEntries(valuesJson));

    const existingByName = this.db
      .prepare('SELECT id FROM variable_profile_samples WHERE profile_id = ? AND name = ?')
      .get(profileId, name);

    if (sample.id) {
      const existingById = this.db
        .prepare('SELECT id FROM variable_profile_samples WHERE id = ?')
        .get(sample.id);
      if (existingById) {
        if (existingByName && existingByName.id !== sample.id) {
          throw new Error('Da ton tai mau voi ten nay.');
        }
        this.db.prepare(`
          UPDATE variable_profile_samples
          SET name = ?, values_json = ?, is_dirty = 1, updated_at = ?
          WHERE id = ?
        `).run(name, valuesJson, now, sample.id);
        return this.getVariableProfileSampleById(sample.id);
      }
    }

    if (existingByName) {
      throw new Error('Da ton tai mau voi ten nay.');
    }

    this.db.prepare(`
      INSERT INTO variable_profile_samples (id, profile_id, name, values_json, is_dirty, updated_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, profileId, name, valuesJson, now);

    return this.getVariableProfileSampleById(id);
  }

  saveVariableProfileSampleQuick({ profileId, name, variables = [] }) {
    return this.saveVariableProfileSample({
      profile_id: profileId,
      name,
      variables,
    });
  }

  deleteVariableProfileSample(id) {
    this.db.prepare('DELETE FROM variable_profile_samples WHERE id = ?').run(id);
    return { success: true, id };
  }

  _validateSampleKeys(templateKeys = [], sampleEntries = []) {
    const templateSet = new Set(templateKeys);
    const sampleSet = new Set(sampleEntries.map((item) => item.key));

    if (templateSet.size !== sampleSet.size) {
      throw new Error('Sample phai co cung tap key voi template.');
    }

    for (const key of templateSet) {
      if (!sampleSet.has(key)) {
        throw new Error(`Sample thieu key "${key}" cua template.`);
      }
    }
  }

  setScenarioVariableProfileId(scenarioId, profileId) {
    const normalizedProfileId = profileId ? String(profileId).trim() : null;
    const now = new Date().toISOString();

    const apply = this.db.transaction(() => {
      if (normalizedProfileId) {
        const profile = this.getVariableProfileById(normalizedProfileId);
        if (!profile) {
          throw new Error('Khong tim thay ho so bien.');
        }
        const merged = this._mergeTemplateKeysIntoLocalVariables(scenarioId, profile.variables);
        this.saveScenarioLocalVariables(scenarioId, merged);
      }

      this.setScenarioMetaValue(scenarioId, 'variable_profile_id', normalizedProfileId);
      this.db.prepare(`
        UPDATE scenarios
        SET is_dirty = 1, updated_at = ?
        WHERE id = ?
      `).run(now, scenarioId);
    });

    apply();
    return {
      scenario: this.getScenarioById(scenarioId),
      variables: this.getScenarioLocalVariables(scenarioId),
    };
  }

  parseLocalVariablesExportPayload(raw) {
    const text = typeof raw === 'string' ? raw.replace(/^\uFEFF/, '').trim() : raw;
    let parsed = text;
    if (typeof text === 'string') {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(`File JSON khong hop le: ${error.message}`);
      }
    }
    if (Array.isArray(parsed)) {
      return normalizeVariableEntries(parsed);
    }
    if (Array.isArray(parsed?.variables)) {
      return normalizeVariableEntries(parsed.variables);
    }
    throw new Error('File JSON khong hop le.');
  }

  exportLocalVariablesPayload(scenarioId) {
    const variables = normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables);
    return {
      version: 1,
      variables: variables.map(({ key, value }) => ({ key, value: value ?? '' })),
    };
  }

  importScenarioLocalVariables(scenarioId, rawPayload) {
    const variables = this.parseLocalVariablesExportPayload(rawPayload);
    this.saveScenarioLocalVariables(scenarioId, variables);
    return this.getScenarioLocalVariables(scenarioId);
  }

  _getScenarioStorageDir(scenarioId) {
    const settings = this.getSettings();
    const browserRoot = settings['browser.userDataDir'] || path.join(path.dirname(this.dbDir), 'browser-data');
    return path.join(browserRoot, 'storage', 'scenarios', scenarioId);
  }

  buildScenarioExportBundle(scenarioId) {
    const scenario = this.getScenarioById(scenarioId);
    if (!scenario) {
      throw new Error('Khong tim thay kich ban.');
    }

    const variables = normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables);

    const previewFrames = (scenario.preview_frames || []).map((frame) => ({
      name: frame.name || (frame.path ? path.basename(frame.path) : null),
      time: Number(frame.time) || 0,
      sourcePath: frame.path || null,
    })).filter((frame) => frame.name);

    const steps = (scenario.steps || []).map((step, index) => {
      const anchor = step.target_anchor ? { ...step.target_anchor } : null;
      if (anchor?.associated_frame) {
        const frameName = anchor.associated_frame_name || path.basename(anchor.associated_frame);
        anchor.associated_frame = frameName;
        anchor.associated_frame_name = frameName;
        delete anchor.associated_frame_url;
      }
      return {
        step_order: Number(step.step_order) || index + 1,
        action_type: step.action_type,
        delay_ms: Number(step.delay_ms) || 300,
        target_anchor: anchor,
      };
    });

    return {
      version: 1,
      kind: 'scenario',
      format: 'zip',
      exportedAt: new Date().toISOString(),
      scenario: {
        name: scenario.name,
        description: scenario.description,
        platform: scenario.platform,
        target_url: scenario.target_url,
        recorded_width: scenario.recorded_width,
        recorded_height: scenario.recorded_height,
        device_pixel_ratio: scenario.device_pixel_ratio,
        preview_duration_ms: scenario.preview_duration_ms,
        preview_trim_ranges: scenario.preview_trim_ranges || [],
        scenario_type: normalizeScenarioType(scenario.scenario_type),
        result_type: normalizeScenarioResultType(scenario.result_type),
        scenario_meta: scenario.scenario_meta || {},
        parent_id: scenario.parent_id || null,
        dom_check_anchor: parseDomCheckAnchor(scenario.dom_check_anchor),
        local_variables: variables.map(({ key, value }) => ({ key, value: value ?? '' })),
      },
      steps,
      preview: {
        durationMs: scenario.preview_duration_ms,
        trimRanges: scenario.preview_trim_ranges || [],
        frames: previewFrames.map(({ name, time }) => ({ name, time })),
      },
      _assets: previewFrames
        .filter((frame) => frame.sourcePath && fs.existsSync(frame.sourcePath))
        .map(({ name, sourcePath }) => ({ name, sourcePath })),
    };
  }

  parseScenarioImportPayload(raw) {
    const text = typeof raw === 'string' ? raw.replace(/^\uFEFF/, '').trim() : raw;
    let parsed = text;
    if (typeof text === 'string') {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        throw new Error(`File JSON khong hop le: ${error.message}`);
      }
    }

    if (parsed?.kind === 'scenario' || Array.isArray(parsed?.steps)) {
      return parsed;
    }

    if (Array.isArray(parsed) || Array.isArray(parsed?.variables)) {
      throw new Error('VARIABLES_ONLY_FILE');
    }

    throw new Error('File JSON khong phai dinh dang kich ban hop le.');
  }

  importScenarioBundle(rawPayload, assetsDir = '') {
    const parsed = this.parseScenarioImportPayload(rawPayload);
    const scenarioData = parsed.scenario || parsed;
    const newId = crypto.randomUUID();
    const storageDir = this._getScenarioStorageDir(newId);
    const framesDir = path.join(storageDir, 'frames');

    fs.mkdirSync(framesDir, { recursive: true });

    const framePathByName = new Map();
    for (const frame of parsed.preview?.frames || []) {
      const name = frame.name || frame.fileName;
      if (!name) continue;

      const candidates = [
        assetsDir ? path.join(assetsDir, 'frames', name) : null,
        assetsDir ? path.join(assetsDir, name) : null,
      ].filter(Boolean);

      const sourcePath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!sourcePath) continue;

      const destPath = path.join(framesDir, name);
      fs.copyFileSync(sourcePath, destPath);
      framePathByName.set(name, destPath);
    }

    const manifestFrames = (parsed.preview?.frames || [])
      .map((frame) => {
        const name = frame.name || frame.fileName;
        const filePath = framePathByName.get(name);
        if (!filePath) return null;
        return {
          name,
          time: Number(frame.time ?? frame.timestamp) || 0,
          path: filePath,
        };
      })
      .filter(Boolean);

    const durationMs = scenarioData.preview_duration_ms != null
      ? Number(scenarioData.preview_duration_ms)
      : (parsed.preview?.durationMs != null
        ? Number(parsed.preview.durationMs)
        : (manifestFrames.length
          ? Math.max(...manifestFrames.map((frame) => frame.time))
          : 0));

    const manifestPath = path.join(storageDir, 'preview.json');
    this.writePreviewManifest(manifestPath, manifestFrames, durationMs);

    const steps = (parsed.steps || []).map((step) => {
      const anchor = step.target_anchor ? { ...step.target_anchor } : null;
      if (anchor?.associated_frame) {
        const frameName = anchor.associated_frame_name || path.basename(String(anchor.associated_frame));
        const resolvedPath = framePathByName.get(frameName);
        if (resolvedPath) {
          anchor.associated_frame = resolvedPath;
          anchor.associated_frame_name = frameName;
        } else {
          delete anchor.associated_frame;
          delete anchor.associated_frame_name;
          delete anchor.associated_frame_url;
        }
      }
      return {
        action_type: step.action_type,
        delay_ms: Number(step.delay_ms) || 300,
        target_anchor: anchor,
      };
    });

    this.saveScenario({
      id: newId,
      name: scenarioData.name || 'Kich ban imported',
      description: scenarioData.description || null,
      platform: scenarioData.platform || 'custom',
      target_url: scenarioData.target_url || null,
      recorded_width: scenarioData.recorded_width || null,
      recorded_height: scenarioData.recorded_height || null,
      device_pixel_ratio: scenarioData.device_pixel_ratio || 1,
      preview_path: null,
      preview_manifest_path: manifestPath,
      preview_duration_ms: durationMs,
      preview_trim_ranges: scenarioData.preview_trim_ranges || parsed.preview?.trimRanges || [],
      preview_manifest_frames: manifestFrames,
      browser_profile_id: null,
      variable_profile_id: null,
      scenario_type: scenarioData.scenario_type,
      result_type: scenarioData.result_type,
      scenario_meta: scenarioData.scenario_meta || scenarioData.meta || {},
      parent_id: scenarioData.parent_id,
      dom_check_anchor: scenarioData.dom_check_anchor,
    }, steps);

    const variables = scenarioData.local_variables || parsed.variables;
    if (Array.isArray(variables) && variables.length) {
      this.saveScenarioLocalVariables(newId, variables);
    }

    return this.getScenarioById(newId);
  }

  buildVariableMap(scenarioId, sampleId = null) {
    const resolved = new Map(
      normalizeVariableEntries(this.getScenarioMeta(scenarioId).local_variables).map((item) => [item.key, item.value ?? '']),
    );

    const normalizedSampleId = sampleId ? String(sampleId).trim() : '';
    if (normalizedSampleId) {
      const sample = this.getVariableProfileSampleById(normalizedSampleId);
      if (sample?.variables?.length) {
        for (const item of sample.variables) {
          if (item.value != null && item.value !== '') {
            resolved.set(item.key, item.value);
          }
        }
      }
    } else {
      this._mergeVariableProfileSampleDefaults(scenarioId, resolved);
    }

    return resolved;
  }

  _mergeVariableProfileSampleDefaults(scenarioId, resolved) {
    const profileId = this.getScenarioMeta(scenarioId).variable_profile_id;
    if (!profileId) return;

    const samples = this.getVariableProfileSamples(profileId);
    if (!samples.length) return;

    const preferred = samples.find((sample) => sample.name === 'Default') || samples[0];
    for (const item of preferred.variables || []) {
      const key = String(item.key || '').trim();
      if (!key) continue;
      const value = item.value ?? '';
      if (value === '') continue;
      if (!resolved.has(key) || resolved.get(key) === '') {
        resolved.set(key, value);
      }
    }
  }

  buildResolvedVariables(scenarioId, sampleId = null) {
    const map = this.buildVariableMap(scenarioId, sampleId);
    return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
  }

  deleteScenario(id) {
    const scenario = this.db.prepare('SELECT is_pinned FROM scenarios WHERE id = ?').get(id);
    if (scenario?.is_pinned) {
      throw new Error('Pinned scenario must be unpinned before deleting.');
    }
    this.db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
    return { success: true, id };
  }

  setScenarioPinned(id, isPinned) {
    const scenario = this.db.prepare('SELECT id FROM scenarios WHERE id = ?').get(id);
    if (!scenario) {
      throw new Error('Scenario not found.');
    }
    this.db
      .prepare('UPDATE scenarios SET is_pinned = ?, is_dirty = 1, updated_at = ? WHERE id = ?')
      .run(isPinned ? 1 : 0, new Date().toISOString(), id);
    return { success: true, id, is_pinned: isPinned ? 1 : 0 };
  }

  getTasks() {
    return this.db
      .prepare('SELECT * FROM tasks ORDER BY datetime(updated_at) DESC')
      .all()
      .map((task) => ({
        ...task,
        flow_data: parseJsonObject(task.flow_data),
      }));
  }

  getTaskById(id) {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return task ? { ...task, flow_data: parseJsonObject(task.flow_data) } : null;
  }

  saveTask(task = {}) {
    const now = new Date().toISOString();
    const id = task.id || crypto.randomUUID();
    const existing = this.db.prepare('SELECT id, created_at FROM tasks WHERE id = ?').get(id);
    const flowData = serializeJsonValue(task.flow_data || { nodes: [], edges: [] });

    if (existing) {
      this.db.prepare(`
        UPDATE tasks
        SET name = ?, description = ?, flow_data = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        String(task.name || '').trim() || 'Task mới',
        task.description || null,
        flowData,
        task.is_active === 0 ? 0 : 1,
        now,
        id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO tasks (id, name, description, flow_data, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        String(task.name || '').trim() || 'Task mới',
        task.description || null,
        flowData,
        task.is_active === 0 ? 0 : 1,
        now,
        now,
      );
    }

    return this.getTaskById(id);
  }

  deleteTask(id) {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return { success: true, id };
  }

  // ============================================================
  // Proxy CRUD
  // ============================================================

  /**
   * Lấy danh sách tất cả proxy, sắp xếp theo updated_at mới nhất.
   * @returns {Array<Object>}
   */
  getProxies() {
    return this.db
      .prepare('SELECT * FROM proxies ORDER BY updated_at DESC')
      .all();
  }

  getProxyById(id) {
    if (!id) return null;
    return this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) || null;
  }

  /**
   * Lưu hoặc cập nhật một proxy.
   * Nếu proxy có id → UPDATE, nếu không → INSERT.
   * @param {Object} proxy - { id?, name, protocol, ip, port, username?, password?, status? }
   * @returns {Object} Proxy đã lưu.
   */
  saveProxy(proxy) {
    const now = new Date().toISOString();
    const isNew = !proxy.id;
    const id = proxy.id || crypto.randomUUID();

    if (isNew) {
      this.db
        .prepare(
          `INSERT INTO proxies (id, name, protocol, ip, port, username, password, status, is_dirty, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          id,
          proxy.name,
          proxy.protocol || 'http',
          proxy.ip,
          proxy.port,
          proxy.username || null,
          proxy.password || null,
          proxy.status || 'active',
          now
        );
    } else {
      this.db
        .prepare(
          `UPDATE proxies
           SET name = ?, protocol = ?, ip = ?, port = ?, username = ?,
               password = ?, status = ?, is_dirty = 1, updated_at = ?
           WHERE id = ?`
        )
        .run(
          proxy.name,
          proxy.protocol || 'http',
          proxy.ip,
          proxy.port,
          proxy.username || null,
          proxy.password || null,
          proxy.status || 'active',
          now,
          id
        );
    }

    return this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(id);
  }

  /**
   * Xóa một proxy theo ID.
   * Các profile có proxy_id = id sẽ được set NULL (ON DELETE SET NULL).
   * @param {string} id
   * @returns {{ success: boolean }}
   */
  deleteProxy(id) {
    this.db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
    return { success: true };
  }

  getBrowserProfiles() {
    return this.db
      .prepare('SELECT * FROM browser_profiles ORDER BY browser_name ASC, profile_name ASC')
      .all();
  }

  getMachineBrowserProfiles() {
    return this.db
      .prepare(`
        SELECT * FROM browser_profiles
        WHERE imported_at IS NULL
        ORDER BY browser_name ASC, profile_name ASC
      `)
      .all();
  }

  getImportedBrowserProfiles() {
    return this.db
      .prepare(`
        SELECT * FROM browser_profiles
        WHERE imported_at IS NOT NULL
        ORDER BY imported_at DESC
      `)
      .all();
  }

  updateBrowserProfileAccount(profileId, account = {}) {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE browser_profiles
        SET facebook_id = ?,
            has_linkedin = ?,
            account_detected_at = ?,
            account_summary = ?,
            is_dirty = 1,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        account.facebookId || null,
        account.hasLinkedIn ? 1 : 0,
        now,
        account.accountSummary || null,
        now,
        profileId,
      );

    return this.getBrowserProfileById(profileId);
  }

  updateBrowserProfileAccountSummary(profileId, accountSummary = '') {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE browser_profiles
        SET account_summary = ?,
            account_detected_at = COALESCE(account_detected_at, ?),
            is_dirty = 1,
            updated_at = ?
        WHERE id = ?
      `)
      .run(String(accountSummary || '').trim() || null, now, now, profileId);

    return this.getBrowserProfileById(profileId);
  }

  markBrowserProfileImported(profileId, importPath, importedAt = new Date().toISOString()) {
    this.db
      .prepare(`
        UPDATE browser_profiles
        SET imported_at = ?, import_path = ?, status = 'imported', is_dirty = 1, updated_at = ?
        WHERE id = ?
      `)
      .run(importedAt, importPath, importedAt, profileId);

    return this.getBrowserProfileById(profileId);
  }

  clearBrowserProfileImport(profileId) {
    this.db
      .prepare(`
        UPDATE browser_profiles
        SET imported_at = NULL, import_path = NULL, status = 'active', is_dirty = 1, updated_at = ?
        WHERE id = ?
      `)
      .run(new Date().toISOString(), profileId);

    return this.getBrowserProfileById(profileId);
  }

  getBrowserProfileById(id) {
    return this.db.prepare('SELECT * FROM browser_profiles WHERE id = ?').get(id);
  }

  getBrowserProfileByUserDataDir(userDataDir) {
    return this.db
      .prepare(`
        SELECT * FROM browser_profiles
        WHERE import_path = ? OR user_data_dir = ?
        ORDER BY imported_at DESC
        LIMIT 1
      `)
      .get(userDataDir, userDataDir);
  }

  saveBrowserProfile(profile) {
    const now = new Date().toISOString();
    const id = profile.id || crypto.randomUUID();
    const displayName = profile.display_name || `${profile.browser_name} - ${profile.profile_name}`;

    this.db
      .prepare(`
        INSERT INTO browser_profiles (
          id, browser_key, browser_name, profile_name, executable_path,
          user_data_dir, profile_dir_name, display_name, source, status,
          last_scanned_at, is_dirty, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(browser_key, user_data_dir, profile_dir_name)
        DO UPDATE SET
          browser_name = excluded.browser_name,
          profile_name = excluded.profile_name,
          executable_path = excluded.executable_path,
          display_name = excluded.display_name,
          source = excluded.source,
          status = excluded.status,
          is_dirty = 1,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        profile.browser_key,
        profile.browser_name,
        profile.profile_name,
        profile.executable_path,
        profile.user_data_dir,
        profile.profile_dir_name,
        displayName,
        profile.source || 'manual',
        profile.status || 'active',
        profile.last_scanned_at || null,
        now
      );

    return this.db
      .prepare(
        `SELECT * FROM browser_profiles
         WHERE browser_key = ? AND user_data_dir = ? AND profile_dir_name = ?`
      )
      .get(profile.browser_key, profile.user_data_dir, profile.profile_dir_name);
  }

  deleteBrowserProfile(id) {
    this.db.prepare('DELETE FROM browser_profiles WHERE id = ?').run(id);
    return { success: true };
  }

  upsertBrowserProfiles(browserProfiles = []) {
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO browser_profiles (
        id, browser_key, browser_name, profile_name, executable_path,
        user_data_dir, profile_dir_name, display_name, source, status,
        last_scanned_at, is_dirty, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(browser_key, user_data_dir, profile_dir_name)
      DO UPDATE SET
        browser_name = excluded.browser_name,
        profile_name = excluded.profile_name,
        executable_path = excluded.executable_path,
        display_name = excluded.display_name,
        source = excluded.source,
        status = excluded.status,
        last_scanned_at = excluded.last_scanned_at,
        is_dirty = 1,
        updated_at = excluded.updated_at
    `);

    const saveAll = this.db.transaction((items) => {
      const findExisting = this.db.prepare(`
        SELECT id, imported_at FROM browser_profiles
        WHERE browser_key = ? AND user_data_dir = ? AND profile_dir_name = ?
      `);

      for (const item of items) {
        const existing = findExisting.get(item.browser_key, item.user_data_dir, item.profile_dir_name);
        if (existing?.imported_at) continue;

        upsert.run(
          existing?.id || item.id || crypto.randomUUID(),
          item.browser_key,
          item.browser_name,
          item.profile_name,
          item.executable_path,
          item.user_data_dir,
          item.profile_dir_name,
          item.display_name,
          item.source || 'scan',
          item.status || 'active',
          item.last_scanned_at || now,
          now
        );
      }
    });

    saveAll(browserProfiles);
    return this.getBrowserProfiles();
  }

  getSettings() {
    const rows = this.db.prepare('SELECT option_name, option_value FROM settings').all();
    const settings = {};

    for (const row of rows) {
      try {
        settings[row.option_name] = row.option_value ? JSON.parse(row.option_value) : null;
      } catch {
        settings[row.option_name] = row.option_value;
      }
    }

    return settings;
  }

  saveSettings(settings = {}) {
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO settings (option_name, option_value, autoload, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(option_name)
      DO UPDATE SET option_value = excluded.option_value, autoload = 1, updated_at = excluded.updated_at
    `);

    const saveAll = this.db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsert.run(key, JSON.stringify(value), now);
      }
    });

    saveAll(Object.entries(settings));
    return this.getSettings();
  }

  _deleteOrphanedScenarioFrames(previousFramePaths, nextFramePaths) {
    for (const framePath of previousFramePaths) {
      if (!framePath || nextFramePaths.has(framePath)) continue;

      const stillUsed = this.db
        .prepare('SELECT COUNT(*) AS count FROM scenario_step_frames WHERE frame_path = ?')
        .get(framePath);

      if (stillUsed?.count > 0) continue;

      try {
        if (fs.existsSync(framePath)) {
          fs.unlinkSync(framePath);
        }
      } catch (error) {
        console.warn(`[DatabaseService] Khong xoa duoc frame orphan: ${framePath} - ${error.message}`);
      }
    }
  }

  createExecutionLog(log) {
    const now = new Date().toISOString();
    const id = log.id || crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO execution_logs (
        id, scenario_id, scenario_name, browser_profile_id,
        variable_profile_id, variable_profile_name,
        variable_sample_id, variable_sample_name,
        status, total_steps, completed_steps, failed_steps,
        failed_step_index, error_message, result_json, duration_ms,
        started_at, finished_at, is_dirty, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      log.scenario_id,
      log.scenario_name || null,
      log.browser_profile_id || null,
      log.variable_profile_id || null,
      log.variable_profile_name || null,
      log.variable_sample_id || null,
      log.variable_sample_name || null,
      log.status || 'running',
      log.total_steps || 0,
      log.completed_steps || 0,
      log.failed_steps || 0,
      log.failed_step_index ?? null,
      log.error_message || null,
      serializeJsonValue(log.result_json ?? log.result),
      log.duration_ms ?? null,
      log.started_at || now,
      log.finished_at || null,
      now,
    );

    return this.getExecutionLogById(id);
  }

  finishExecutionLog(id, patch = {}) {
    const now = new Date().toISOString();
    const existing = this.getExecutionLogById(id);
    if (!existing) {
      return this.createExecutionLog({ id, ...patch });
    }

    this.db.prepare(`
      UPDATE execution_logs
      SET status = ?,
          completed_steps = ?,
          failed_steps = ?,
          failed_step_index = ?,
          error_message = ?,
          result_json = ?,
          duration_ms = ?,
          finished_at = ?,
          is_dirty = 1,
          updated_at = ?
      WHERE id = ?
    `).run(
      patch.status || existing.status,
      patch.completed_steps ?? existing.completed_steps,
      patch.failed_steps ?? existing.failed_steps,
      patch.failed_step_index ?? existing.failed_step_index,
      patch.error_message ?? existing.error_message,
      patch.result_json !== undefined || patch.result !== undefined
        ? serializeJsonValue(patch.result_json ?? patch.result)
        : serializeJsonValue(existing.result_json),
      patch.duration_ms ?? existing.duration_ms,
      patch.finished_at || now,
      now,
      id,
    );

    return this.getExecutionLogById(id);
  }

  getExecutionLogs(limit = 100) {
    const rows = this.db.prepare(`
      SELECT *
      FROM execution_logs
      ORDER BY datetime(started_at) DESC
      LIMIT ?
    `).all(limit);

    return rows.map((row) => this._mapExecutionLogRow(row));
  }

  getExecutionLogById(id) {
    const row = this.db.prepare('SELECT * FROM execution_logs WHERE id = ?').get(id);
    return row ? this._mapExecutionLogRow(row) : null;
  }

  deleteAllExecutionLogs() {
    const result = this.db.prepare('DELETE FROM execution_logs').run();
    return { deleted: result.changes || 0 };
  }

  _mapExecutionLogRow(row) {
    return {
      id: row.id,
      scenario_id: row.scenario_id,
      scenario_name: row.scenario_name,
      browser_profile_id: row.browser_profile_id,
      variable_profile_id: row.variable_profile_id,
      variable_profile_name: row.variable_profile_name,
      variable_sample_id: row.variable_sample_id,
      variable_sample_name: row.variable_sample_name,
      status: row.status,
      total_steps: row.total_steps,
      completed_steps: row.completed_steps,
      failed_steps: row.failed_steps,
      failed_step_index: row.failed_step_index,
      error_message: row.error_message,
      result_json: parseJsonObject(row.result_json),
      duration_ms: row.duration_ms,
      started_at: row.started_at,
      finished_at: row.finished_at,
    };
  }

  /**
   * Đóng kết nối database an toàn.
   * Nên gọi khi ứng dụng thoát (app.on('before-quit')).
   */
  getScenarioMeta(scenarioId) {
    if (!scenarioId) return {};
    const table = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios_meta'")
      .get();
    if (!table) return {};

    const rows = this.db
      .prepare('SELECT meta_key, meta_value FROM scenarios_meta WHERE scenario_id = ? ORDER BY meta_key ASC')
      .all(scenarioId);

    return rows.reduce((meta, row) => {
      meta[row.meta_key] = parseMetaValue(row.meta_value);
      return meta;
    }, {});
  }

  _replaceScenarioMetaStatement() {
    const deleteMeta = this.db.prepare('DELETE FROM scenarios_meta WHERE scenario_id = ?');
    const insertMeta = this.db.prepare(`
      INSERT INTO scenarios_meta (id, scenario_id, meta_key, meta_value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scenario_id, meta_key) DO UPDATE SET
        meta_value = excluded.meta_value,
        updated_at = excluded.updated_at
    `);

    return (scenarioId, meta = {}) => {
      const now = new Date().toISOString();
      const entries = Object.entries(meta || {})
        .filter(([key, value]) => String(key || '').trim() && value !== undefined);
      deleteMeta.run(scenarioId);
      entries.forEach(([key, value]) => {
        insertMeta.run(crypto.randomUUID(), scenarioId, String(key).trim(), serializeMetaValue(value), now);
      });
    };
  }

  setScenarioMetaValue(scenarioId, key, value) {
    if (!scenarioId || !String(key || '').trim()) return;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO scenarios_meta (id, scenario_id, meta_key, meta_value, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scenario_id, meta_key) DO UPDATE SET
        meta_value = excluded.meta_value,
        updated_at = excluded.updated_at
    `).run(crypto.randomUUID(), scenarioId, String(key).trim(), serializeMetaValue(value), now);
  }

  _migrateScenarioColumnsToMeta() {
    const scenariosTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios'")
      .get();
    const metaTable = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios_meta'")
      .get();
    if (!scenariosTable || !metaTable) return;

    const columns = this.db.prepare('PRAGMA table_info(scenarios)').all();
    const columnNames = new Set(columns.map((col) => col.name));
    const movedColumns = [
      'result_type',
      'recorded_width',
      'recorded_height',
      'dom_check_anchor',
      'local_variables',
      'variable_profile_id',
    ].filter((name) => columnNames.has(name));
    if (!movedColumns.length) return;

    const rows = this.db
      .prepare(`SELECT id, ${movedColumns.join(', ')} FROM scenarios`)
      .all();
    const findMeta = this.db
      .prepare('SELECT 1 FROM scenarios_meta WHERE scenario_id = ? AND meta_key = ?');
    const insertMeta = this.db.prepare(`
      INSERT OR IGNORE INTO scenarios_meta (id, scenario_id, meta_key, meta_value, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();

    rows.forEach((row) => {
      movedColumns.forEach((key) => {
        const value = row[key];
        if (value === null || value === undefined || value === '') return;
        if (findMeta.get(row.id, key)) return;
        insertMeta.run(crypto.randomUUID(), row.id, key, serializeMetaValue(value), now);
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[DatabaseService] Đã đóng kết nối database');
    }
  }
}

function toCacheUrl(filePath) {
  return `rpa-cache://file/${Buffer.from(filePath).toString('base64url')}`;
}

function parseJsonObject(value) {
  let parsed = value || {};
  for (let i = 0; i < 2; i += 1) {
    if (typeof parsed !== 'string') break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
      break;
    }
  }
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function parseJsonArray(value) {
  let parsed = value || [];
  for (let i = 0; i < 2; i += 1) {
    if (typeof parsed !== 'string') break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = [];
      break;
    }
  }
  return Array.isArray(parsed) ? parsed : [];
}

function serializeJsonValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify({ value });
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
}

function serializeMetaValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseMetaValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function buildScenarioMetaForStorage(scenario = {}, existingScenario = null, existingMeta = {}) {
  const meta = {
    ...(existingMeta || {}),
    ...(scenario.meta || {}),
    ...(scenario.scenario_meta || {}),
  };

  const readMovedValue = (key, fallback) => (
    scenario[key] !== undefined
      ? scenario[key]
      : (meta[key] !== undefined ? meta[key] : fallback)
  );

  meta.result_type = normalizeScenarioResultType(
    readMovedValue('result_type', existingScenario?.result_type || 'simple'),
  );
  meta.recorded_width = readMovedValue('recorded_width', existingScenario?.recorded_width ?? null);
  meta.recorded_height = readMovedValue('recorded_height', existingScenario?.recorded_height ?? null);
  meta.dom_check_anchor = parseDomCheckAnchor(
    readMovedValue('dom_check_anchor', existingScenario?.dom_check_anchor ?? null),
  );
  meta.local_variables = serializeVariableEntries(
    normalizeVariableEntries(readMovedValue('local_variables', existingScenario?.local_variables || '[]')),
  );
  meta.variable_profile_id = readMovedValue('variable_profile_id', existingScenario?.variable_profile_id ?? null) || null;

  return meta;
}

const SCENARIO_TYPES = new Set(['prepare', 'crawl', 'action', 'request_catching']);
const SCENARIO_RESULT_TYPES = new Set(['simple', 'list']);

function normalizeScenarioType(value) {
  const normalized = String(value || 'action').trim().toLowerCase();
  return SCENARIO_TYPES.has(normalized) ? normalized : 'action';
}

function normalizeScenarioResultType(value) {
  const normalized = String(value || 'simple').trim().toLowerCase();
  return SCENARIO_RESULT_TYPES.has(normalized) ? normalized : 'simple';
}

function normalizeScenarioParentId(scenarioType, parentId) {
  const type = normalizeScenarioType(scenarioType);
  if (type === 'prepare' || type === 'request_catching') return null;

  const normalized = parentId ? String(parentId).trim() : '';
  return normalized || null;
}

function parseDomCheckAnchor(value) {
  const parsed = parseJsonObject(value);
  if (!parsed || typeof parsed !== 'object') return null;
  if (Object.keys(parsed).length === 0) return null;
  return parsed;
}

function serializeDomCheckAnchor(value) {
  const parsed = parseDomCheckAnchor(value);
  return parsed ? JSON.stringify(parsed) : null;
}

function readPreviewFrames(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) return [];

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.frames)) return [];

    return manifest.frames
      .map((frame, index) => ({
        index,
        time: Number(frame.timestamp) || 0,
        path: frame.filePath || null,
        name: frame.fileName || (frame.filePath ? path.basename(frame.filePath) : null),
        url: frame.filePath ? toCacheUrl(frame.filePath) : frame.fileUrl || null,
      }))
      .filter((frame) => frame.path)
      .sort((a, b) => a.time - b.time);
  } catch (error) {
    console.warn(`[DatabaseService] Khong doc duoc preview manifest: ${manifestPath} - ${error.message}`);
    return [];
  }
}

function normalizeTemplateKeys(raw) {
  const list = parseJsonArray(raw);
  const seen = new Set();
  const keys = [];
  for (const item of list) {
    const key = String(item?.key || item?.variable_key || item?.name || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push({ key });
  }
  return keys;
}

function serializeTemplateKeys(keysOrEntries = []) {
  const normalized = normalizeTemplateKeys(
    Array.isArray(keysOrEntries)
      ? keysOrEntries.map((item) => (
        typeof item === 'string' ? { key: item } : item
      ))
      : [],
  );
  return JSON.stringify(normalized);
}

function normalizeVariableEntries(raw) {
  const list = parseJsonArray(raw);
  return list
    .map((item) => ({
      key: String(item?.key || item?.variable_key || item?.name || '').trim(),
      value: item?.value ?? '',
      value_type: item?.value_type === 'file' ? 'file' : 'text',
    }))
    .filter((item) => item.key);
}

function serializeVariableEntries(entries = []) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((item) => ({
      key: String(item?.key || item?.variable_key || item?.name || '').trim(),
      value: item?.value ?? '',
      value_type: item?.value_type === 'file' ? 'file' : 'text',
    }))
    .filter((item) => item.key);
  return JSON.stringify(normalized);
}

export default DatabaseService;
