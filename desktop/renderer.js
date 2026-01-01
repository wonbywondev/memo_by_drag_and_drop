const typeMeta = {
  task: { label: '할 일', section: 'A', color: 'var(--a-task)', icon: '✓' },
  note: { label: '노트', section: 'A', color: 'var(--a-note)', icon: '✎' },
  project: { label: '프로젝트', section: 'B', color: 'var(--b-project)', icon: 'P' },
  goal: { label: '목표', section: 'B', color: 'var(--b-goal)', icon: 'G' },
  area: { label: '영역', section: 'B', color: 'var(--b-area)', icon: 'A' },
  resource: { label: '자원', section: 'B', color: 'var(--b-resource)', icon: 'R' },
};

const nodes = new Map();
let rootFolder = null;

function undo() {
  console.log('Undo called - historyIndex:', state.historyIndex, 'history length:', state.history.length);

  if (!rootFolder) {
    showToast('폴더를 먼저 선택하세요.', 'error');
    return;
  }

  if (state.historyIndex <= 0) {
    showToast('더 이상 되돌릴 작업이 없습니다.', 'error');
    return;
  }

  state.historyIndex--;
  const snapshot = state.history[state.historyIndex];

  // 메모리 상태만 복원 (파일은 Cmd+S로 저장)
  nodes.clear();
  snapshot.nodes.forEach((node, id) => {
    nodes.set(id, {
      ...node,
      links: new Set(node.links),
    });
  });

  renderSections();
  showToast('작업이 취소되었습니다. Cmd+S로 저장하세요.');
  console.log('Undo completed - new historyIndex:', state.historyIndex);
}

async function deleteSelectedNodes() {
  if (state.selectedIds.size === 0) return;

  const count = state.selectedIds.size;
  const nodeNames = [...state.selectedIds].map(id => {
    const node = nodes.get(id);
    return node ? node.title : id;
  }).join(', ');

  // 확인 메시지
  const confirmed = confirm(`${count}개의 노드를 삭제하시겠습니까?\n\n${nodeNames}\n\n이 작업은 파일을 완전히 삭제하며, Cmd+Z로 되돌릴 수 없습니다.`);
  if (!confirmed) return;

  saveState(); // 삭제 전 상태 저장

  const deletePromises = [];
  const deletedIds = [];

  state.selectedIds.forEach(nodeId => {
    const node = nodes.get(nodeId);
    if (node && node.fullPath) {
      // 파일 삭제
      deletePromises.push(window.desktopApi.deleteNote(node.fullPath));
      deletedIds.push(nodeId);

      // 다른 노드들의 링크에서 제거
      nodes.forEach((otherNode) => {
        if (otherNode.links.has(nodeId)) {
          otherNode.links.delete(nodeId);
        }
      });

      // 메모리에서 제거
      nodes.delete(nodeId);
    }
  });

  try {
    await Promise.all(deletePromises);
    state.selectedIds.clear();
    state.isDirty = true;
    renderSections();
    showToast(`${count}개의 노드가 삭제되었습니다. Cmd+S로 저장하세요.`);
  } catch (error) {
    showToast('삭제 중 오류가 발생했습니다.', 'error');
    console.error('Delete error:', error);
  }
}

function saveState() {
  const snapshot = {
    nodes: new Map(),
    timestamp: Date.now(),
  };

  nodes.forEach((node, id) => {
    snapshot.nodes.set(id, {
      ...node,
      links: new Set(node.links),
    });
  });

  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(snapshot);
  state.historyIndex = state.history.length - 1;

  if (state.history.length > 50) {
    state.history.shift();
    state.historyIndex--;
  }

  state.isDirty = true; // 변경사항 있음 표시
  console.log('State saved - historyIndex:', state.historyIndex, 'history length:', state.history.length);
}

const state = {
  selectedIds: new Set(),
  search: '',
  filters: {
    aTypes: new Set(['task', 'note']),
    bLevels: new Set(['project', 'goal', 'area', 'resource']),
  },
  dragPayload: null,
  modalType: null,
  history: [],
  historyIndex: -1,
  isDirty: false, // 저장되지 않은 변경사항 추적
  deleteHoverTimer: null, // 드래그 삭제 타이머
  deleteHoverTarget: null, // 드래그 삭제 대상
  pendingConnection: null, // 노드 생성 후 자동 연결할 노드 ID
};

const dom = {
  aList: document.getElementById('aList'),
  bList: document.getElementById('bList'),
  globalSearch: document.getElementById('globalSearch'),
  aTypeFilter: document.getElementById('aTypeFilter'),
  bLevelFilter: document.getElementById('bLevelFilter'),
  editPanel: document.getElementById('editPanel'),
  panelTitle: document.getElementById('panelTitle'),
  panelSubtitle: document.getElementById('panelSubtitle'),
  panelBody: document.getElementById('panelBody'),
  nodeModal: document.getElementById('nodeModal'),
  modalTitle: document.getElementById('modalTitle'),
  nodeForm: document.getElementById('nodeForm'),
  actionableGroup: document.getElementById('actionableGroup'),
  closeModal: document.getElementById('closeModal'),
  toastContainer: document.getElementById('toastContainer'),
  onboardingModal: document.getElementById('onboardingModal'),
  showOnboarding: document.getElementById('showOnboarding'),
  selectRootFolder: document.getElementById('selectRootFolder'),
};

