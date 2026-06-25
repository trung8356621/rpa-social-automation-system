export function pickFileWithInput({ accept = '' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? window.electronAPI.getPathForFile(file) : null);
    });

    document.body.appendChild(input);
    input.click();
  });
}

export function pickDirectoryWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();

      const filePath = file ? window.electronAPI.getPathForFile(file) : null;

      if (!filePath) {
        resolve(null);
        return;
      }

      const relativePath = file.webkitRelativePath || file.name;
      const suffix = relativePath ? relativePath.replace(/\//g, '\\') : file.name;
      resolve(filePath.endsWith(suffix) ? filePath.slice(0, -suffix.length).replace(/[\\/]+$/, '') : filePath);
    });

    document.body.appendChild(input);
    input.click();
  });
}
