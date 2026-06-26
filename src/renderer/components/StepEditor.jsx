import React from 'react';
import { Trash2 } from 'lucide-react';

const ACTION_LABELS = {
  navigate: 'Điều hướng đến URL',
  click: 'Click vào phần tử',
  input: 'Nhập text vào ô input',
  type: 'Nhập text vào ô input',
  wait: 'Chờ một khoảng thời gian',
  waitForElement: 'Chờ phần tử xuất hiện',
  extractText: 'Lấy text từ phần tử',
  scroll: 'Cuộn trang',
  screenshot: 'Chụp màn hình',
  submit: 'Submit form',
  login: 'Đăng nhập',
  facebookPost: 'Đăng bài Facebook',
  like: 'Like trang / bài viết',
  comment: 'Comment vào bài viết',
  customScript: 'JavaScript tùy chỉnh',
};

export default function StepEditor({ step, index, onUpdate, onDelete }) {
  const config = typeof step.action_config === 'string'
    ? JSON.parse(step.action_config)
    : step.action_config || {};

  const updateConfig = (key, value) => {
    onUpdate({
      action_config: { ...config, [key]: value },
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-700">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Bước {index + 1}: {ACTION_LABELS[step.action_type] || step.action_type}
          </h2>
          <p className="text-sm text-slate-400 mt-1">Cấu hình chi tiết cho bước này</p>
        </div>
        <button
          onClick={onDelete}
          className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Mô tả */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">Mô tả</label>
        <input
          type="text"
          value={step.description || ''}
          onChange={(e) => onUpdate({ description: e.target.value })}
          className="input-field"
          placeholder="Mô tả ngắn về bước này..."
        />
      </div>

      {/* Cấu hình theo từng loại action */}
      <div className="space-y-4">
        {renderConfigFields(step.action_type, config, updateConfig, step, onUpdate)}
      </div>

      {/* Thời gian chờ */}
      <div className="pt-4 border-t border-slate-700">
        <h3 className="text-sm font-medium text-slate-300 mb-3">Thời gian chờ</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Chờ trước (ms)</label>
            <input
              type="number"
              min="0"
              max="60000"
              value={step.wait_before || 1000}
              onChange={(e) => onUpdate({ wait_before: parseInt(e.target.value) || 0 })}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Chờ sau (ms)</label>
            <input
              type="number"
              min="0"
              max="60000"
              value={step.wait_after || 500}
              onChange={(e) => onUpdate({ wait_after: parseInt(e.target.value) || 0 })}
              className="input-field"
            />
          </div>
        </div>
      </div>

      {/* Selector */}
      {['click', 'type', 'waitForElement', 'extractText', 'submit', 'like'].includes(step.action_type) && (
        <div className="pt-4 border-t border-slate-700">
          <h3 className="text-sm font-medium text-slate-300 mb-3">Selector (CSS/XPath)</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Loại</label>
              <select
                value={step.selector_type || 'css'}
                onChange={(e) => onUpdate({ selector_type: e.target.value })}
                className="select-field"
              >
                <option value="css">CSS</option>
                <option value="xpath">XPath</option>
                <option value="text">Text</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Giá trị</label>
              <input
                type="text"
                value={step.selector_value || ''}
                onChange={(e) => onUpdate({ selector_value: e.target.value })}
                className="input-field"
                placeholder={step.selector_type === 'css' ? '#my-button, .class-name' : '//div[@id="my-id"]'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderConfigFields(actionType, config, updateConfig, step, onUpdate) {
  switch (actionType) {
    case 'navigate':
      return (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">URL</label>
          <input
            type="url"
            value={config.url || ''}
            onChange={(e) => updateConfig('url', e.target.value)}
            className="input-field"
            placeholder="https://facebook.com"
          />
        </div>
      );

    case 'click':
      return (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Selector để click</label>
          <input
            type="text"
            value={config.selector || ''}
            onChange={(e) => updateConfig('selector', e.target.value)}
            className="input-field"
            placeholder="button[type='submit'], #login-button"
          />
        </div>
      );

    case 'type':
      return (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Selector</label>
            <input
              type="text"
              value={config.selector || ''}
              onChange={(e) => updateConfig('selector', e.target.value)}
              className="input-field"
              placeholder="input[name='email']"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nội dung nhập</label>
            <textarea
              value={config.text || ''}
              onChange={(e) => updateConfig('text', e.target.value)}
              className="input-field min-h-[80px] resize-none"
              placeholder="Text cần nhập..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Tốc độ gõ (ms) <span className="text-slate-500 font-normal">- delay giữa các ký tự</span>
            </label>
            <input
              type="number"
              min="0"
              max="500"
              value={config.delay || 50}
              onChange={(e) => updateConfig('delay', parseInt(e.target.value) || 50)}
              className="input-field"
            />
          </div>
        </>
      );

    case 'wait':
      return (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Thời gian chờ (ms)
          </label>
          <input
            type="number"
            min="100"
            max="120000"
            value={config.duration || 2000}
            onChange={(e) => updateConfig('duration', parseInt(e.target.value) || 2000)}
            className="input-field"
          />
          <p className="text-xs text-slate-500 mt-1">1000ms = 1 giây. Tối đa 120 giây.</p>
        </div>
      );

    case 'waitForElement':
      return (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Selector</label>
            <input
              type="text"
              value={config.selector || ''}
              onChange={(e) => updateConfig('selector', e.target.value)}
              className="input-field"
              placeholder=".class-name, #element-id"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Timeout (ms)
            </label>
            <input
              type="number"
              min="1000"
              max="120000"
              value={config.timeout || 10000}
              onChange={(e) => updateConfig('timeout', parseInt(e.target.value) || 10000)}
              className="input-field"
            />
          </div>
        </>
      );

    case 'scroll':
      return (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Hướng cuộn</label>
            <select
              value={config.direction || 'down'}
              onChange={(e) => updateConfig('direction', e.target.value)}
              className="select-field"
            >
              <option value="down">Xuống</option>
              <option value="up">Lên</option>
              <option value="to">Đến vị trí</option>
              <option value="bottom">Xuống cuối trang</option>
            </select>
          </div>
          {config.direction !== 'bottom' && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">
                {config.direction === 'to' ? 'Vị trí (px)' : 'Khoảng cách (px)'}
              </label>
              <input
                type="number"
                min="0"
                value={config.amount || 500}
                onChange={(e) => updateConfig('amount', parseInt(e.target.value) || 500)}
                className="input-field"
              />
            </div>
          )}
        </>
      );

    case 'login':
      return (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Tên đăng nhập</label>
            <input
              type="text"
              value={config.username || ''}
              onChange={(e) => updateConfig('username', e.target.value)}
              className="input-field"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Mật khẩu</label>
            <input
              type="password"
              value={config.password || ''}
              onChange={(e) => updateConfig('password', e.target.value)}
              className="input-field"
              placeholder="••••••••"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Selector username</label>
              <input
                type="text"
                value={config.usernameSelector || '#email'}
                onChange={(e) => updateConfig('usernameSelector', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Selector password</label>
              <input
                type="text"
                value={config.passwordSelector || '#pass'}
                onChange={(e) => updateConfig('passwordSelector', e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Selector login button</label>
              <input
                type="text"
                value={config.loginButtonSelector || 'button[type="submit"]'}
                onChange={(e) => updateConfig('loginButtonSelector', e.target.value)}
                className="input-field"
              />
            </div>
          </div>
        </>
      );

    case 'facebookPost':
      return (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Nội dung bài đăng</label>
          <textarea
            value={config.content || ''}
            onChange={(e) => updateConfig('content', e.target.value)}
            className="input-field min-h-[150px] resize-none"
            placeholder="Nhập nội dung bài đăng Facebook..."
            rows={6}
          />
        </div>
      );

    case 'comment':
      return (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Nội dung comment</label>
          <textarea
            value={config.text || ''}
            onChange={(e) => updateConfig('text', e.target.value)}
            className="input-field min-h-[100px] resize-none"
            placeholder="Nhập nội dung comment..."
            rows={4}
          />
        </div>
      );

    case 'customScript':
      return (
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">JavaScript code</label>
          <textarea
            value={config.script || ''}
            onChange={(e) => updateConfig('script', e.target.value)}
            className="input-field min-h-[200px] resize-none font-mono text-xs"
            placeholder="document.querySelector('button').click();"
            rows={8}
          />
          <p className="text-xs text-slate-500 mt-1">
            Code JavaScript chạy trong browser context. Có thể dùng DOM APIs.
          </p>
        </div>
      );

    case 'screenshot':
      return (
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="fullPage"
            checked={config.fullPage || false}
            onChange={(e) => updateConfig('fullPage', e.target.checked)}
            className="w-4 h-4 rounded border-slate-600 bg-slate-700 accent-blue-500"
          />
          <label htmlFor="fullPage" className="text-sm text-slate-300">
            Chụp toàn bộ trang (full page)
          </label>
        </div>
      );

    default:
      return (
        <div className="text-sm text-slate-500">
          Không có cấu hình đặc biệt cho action này.
        </div>
      );
  }
}