function ensureLinkSet(node) {
  if (!node) return null;
  if (!(node.links instanceof Set)) {
    const source = node.links;
    if (Array.isArray(source)) {
      node.links = new Set(source);
    } else if (source && typeof source[Symbol.iterator] === 'function') {
      node.links = new Set([...source]);
    } else {
      node.links = new Set();
    }
  }
  return node;
}

function createNode(payload) {
  return ensureLinkSet({ ...payload });
}

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSectionForType(type) {
  return typeMeta[type]?.section;
}

function getNodesBySection(section) {
  return [...nodes.values()].filter((node) => getSectionForType(node.type) === section);
}

function filterNodes(list, section) {
  const searchTerm = state.search.toLowerCase();
  return list.filter((node) => {
    const matchesSearch = node.title.toLowerCase().includes(searchTerm);
    if (!matchesSearch) return false;
    if (section === 'A') {
      if (!state.filters.aTypes.has(node.type)) return false;
    }
    if (section === 'B') {
      if (!state.filters.bLevels.has(node.type)) return false;
    }
    return true;
  });
}

function renderSections() {
  renderSection('A', dom.aList);
  renderSection('B', dom.bList);
  updateCardStates();
  updateBanner();
  renderPanel();
}

function renderSection(section, container) {
  container.innerHTML = '';
  const template = document.getElementById('nodeCardTemplate');
  const nodesToRender = filterNodes(getNodesBySection(section), section);

  if (!nodesToRender.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '아직 노드가 없습니다.';
    container.appendChild(empty);
    return;
  }

  nodesToRender.forEach((node) => {
    const clone = template.content.firstElementChild.cloneNode(true);
    clone.dataset.id = node.id;
    clone.dataset.type = node.type;
    clone.dataset.section = section;
    
    const titleEl = clone.querySelector('.node-title');
    titleEl.textContent = node.title;
    
    // 할 일 타입이고 완료된 경우 취소선 표시
    if (node.type === 'task' && node.completed) {
      titleEl.style.textDecoration = 'line-through';
      titleEl.style.opacity = '0.6';
      clone.classList.add('completed');
    }
    
    let linkCountText = `연결 ${node.links.size}개`;
    // 할 일 타입일 때 일정 표시
    if (node.type === 'task' && node.dueDate) {
      const dueDate = new Date(node.dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      let dateText = '';
      if (daysDiff < 0) {
        dateText = ` (지연 ${Math.abs(daysDiff)}일)`;
      } else if (daysDiff === 0) {
        dateText = ' (오늘)';
      } else if (daysDiff === 1) {
        dateText = ' (내일)';
      } else {
        dateText = ` (${daysDiff}일 후)`;
      }
      linkCountText += dateText;
    }
    clone.querySelector('.link-count').textContent = linkCountText;

    const icon = clone.querySelector('.icon');
    icon.remove();
    clone.style.borderLeftWidth = '4px';
    clone.style.borderLeftColor = typeMeta[node.type].color;
    clone.style.backgroundColor = `color-mix(in srgb, ${typeMeta[node.type].color} 5%, white)`;

    clone.addEventListener('click', (event) => handleCardClick(event, node.id));
    clone.addEventListener('dragstart', (event) => handleDragStart(event, node.id));
    clone.addEventListener('dragend', handleDragEnd);
    clone.addEventListener('dragenter', (event) => handleDragEnter(event, node.id));
    clone.addEventListener('dragleave', (event) => handleDragLeave(event));
    clone.addEventListener('dragover', (event) => handleDragOver(event, node.id));
    clone.addEventListener('drop', (event) => handleDrop(event, node.id));

    container.appendChild(clone);
  });
}

function handleCardClick(event, nodeId) {
  const isMeta = event.metaKey || event.ctrlKey;
  if (!isMeta) {
    state.selectedIds = new Set([nodeId]);
  } else {
    const next = new Set(state.selectedIds);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      const section = getSectionForType(nodes.get(nodeId).type);
      const hasDifferentSection = [...next].some((id) => getSectionForType(nodes.get(id).type) !== section);
      if (hasDifferentSection) {
        showToast('다른 섹션과 함께 선택할 수 없습니다.', 'error');
        return;
      }
      next.add(nodeId);
    }
    state.selectedIds = next;
  }
  updateCardStates();
  updateBanner();
  renderPanel();
}

