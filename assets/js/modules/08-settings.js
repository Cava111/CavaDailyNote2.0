/* Cava Notebook - 08-settings.js */
            // --- Modal Helpers ---
            function setupModal(triggerId, modalId, closeId, onOpen) {
                const modal = document.getElementById(modalId);
                if (triggerId) { document.getElementById(triggerId).addEventListener('click', () => { if (onOpen) onOpen(); modal.classList.add('visible'); }); }
                if (closeId) { document.getElementById(closeId).addEventListener('click', () => modal.classList.remove('visible')); }
            }
            function setupEditorModal(modalId, onSave) {
                const modal = document.getElementById(modalId);
                modal.querySelector('.save-btn')?.addEventListener('click', () => { if (onSave) onSave(); });
                modal.querySelector('.cancel-btn')?.addEventListener('click', () => modal.classList.remove('visible'));
            }

            // --- RESTORED SETTINGS FUNCTIONS ---
            function renderChatCharacterBar() {
                const bar = ELS.chatCharacterBar;
                bar.innerHTML = '';

                if (state.characters.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'chat-character-empty';
                    empty.textContent = '在设置中添加 AI 角色后，可从这里点选回复';
                    bar.appendChild(empty);
                    return;
                }

                state.characters.forEach(character => {
                    const button = document.createElement('button');
                    const avatar = document.createElement('img');
                    button.type = 'button';
                    button.className = 'chat-character-btn';
                    button.setAttribute('role', 'listitem');
                    button.setAttribute('aria-label', `让 ${character.name} 回复`);
                    button.title = `让 ${character.name} 回复`;
                    avatar.src = character.avatar || DEFAULT_AVATAR;
                    avatar.alt = character.name;
                    button.appendChild(avatar);
                    button.addEventListener('click', async () => {
                        if (button.disabled) return;
                        button.disabled = true;
                        button.classList.add('is-responding');
                        button.setAttribute('aria-busy', 'true');
                        try {
                            await triggerAIResponse(character);
                        } finally {
                            button.disabled = false;
                            button.classList.remove('is-responding');
                            button.removeAttribute('aria-busy');
                        }
                    });
                    bar.appendChild(button);
                });
            }

            let editingProxyId = null;
            let proxyEditorAvailableModels = [];
            let proxyEditorSelectedModels = new Set();
            let proxyEditorConnectionState = { status: 'idle', message: '尚未检测' };
            let proxyConnectionAbortController = null;

            function normalizeProxyBaseUrl(value) {
                return value.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
            }

            function renderProxyList() {
                const list = document.getElementById('proxy-list');
                list.innerHTML = '';
                if (state.proxies.length === 0) {
                    list.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">还没有任何代理，快添加一个吧！</p>';
                    return;
                }

                state.proxies.forEach(proxy => {
                    const item = document.createElement('div');
                    const titleRow = document.createElement('div');
                    const name = document.createElement('div');
                    const status = document.createElement('div');
                    const dot = document.createElement('span');
                    const statusText = document.createElement('span');
                    const details = document.createElement('div');
                    const modelCount = document.createElement('div');
                    const actions = document.createElement('div');
                    const editButton = document.createElement('button');
                    const deleteButton = document.createElement('button');
                    const enabledModels = proxy.models ? proxy.models.split(',').filter(Boolean) : [];
                    const connectionStatus = proxy.connectionStatus === 'valid' || proxy.connectionStatus === 'invalid'
                        ? proxy.connectionStatus
                        : 'idle';

                    item.className = 'list-item-setting';
                    titleRow.className = 'proxy-list-title-row';
                    name.className = 'name';
                    name.textContent = proxy.name || '未命名代理';
                    status.className = `proxy-list-status ${connectionStatus}`;
                    dot.className = 'proxy-status-dot';
                    statusText.textContent = connectionStatus === 'valid' ? 'Valid' : connectionStatus === 'invalid' ? '连接失败' : '未检测';
                    status.append(dot, statusText);
                    titleRow.append(name, status);

                    details.className = 'details';
                    details.textContent = `URL: ${proxy.url}`;
                    modelCount.className = 'proxy-list-models';
                    modelCount.textContent = `已启用 ${enabledModels.length} 个模型`;

                    actions.className = 'list-item-actions';
                    editButton.className = 'edit-proxy';
                    editButton.title = '编辑';
                    editButton.innerHTML = appIcon('edit');
                    deleteButton.className = 'delete-proxy';
                    deleteButton.title = '删除';
                    deleteButton.innerHTML = appIcon('trash');
                    editButton.addEventListener('click', () => openProxyEditor(proxy.id));
                    deleteButton.addEventListener('click', () => deleteProxy(proxy.id));
                    actions.append(editButton, deleteButton);
                    item.append(titleRow, details, modelCount, actions);
                    list.appendChild(item);
                });
            }

            function setProxyConnectionState(status, message) {
                proxyEditorConnectionState = { status, message };
                const statusElement = document.getElementById('proxy-connection-status');
                const testButton = document.getElementById('proxy-test-connection-btn');
                const saveButton = document.querySelector('#proxy-editor-modal .save-btn');
                statusElement.className = `proxy-connection-status ${status}`;
                statusElement.querySelector('.proxy-status-text').textContent = message;
                testButton.disabled = status === 'checking';
                testButton.textContent = status === 'checking' ? '正在检测…' : '检测连接并拉取模型';
                saveButton.disabled = status === 'checking';
            }

            function renderProxyModelPicker() {
                const list = document.getElementById('proxy-models-list');
                const summary = document.getElementById('proxy-models-summary');
                const allModels = [...new Set([...proxyEditorAvailableModels, ...proxyEditorSelectedModels])]
                    .sort((a, b) => {
                        const selectedDifference = Number(proxyEditorSelectedModels.has(b)) - Number(proxyEditorSelectedModels.has(a));
                        return selectedDifference || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                    });

                summary.textContent = proxyEditorAvailableModels.length
                    ? `已启用 ${proxyEditorSelectedModels.size} / 可用 ${proxyEditorAvailableModels.length}`
                    : proxyEditorSelectedModels.size
                        ? `已启用 ${proxyEditorSelectedModels.size}（待刷新）`
                        : '连接后自动拉取';
                list.innerHTML = '';

                if (allModels.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'proxy-models-empty';
                    empty.textContent = '填写 Base URL 和 API Key 后将自动拉取模型';
                    list.appendChild(empty);
                    return;
                }

                allModels.forEach(modelId => {
                    const option = document.createElement('label');
                    const checkbox = document.createElement('input');
                    const text = document.createElement('span');
                    option.className = 'proxy-model-option';
                    checkbox.type = 'checkbox';
                    checkbox.checked = proxyEditorSelectedModels.has(modelId);
                    text.textContent = modelId;
                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) proxyEditorSelectedModels.add(modelId);
                        else proxyEditorSelectedModels.delete(modelId);
                        renderProxyModelPicker();
                    });
                    option.append(checkbox, text);
                    list.appendChild(option);
                });
            }

            function extractProxyModels(payload) {
                const source = Array.isArray(payload)
                    ? payload
                    : Array.isArray(payload?.data)
                        ? payload.data
                        : Array.isArray(payload?.models)
                            ? payload.models
                            : [];
                return [...new Set(source.map(model => {
                    if (typeof model === 'string') return model;
                    return model?.id || model?.name || model?.model || '';
                }).filter(Boolean))];
            }

            function extractProxyError(payload, fallback) {
                return payload?.error?.message
                    || payload?.message
                    || (typeof payload?.error === 'string' ? payload.error : '')
                    || fallback;
            }

            async function testProxyConnection() {
                if (proxyEditorConnectionState.status === 'checking') return;
                const rawUrl = document.getElementById('proxy-editor-url').value;
                const apiKey = document.getElementById('proxy-editor-apikey').value.trim();
                const baseUrl = normalizeProxyBaseUrl(rawUrl);

                if (!baseUrl || !apiKey) {
                    setProxyConnectionState('invalid', '连接失败：请填写 Base URL 和 API Key');
                    return;
                }

                try {
                    const parsedUrl = new URL(baseUrl);
                    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Base URL 必须使用 http 或 https');
                } catch (error) {
                    setProxyConnectionState('invalid', `连接失败：${error.message || 'Base URL 格式不正确'}`);
                    return;
                }

                setProxyConnectionState('checking', '正在连接…');
                const controller = new AbortController();
                proxyConnectionAbortController = controller;
                const timeoutId = setTimeout(() => controller.abort(), 12000);

                try {
                    const response = await fetch(`${baseUrl}/v1/models`, {
                        method: 'GET',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
                        signal: controller.signal
                    });
                    let payload = null;
                    try { payload = await response.json(); } catch (_) { /* 在下方统一报告非 JSON 响应 */ }
                    if (!response.ok) {
                        throw new Error(extractProxyError(payload, `HTTP ${response.status}`));
                    }
                    if (!payload) throw new Error('服务返回的不是有效 JSON');

                    proxyEditorAvailableModels = extractProxyModels(payload);
                    renderProxyModelPicker();
                    setProxyConnectionState('valid', proxyEditorAvailableModels.length
                        ? `Valid · 已拉取 ${proxyEditorAvailableModels.length} 个模型`
                        : 'Valid · 服务未返回模型条目');
                } catch (error) {
                    if (proxyConnectionAbortController !== controller) return;
                    const reason = error.name === 'AbortError'
                        ? '请求超时'
                        : error.message === 'Failed to fetch'
                            ? '网络错误或跨域限制'
                            : error.message;
                    setProxyConnectionState('invalid', `连接失败：${reason}`);
                } finally {
                    clearTimeout(timeoutId);
                    if (proxyConnectionAbortController === controller) proxyConnectionAbortController = null;
                }
            }

            function openProxyEditor(id = null) {
                editingProxyId = id;
                const modal = document.getElementById('proxy-editor-modal');
                const title = document.getElementById('proxy-editor-title');
                const name = document.getElementById('proxy-editor-name');
                const url = document.getElementById('proxy-editor-url');
                const apiKey = document.getElementById('proxy-editor-apikey');
                const modelsToggle = document.getElementById('proxy-models-toggle');
                const modelsPanel = document.getElementById('proxy-models-panel');
                const existingProxy = id ? state.proxies.find(proxy => proxy.id === id) : null;

                title.textContent = existingProxy ? '编辑代理' : '添加新代理';
                name.value = existingProxy?.name || '';
                url.value = existingProxy?.url || '';
                apiKey.value = existingProxy?.apiKey || '';
                proxyEditorSelectedModels = new Set(existingProxy?.models ? existingProxy.models.split(',').filter(Boolean) : []);
                proxyEditorAvailableModels = [...proxyEditorSelectedModels];
                modelsPanel.hidden = true;
                modelsToggle.setAttribute('aria-expanded', 'false');
                modelsToggle.onclick = () => {
                    modelsPanel.hidden = !modelsPanel.hidden;
                    modelsToggle.setAttribute('aria-expanded', String(!modelsPanel.hidden));
                };
                document.getElementById('proxy-test-connection-btn').onclick = testProxyConnection;

                const resetConnectionState = () => {
                    if (proxyConnectionAbortController) proxyConnectionAbortController.abort();
                    proxyConnectionAbortController = null;
                    setProxyConnectionState('idle', '配置已更改，等待检测');
                };
                const autoTestIfReady = () => {
                    if (url.value.trim() && apiKey.value.trim()) testProxyConnection();
                };
                url.oninput = resetConnectionState;
                apiKey.oninput = resetConnectionState;
                url.onchange = autoTestIfReady;
                apiKey.onchange = autoTestIfReady;

                renderProxyModelPicker();
                setProxyConnectionState(existingProxy?.connectionStatus || 'idle', existingProxy?.connectionStatus === 'valid'
                    ? 'Valid · 正在刷新模型列表'
                    : existingProxy?.connectionStatus === 'invalid'
                        ? '上次检测连接失败 · 正在重试'
                        : '尚未检测');
                modal.classList.add('visible');
                if (existingProxy && url.value.trim() && apiKey.value.trim()) {
                    setTimeout(testProxyConnection, 0);
                }
            }

            async function saveProxy() {
                const url = normalizeProxyBaseUrl(document.getElementById('proxy-editor-url').value);
                const apiKey = document.getElementById('proxy-editor-apikey').value.trim();
                if (!url || !apiKey) {
                    setProxyConnectionState('invalid', '连接失败：请填写 Base URL 和 API Key');
                    return;
                }

                const proxyData = {
                    name: document.getElementById('proxy-editor-name').value.trim(),
                    url,
                    apiKey,
                    models: [...proxyEditorSelectedModels].join(','),
                    connectionStatus: proxyEditorConnectionState.status === 'valid' ? 'valid' : proxyEditorConnectionState.status === 'invalid' ? 'invalid' : 'idle',
                    connectionMessage: proxyEditorConnectionState.message,
                    connectionCheckedAt: ['valid', 'invalid'].includes(proxyEditorConnectionState.status) ? Date.now() : null
                };
                if (editingProxyId) {
                    proxyData.id = editingProxyId;
                    await db.apiProxies.put(proxyData);
                    const index = state.proxies.findIndex(proxy => proxy.id === editingProxyId);
                    state.proxies[index] = proxyData;
                } else {
                    const id = await db.apiProxies.add(proxyData);
                    state.proxies.push({ ...proxyData, id });
                }
                renderProxyList();
                document.getElementById('proxy-editor-modal').classList.remove('visible');
            }
            async function deleteProxy(id) { if (confirm('确定要删除这个代理吗？')) { await db.apiProxies.delete(id); state.proxies = state.proxies.filter(p => p.id !== id); renderProxyList(); } }

            let editingCharId = null;
            function renderCharacterList() { const list = document.getElementById('character-list'); list.innerHTML = ''; if (state.characters.length === 0) { list.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">还没有任何角色，快创建一个吧！</p>'; } state.characters.forEach(c => { const item = document.createElement('div'); item.className = 'list-item-setting'; item.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><img src="${c.avatar || DEFAULT_AVATAR}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;"><span class="name">${c.name}</span></div><div class="list-item-actions"><button class="edit-char" data-id="${c.id}" title="编辑">${appIcon('edit')}</button><button class="delete-char" data-id="${c.id}" title="删除">${appIcon('trash')}</button></div>`; item.querySelector('.edit-char').addEventListener('click', () => openCharacterEditor(c.id)); item.querySelector('.delete-char').addEventListener('click', () => deleteCharacter(c.id)); list.appendChild(item); }); }
            function populateModelsForProxy(proxySelectId, modelSelectId, selectedProxyId, selectedModel) { const modelSelect = document.getElementById(modelSelectId); modelSelect.innerHTML = '<option value="">-- 请先选API --</option>'; if (!selectedProxyId) return; const proxy = state.proxies.find(p => p.id === parseInt(selectedProxyId)); if (proxy && proxy.models) { modelSelect.innerHTML = '<option value="">-- 选择模型 --</option>'; const models = proxy.models.split(',').map(m => m.trim()).filter(Boolean); models.forEach(modelName => { const option = document.createElement('option'); option.value = modelName; option.textContent = modelName; if (modelName === selectedModel) { option.selected = true; } modelSelect.appendChild(option); }); } }
            function openCharacterEditor(id = null) {
                editingCharId = id;
                const modal = document.getElementById('character-editor-modal');
                const title = document.getElementById('character-editor-title');
                const name = document.getElementById('character-editor-name');
                const avatarPreview = document.getElementById('character-editor-avatar-preview');
                const prompt = document.getElementById('character-editor-prompt');
                const proxySelect = document.getElementById('character-editor-proxy');
                const backupProxySelect = document.getElementById('character-editor-backup-proxy');
                const modelSelect = document.getElementById('character-editor-model');
                const backupModelSelect = document.getElementById('character-editor-backup-model');

                proxySelect.innerHTML = '<option value="">-- 选择主用API --</option>';
                backupProxySelect.innerHTML = '<option value="">-- 选择备用API --</option>';
                state.proxies.forEach(p => { const optionText = p.name || p.url; const option = `<option value="${p.id}">${optionText}</option>`; proxySelect.innerHTML += option; backupProxySelect.innerHTML += option; });
                proxySelect.onchange = () => populateModelsForProxy('character-editor-proxy', 'character-editor-model', proxySelect.value, null);
                backupProxySelect.onchange = () => populateModelsForProxy('character-editor-backup-proxy', 'character-editor-backup-model', backupProxySelect.value, null);

                document.getElementById('upload-char-avatar-btn').onclick = () => document.getElementById('character-editor-avatar-input').click();
                document.getElementById('character-editor-avatar-input').onchange = (e) => {
                    handleAvatarUpload(e, (base64) => { avatarPreview.src = base64; });
                };

                if (id) {
                    const char = state.characters.find(c => c.id === id);
                    title.textContent = "编辑角色"; name.value = char.name;
                    avatarPreview.src = char.avatar || DEFAULT_AVATAR;
                    prompt.value = char.prompt;
                    proxySelect.value = char.proxyId;
                    populateModelsForProxy('character-editor-proxy', 'character-editor-model', char.proxyId, char.model);
                    backupProxySelect.value = char.backupProxyId;
                    populateModelsForProxy('character-editor-backup-proxy', 'character-editor-backup-model', char.backupProxyId, char.backupModel);
                    applyCharParamsToEditor(char.aiParams);
                } else {
                    title.textContent = "添加新角色";
                    name.value = '';
                    avatarPreview.src = DEFAULT_AVATAR;
                    prompt.value = '';
                    proxySelect.value = '';
                    backupProxySelect.value = '';
                    modelSelect.innerHTML = '<option value="">-- 请先选API --</option>';
                    backupModelSelect.innerHTML = '<option value="">-- 请先选API --</option>';
                    applyCharParamsToEditor(null);
                }
                modal.classList.add('visible');
            }
            async function saveCharacter() {
                const characterData = {
                    name: document.getElementById('character-editor-name').value.trim(),
                    avatar: document.getElementById('character-editor-avatar-preview').src,
                    prompt: document.getElementById('character-editor-prompt').value.trim(),
                    proxyId: parseInt(document.getElementById('character-editor-proxy').value) || null,
                    model: document.getElementById('character-editor-model').value,
                    backupProxyId: parseInt(document.getElementById('character-editor-backup-proxy').value) || null,
                    backupModel: document.getElementById('character-editor-backup-model').value,
                    aiParams: collectCharParamsFromEditor()
                };

                if (editingCharId) {
                    await db.aiCharacters.update(editingCharId, characterData);

                    const index = state.characters.findIndex(c => c.id === editingCharId);
                    if (index !== -1) {
                        state.characters[index] = { ...state.characters[index], ...characterData };
                    }
                } else {
                    const id = await db.aiCharacters.add(characterData);
                    state.characters.push({ ...characterData, id });
                }

                // 3. 收尾工作（这部分也是正确的）
                renderCharacterList();
                renderChatCharacterBar();
                renderChatMessages();
                document.getElementById('character-editor-modal').classList.remove('visible');
                editingCharId = null; // 清空正在编辑的ID
            }
            async function deleteCharacter(id) { if (confirm('确定要删除这个角色吗？')) { await db.aiCharacters.delete(id); state.characters = state.characters.filter(c => c.id !== id); renderCharacterList(); renderChatCharacterBar(); renderChatMessages(); } }

            let currentlyEditingCurrencyCode = null;
            function openCurrencyEditor(curr = null) {
                const modal = document.getElementById('currency-editor-modal');
                currentlyEditingCurrencyCode = curr ? curr.code : null;
                document.getElementById('currency-editor-title').textContent = curr ? '编辑币种' : '新建币种';
                document.getElementById('currency-editor-code').value = curr ? curr.code : '';
                document.getElementById('currency-editor-code').disabled = !!curr;
                document.getElementById('currency-editor-name').value = curr ? curr.name : '';
                document.getElementById('currency-editor-rate').value = curr ? curr.rate : '';
                modal.classList.add('visible');
            }

            async function saveCurrency() {
                const code = document.getElementById('currency-editor-code').value.trim().toUpperCase();
                const name = document.getElementById('currency-editor-name').value.trim();
                const rate = parseFloat(document.getElementById('currency-editor-rate').value);

                if (!code || !name || isNaN(rate)) { alert('请填写所有字段'); return; }
                if (code.length !== 3) { alert('币种代码必须是3位字母'); return; }

                const currencyData = { code, name, rate };
                await db.currencies.put(currencyData);

                state.currencies = await db.currencies.toArray();
                renderCurrencyList();
                populateLedgerCurrencyFilter();
                document.getElementById('currency-editor-modal').classList.remove('visible');
            }

            function renderCurrencyList() {
                const listEl = document.getElementById('currency-list');
                listEl.innerHTML = '';
                const allCurrencies = [{ code: 'RMB', name: '人民币', rate: 1, isBase: true }, ...state.currencies];

                allCurrencies.forEach(curr => {
                    const item = document.createElement('div');
                    item.className = 'list-item-setting';
                    item.innerHTML = `<div class="name">${curr.name} (${curr.code})</div><div class="details">1 ${curr.code} ≈ ${curr.rate} RMB</div>`;

                    if (!curr.isBase) {
                        const actions = document.createElement('div');
                        actions.className = 'list-item-actions';

                        const editBtn = document.createElement('button');
                        editBtn.innerHTML = appIcon('edit');
                        editBtn.onclick = () => openCurrencyEditor(curr);

                        const deleteBtn = document.createElement('button');
                        deleteBtn.innerHTML = appIcon('trash');
                        deleteBtn.onclick = async () => {
                            if (confirm(`确定要删除 "${curr.name}" 吗？`)) {
                                await db.currencies.delete(curr.code);
                                state.currencies = state.currencies.filter(c => c.code !== curr.code);
                                renderCurrencyList();
                                populateLedgerCurrencyFilter();
                            }
                        };

                        actions.append(editBtn, deleteBtn);
                        item.appendChild(actions);
                    }
                    listEl.appendChild(item);
                });
            }

            function openSystemPromptsEditor() {
                const settings = state.config.systemPromptSettings || DEFAULT_SYSTEM_PROMPTS;
                document.getElementById('system-prompt-send-time').checked = settings.sendTime;
                document.getElementById('system-prompt-send-model').checked = settings.sendModel;
                document.getElementById('system-prompt-send-role').checked = settings.sendRole;
                document.getElementById('system-prompt-ledger').value = settings.ledger;
                document.getElementById('system-prompt-schedule').value = settings.schedule;
                document.getElementById('system-prompt-pie').value = settings.pie;
                document.getElementById('system-prompts-modal').classList.add('visible');
            }

            async function saveSystemPrompts() {
                const newSettings = {
                    sendTime: document.getElementById('system-prompt-send-time').checked,
                    sendModel: document.getElementById('system-prompt-send-model').checked,
                    sendRole: document.getElementById('system-prompt-send-role').checked,
                    ledger: document.getElementById('system-prompt-ledger').value.trim() || DEFAULT_SYSTEM_PROMPTS.ledger,
                    schedule: document.getElementById('system-prompt-schedule').value.trim() || DEFAULT_SYSTEM_PROMPTS.schedule,
                    pie: document.getElementById('system-prompt-pie').value.trim() || DEFAULT_SYSTEM_PROMPTS.pie,
                };
                await updateConfig('systemPromptSettings', newSettings);
                document.getElementById('system-prompts-modal').classList.remove('visible');
            }

            function showAICharacterSelector() {
                const selector = document.getElementById('ai-character-selector');
                selector.innerHTML = '';
                if (state.characters.length === 0) {
                    alert('请先在“设置”中添加AI角色');
                    return;
                }
                state.characters.forEach(char => {
                    const item = document.createElement('div');
                    item.className = 'character-item';
                    item.innerHTML = `<img src="${char.avatar || DEFAULT_AVATAR}" alt="${char.name}"><div class="name">${char.name}</div>`;
                    item.onclick = () => {
                        document.getElementById('ai-character-selector-modal').classList.remove('visible');
                        triggerAIResponse(char);
                    };
                    selector.appendChild(item);
                });
                document.getElementById('ai-character-selector-modal').classList.add('visible');
            }

            // --- Emoji Pack Management ---
            function renderEmojiPackList() {
                const listEl = document.getElementById('emoji-pack-list');
                if (!listEl) return;

                if (state.emojiPacks.length === 0) {
                    listEl.innerHTML = '<div class="empty-state">还没有上传表情包</div>';
                    return;
                }

                listEl.innerHTML = state.emojiPacks.map(emoji => `
                <div class="list-item-setting" style="display: flex; align-items: center; gap: 10px;">
                    <img src="${emoji.image}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 8px;">
                    <div style="flex-grow: 1;">
                        <div class="name">${emoji.name}</div>
                        <div class="details">用于聊天: [emoji:${emoji.name}]</div>
                    </div>
                    <div class="list-item-actions">
                        <button data-id="${emoji.id}" class="delete-emoji-btn">×</button>
                    </div>
                </div>
            `).join('');

                listEl.querySelectorAll('.delete-emoji-btn').forEach(btn => {
                    btn.addEventListener('click', async (e) => {
                        const id = parseInt(e.target.dataset.id);
                        if (confirm('确定要删除这个表情包吗？')) {
                            await db.emojiPacks.delete(id);
                            state.emojiPacks = state.emojiPacks.filter(e => e.id !== id);
                            renderEmojiPackList();
                        }
                    });
                });
            }

            async function openEmojiPackManager() {
                const modal = document.getElementById('emoji-pack-modal');
                if (!modal) {
                    const modalHTML = `
                    <div id="emoji-pack-modal" class="modal-overlay">
                        <div class="modal-content">
                            <div class="modal-header">管理我的表情包</div>
                            <div class="modal-body">
                                <div id="emoji-pack-list"></div>
                                <button class="form-button" id="add-emoji-pack-btn">＋ 添加新表情包</button>
                                <input type="file" id="emoji-pack-file-input" accept="image/*" style="display:none;">
                            </div>
                            <div class="modal-footer">
                                <button class="cancel-btn" id="close-emoji-pack-modal">关闭</button>
                            </div>
                        </div>
                    </div>
                `;
                    document.body.insertAdjacentHTML('beforeend', modalHTML);

                    document.getElementById('add-emoji-pack-btn').addEventListener('click', () => {
                        document.getElementById('emoji-pack-file-input').click();
                    });

                    document.getElementById('emoji-pack-file-input').addEventListener('change', async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const name = prompt('请输入表情包名称（例如：开心、生气、疑惑）：');
                        if (!name) return;
                        const compressedImage = await compressEmojiPack(file);
                        const newEmoji = { name: name, image: compressedImage, timestamp: Date.now() };
                        const id = await db.emojiPacks.add(newEmoji);
                        state.emojiPacks.push({ ...newEmoji, id });
                        renderEmojiPackList();
                        e.target.value = '';
                    });

                    document.getElementById('close-emoji-pack-modal').addEventListener('click', () => {
                        document.getElementById('emoji-pack-modal').classList.remove('visible');
                    });
                }

                renderEmojiPackList();
                document.getElementById('emoji-pack-modal').classList.add('visible');
            }

            document.getElementById('manage-emoji-packs-btn').addEventListener('click', openEmojiPackManager);

            function showEmojiPackSelector() {
                if (state.emojiPacks.length === 0) {
                    alert('还没有上传表情包呢！请先在设置中添加表情包。');
                    return;
                }

                const modal = document.createElement('div');
                modal.className = 'modal-overlay visible';
                modal.innerHTML = `
        <div class="modal-content" style="max-width: 320px;">
            <div class="modal-header">选择表情包</div>
            <div class="modal-body" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 15px;">
                ${state.emojiPacks.map(emoji => `
                    <div class="emoji-pack-item" data-id="${emoji.id}" style="cursor: pointer; text-align: center;">
                        <img src="${emoji.image}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 8px;">
                        <div style="font-size: 10px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${emoji.name}</div>
                    </div>
                `).join('')}
            </div>
            <div class="modal-footer">
                <button class="cancel-btn">取消</button>
            </div>
        </div>
    `;

                document.body.appendChild(modal);

                modal.querySelectorAll('.emoji-pack-item').forEach(item => {
                    item.addEventListener('click', async () => {
                        const emojiId = parseInt(item.dataset.id);
                        const emoji = state.emojiPacks.find(e => e.id === emojiId);
                        if (emoji) {
                            // 发送表情包名称作为消息内容，但类型标记为emoji_pack
                            const newMsg = {
                                timestamp: Date.now(),
                                role: 'user',
                                content: `[emoji:${emoji.name}]`,  // 特殊格式存储
                                type: 'emoji_pack'
                            };
                            const id = await db.messages.add(newMsg);
                            state.messages.push({ ...newMsg, id });
                            renderChatMessages();
                        }
                        modal.remove();
                    });
                });

                modal.querySelector('.cancel-btn').addEventListener('click', () => modal.remove());
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) modal.remove();
                });
            }
            // Call init
            init();
