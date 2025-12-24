const typeMeta = {
  task: { label: '할 일', section: 'A', color: 'var(--a-task)', icon: '✓' },
  note: { label: '노트', section: 'A', color: 'var(--a-note)', icon: '✎' },
  project: { label: '프로젝트', section: 'B', color: 'var(--b-project)', icon: 'P' },
  goal: { label: '목표', section: 'B', color: 'var(--b-goal)', icon: 'G' },
  area: { label: '영역', section: 'B', color: 'var(--b-area)', icon: 'A' },
  resource: { label: '자원', section: 'B', color: 'var(--b-resource)', icon: 'R' },
};

const nodes = new Map();

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

function seededId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function addSampleData() {
  const samples = [
    {
      id: seededId('task'),
      title: '신규 온보딩 이메일 자동화 작성',
      description: '고객 여정 기반 시나리오 문서화',
      type: 'task',
      actionable: true,
      links: new Set(),
    },
    {
      id: seededId('task'),
      title: '주간 리뷰 노트 구조 만들기',
      description: 'PARA 영역 템플릿 정리',
      type: 'task',
      actionable: true,
      links: new Set(),
    },
    {
      id: seededId('note'),
      title: 'AI 메모 실험 기록',
      description: '노션 API 연결 메모',
      type: 'note',
      actionable: false,
      links: new Set(),
    },
    {
      id: seededId('project'),
      title: 'GTD 워크샵 운영',
      description: '오프라인 이벤트 론칭 준비',
      type: 'project',
      actionable: false,
      links: new Set(),
    },
    {
      id: seededId('goal'),
      title: 'Q3 개인 성과 목표',
      description: '자동화 프로젝트 2건 완료',
      type: 'goal',
      actionable: false,
      links: new Set(),
    },
    {
      id: seededId('area'),
      title: '프로덕트 리서치',
      description: '지속적인 리서치 자산 관리',
      type: 'area',
      actionable: false,
      links: new Set(),
    },
  ];

  samples.forEach((node) => nodes.set(node.id, createNode(node)));

  const task = samples[0];
  const project = samples[3];
  const area = samples[5];
  connectNodes(task.id, project.id, { silent: true });
  connectNodes(task.id, area.id, { silent: true });
}

const state = {
  selectedIds: new Set(),
  search: '',
  filters: {
    aType: 'all',
    bLevel: 'all',
  },
  dragPayload: null,
  modalType: null,
};

const dom = {
  aList: document.getElementById('aList'),
  bList: document.getElementById('bList'),
  globalSearch: document.getElementById('globalSearch'),
  aTypeFilter: document.getElementById('aTypeFilter'),
  bLevelFilter: document.getElementById('bLevelFilter'),
  connectionBanner: document.getElementById('connectionBanner'),
  connectionCount: document.getElementById('connectionCount'),
  clearHighlight: document.getElementById('clearHighlight'),
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
};

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
      if (state.filters.aType !== 'all' && node.type !== state.filters.aType) return false;
    }
    if (section === 'B') {
      if (state.filters.bLevel !== 'all' && node.type !== state.filters.bLevel) return false;
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
    clone.querySelector('.node-title').textContent = node.title;
    clone.querySelector('.link-count').textContent = `연결 ${node.links.size}개`;

    const icon = clone.querySelector('.icon');
    icon.textContent = typeMeta[node.type].icon;
    icon.style.background = typeMeta[node.type].color;

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
      // 멀티 선택을 같은 섹션으로 제한
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
    node.links.forEach((linkedId) => targets.add(linkedId));
  });
  return targets;
}

function updateBanner() {
  if (!state.selectedIds.size) {
    dom.connectionBanner.hidden = true;
    return;
  }
  const highlightTargets = getHighlightTargets();
  dom.connectionBanner.hidden = false;
  dom.connectionCount.textContent = `연결된 노드 ${highlightTargets.size}개`;
}