function updateCardStates() {
  const cards = document.querySelectorAll('.node-card');
  const selected = state.selectedIds;
  const highlightTargets = getHighlightTargets();

  cards.forEach((card) => {
    const id = card.dataset.id;
    card.classList.toggle('selected', selected.has(id));
    card.classList.remove('dimmed');
    if (selected.size && !selected.has(id) && highlightTargets.size && !highlightTargets.has(id)) {
      card.classList.add('dimmed');
    }
  });
}

function getHighlightTargets() {
  if (!state.selectedIds.size) return new Set();
  const targets = new Set();
  state.selectedIds.forEach((id) => {
    const node = nodes.get(id);
    if (node) {
      node.links.forEach((linkedId) => targets.add(linkedId));
    }
  });
  return targets;
}

function updateBanner() {
  // 배너 제거됨 - 더 이상 사용하지 않음
}

function renderPanel() {
  const ids = [...state.selectedIds];
  if (!ids.length) {
    dom.panelTitle.innerHTML = '노드를 선택하세요';
    dom.panelSubtitle.textContent = '하이라이트된 노드만 편집 가능합니다.';
    dom.panelBody.innerHTML = '<p class="empty-state">왼쪽 리스트에서 노드를 선택하면 상세 정보가 여기에 표시됩니다.</p>';
    return;
  }
  if (ids.length > 1) {
    dom.panelTitle.innerHTML = `${ids.length}개의 노드 선택됨`;
    dom.panelSubtitle.textContent = '다중 선택 시 관계 정보만 확인할 수 있습니다.';
    const connections = getHighlightTargets();
    dom.panelBody.innerHTML = `<p>현재 선택과 연결된 노드 ${connections.size}개</p>`;
    return;
  }

  const node = nodes.get(ids[0]);
  if (!node) return;

  dom.panelTitle.innerHTML = `
    <div class="title-edit-wrapper">
      <input type="text" class="title-input" value="${escapeHtml(node.title)}" />
      <span class="edit-icon">✏️</span>
    </div>
  `;
  dom.panelSubtitle.textContent = `${typeMeta[node.type].label} · 연결 ${node.links.size}개`;

  const titleInput = dom.panelTitle.querySelector('.title-input');
  const editIcon = dom.panelTitle.querySelector('.edit-icon');

  editIcon.addEventListener('click', () => {
    titleInput.focus();
    titleInput.select();
  });
  titleInput.addEventListener('input', () => {
    const newTitle = titleInput.value.trim();
    if (newTitle && newTitle !== node.title) {
      saveState();
      node.title = newTitle;
      renderSections();
    }
  });
  titleInput.addEventListener('blur', () => {
    const newTitle = titleInput.value.trim();
    if (newTitle && newTitle !== node.title) {
      saveState();
      node.title = newTitle;
      renderSections();
    }
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleInput.blur();
    }
  });

  dom.panelBody.innerHTML = '';

  const descriptionArea = document.createElement('textarea');
  descriptionArea.className = 'description-area';
  descriptionArea.rows = 8;
  descriptionArea.placeholder = '본문을 입력하세요...';
  descriptionArea.value = node.description ?? '';
  descriptionArea.addEventListener('input', () => {
    if (descriptionArea.value !== node.description) {
      saveState();
      node.description = descriptionArea.value;
    }
  });
  descriptionArea.addEventListener('blur', () => {
    if (descriptionArea.value !== node.description) {
      saveState();
      node.description = descriptionArea.value;
    }
  });

  dom.panelBody.appendChild(descriptionArea);

  // 할 일 타입일 때만 일정과 완료 정보 표시
  if (node.type === 'task') {
    const taskInfoSection = document.createElement('div');
    taskInfoSection.className = 'task-info-section';
    taskInfoSection.style.marginTop = '16px';

    // 완료 여부
    const completedLabel = document.createElement('label');
    completedLabel.className = 'task-info-item';
    completedLabel.innerHTML = `
      <input type="checkbox" class="task-completed-checkbox" ${node.completed ? 'checked' : ''} />
      <span>완료됨</span>
    `;
    taskInfoSection.appendChild(completedLabel);

    const completedCheckbox = completedLabel.querySelector('.task-completed-checkbox');
    completedCheckbox.addEventListener('change', () => {
      saveState();
      node.completed = completedCheckbox.checked;
      renderSections();
    });

    // 일정
    const dueDateLabel = document.createElement('label');
    dueDateLabel.className = 'task-info-item';
    dueDateLabel.innerHTML = `
      <span>일정</span>
      <input type="date" class="task-duedate-input" value="${node.dueDate || ''}" />
    `;
    taskInfoSection.appendChild(dueDateLabel);

    const dueDateInput = dueDateLabel.querySelector('.task-duedate-input');
    dueDateInput.addEventListener('change', () => {
      saveState();
      node.dueDate = dueDateInput.value || null;
      renderSections();
    });

    dom.panelBody.appendChild(taskInfoSection);
  }

  const connectionHeader = document.createElement('div');
  connectionHeader.style.display = 'flex';
  connectionHeader.style.justifyContent = 'space-between';
  connectionHeader.style.alignItems = 'center';
  connectionHeader.style.marginTop = '16px';

  const connectionTitle = document.createElement('h4');
  connectionTitle.textContent = '연결 관리';
  connectionTitle.style.margin = '0';

  const validateBtn = document.createElement('button');
  validateBtn.textContent = '🔍 링크 검증';
  validateBtn.className = 'ghost-btn';
  validateBtn.style.fontSize = '12px';
  validateBtn.addEventListener('click', () => showLinkValidationModal());

  connectionHeader.appendChild(connectionTitle);
  connectionHeader.appendChild(validateBtn);
  dom.panelBody.appendChild(connectionHeader);

  // 관계된 노드 추가 버튼
  const addRelatedSection = document.createElement('div');
  addRelatedSection.style.display = 'flex';
  addRelatedSection.style.gap = '8px';
  addRelatedSection.style.marginBottom = '12px';

  const addNoteBtn = document.createElement('button');
  addNoteBtn.textContent = '+ 관계된 노트';
  addNoteBtn.className = 'secondary';
  addNoteBtn.style.flex = '1';
  addNoteBtn.addEventListener('click', () => {
    state.pendingConnection = node.id;
    openModal('note');
  });

  const addTaskBtn = document.createElement('button');
  addTaskBtn.textContent = '+ 관계된 할 일';
  addTaskBtn.className = 'secondary';
  addTaskBtn.style.flex = '1';
  addTaskBtn.addEventListener('click', () => {
    state.pendingConnection = node.id;
    openModal('task');
  });

  addRelatedSection.appendChild(addNoteBtn);
  addRelatedSection.appendChild(addTaskBtn);
  dom.panelBody.appendChild(addRelatedSection);

  const list = document.createElement('ul');
  list.className = 'connection-list';

  if (!node.links.size) {
    const empty = document.createElement('p');
    empty.textContent = '연결된 노드가 없습니다.';
    dom.panelBody.appendChild(empty);
  } else {
    node.links.forEach((linkedId) => {
      const connected = nodes.get(linkedId);
      if (!connected) return;
      const li = document.createElement('li');
      li.innerHTML = `<span>${connected.title} · ${typeMeta[connected.type].label}</span>`;
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '해제';
      removeBtn.className = 'secondary mini';
      removeBtn.addEventListener('click', () => {
        disconnectNodes(node.id, connected.id);
        renderSections();
        showToast('연결이 해제되었습니다. Cmd+Z로 되돌리기, Cmd+S로 저장하세요.');
      });
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
    dom.panelBody.appendChild(list);
  }

}

async function updateNode(id, nextData) {
  const node = nodes.get(id);
  if (!node) return;
  
  const updated = createNode({ ...node, ...nextData });
  nodes.set(id, updated);
  
  // 파일 저장
  if (node.fullPath) {
    const content = await window.desktopApi.loadNoteContent(node.fullPath);
    if (content.ok) {
      const fm = parseFrontmatter(content.content);
      const body = updated.description || (content.content.startsWith('---')
        ? content.content.slice(content.content.indexOf('\n---', 3) + 4).trim()
        : content.content.trim());
      
      const fmLines = [];
      fmLines.push(`title: ${updated.title}`);
      if (updated.type) fmLines.push(`type: ${updated.type}`);
      
      // 할 일 타입일 때 dueDate와 completed 추가
      if (updated.type === 'task') {
        if (updated.dueDate) {
          fmLines.push(`dueDate: ${updated.dueDate}`);
        }
        if (updated.completed !== undefined) {
          fmLines.push(`completed: ${updated.completed}`);
        }
      }
      
      // links는 현재 메모리 상태를 사용 (양방향 관계 유지)
      const currentLinks = [...updated.links].map(linkId => {
        const linkedNode = nodes.get(linkId);
        return linkedNode ? linkedNode.relativePath : linkId;
      });
      if (currentLinks.length > 0) {
        fmLines.push(`links: [${currentLinks.map(l => `"${l}"`).join(', ')}]`);
      } else {
        fmLines.push(`links: []`);
      }
      
      const newContent = `---\n${fmLines.join('\n')}\n---\n\n${body}`;
      await window.desktopApi.saveNoteContent(node.fullPath, newContent);
    }
  }
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

function evaluateDropTarget(targetId) {
  if (!state.dragPayload) return { allowedIds: [], blocked: [] };
  const evaluations = state.dragPayload.ids.map((sourceId) => ({
    sourceId,
    validation: validateConnection(sourceId, targetId),
  }));
  return {
    allowedIds: evaluations.filter((entry) => entry.validation.ok).map((entry) => entry.sourceId),
    blocked: evaluations.filter((entry) => !entry.validation.ok),
  };
}

function validateConnection(sourceId, targetId) {
  if (sourceId === targetId) return { ok: false, reason: 'self' };
  const source = ensureLinkSet(nodes.get(sourceId));
  const target = ensureLinkSet(nodes.get(targetId));
  if (!source || !target) return { ok: false, reason: 'missing' };
  if (source.links.has(targetId)) return { ok: false, reason: 'duplicate' };

  return { ok: true, reason: null };
}

function getValidationMessage(reason) {
  switch (reason) {
    case 'self':
      return '같은 노드끼리는 연결할 수 없습니다.';
    case 'duplicate':
      return '이미 연결된 조합입니다.';
    case 'missing':
      return '연결 대상 정보를 찾을 수 없습니다.';
    default:
      return '해당 위치에는 연결할 수 없습니다.';
  }
}

function connectNodes(sourceId, targetId, options = {}) {
  const validation = validateConnection(sourceId, targetId);
  if (!validation.ok) {
    if (!options.silent) showToast(getValidationMessage(validation.reason), 'error');
    return false;
  }
  const source = ensureLinkSet(nodes.get(sourceId));
  const target = ensureLinkSet(nodes.get(targetId));

  saveState();
  source.links.add(targetId);
  target.links.add(sourceId);

  return true;
}

function disconnectNodes(sourceId, targetId) {
  const source = nodes.get(sourceId);
  const target = nodes.get(targetId);
  if (!source || !target) return;

  saveState();
  source.links.delete(targetId);
  target.links.delete(sourceId);
}

function getEligibleTargets(nodeId) {
  const node = nodes.get(nodeId);
  if (!node) return [];
  return [...nodes.values()].filter((candidate) => {
    if (candidate.id === nodeId) return false;
    if (node.links.has(candidate.id)) return false;
    return true;
  });
}

function handleDragStart(event, nodeId) {
  if (event.target.closest('button')) {
    event.preventDefault();
    return;
  }
  const node = nodes.get(nodeId);
  if (!node) return;
  event.stopPropagation();
  const section = getSectionForType(node.type);
  const sameSectionSelected = [...state.selectedIds].filter((id) => getSectionForType(nodes.get(id).type) === section);
  const payloadIds = sameSectionSelected.length ? sameSectionSelected : [nodeId];
  state.selectedIds = new Set(payloadIds);
  updateCardStates();
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'all';
    event.dataTransfer.setData('text/plain', nodeId);
  }
  state.dragPayload = { ids: payloadIds, section };
  event.currentTarget.classList.add('dragging');
}

function handleDragEnter(event, targetId) {
  if (!state.dragPayload) return;
  const card = event.currentTarget;

  if (state.dragPayload.ids.includes(targetId)) {
    card.classList.remove('drop-allowed');
    card.classList.add('drop-blocked');
    return;
  }

  // 이미 연결된 노드인지 확인
  const isAlreadyConnected = state.dragPayload.ids.some(sourceId => {
    const sourceNode = nodes.get(sourceId);
    return sourceNode && sourceNode.links.has(targetId);
  });

  if (isAlreadyConnected) {
    // 1.2초 타이머 시작 (이전 타이머가 있으면 취소)
    if (state.deleteHoverTimer) {
      clearTimeout(state.deleteHoverTimer);
    }
    state.deleteHoverTarget = targetId;
    state.deleteHoverTimer = setTimeout(() => {
      card.classList.add('show-delete-icon');
      card.setAttribute('data-delete-mode', 'true');
    }, 1200);
  } else {
    // 연결되지 않은 노드는 일반 드롭 시각 피드백
    const { allowedIds } = evaluateDropTarget(targetId);
    card.classList.toggle('drop-allowed', allowedIds.length > 0);
    card.classList.toggle('drop-blocked', allowedIds.length === 0);
  }
}

function handleDragLeave(event) {
  const card = event.currentTarget;
  const targetId = card.dataset.id;

  // 다른 카드로 이동한 경우에만 정리
  // (같은 카드 내부의 자식 요소로 이동하는 경우는 무시)
  if (!event.relatedTarget || !card.contains(event.relatedTarget)) {
    // 삭제 모드가 활성화되지 않았을 때만 정리
    if (!card.classList.contains('show-delete-icon')) {
      card.classList.remove('drop-allowed', 'drop-blocked');

      // 타이머 취소 (삭제 아이콘이 아직 표시되지 않은 경우)
      if (state.deleteHoverTimer && state.deleteHoverTarget === targetId) {
        clearTimeout(state.deleteHoverTimer);
        state.deleteHoverTimer = null;
        state.deleteHoverTarget = null;
      }
    }
  }
}

function handleDragOver(event, targetId) {
  if (!state.dragPayload) return;
  event.preventDefault();

  const card = event.currentTarget;
  const isDeleteMode = card.classList.contains('show-delete-icon');

  if (isDeleteMode) {
    // 삭제 모드에서는 항상 드롭 허용
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  } else {
    // 일반 모드에서는 기존 로직 사용
    const { allowedIds } = evaluateDropTarget(targetId);
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = allowedIds.length ? 'move' : 'none';
    }
  }
}

