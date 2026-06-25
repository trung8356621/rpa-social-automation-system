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
      const profileColumns = this.db.prepare('PRAGMA table_info(profiles)').all();
      const hasBrowserProfileId = profileColumns.some((col) => col.name === 'browser_profile_id');

      if (!hasBrowserProfileId) {
        this.db.exec('ALTER TABLE profiles ADD COLUMN browser_profile_id TEXT');
      }
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
        -- Bảng profiles: hồ sơ trình duyệt (cookies, cache phân vùng)
        -- Mỗi profile gắn với một proxy (nếu có) và một nền tảng MXH
        -- ============================================================
        CREATE TABLE IF NOT EXISTS profiles (
          id                TEXT PRIMARY KEY,
          proxy_id          TEXT,
          platform          TEXT NOT NULL,
          username          TEXT NOT NULL,
          password          TEXT,
          cookie_data       TEXT,
          profile_directory TEXT,
          browser_profile_id TEXT,
          status            TEXT NOT NULL DEFAULT 'active',
          is_dirty          INTEGER NOT NULL DEFAULT 1,
          updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
          FOREIGN KEY (browser_profile_id) REFERENCES browser_profiles(id) ON DELETE SET NULL
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
          is_dirty            INTEGER NOT NULL DEFAULT 1,
          updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS scenario_variables (
          id                TEXT PRIMARY KEY,
          scenario_id       TEXT NOT NULL,
          name              TEXT NOT NULL,
          value             TEXT,
          type              TEXT NOT NULL DEFAULT 'text',
          source            TEXT NOT NULL DEFAULT 'manual',
          source_profile_id TEXT,
          created_at        TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(scenario_id, name),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
          FOREIGN KEY (source_profile_id) REFERENCES profiles(id) ON DELETE SET NULL
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
          delay_ms      INTEGER DEFAULT 1000,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
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
          profile_id  TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending',
          updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
          FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
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
            is_dirty, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `)
      : this.db.prepare(`
          UPDATE scenarios
          SET name = ?, description = ?, platform = ?, target_url = ?,
              recorded_width = ?, recorded_height = ?, device_pixel_ratio = ?,
              preview_path = ?, preview_manifest_path = ?, preview_duration_ms = ?,
              preview_trim_ranges = ?,
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
          now,
          scenarioId
        );
      }

      // Xóa steps cũ và thêm steps mới (thay thế toàn bộ)
      deleteSteps.run(scenarioId);

      steps.forEach((step, index) => {
        insertStep.run(
          step.id || crypto.randomUUID(),
          scenarioId,
          index + 1,
          step.action_type,
          // target_anchor là object — serialize thành JSON string khi ghi DB
          step.target_anchor ? JSON.stringify(parseJsonObject(step.target_anchor)) : null,
          step.delay_ms || 1000,
          now
        );
      });
    });

    saveTransaction();

    // Trả về dữ liệu đã lưu với steps đã được deserialize
    return this.getScenarioById(scenarioId);
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

    // Deserialize target_anchor từ JSON string về object
    const stepsDeserialized = steps.map((step) => {
      const targetAnchor = step.target_anchor ? parseJsonObject(step.target_anchor) : null;
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
      steps: stepsDeserialized,
    };
  }

  getScenarioVariables(scenarioId) {
    return this.db
      .prepare('SELECT * FROM scenario_variables WHERE scenario_id = ? ORDER BY updated_at DESC, name ASC')
      .all(scenarioId);
  }

  saveScenarioVariable(variable) {
    const now = new Date().toISOString();
    const id = variable.id || crypto.randomUUID();
    const name = String(variable.name || '').trim();

    if (!variable.scenario_id) {
      throw new Error('scenario_id is required for scenario variable.');
    }
    if (!name) {
      throw new Error('Variable name is required.');
    }

    this.db
      .prepare(`
        INSERT INTO scenario_variables (
          id, scenario_id, name, value, type, source, source_profile_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scenario_id, name)
        DO UPDATE SET
          value = excluded.value,
          type = excluded.type,
          source = excluded.source,
          source_profile_id = excluded.source_profile_id,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        variable.scenario_id,
        name,
        variable.value ?? '',
        variable.type || 'text',
        variable.source || 'manual',
        variable.source_profile_id || null,
        now,
        now
      );

    return this.db
      .prepare('SELECT * FROM scenario_variables WHERE scenario_id = ? AND name = ?')
      .get(variable.scenario_id, name);
  }

  deleteScenarioVariable(id) {
    this.db.prepare('DELETE FROM scenario_variables WHERE id = ?').run(id);
    return { success: true, id };
  }

  importProfileVariables({ scenarioId, profileId }) {
    const profile = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
    if (!profile) {
      throw new Error('Khong tim thay tai khoan de import variable.');
    }

    const baseName = `${profile.platform || 'account'}_${String(profile.username || 'user')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()}`.slice(0, 48);

    const usernameVariable = this.saveScenarioVariable({
      scenario_id: scenarioId,
      name: `${baseName}_username`,
      value: profile.username || '',
      type: 'text',
      source: 'account_import',
      source_profile_id: profileId,
    });

    const imported = [usernameVariable];

    if (profile.password) {
      imported.push(this.saveScenarioVariable({
        scenario_id: scenarioId,
        name: `${baseName}_password`,
        value: profile.password,
        type: 'secret',
        source: 'account_import',
        source_profile_id: profileId,
      }));
    }

    return imported;
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

  // ============================================================
  // Profile CRUD
  // ============================================================

  /**
   * Lấy danh sách tất cả profile (JOIN proxy để hiển thị tên proxy), sắp xếp mới nhất.
   * @returns {Array<Object>}
   */
  getProfiles() {
    return this.db
      .prepare(
        `SELECT p.*, pr.name AS proxy_name,
                bp.display_name AS browser_profile_display_name,
                bp.browser_name AS browser_name,
                bp.profile_name AS browser_profile_name,
                bp.executable_path AS browser_executable_path,
                bp.user_data_dir AS browser_user_data_dir,
                bp.profile_dir_name AS browser_profile_dir_name
         FROM profiles p
         LEFT JOIN proxies pr ON pr.id = p.proxy_id
         LEFT JOIN browser_profiles bp ON bp.id = p.browser_profile_id
         ORDER BY p.updated_at DESC`
      )
      .all();
  }

  /**
   * Lưu hoặc cập nhật một profile.
   * Nếu profile có id → UPDATE, nếu không → INSERT.
   * @param {Object} profile - { id?, proxy_id?, browser_profile_id?, platform, username, password?, cookie_data?, profile_directory?, status? }
   * @returns {Object} Profile đã lưu (kèm proxy_name).
   */
  saveProfile(profile) {
    const now = new Date().toISOString();
    const isNew = !profile.id;
    const id = profile.id || crypto.randomUUID();

    if (isNew) {
      this.db
        .prepare(
          `INSERT INTO profiles (id, proxy_id, browser_profile_id, platform, username, password, cookie_data, profile_directory, status, is_dirty, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
        )
        .run(
          id,
          profile.proxy_id || null,
          profile.browser_profile_id || null,
          profile.platform,
          profile.username,
          profile.password || null,
          profile.cookie_data || null,
          profile.profile_directory || null,
          profile.status || 'active',
          now
        );
    } else {
      this.db
        .prepare(
          `UPDATE profiles
           SET proxy_id = ?, browser_profile_id = ?, platform = ?, username = ?, password = ?,
               cookie_data = ?, profile_directory = ?, status = ?,
               is_dirty = 1, updated_at = ?
           WHERE id = ?`
        )
        .run(
          profile.proxy_id || null,
          profile.browser_profile_id || null,
          profile.platform,
          profile.username,
          profile.password || null,
          profile.cookie_data || null,
          profile.profile_directory || null,
          profile.status || 'active',
          now,
          id
        );
    }

    // Trả về profile kèm proxy_name
    return this.db
      .prepare(
        `SELECT p.*, pr.name AS proxy_name,
                bp.display_name AS browser_profile_display_name,
                bp.browser_name AS browser_name,
                bp.profile_name AS browser_profile_name,
                bp.executable_path AS browser_executable_path,
                bp.user_data_dir AS browser_user_data_dir,
                bp.profile_dir_name AS browser_profile_dir_name
         FROM profiles p
         LEFT JOIN proxies pr ON pr.id = p.proxy_id
         LEFT JOIN browser_profiles bp ON bp.id = p.browser_profile_id
         WHERE p.id = ?`
      )
      .get(id);
  }

  /**
   * Xóa một profile theo ID.
   * @param {string} id
   * @returns {{ success: boolean }}
   */
  deleteProfile(id) {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    return { success: true };
  }

  getBrowserProfiles() {
    return this.db
      .prepare('SELECT * FROM browser_profiles ORDER BY browser_name ASC, profile_name ASC')
      .all();
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
    this.db.prepare('UPDATE profiles SET browser_profile_id = NULL WHERE browser_profile_id = ?').run(id);
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
      for (const item of items) {
        upsert.run(
          item.id || crypto.randomUUID(),
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

export default DatabaseService;