function renderPanel() {
  const ids = [...state.selectedIds];
  if (!ids.length) {
    dom.panelTitle.textContent = '노드를 선택하세요';
    dom.panelSubtitle.textContent = '하이라이트된 노드만 편집 가능합니다.';
    dom.panelBody.innerHTML = '<p class="empty-state">왼쪽 리스트에서 노드를 선택하면 상세 정보가 여기에 표시됩니다.</p>';
    return;
  }
  if (ids.length > 1) {
    dom.panelTitle.textContent = `${ids.length}개의 노드 선택됨`;
    dom.panelSubtitle.textContent = '다중 선택 시 관계 정보만 확인할 수 있습니다.';
    const connections = getHighlightTargets();
    dom.panelBody.innerHTML = `<p>현재 선택과 연결된 노드 ${connections.size}개</p>`;
    return;
  }

  const node = nodes.get(ids[0]);
  dom.panelTitle.textContent = node.title;
  dom.panelSubtitle.textContent = `${typeMeta[node.type].label} · 연결 ${node.links.size}개`;
  dom.panelBody.innerHTML = '';

  const form = document.createElement('form');
  form.innerHTML = `
    <label>제목<input type="text" name="title" value="${escapeHtml(node.title)}" /></label>
    <label>본문<textarea name="description" rows="4">${escapeHtml(node.description ?? '')}</textarea></label>
  `;

  if (getSectionForType(node.type) === 'A') {
    const toggleWrapper = document.createElement('label');
    toggleWrapper.textContent = '실행 가능 여부';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'actionable';
    checkbox.checked = !!node.actionable;
    checkbox.addEventListener('change', () => {
      updateNode(node.id, { actionable: checkbox.checked });
      showToast('행동 가능 여부가 업데이트되었습니다.');
    });
    toggleWrapper.appendChild(checkbox);
    form.appendChild(toggleWrapper);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    updateNode(node.id, {
      title: formData.get('title').trim(),
      description: formData.get('description'),
    });
    renderSections();
    showToast('노드 정보가 저장되었습니다.');
  });

  dom.panelBody.appendChild(form);

  const connectionTitle = document.createElement('h4');
  connectionTitle.textContent = '연결 관리';
  dom.panelBody.appendChild(connectionTitle);

  const list = document.createElement('ul');
  list.className = 'connection-list';

  if (!node.links.size) {
    const empty = document.createElement('p');
    empty.textContent = '연결된 노드가 없습니다.';
    dom.panelBody.appendChild(empty);
  } else {
    node.links.forEach((id) => {
      const connected = nodes.get(id);
      const li = document.createElement('li');
      li.innerHTML = `<span>${connected.title} · ${typeMeta[connected.type].label}</span>`;
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '연결 해제';
      removeBtn.className = 'secondary';
      removeBtn.addEventListener('click', () => {
        disconnectNodes(node.id, connected.id);
        renderSections();
        showToast('연결이 해제되었습니다.');
      });
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
    dom.panelBody.appendChild(list);
  }

  const eligible = getEligibleTargets(node.id);
  if (eligible.length) {
    const adder = document.createElement('div');
    adder.className = 'connection-adder';

    const select = document.createElement('select');
    eligible.forEach((target) => {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = `${target.title} · ${typeMeta[target.type].label}`;
      select.appendChild(option);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '연결 추가';
    addBtn.className = 'primary';
    addBtn.addEventListener('click', () => {
      if (!select.value) return;
      const added = connectNodes(node.id, select.value);
      if (added) {
        renderSections();
        showToast('새로운 연결이 생성되었습니다.');
      }
    });

    adder.append(select, addBtn);
    dom.panelBody.appendChild(adder);
  } else {
    const info = document.createElement('p');
    info.textContent = '연결 가능한 노드가 없습니다.';
    dom.panelBody.appendChild(info);
  }
}

function updateNode(id, nextData) {
  const node = nodes.get(id);
  nodes.set(id, createNode({ ...node, ...nextData }));
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

  const sourceSection = getSectionForType(source.type);
  const targetSection = getSectionForType(target.type);

  if (sourceSection === 'A' && targetSection === 'A') {
    if (source.type === target.type) {
      return { ok: false, reason: 'sameTypeA' };
    }
  }
  return { ok: true, reason: null };
}

function getValidationMessage(reason) {
  switch (reason) {
    case 'self':
      return '같은 노드끼리는 연결할 수 없습니다.';
    case 'sameTypeA':
      return '할 일↔할 일 또는 노트↔노트는 연결할 수 없습니다.';
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
  source.links.add(targetId);
  target.links.add(sourceId);
  return true;
}

function disconnectNodes(sourceId, targetId) {
  const source = nodes.get(sourceId);
  const target = nodes.get(targetId);
  if (!source || !target) return;
  source.links.delete(targetId);
  target.links.delete(sourceId);
}

function getEligibleTargets(nodeId) {
  const node = nodes.get(nodeId);
  if (!node) return [];
  const section = getSectionForType(node.type);
  return [...nodes.values()].filter((candidate) => {
    if (candidate.id === nodeId) return false;
    if (node.links.has(candidate.id)) return false;
    const candidateSection = getSectionForType(candidate.type);
    if (section === 'A' && candidateSection === 'A' && candidate.type === node.type) {
      return false;
    }
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
  const { allowedIds } = evaluateDropTarget(targetId);
  card.classList.toggle('drop-allowed', allowedIds.length > 0);
  card.classList.toggle('drop-blocked', allowedIds.length === 0);
}

function handleDragLeave(event) {
  const card = event.currentTarget;
  card.classList.remove('drop-allowed', 'drop-blocked');
}

function handleDragOver(event, targetId) {
  if (!state.dragPayload) return;
  event.preventDefault();
  const { allowedIds } = evaluateDropTarget(targetId);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = allowedIds.length ? 'move' : 'none';
  }
}

function handleDrop(event, targetId) {
  if (!state.dragPayload) return;
  event.preventDefault();
  const { allowedIds, blocked } = evaluateDropTarget(targetId);
  if (!allowedIds.length) {
    if (blocked.length) showToast(getValidationMessage(blocked[0].validation.reason), 'error');
    resetDragState();
    return;
  }
  allowedIds.forEach((sourceId) => connectNodes(sourceId, targetId, { silent: true }));
  renderSections();
  showToast(allowedIds.length > 1 ? `관계 ${allowedIds.length}개 생성` : '관계가 생성되었습니다.');
  if (blocked.length) showToast(getValidationMessage(blocked[0].validation.reason), 'error');
  resetDragState();
}

function resetDragState() {
  document.querySelectorAll('.node-card').forEach((card) => {
    card.classList.remove('dragging', 'drop-allowed', 'drop-blocked');
  });
  state.dragPayload = null;
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

dom.clearHighlight.addEventListener('click', resetSelection);

function bindFilters() {
  dom.globalSearch.addEventListener('input', (event) => {
    state.search = event.target.value;
    renderSections();
  });

  dom.aTypeFilter.addEventListener('change', (event) => {
    state.filters.aType = event.target.value;
    renderSections();
  });

  dom.bLevelFilter.addEventListener('change', (event) => {
    state.filters.bLevel = event.target.value;
    renderSections();
  });
}

function openModal(type) {
  state.modalType = type;
  dom.nodeModal.setAttribute('aria-hidden', 'false');
  dom.modalTitle.textContent = `${typeMeta[type].label} 추가`;
  dom.nodeForm.reset();
  if (typeMeta[type].section === 'A') {
    dom.actionableGroup.style.display = 'flex';
  } else {
    dom.actionableGroup.style.display = 'none';
  }
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

function handleFormSubmit(event) {
  event.preventDefault();
  if (!state.modalType) return;
  const formData = new FormData(dom.nodeForm);
  const entry = {
    id: seededId(state.modalType),
    title: formData.get('title').trim(),
    description: formData.get('description')?.trim(),
    type: state.modalType,
    actionable: typeMeta[state.modalType].section === 'A' ? !!formData.get('actionable') : false,
    links: new Set(),
  };
  if (!entry.title) {
    showToast('제목을 입력해주세요.', 'error');
    return;
  }
  nodes.set(entry.id, createNode(entry));
  renderSections();
  closeModal();
  showToast(`${typeMeta[state.modalType].label}이(가) 추가되었습니다.`);
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

function init() {
  addSampleData();
  bindFilters();
  bindOnboarding();
  renderSections();
}

init();