function handleDrop(event, targetId) {
  if (!state.dragPayload) return;
  event.preventDefault();

  const card = event.currentTarget;
  const isDeleteMode = card.getAttribute('data-delete-mode') === 'true';

  // 삭제 모드: 연결 해제
  if (isDeleteMode) {
    let disconnectCount = 0;
    state.dragPayload.ids.forEach(sourceId => {
      const sourceNode = nodes.get(sourceId);
      if (sourceNode && sourceNode.links.has(targetId)) {
        disconnectNodes(sourceId, targetId);
        disconnectCount++;
      }
    });
    renderSections();
    if (disconnectCount > 0) {
      const message = disconnectCount > 1 ? `관계 ${disconnectCount}개 해제됨` : '관계가 해제됨';
      showToast(`${message}. Cmd+Z로 되돌리기, Cmd+S로 저장하세요.`);
    }
    resetDragState();
    return;
  }

  // 일반 모드: 연결 생성
  const { allowedIds, blocked } = evaluateDropTarget(targetId);
  if (!allowedIds.length) {
    if (blocked.length) showToast(getValidationMessage(blocked[0].validation.reason), 'error');
    resetDragState();
    return;
  }
  for (const sourceId of allowedIds) {
    connectNodes(sourceId, targetId, { silent: true });
  }
  renderSections();
  const message = allowedIds.length > 1 ? `관계 ${allowedIds.length}개 생성됨` : '관계가 생성됨';
  showToast(`${message}. Cmd+Z로 되돌리기, Cmd+S로 저장하세요.`);
  if (blocked.length) showToast(getValidationMessage(blocked[0].validation.reason), 'error');
  resetDragState();
}

