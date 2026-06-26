import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

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

    if (tableExists) {
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
    }

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
    this._migrateExecutionLogsProfileColumns();
    this.db.prepare(`
      UPDATE scenario_steps
      SET action_type = 'input'
      WHERE action_type = 'type'
    `).run();
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
        id          TEXT PRIMARY KEY,
        scenario_id TEXT NOT NULL,
        name        TEXT NOT NULL,
        is_dirty    INTEGER NOT NULL DEFAULT 1,
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(scenario_id, name),
        FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS profile_variable_values (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL,
        variable_key TEXT NOT NULL,
        value        TEXT,
        UNIQUE(profile_id, variable_key),
        FOREIGN KEY (profile_id) REFERENCES variable_profiles(id) ON DELETE CASCADE
      );
    `);
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

        CREATE TABLE IF NOT EXISTS variable_profiles (
          id          TEXT PRIMARY KEY,
          scenario_id TEXT NOT NULL,
          name        TEXT NOT NULL,
          is_dirty    INTEGER NOT NULL DEFAULT 1,
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(scenario_id, name),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS profile_variable_values (
          id           TEXT PRIMARY KEY,
          profile_id   TEXT NOT NULL,
          variable_key TEXT NOT NULL,
          value        TEXT,
          UNIQUE(profile_id, variable_key),
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
          status                TEXT NOT NULL DEFAULT 'running',
          total_steps         INTEGER NOT NULL DEFAULT 0,
          completed_steps     INTEGER NOT NULL DEFAULT 0,
          failed_steps        INTEGER NOT NULL DEFAULT 0,
          failed_step_index   INTEGER,
          error_message       TEXT,
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
    const upsertScenario = isNew
      ? this.db.prepare(`
          INSERT INTO scenarios (
            id, name, description, platform, target_url,
            recorded_width, recorded_height, device_pixel_ratio,
            preview_path, preview_manifest_path, preview_duration_ms, preview_trim_ranges,
            browser_profile_id,
            is_dirty, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `)
      : this.db.prepare(`
          UPDATE scenarios
          SET name = ?, description = ?, platform = ?, target_url = ?,
              recorded_width = ?, recorded_height = ?, device_pixel_ratio = ?,
              preview_path = ?, preview_manifest_path = ?, preview_duration_ms = ?,
              preview_trim_ranges = ?,
              browser_profile_id = ?,
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
          scenario.recorded_width || null,
          scenario.recorded_height || null,
          scenario.device_pixel_ratio || 1.0,
          scenario.preview_path ?? null,
          scenario.preview_manifest_path ?? null,
          scenario.preview_duration_ms ?? null,
          JSON.stringify(parseJsonArray(scenario.preview_trim_ranges)),
          scenario.browser_profile_id ?? null,
          now
        );
      } else {
        // UPDATE scenario đã tồn tại
        upsertScenario.run(
          scenario.name || 'Kịch bản mới',
          scenario.description || null,
          scenario.platform || 'custom',
          scenario.target_url || null,
          scenario.recorded_width || null,
          scenario.recorded_height || null,
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
    });

    saveTransaction();
    this._deleteOrphanedScenarioFrames(previousFramePaths, nextFramePaths);

    if (Array.isArray(scenario.preview_manifest_frames)) {
      const manifestPath = scenario.preview_manifest_path || existingScenario?.preview_manifest_path;
      if (manifestPath) {
        const durationMs = scenario.preview_duration_ms != null
          ? Number(scenario.preview_duration_ms)
          : (scenario.preview_manifest_frames.length
            ? Math.max(...scenario.preview_manifest_frames.map((frame) => Number(frame.time) || 0))
            : 0);
        this.writePreviewManifest(manifestPath, scenario.preview_manifest_frames, durationMs);
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

    return {
      ...scenario,
      preview_trim_ranges: parseJsonArray(scenario.preview_trim_ranges),
      preview_url: scenario.preview_path ? toCacheUrl(scenario.preview_path) : null,
      preview_frames: readPreviewFrames(scenario.preview_manifest_path),
      steps: stepsDeserialized,
    };
  }

  getScenarioVariables(scenarioId) {
    return this.db
      .prepare('SELECT id, scenario_id, key, value FROM scenario_variables WHERE scenario_id = ? ORDER BY key ASC')
      .all(scenarioId);
  }

  saveScenarioVariable(variable) {
    const scenarioId = variable.scenario_id;
    const key = String(variable.key || variable.name || '').trim();
    const value = variable.value ?? '';

    if (!scenarioId) {
      throw new Error('scenario_id is required for scenario variable.');
    }
    if (!key) {
      throw new Error('Variable key is required.');
    }

    const existingByKey = this.db
      .prepare('SELECT id, scenario_id, key, value FROM scenario_variables WHERE scenario_id = ? AND key = ?')
      .get(scenarioId, key);

    if (variable.id) {
      const existingById = this.db
        .prepare('SELECT id, scenario_id, key, value FROM scenario_variables WHERE id = ?')
        .get(variable.id);

      if (existingById) {
        if (existingByKey && existingByKey.id !== variable.id) {
          throw new Error('Da ton tai bien voi key nay.');
        }

        const previousKey = existingById.key;
        this.db
          .prepare('UPDATE scenario_variables SET key = ?, value = ? WHERE id = ?')
          .run(key, value, variable.id);

        if (previousKey && previousKey !== key) {
          this._renameProfileVariableKey(scenarioId, previousKey, key);
        }

        return this.db
          .prepare('SELECT id, scenario_id, key, value FROM scenario_variables WHERE id = ?')
          .get(variable.id);
      }
    }

    if (existingByKey) {
      this.db
        .prepare('UPDATE scenario_variables SET value = ? WHERE id = ?')
        .run(value, existingByKey.id);

      return this.db
        .prepare('SELECT id, scenario_id, key, value FROM scenario_variables WHERE scenario_id = ? AND key = ?')
        .get(scenarioId, key);
    }

    const id = variable.id || crypto.randomUUID();
    this.db
      .prepare('INSERT INTO scenario_variables (id, scenario_id, key, value) VALUES (?, ?, ?, ?)')
      .run(id, scenarioId, key, value);

    return this.db
      .prepare('SELECT id, scenario_id, key, value FROM scenario_variables WHERE id = ?')
      .get(id);
  }

  deleteScenarioVariable(id) {
    const existing = this.db
      .prepare('SELECT id, scenario_id, key FROM scenario_variables WHERE id = ?')
      .get(id);

    if (existing?.scenario_id && existing?.key) {
      this._deleteProfileValuesForScenarioKey(existing.scenario_id, existing.key);
    }

    this.db.prepare('DELETE FROM scenario_variables WHERE id = ?').run(id);
    return { success: true, id };
  }

  _deleteProfileValuesForScenarioKey(scenarioId, variableKey) {
    const profiles = this.db
      .prepare('SELECT id FROM variable_profiles WHERE scenario_id = ?')
      .all(scenarioId);

    const deleteStmt = this.db.prepare(
      'DELETE FROM profile_variable_values WHERE profile_id = ? AND variable_key = ?',
    );

    for (const profile of profiles) {
      deleteStmt.run(profile.id, variableKey);
    }
  }

  _renameProfileVariableKey(scenarioId, oldKey, newKey) {
    const profiles = this.db
      .prepare('SELECT id FROM variable_profiles WHERE scenario_id = ?')
      .all(scenarioId);

    const updateStmt = this.db.prepare(
      'UPDATE profile_variable_values SET variable_key = ? WHERE profile_id = ? AND variable_key = ?',
    );

    for (const profile of profiles) {
      updateStmt.run(newKey, profile.id, oldKey);
    }
  }

  getVariableProfiles(scenarioId) {
    return this.db
      .prepare('SELECT id, scenario_id, name, updated_at FROM variable_profiles WHERE scenario_id = ? ORDER BY name ASC')
      .all(scenarioId);
  }

  getVariableProfileById(profileId) {
    const profile = this.db
      .prepare('SELECT id, scenario_id, name, updated_at FROM variable_profiles WHERE id = ?')
      .get(profileId);
    if (!profile) return null;

    const skeleton = this.getScenarioVariables(profile.scenario_id);
    const values = this.getProfileVariableValues(profileId);
    const valueMap = new Map(values.map((item) => [item.variable_key, item.value ?? '']));

    return {
      ...profile,
      skeleton,
      values: skeleton.map((item) => ({
        variable_key: item.key,
        value: valueMap.get(item.key) ?? '',
        default_value: item.value ?? '',
      })),
    };
  }

  saveVariableProfile(profile) {
    const id = profile.id || crypto.randomUUID();
    const scenarioId = profile.scenario_id;
    const name = String(profile.name || '').trim();
    const now = new Date().toISOString();

    if (!scenarioId) {
      throw new Error('scenario_id is required for variable profile.');
    }
    if (!name) {
      throw new Error('Profile name is required.');
    }

    const existingByName = this.db
      .prepare('SELECT id FROM variable_profiles WHERE scenario_id = ? AND name = ?')
      .get(scenarioId, name);

    if (profile.id) {
      const existingById = this.db
        .prepare('SELECT id, scenario_id, name FROM variable_profiles WHERE id = ?')
        .get(profile.id);

      if (existingById) {
        if (existingByName && existingByName.id !== profile.id) {
          throw new Error('Da ton tai ho so voi ten nay.');
        }

        this.db.prepare(`
          UPDATE variable_profiles
          SET name = ?, is_dirty = 1, updated_at = ?
          WHERE id = ?
        `).run(name, now, profile.id);

        return this.getVariableProfileById(profile.id);
      }
    }

    if (existingByName) {
      throw new Error('Da ton tai ho so voi ten nay.');
    }

    this.db.prepare(`
      INSERT INTO variable_profiles (id, scenario_id, name, is_dirty, updated_at)
      VALUES (?, ?, ?, 1, ?)
    `).run(id, scenarioId, name, now);

    return this.getVariableProfileById(id);
  }

  deleteVariableProfile(id) {
    this.db.prepare('DELETE FROM variable_profiles WHERE id = ?').run(id);
    return { success: true, id };
  }

  getProfileVariableValues(profileId) {
    return this.db
      .prepare('SELECT id, profile_id, variable_key, value FROM profile_variable_values WHERE profile_id = ? ORDER BY variable_key ASC')
      .all(profileId);
  }

  saveProfileVariableValues(profileId, entries = []) {
    if (!profileId) {
      throw new Error('profile_id is required.');
    }

    const profile = this.db
      .prepare('SELECT id, scenario_id FROM variable_profiles WHERE id = ?')
      .get(profileId);
    if (!profile) {
      throw new Error('Khong tim thay ho so du lieu.');
    }

    const skeletonKeys = new Set(
      this.getScenarioVariables(profile.scenario_id).map((item) => item.key),
    );

    const upsert = this.db.prepare(`
      INSERT INTO profile_variable_values (id, profile_id, variable_key, value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(profile_id, variable_key)
      DO UPDATE SET value = excluded.value
    `);

    const deleteStmt = this.db.prepare(
      'DELETE FROM profile_variable_values WHERE profile_id = ? AND variable_key = ?',
    );

    const saveMany = this.db.transaction((rows) => {
      for (const entry of rows) {
        const variableKey = String(entry.variable_key || entry.key || '').trim();
        if (!variableKey || !skeletonKeys.has(variableKey)) continue;

        const rawValue = entry.value ?? '';
        if (rawValue === '') {
          deleteStmt.run(profileId, variableKey);
          continue;
        }

        upsert.run(crypto.randomUUID(), profileId, variableKey, rawValue);
      }
    });

    saveMany(entries);
    return this.getVariableProfileById(profileId);
  }

  buildVariableMap(scenarioId, profileId = null) {
    const skeleton = this.getScenarioVariables(scenarioId);
    let profileValues = [];
    const normalizedProfileId = profileId ? String(profileId).trim() : '';

    if (normalizedProfileId) {
      const profile = this.db
        .prepare('SELECT id, scenario_id FROM variable_profiles WHERE id = ?')
        .get(normalizedProfileId);
      if (profile?.scenario_id === scenarioId) {
        profileValues = this.getProfileVariableValues(normalizedProfileId);
      }
    }

    const profileMap = new Map(profileValues.map((item) => [item.variable_key, item.value ?? '']));

    const resolved = new Map();
    for (const item of skeleton) {
      const key = item.key;
      const profileValue = profileMap.get(key);
      const defaultValue = item.value ?? '';
      const resolvedValue = (profileValue != null && profileValue !== '')
        ? profileValue
        : defaultValue;
      resolved.set(key, resolvedValue);
    }

    return resolved;
  }

  buildResolvedVariables(scenarioId, profileId = null) {
    const map = this.buildVariableMap(scenarioId, profileId);
    return Array.from(map.entries()).map(([key, value]) => ({ key, value }));
  }

  deleteScenario(id) {
    this.db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
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
        status, total_steps, completed_steps, failed_steps,
        failed_step_index, error_message, duration_ms,
        started_at, finished_at, is_dirty, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      id,
      log.scenario_id,
      log.scenario_name || null,
      log.browser_profile_id || null,
      log.variable_profile_id || null,
      log.variable_profile_name || null,
      log.status || 'running',
      log.total_steps || 0,
      log.completed_steps || 0,
      log.failed_steps || 0,
      log.failed_step_index ?? null,
      log.error_message || null,
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
      status: row.status,
      total_steps: row.total_steps,
      completed_steps: row.completed_steps,
      failed_steps: row.failed_steps,
      failed_step_index: row.failed_step_index,
      error_message: row.error_message,
      duration_ms: row.duration_ms,
      started_at: row.started_at,
      finished_at: row.finished_at,
    };
  }

  /**
   * Đóng kết nối database an toàn.
   * Nên gọi khi ứng dụng thoát (app.on('before-quit')).
   */
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

export default DatabaseService;
