const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

let mainWindow = null;
let rootFolder = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset'
  });

  await mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers

ipcMain.handle('select-root-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Markdown 루트 폴더 선택'
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  rootFolder = result.filePaths[0];
  const notes = await scanMarkdownFiles(rootFolder);
  return { canceled: false, rootFolder, notes };
});

ipcMain.handle('get-root-folder', async () => {
  if (!rootFolder) return { rootFolder: null, notes: [] };
  const notes = await scanMarkdownFiles(rootFolder);
  return { rootFolder, notes };
});

ipcMain.handle('load-note-content', async (_event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('save-note-content', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('create-note', async (_event, relativePath, template) => {
  if (!rootFolder) {
    return { ok: false, error: '루트 폴더가 설정되지 않았습니다.' };
  }
  const fullPath = path.join(rootFolder, relativePath);
  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, template, 'utf8');
    const notes = await scanMarkdownFiles(rootFolder);
    return { ok: true, fullPath, notes };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('delete-note', async (_event, filePath) => {
  try {
    await fs.unlink(filePath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

async function scanMarkdownFiles(baseDir) {
  const result = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const relativePath = path.relative(baseDir, fullPath);
        const meta = await readFrontmatterMeta(fullPath, relativePath);
        result.push({
          id: relativePath,
          name: entry.name,
          fullPath,
          relativePath,
          meta
        });
      }
    }
  }

  await walk(baseDir);
  result.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return result;
}

function parseFrontmatter(content) {
  const result = { title: null, type: null, links: [], description: null, dueDate: null, completed: false };
  if (!content.startsWith('---')) return result;
  
  const end = content.indexOf('\n---', 3);
  if (end === -1) return result;
  
  const fmBlock = content.slice(3, end);
  const body = content.slice(end + 4).trim();
  
  for (const line of fmBlock.split('\n')) {
    const titleMatch = line.match(/^\s*title\s*:\s*(.+)\s*$/i);
    if (titleMatch) {
      result.title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    
    const typeMatch = line.match(/^\s*type\s*:\s*(.+)\s*$/i);
    if (typeMatch) {
      result.type = typeMatch[1].trim().toLowerCase();
      continue;
    }
    
    const linksMatch = line.match(/^\s*links\s*:\s*\[(.+)\]\s*$/i);
    if (linksMatch) {
      const linksStr = linksMatch[1];
      result.links = linksStr
        .split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }
    
    const dueDateMatch = line.match(/^\s*dueDate\s*:\s*(.+)\s*$/i);
    if (dueDateMatch) {
      result.dueDate = dueDateMatch[1].trim();
      continue;
    }
    
    const completedMatch = line.match(/^\s*completed\s*:\s*(.+)\s*$/i);
    if (completedMatch) {
      result.completed = completedMatch[1].trim().toLowerCase() === 'true';
      continue;
    }
  }
  
  result.description = body;
  return result;
}

async function readFrontmatterMeta(fullPath, relativePath) {
  let type = null;
  let rawType = null;
  let title = null;
  let links = [];

  try {
    const content = await fs.readFile(fullPath, 'utf8');
    const parsed = parseFrontmatter(content);
    rawType = parsed.type;
    title = parsed.title;
    links = parsed.links;
  } catch {
    // 읽기 실패 시 타입 정보 없음
  }

  // frontmatter 우선 분류
  if (rawType === 'task' || rawType === 'todo') {
    type = { class: 'A', kind: 'task' };
  } else if (rawType === 'note') {
    type = { class: 'A', kind: 'note' };
  } else if (rawType === 'project') {
    type = { class: 'B', kind: 'project' };
  } else if (rawType === 'goal') {
    type = { class: 'B', kind: 'goal' };
  } else if (rawType === 'area' || rawType === 'area_of_responsibility') {
    type = { class: 'B', kind: 'area' };
  }

  // 디렉터리 규칙 보정 (frontmatter 없거나 애매한 경우)
  const lowerRel = relativePath.toLowerCase();
  if (!type) {
    if (lowerRel.includes('/tasks/') || lowerRel.startsWith('tasks/')) {
      type = { class: 'A', kind: 'task' };
    } else if (lowerRel.includes('/notes/') || lowerRel.startsWith('notes/')) {
      type = { class: 'A', kind: 'note' };
    } else if (lowerRel.includes('/projects/') || lowerRel.startsWith('projects/')) {
      type = { class: 'B', kind: 'project' };
    }
  }

  return {
    class: type ? type.class : null,
    kind: type ? type.kind : null,
    rawType,
    title: title || path.basename(relativePath, '.md'),
    links
  };
}

ipcMain.handle('update-node-links', async (_event, filePath, links) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = parseFrontmatter(content);
    const body = content.startsWith('---')
      ? content.slice(content.indexOf('\n---', 3) + 4).trim()
      : content.trim();

    const fmLines = [];
    if (parsed.title) fmLines.push(`title: ${parsed.title}`);
    if (parsed.type) fmLines.push(`type: ${parsed.type}`);

    // links는 항상 업데이트 (양방향 관계 유지)
    if (links.length > 0) {
      fmLines.push(`links: [${links.map(l => `"${l}"`).join(', ')}]`);
    } else {
      fmLines.push('links: []');
    }

    // 기존 frontmatter 필드 보존
    if (parsed.dueDate) fmLines.push(`dueDate: ${parsed.dueDate}`);
    if (parsed.completed !== undefined) fmLines.push(`completed: ${parsed.completed}`);

    const newContent = `---\n${fmLines.join('\n')}\n---\n\n${body}`;
    await fs.writeFile(filePath, newContent, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});