function resetDragState() {
  document.querySelectorAll('.node-card').forEach((card) => {
    card.classList.remove('dragging', 'drop-allowed', 'drop-blocked', 'show-delete-icon');
    card.removeAttribute('data-delete-mode');
  });
  state.dragPayload = null;

  // 타이머 정리
  if (state.deleteHoverTimer) {
    clearTimeout(state.deleteHoverTimer);
    state.deleteHoverTimer = null;
  }
  state.deleteHoverTarget = null;
}

function handleDragEnd() {
  resetDragState();
}

function resetSelection() {
  state.selectedIds.clear();
  updateCardStates();
  updateBanner();
  renderPanel();
}

// 배경 클릭 시 하이라이트 초기화
document.addEventListener('click', (event) => {
  // 카드나 버튼이 아닌 영역 클릭 시
  if (!event.target.closest('.node-card') && 
      !event.target.closest('button') && 
      !event.target.closest('.modal') &&
      !event.target.closest('.edit-panel') &&
      state.selectedIds.size > 0) {
    resetSelection();
  }
});

function bindFilters() {
  dom.globalSearch.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderSections();
  });

  dom.aTypeFilter.addEventListener('click', (event) => {
    const btn = event.target.closest('.filter-card');
    if (!btn) return;
    const type = btn.dataset.type;
    if (state.filters.aTypes.has(type)) {
      state.filters.aTypes.delete(type);
      btn.classList.remove('active');
    } else {
      state.filters.aTypes.add(type);
      btn.classList.add('active');
    }
    renderSections();
  });

  dom.bLevelFilter.addEventListener('click', (event) => {
    const btn = event.target.closest('.filter-card');
    if (!btn) return;
    const type = btn.dataset.type;
    if (state.filters.bLevels.has(type)) {
      state.filters.bLevels.delete(type);
      btn.classList.remove('active');
    } else {
      state.filters.bLevels.add(type);
      btn.classList.add('active');
    }
    renderSections();
  });
}

function openModal(type) {
  state.modalType = type;
  dom.nodeModal.setAttribute('aria-hidden', 'false');
  dom.modalTitle.textContent = `${typeMeta[type].label} 추가`;
  dom.nodeForm.reset();
  dom.actionableGroup.style.display = 'none';
}

function closeModal() {
  dom.nodeModal.setAttribute('aria-hidden', 'true');
  state.modalType = null;
}

document.querySelectorAll('[data-open-modal]').forEach((btn) => {
  btn.addEventListener('click', () => openModal(btn.dataset.openModal));
});

dom.closeModal.addEventListener('click', closeModal);
dom.nodeModal.addEventListener('click', (event) => {
  if (event.target === dom.nodeModal) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (dom.nodeModal.getAttribute('aria-hidden') === 'false') {
      closeModal();
    }
    if (dom.onboardingModal.getAttribute('aria-hidden') === 'false') {
      dom.onboardingModal.setAttribute('aria-hidden', 'true');
    }
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
    event.preventDefault();
    undo();
  }

  // Delete 키로 선택된 노드 삭제
  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIds.size > 0) {
    // 입력 필드에서는 작동하지 않도록
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }
    event.preventDefault();
    deleteSelectedNodes();
  }
});

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!state.modalType || !rootFolder) {
    showToast('루트 폴더를 먼저 선택하세요.', 'error');
    return;
  }
  const formData = new FormData(dom.nodeForm);
  const title = formData.get('title').trim();
  if (!title) {
    showToast('제목을 입력해주세요.', 'error');
    return;
  }
  
  const type = state.modalType;
  const description = formData.get('description')?.trim() || '';
  const actionable = typeMeta[type].section === 'A' ? !!formData.get('actionable') : false;
  
  // 파일명 생성
  const safeTitle = title.replace(/[^a-zA-Z0-9가-힣\s]/g, '').replace(/\s+/g, '-').toLowerCase();
  const dirMap = {
    task: 'tasks',
    note: 'notes',
    project: 'projects',
    goal: 'goals',
    area: 'areas',
  };
  const dir = dirMap[type] || 'misc';
  const relativePath = `${dir}/${safeTitle}.md`;
  
  const frontmatter = `---\ntitle: ${title}\ntype: ${type}\nlinks: []\n---\n\n${description}`;
  
  const result = await window.desktopApi.createNote(relativePath, frontmatter);
  if (!result.ok) {
    showToast(`생성 실패: ${result.error}`, 'error');
    return;
  }
  
  // 노드 추가
  const nodeId = relativePath;
  const node = createNode({
    id: nodeId,
    title,
    type,
    description,
    actionable,
    links: new Set(),
    fullPath: result.fullPath,
    relativePath,
    meta: {
      class: typeMeta[type].section,
      kind: type,
    },
  });
  nodes.set(nodeId, node);

  // 자동 연결 처리
  if (state.pendingConnection) {
    const parentNode = nodes.get(state.pendingConnection);
    if (parentNode) {
      connectNodes(state.pendingConnection, nodeId);
      showToast(`${typeMeta[type].label}이(가) 추가되고 "${parentNode.title}"와 연결되었습니다. Cmd+S로 저장하세요.`);
    } else {
      showToast(`${typeMeta[type].label}이(가) 추가되었습니다.`);
    }
    state.pendingConnection = null;
  } else {
    showToast(`${typeMeta[type].label}이(가) 추가되었습니다.`);
  }

  renderSections();
  closeModal();
}

dom.nodeForm.addEventListener('submit', handleFormSubmit);

function showToast(message, variant = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${variant === 'error' ? 'error' : ''}`;
  toast.textContent = message;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function bindOnboarding() {
  dom.showOnboarding.addEventListener('click', () => {
    dom.onboardingModal.setAttribute('aria-hidden', 'false');
  });
  dom.onboardingModal.addEventListener('click', (event) => {
    if (event.target === dom.onboardingModal || event.target.dataset.closeOnboarding !== undefined) {
      dom.onboardingModal.setAttribute('aria-hidden', 'true');
    }
  });
}

function validateAllLinks() {
  const unidirectionalLinks = [];
  const brokenLinks = [];

  nodes.forEach((node) => {
    node.links.forEach((linkedId) => {
      const linkedNode = nodes.get(linkedId);

      // 깨진 링크 확인
      if (!linkedNode) {
        brokenLinks.push({
          from: node.title,
          fromId: node.id,
          toId: linkedId,
        });
        return;
      }

      // 양방향 확인
      if (!linkedNode.links.has(node.id)) {
        unidirectionalLinks.push({
          from: node.title,
          fromId: node.id,
          to: linkedNode.title,
          toId: linkedId,
        });
      }
    });
  });

  return { unidirectionalLinks, brokenLinks };
}

function showLinkValidationModal() {
  const modal = document.getElementById('linkValidationModal');
  const content = document.getElementById('linkValidationContent');

  const { unidirectionalLinks, brokenLinks } = validateAllLinks();

  let html = '';

  if (unidirectionalLinks.length === 0 && brokenLinks.length === 0) {
    html = '<p style="color: #10b981; font-weight: 500;">✅ 모든 링크가 정상입니다!</p>';
  } else {
    if (unidirectionalLinks.length > 0) {
      html += `<div style="margin-bottom: 20px;">
        <h4 style="color: #f59e0b; margin-bottom: 12px;">⚠️ 일방향 링크 (${unidirectionalLinks.length}개)</h4>
        <p style="font-size: 13px; color: #64748b; margin-bottom: 12px;">아래 링크들은 한쪽에만 설정되어 있습니다. Cmd+S로 저장하면 자동으로 양방향으로 수정됩니다.</p>
        <ul style="list-style: none; padding: 0;">`;

      unidirectionalLinks.forEach(link => {
        html += `<li style="padding: 8px; background: #fef3c7; border-radius: 6px; margin-bottom: 8px; font-size: 13px;">
          <strong>${escapeHtml(link.from)}</strong> → ${escapeHtml(link.to)}
          <div style="font-size: 11px; color: #92400e; margin-top: 4px;">
            "${escapeHtml(link.to)}"에는 역방향 링크가 없습니다.
          </div>
        </li>`;
      });

      html += '</ul></div>';
    }

    if (brokenLinks.length > 0) {
      html += `<div>
        <h4 style="color: #dc2626; margin-bottom: 12px;">❌ 깨진 링크 (${brokenLinks.length}개)</h4>
        <p style="font-size: 13px; color: #64748b; margin-bottom: 12px;">참조하는 노드가 존재하지 않습니다.</p>
        <ul style="list-style: none; padding: 0;">`;

      brokenLinks.forEach(link => {
        html += `<li style="padding: 8px; background: #fee2e2; border-radius: 6px; margin-bottom: 8px; font-size: 13px;">
          <strong>${escapeHtml(link.from)}</strong> → <code>${escapeHtml(link.toId)}</code>
          <div style="font-size: 11px; color: #991b1b; margin-top: 4px;">
            대상 노드를 찾을 수 없습니다.
          </div>
        </li>`;
      });

      html += '</ul></div>';
    }
  }

  content.innerHTML = html;
  modal.setAttribute('aria-hidden', 'false');
}

document.getElementById('closeLinkValidation').addEventListener('click', () => {
  document.getElementById('linkValidationModal').setAttribute('aria-hidden', 'true');
});

document.getElementById('linkValidationModal').addEventListener('click', (event) => {
  if (event.target.id === 'linkValidationModal') {
    document.getElementById('linkValidationModal').setAttribute('aria-hidden', 'true');
  }
});

async function loadNotes() {
  const result = await window.desktopApi.getRootFolder();
  rootFolder = result.rootFolder;
  
  nodes.clear();
  if (result.notes && result.notes.length) {
    // 먼저 모든 노드를 생성 (파일 내용에서 상세 정보 읽기)
    for (const note of result.notes) {
      const content = await window.desktopApi.loadNoteContent(note.fullPath);
      if (!content.ok) continue;
      
      const fm = parseFrontmatter(content.content);
      const node = createNode({
        id: note.relativePath,
        title: fm.title || note.meta?.title || note.name.replace('.md', ''),
        type: fm.type || note.meta?.kind || note.meta?.rawType || 'note',
        description: fm.description || '',
        actionable: (fm.type || note.meta?.kind) === 'task',
        dueDate: fm.dueDate || null,
        completed: fm.completed || false,
        links: new Set(),
        fullPath: note.fullPath,
        relativePath: note.relativePath,
        meta: note.meta,
      });
      nodes.set(node.id, node);
    }
    
    // 그 다음 links 설정 (relativePath 기반)
    result.notes.forEach((note) => {
      const node = nodes.get(note.relativePath);
      if (node && note.meta?.links) {
        note.meta.links.forEach((linkPath) => {
          // 상대 경로로 연결된 노드 찾기
          const linkedNode = [...nodes.values()].find(n => n.relativePath === linkPath);
          if (linkedNode) {
            node.links.add(linkedNode.id);
          }
        });
      }
    });
  }

  saveState();
  state.isDirty = false; // 초기 로드 시에는 저장할 필요 없음
  renderSections();
}

async function selectRootFolder() {
  const result = await window.desktopApi.selectRootFolder();
  if (result.canceled) return;
  rootFolder = result.rootFolder;
  await loadNotes();
  showToast('폴더가 로드되었습니다.');
}

dom.selectRootFolder.addEventListener('click', selectRootFolder);

// 전역 Cmd+S 저장 핸들러 (한 번만 등록)
let cmdSHandlerRegistered = false;
function registerCmdSHandler() {
  if (cmdSHandlerRegistered) return;
  cmdSHandlerRegistered = true;

  document.addEventListener('keydown', async (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();

      if (!rootFolder) {
        showToast('폴더를 먼저 선택하세요.', 'error');
        return;
      }

      if (!state.isDirty) {
        showToast('저장할 변경사항이 없습니다.');
        return;
      }

      try {
        // 모든 노드를 파일 시스템에 저장
        const savePromises = [];
        nodes.forEach((node) => {
          if (node.fullPath) {
            // 노드 정보 업데이트
            savePromises.push(updateNode(node.id, {
              title: node.title,
              description: node.description,
              completed: node.completed,
              dueDate: node.dueDate,
            }));

            // 링크 정보 업데이트
            const nodeLinks = [...node.links].map(id => {
              const linkedNode = nodes.get(id);
              return linkedNode ? linkedNode.relativePath : id;
            });
            savePromises.push(window.desktopApi.updateNodeLinks(node.fullPath, nodeLinks));
          }
        });

        await Promise.all(savePromises);
        state.isDirty = false;
        showToast('저장되었습니다.');
        console.log('All changes saved to file system');
      } catch (error) {
        console.error('Save failed:', error);
        showToast('저장 중 오류가 발생했습니다.', 'error');
      }
    }
  });
}

async function init() {
  bindFilters();
  bindOnboarding();
  registerCmdSHandler();
  await loadNotes();
}

init();
