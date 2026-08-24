/* Cava Notebook - 09-memory.js
 * Summary-memory storage, recall, cursors, automation and management UI.
 */
            let memoryFeatureInitialized = false;
            let memoryAutoTimer = null;
            let memoryAutoBusy = false;
            let memoryManualBusy = false;

            function getMemorySettings() {
                return { ...DEFAULT_MEMORY_SETTINGS, ...(state.config.memorySettings || {}) };
            }

            function sortMessagesChronologically(messages = state.messages) {
                return [...messages].sort((a, b) => (a.timestamp - b.timestamp) || (Number(a.id) - Number(b.id)));
            }

            function toLocalDateKey(value) {
                const date = value instanceof Date ? value : new Date(value);
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            }

            function dateKeyToTimestamp(dateKey, endOfDay = false) {
                const [year, month, day] = dateKey.split('-').map(Number);
                return endOfDay
                    ? new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
                    : new Date(year, month - 1, day).getTime();
            }

            function addDaysToDateKey(dateKey, days) {
                const [year, month, day] = dateKey.split('-').map(Number);
                return toLocalDateKey(new Date(year, month - 1, day + days));
            }

            function compareDateKeys(a, b) {
                return dateKeyToTimestamp(a) - dateKeyToTimestamp(b);
            }

            function formatMemoryDateTime(timestamp) {
                if (!timestamp) return '未知时间';
                return new Date(timestamp).toLocaleString([], {
                    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
            }

            function estimateMemoryTokens(text) {
                return Math.max(1, Math.ceil(String(text || '').length * 2));
            }

            function getMemoryMessageText(message) {
                if (message.type === 'text') return message.content || '';
                if (message.type === 'image') return '[image]';
                if (message.type === 'emoji_pack') return message.content || '[表情包]';
                if (message.type === 'transaction') {
                    const transaction = state.transactions.find(item => item.id === message.relatedId);
                    if (!transaction) return '[已删除的记账]';
                    const category = CATEGORIES[transaction.type]?.find(item => item.id === transaction.category)?.name || '未知分类';
                    return `[记账] ${transaction.type === 'expense' ? '支出' : '收入'} ${transaction.amount}${transaction.currency}，${category}，备注：${transaction.remark || '无'}`;
                }
                if (message.type === 'schedule') {
                    const schedule = state.schedules.find(item => item.id === message.relatedId);
                    if (!schedule) return '[已删除的日程]';
                    return `[TODO] ${schedule.title}；说明：${schedule.description || '无'}；截止：${schedule.deadline ? formatDeadline(schedule.deadline) : '无'}`;
                }
                if (message.type === 'ledger_summary') return '[账本摘要]';
                if (message.type === 'schedule_summary') return '[日程摘要]';
                if (message.type === 'pie_chart_summary') return '[账本图表摘要]';
                if (message.type === 'calendar_view_summary') return '[日历视图摘要]';
                return typeof message.content === 'string' ? message.content : `[${message.type || '消息'}]`;
            }

            function getMemoryMessageSpeaker(message) {
                if (message.role !== 'assistant') return '用户';
                return state.characters.find(item => item.id === message.senderId)?.name || 'AI';
            }

            function buildMemoryTranscript(messages) {
                return sortMessagesChronologically(messages).map((message, index) => {
                    const time = new Date(message.timestamp).toLocaleString();
                    const content = getMemoryMessageText(message);
                    return `${index + 1}. [${time}] ${getMemoryMessageSpeaker(message)}：${content}`;
                }).join('\n');
            }

            function resolveMemorySummarizer(settings = getMemorySettings()) {
                if (settings.summarizerType === 'api') {
                    const proxy = state.proxies.find(item => item.id === Number(settings.proxyId));
                    if (!proxy) throw new Error('请先选择用于总结的代理供应商');
                    const enabledModels = String(proxy.models || '').split(',').map(model => model.trim()).filter(Boolean);
                    if (!settings.model) throw new Error('请先选择用于总结的轻量模型');
                    if (!enabledModels.includes(settings.model)) {
                        throw new Error(`模型“${settings.model}”未在代理“${proxy.name || proxy.url}”中启用`);
                    }
                    return {
                        type: 'api',
                        proxy,
                        model: settings.model,
                        caller: {
                            aiParams: {
                                temperature: 0.3,
                                topP: 0.9,
                                topK: 0,
                                frequencyPenalty: 0,
                                presencePenalty: 0
                            }
                        },
                        name: proxy.name || proxy.url
                    };
                }

                const character = state.characters.find(item => item.id === Number(settings.characterId));
                if (!character) throw new Error('请先选择用于总结的 AI 角色');
                const proxy = state.proxies.find(item => item.id === character.proxyId);
                if (!proxy || !character.model) throw new Error(`角色“${character.name}”未配置可用的主 API 或模型`);
                return { type: 'character', proxy, model: character.model, caller: character, name: character.name };
            }

            function setMemoryOperationStatus(message, type = '') {
                const status = document.getElementById('memory-operation-status');
                if (!status) return;
                status.textContent = message || '';
                status.className = `memory-operation-status ${type}`.trim();
            }

            async function generateMemorySummary(messages, sourceType, range = {}, settings = getMemorySettings()) {
                if (!messages.length) throw new Error('选择的范围内没有可总结的消息');
                const summarizer = resolveMemorySummarizer(settings);
                const transcript = buildMemoryTranscript(messages);
                const systemPrompt = [
                    '你是聊天记录摘要助手。请把给定的较早聊天压缩成一条可长期保存的 Memory。',
                    '保留明确事实、人物关系、偏好、计划、承诺、重要情绪变化与事件结果。',
                    '不要编造，不要根据常识补全缺失信息，不要输出分析过程。',
                    '用简洁、可直接放入未来对话上下文的中文陈述；直接输出摘要正文，不要加标题。'
                ].join('\n');
                const history = [{
                    role: 'user',
                    content: `请总结以下 ${messages.length} 条原始消息：\n\n${transcript}`
                }];
                const content = (await callAPI(summarizer.proxy, systemPrompt, history, summarizer.model, summarizer.caller)).trim();
                if (!content) throw new Error('AI 未返回摘要内容');

                const ordered = sortMessagesChronologically(messages);
                const maxSortOrder = state.memories.reduce((max, memory) => Math.max(max, Number(memory.sortOrder) || 0), -1);
                const memory = {
                    content,
                    startTime: range.startTime ?? ordered[0].timestamp,
                    endTime: range.endTime ?? ordered[ordered.length - 1].timestamp,
                    sourceType,
                    sourceStartId: ordered[0]?.id ?? null,
                    sourceEndId: ordered[ordered.length - 1]?.id ?? null,
                    recallMode: 'always',
                    keywords: [],
                    sortOrder: maxSortOrder + 1,
                    summarizerType: summarizer.type,
                    summarizerName: summarizer.name,
                    summarizerModel: summarizer.model,
                    createdAt: Date.now()
                };
                const id = await db.memories.add(memory);
                const stored = { ...memory, id };
                state.memories.push(stored);
                state.memories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                return stored;
            }

            function getRecentRealUserInput(maxTime = null) {
                return sortMessagesChronologically()
                    .filter(message => message.role === 'user' && (maxTime == null || message.timestamp <= maxTime))
                    .slice(-5)
                    .map(getMemoryMessageText)
                    .join('\n')
                    .toLocaleLowerCase();
            }

            function memoryMatchesKeywords(memory, realUserInput) {
                const keywords = Array.isArray(memory.keywords) ? memory.keywords : [];
                return keywords.some(keyword => {
                    const normalized = String(keyword || '').trim().toLocaleLowerCase();
                    return normalized && realUserInput.includes(normalized);
                });
            }

            function buildMemoryContext(options = {}) {
                const settings = getMemorySettings();
                const tokenLimit = Math.max(0, Number(settings.tokenLimit) || 0);
                if (tokenLimit === 0 || state.memories.length === 0) {
                    return { context: [], tokens: 0, includedIds: [], omittedCount: 0 };
                }

                const maxEndTime = Number.isFinite(options.maxEndTime) ? options.maxEndTime : null;
                const realUserInput = getRecentRealUserInput(maxEndTime);
                const candidates = [...state.memories]
                    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                    .filter(memory => maxEndTime == null
                        || !((memory.startTime != null && Number(memory.startTime) > maxEndTime)
                            || (memory.endTime != null && Number(memory.endTime) > maxEndTime)))
                    .filter(memory => memory.recallMode === 'always'
                        || (memory.recallMode === 'keyword' && memoryMatchesKeywords(memory, realUserInput)));

                const prepared = candidates.map(memory => {
                    const range = `${formatMemoryDateTime(memory.startTime)} ～ ${formatMemoryDateTime(memory.endTime)}`;
                    const content = `[Memory｜${range}]\n${memory.content}`;
                    const tokens = estimateMemoryTokens(content);
                    return { memory, content, tokens };
                });
                let usedTokens = prepared.reduce((sum, item) => sum + item.tokens, 0);
                let firstIncludedIndex = 0;
                while (firstIncludedIndex < prepared.length && usedTokens > tokenLimit) {
                    usedTokens -= prepared[firstIncludedIndex].tokens;
                    firstIncludedIndex++;
                }
                const selected = prepared.slice(firstIncludedIndex);

                return {
                    context: selected.map(item => ({ role: 'system', content: item.content })),
                    tokens: usedTokens,
                    includedIds: selected.map(item => item.memory.id),
                    omittedCount: firstIncludedIndex
                };
            }

            async function persistMemorySettings(nextSettings) {
                await updateConfig('memorySettings', { ...DEFAULT_MEMORY_SETTINGS, ...nextSettings });
            }

            function getMessagesAfterCursor(cursorId) {
                const ordered = sortMessagesChronologically();
                if (cursorId == null) return ordered;
                const exactIndex = ordered.findIndex(message => message.id === cursorId);
                if (exactIndex >= 0) return ordered.slice(exactIndex + 1);
                return ordered.filter(message => Number(message.id) > Number(cursorId));
            }

            function getFirstUnsummarizedDate(settings, orderedMessages) {
                if (settings.dateCursor) return addDaysToDateKey(settings.dateCursor, 1);
                return orderedMessages.length ? toLocalDateKey(orderedMessages[0].timestamp) : null;
            }

            async function runAutomaticMemorySummary() {
                if (memoryAutoBusy) return;
                const settings = getMemorySettings();
                if (!settings.autoEnabled) return;
                memoryAutoBusy = true;
                let shouldContinue = false;

                try {
                    resolveMemorySummarizer(settings);
                    if (settings.mode === 'messages') {
                        const interval = Math.max(1, Number(settings.messageInterval) || 50);
                        const unsummarized = getMessagesAfterCursor(settings.messageCursorId);
                        if (unsummarized.length < interval) return;
                        const batch = unsummarized.slice(0, interval);
                        setMemoryOperationStatus(`自动总结：正在处理 ${batch.length} 条消息…`);
                        await generateMemorySummary(batch, 'messages', {}, settings);
                        settings.messageCursorId = batch[batch.length - 1].id;
                        shouldContinue = unsummarized.length - batch.length >= interval;
                    } else {
                        const ordered = sortMessagesChronologically();
                        const startDate = getFirstUnsummarizedDate(settings, ordered);
                        if (!startDate) return;
                        const days = Math.max(1, Number(settings.dateIntervalDays) || 3);
                        const endDate = addDaysToDateKey(startDate, days - 1);
                        const today = toLocalDateKey(Date.now());
                        if (compareDateKeys(endDate, today) >= 0) return;
                        const startTime = dateKeyToTimestamp(startDate);
                        const endTime = dateKeyToTimestamp(endDate, true);
                        const batch = ordered.filter(message => message.timestamp >= startTime && message.timestamp <= endTime);
                        if (batch.length) {
                            setMemoryOperationStatus(`自动总结：正在处理 ${startDate} ～ ${endDate}…`);
                            await generateMemorySummary(batch, 'date', { startTime, endTime }, settings);
                        }
                        settings.dateCursor = endDate;
                        shouldContinue = compareDateKeys(addDaysToDateKey(endDate, days), today) < 0;
                    }

                    await persistMemorySettings(settings);
                    renderMemoryProgress();
                    renderMemoryList();
                    setMemoryOperationStatus('自动总结完成', 'success');
                } catch (error) {
                    console.error('Automatic memory summary failed:', error);
                    setMemoryOperationStatus(`自动总结失败：${error.message}`, 'error');
                } finally {
                    memoryAutoBusy = false;
                    if (shouldContinue) scheduleMemoryAutoSummary(1400);
                }
            }

            function scheduleMemoryAutoSummary(delay = 700) {
                clearTimeout(memoryAutoTimer);
                if (!getMemorySettings().autoEnabled) return;
                memoryAutoTimer = setTimeout(runAutomaticMemorySummary, delay);
            }

            function populateMemoryCharacterSelect(settings = getMemorySettings()) {
                const select = document.getElementById('memory-character-select');
                select.innerHTML = '<option value="">请选择角色</option>';
                state.characters.forEach(character => {
                    const option = document.createElement('option');
                    option.value = character.id;
                    option.textContent = character.name;
                    select.appendChild(option);
                });
                select.value = settings.characterId == null ? '' : String(settings.characterId);
            }

            function populateMemoryModelSelect(proxyId, selectedModel = '') {
                const select = document.getElementById('memory-model-select');
                const proxy = state.proxies.find(item => item.id === Number(proxyId));
                const models = String(proxy?.models || '').split(',').map(model => model.trim()).filter(Boolean);
                select.innerHTML = models.length ? '<option value="">请选择模型</option>' : '<option value="">该代理尚未启用模型</option>';
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model;
                    option.textContent = model;
                    select.appendChild(option);
                });
                select.value = models.includes(selectedModel) ? selectedModel : '';
            }

            function populateMemoryProxySelect(settings = getMemorySettings()) {
                const select = document.getElementById('memory-proxy-select');
                select.innerHTML = '<option value="">请选择代理</option>';
                state.proxies.forEach(proxy => {
                    const option = document.createElement('option');
                    option.value = proxy.id;
                    option.textContent = proxy.name || proxy.url;
                    select.appendChild(option);
                });
                select.value = settings.proxyId == null ? '' : String(settings.proxyId);
                populateMemoryModelSelect(select.value, settings.model || '');
            }

            function updateMemorySummarizerVisibility() {
                const type = document.querySelector('input[name="memory-summarizer-type"]:checked')?.value || 'character';
                document.getElementById('memory-character-summarizer-row').hidden = type !== 'character';
                document.getElementById('memory-api-summarizer-row').hidden = type !== 'api';
            }

            function updateMemoryModeVisibility() {
                const selected = document.querySelector('input[name="memory-summary-mode"]:checked')?.value || 'messages';
                document.getElementById('memory-message-interval-row').hidden = selected !== 'messages';
                document.getElementById('memory-date-interval-row').hidden = selected !== 'date';
            }

            function updateManualMemoryRangeVisibility() {
                const selected = document.querySelector('input[name="memory-manual-source"]:checked')?.value || 'messages';
                document.getElementById('memory-manual-message-range').hidden = selected !== 'messages';
                document.getElementById('memory-manual-date-range').hidden = selected !== 'date';
            }

            function renderMemorySourceOverview(resetRanges = false) {
                const messages = sortMessagesChronologically();
                const total = messages.length;
                const firstDate = total ? toLocalDateKey(messages[0].timestamp) : '无';
                const lastDate = total ? toLocalDateKey(messages[total - 1].timestamp) : '无';
                document.getElementById('memory-source-overview').innerHTML = `<strong>当前共 ${total} 条消息</strong><br>日期范围：${firstDate} ～ ${lastDate}`;
                if (!resetRanges) return;
                const startInput = document.getElementById('memory-manual-message-start');
                const endInput = document.getElementById('memory-manual-message-end');
                startInput.max = Math.max(total, 1);
                endInput.max = Math.max(total, 1);
                startInput.value = total ? 1 : '';
                endInput.value = total || '';
                document.getElementById('memory-manual-date-start').value = total ? firstDate : '';
                document.getElementById('memory-manual-date-end').value = total ? lastDate : '';
            }

            function renderMemoryProgress() {
                const settings = getMemorySettings();
                const messages = sortMessagesChronologically();
                const total = messages.length;
                const remaining = settings.messageCursorId == null ? total : getMessagesAfterCursor(settings.messageCursorId).length;
                const covered = Math.max(0, total - remaining);
                document.getElementById('memory-message-progress').innerHTML = [
                    '<strong>消息游标</strong>',
                    `最近已总结到 messageId：${settings.messageCursorId ?? '尚未开始'}`,
                    `当前实际消息总数：${total} 条；游标后剩余：${remaining} 条`
                ].join('<br>');

                const today = toLocalDateKey(Date.now());
                let remainingDays = '—';
                if (settings.dateCursor) {
                    remainingDays = Math.max(0, Math.floor((dateKeyToTimestamp(today) - dateKeyToTimestamp(settings.dateCursor)) / 86400000));
                }
                document.getElementById('memory-date-progress').innerHTML = [
                    '<strong>日期游标</strong>',
                    `最近已总结日期：${settings.dateCursor || '尚未开始'}`,
                    `当前日期：${today}；游标后约 ${remainingDays} 天`
                ].join('<br>');
            }

            function getMemoryRangeLabel(memory) {
                const source = memory.sourceType === 'date' ? '日期' : '消息';
                const ids = memory.sourceStartId != null ? ` · #${memory.sourceStartId}～#${memory.sourceEndId}` : '';
                const summarizer = memory.summarizerName
                    ? ` · ${memory.summarizerType === 'api' ? 'API' : '角色'}：${memory.summarizerName}${memory.summarizerModel ? ` / ${memory.summarizerModel}` : ''}`
                    : '';
                return `${source} · ${toLocalDateKey(memory.startTime)}～${toLocalDateKey(memory.endTime)}${ids}${summarizer}`;
            }

            async function saveMemoryItem(memoryId, item) {
                const memory = state.memories.find(entry => entry.id === memoryId);
                if (!memory) return;
                const content = item.querySelector('.memory-content-input').value.trim();
                if (!content) {
                    setMemoryOperationStatus('Memory 内容不能为空', 'error');
                    return;
                }
                const recallMode = item.querySelector('.memory-recall-select').value;
                const keywords = item.querySelector('.memory-keywords-input').value
                    .split(/[,，\n]/)
                    .map(keyword => keyword.trim())
                    .filter(Boolean);
                Object.assign(memory, { content, recallMode, keywords });
                await db.memories.update(memoryId, { content, recallMode, keywords });
                setMemoryOperationStatus('Memory 已保存', 'success');
            }

            async function deleteMemoryItem(memoryId) {
                if (!confirm('确定删除这条 Memory 吗？总结进度游标不会回退。')) return;
                await softDeleteCloudRecord('memories', memoryId);
                state.memories = state.memories.filter(memory => memory.id !== memoryId);
                await persistMemorySortOrder();
                renderMemoryList();
                setMemoryOperationStatus('Memory 已删除', 'success');
            }

            async function persistMemorySortOrder() {
                state.memories.forEach((memory, index) => { memory.sortOrder = index; });
                await Promise.all(state.memories.map(memory => db.memories.update(memory.id, { sortOrder: memory.sortOrder })));
            }

            function setupMemoryLongPressDrag(item, handle) {
                let pressTimer = null;
                let dragging = false;
                let startX = 0;
                let startY = 0;

                const cancelPress = () => {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                };

                handle.addEventListener('contextmenu', event => event.preventDefault());
                handle.addEventListener('pointerdown', event => {
                    if (event.button !== undefined && event.button !== 0) return;
                    startX = event.clientX;
                    startY = event.clientY;
                    cancelPress();
                    pressTimer = setTimeout(() => {
                        dragging = true;
                        item.classList.add('is-dragging');
                        handle.setPointerCapture?.(event.pointerId);
                        navigator.vibrate?.(20);
                    }, 420);
                });

                handle.addEventListener('pointermove', event => {
                    if (!dragging) {
                        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 9) cancelPress();
                        return;
                    }
                    event.preventDefault();
                    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.memory-item');
                    const list = document.getElementById('memory-list');
                    if (!target || target === item || target.parentElement !== list) return;
                    const targetRect = target.getBoundingClientRect();
                    list.insertBefore(item, event.clientY < targetRect.top + targetRect.height / 2 ? target : target.nextSibling);
                });

                const finish = async () => {
                    cancelPress();
                    if (!dragging) return;
                    dragging = false;
                    item.classList.remove('is-dragging');
                    const ids = [...document.querySelectorAll('#memory-list .memory-item')].map(element => Number(element.dataset.id));
                    state.memories.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
                    await persistMemorySortOrder();
                    setMemoryOperationStatus('Memory 顺序已更新', 'success');
                };
                handle.addEventListener('pointerup', finish);
                handle.addEventListener('pointercancel', finish);
            }

            function renderMemoryList() {
                const list = document.getElementById('memory-list');
                if (!list) return;
                state.memories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
                document.getElementById('memory-count-label').textContent = `${state.memories.length} 条`;
                document.getElementById('memory-header-count').textContent = `${state.memories.length} 条`;
                list.innerHTML = '';
                if (!state.memories.length) {
                    list.innerHTML = '<div class="memory-empty">还没有 Memory。可先手动总结一段历史。</div>';
                    return;
                }

                state.memories.forEach(memory => {
                    const item = document.createElement('article');
                    item.className = 'memory-item';
                    item.dataset.id = memory.id;
                    const handle = document.createElement('button');
                    handle.type = 'button';
                    handle.className = 'memory-drag-handle';
                    handle.title = '长按拖动';
                    handle.setAttribute('aria-label', '长按拖动 Memory');
                    handle.textContent = '⋮⋮';

                    const main = document.createElement('div');
                    main.className = 'memory-item-main';
                    const meta = document.createElement('div');
                    meta.className = 'memory-item-meta';
                    const range = document.createElement('span');
                    range.className = 'memory-item-range';
                    range.textContent = getMemoryRangeLabel(memory);
                    const recall = document.createElement('select');
                    recall.className = 'memory-recall-select';
                    [['always', '始终召回'], ['keyword', '关键词'], ['disabled', '停用']].forEach(([value, label]) => {
                        const option = document.createElement('option');
                        option.value = value;
                        option.textContent = label;
                        recall.appendChild(option);
                    });
                    recall.value = memory.recallMode || 'always';
                    meta.append(range, recall);

                    const content = document.createElement('textarea');
                    content.className = 'memory-content-input';
                    content.value = memory.content || '';
                    const keywordRow = document.createElement('div');
                    keywordRow.className = 'memory-keywords-row';
                    const keywords = document.createElement('input');
                    keywords.type = 'text';
                    keywords.className = 'memory-keywords-input';
                    keywords.placeholder = '关键词，用逗号分隔';
                    keywords.value = (memory.keywords || []).join('，');
                    keywordRow.hidden = recall.value !== 'keyword';
                    keywordRow.appendChild(keywords);
                    recall.addEventListener('change', () => { keywordRow.hidden = recall.value !== 'keyword'; });

                    const actions = document.createElement('div');
                    actions.className = 'memory-item-actions';
                    const save = document.createElement('button');
                    save.type = 'button';
                    save.className = 'memory-save-item';
                    save.textContent = '保存';
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.className = 'memory-delete-item';
                    remove.textContent = '删除';
                    save.addEventListener('click', () => saveMemoryItem(memory.id, item));
                    remove.addEventListener('click', () => deleteMemoryItem(memory.id));
                    actions.append(save, remove);
                    main.append(meta, content, keywordRow, actions);
                    item.append(handle, main);
                    list.appendChild(item);
                    setupMemoryLongPressDrag(item, handle);
                });
            }

            function loadMemorySettingsIntoUI() {
                const settings = getMemorySettings();
                const mode = document.querySelector(`input[name="memory-summary-mode"][value="${settings.mode}"]`)
                    || document.querySelector('input[name="memory-summary-mode"][value="messages"]');
                mode.checked = true;
                const summarizerType = document.querySelector(`input[name="memory-summarizer-type"][value="${settings.summarizerType}"]`)
                    || document.querySelector('input[name="memory-summarizer-type"][value="character"]');
                summarizerType.checked = true;
                document.getElementById('memory-message-interval').value = settings.messageInterval;
                document.getElementById('memory-date-interval').value = settings.dateIntervalDays;
                document.getElementById('memory-token-limit').value = settings.tokenLimit;
                document.getElementById('memory-auto-enabled').checked = Boolean(settings.autoEnabled);
                populateMemoryCharacterSelect(settings);
                populateMemoryProxySelect(settings);
                updateMemoryModeVisibility();
                updateMemorySummarizerVisibility();
            }

            function readMemorySettingsFromUI() {
                const settings = getMemorySettings();
                settings.mode = document.querySelector('input[name="memory-summary-mode"]:checked')?.value || 'messages';
                settings.messageInterval = Math.max(1, Number(document.getElementById('memory-message-interval').value) || 50);
                settings.dateIntervalDays = Math.max(1, Number(document.getElementById('memory-date-interval').value) || 3);
                settings.tokenLimit = Math.max(100, Number(document.getElementById('memory-token-limit').value) || 2000);
                settings.autoEnabled = document.getElementById('memory-auto-enabled').checked;
                settings.summarizerType = document.querySelector('input[name="memory-summarizer-type"]:checked')?.value || 'character';
                settings.characterId = Number(document.getElementById('memory-character-select').value) || null;
                settings.proxyId = Number(document.getElementById('memory-proxy-select').value) || null;
                settings.model = document.getElementById('memory-model-select').value || '';
                return settings;
            }

            async function saveMemorySettingsFromUI() {
                try {
                    const settings = readMemorySettingsFromUI();
                    if (settings.autoEnabled) resolveMemorySummarizer(settings);
                    await persistMemorySettings(settings);
                    loadMemorySettingsIntoUI();
                    renderMemoryProgress();
                    setMemoryOperationStatus('Memory 设置已保存', 'success');
                    scheduleMemoryAutoSummary(400);
                } catch (error) {
                    setMemoryOperationStatus(`设置未保存：${error.message}`, 'error');
                }
            }

            function maybeAdvanceManualCursor(settings, sourceType, selectedMessages, range) {
                const ordered = sortMessagesChronologically();
                if (sourceType === 'messages') {
                    const unsummarized = getMessagesAfterCursor(settings.messageCursorId);
                    if (!unsummarized.length) return;
                    const firstUnsummarizedId = unsummarized[0].id;
                    if (selectedMessages.some(message => message.id === firstUnsummarizedId)) {
                        settings.messageCursorId = selectedMessages[selectedMessages.length - 1].id;
                    }
                    return;
                }

                const nextDate = getFirstUnsummarizedDate(settings, ordered);
                if (nextDate && compareDateKeys(range.startDate, nextDate) <= 0 && compareDateKeys(range.endDate, nextDate) >= 0) {
                    settings.dateCursor = range.endDate;
                }
            }

            async function runManualMemorySummary() {
                if (memoryManualBusy || memoryAutoBusy) return;
                const sourceType = document.querySelector('input[name="memory-manual-source"]:checked')?.value || 'messages';
                const ordered = sortMessagesChronologically();
                let selectedMessages = [];
                let range = {};
                let settings;

                try {
                    settings = readMemorySettingsFromUI();
                    resolveMemorySummarizer(settings);
                    await persistMemorySettings(settings);
                    if (sourceType === 'messages') {
                        const start = Number(document.getElementById('memory-manual-message-start').value);
                        const end = Number(document.getElementById('memory-manual-message-end').value);
                        if (!start || !end || start < 1 || end < start || end > ordered.length) {
                            throw new Error(`请输入 1～${ordered.length} 之间的有效消息范围`);
                        }
                        selectedMessages = ordered.slice(start - 1, end);
                    } else {
                        const startDate = document.getElementById('memory-manual-date-start').value;
                        const endDate = document.getElementById('memory-manual-date-end').value;
                        if (!startDate || !endDate || compareDateKeys(startDate, endDate) > 0) throw new Error('请选择有效的日期范围');
                        range = {
                            startDate,
                            endDate,
                            startTime: dateKeyToTimestamp(startDate),
                            endTime: dateKeyToTimestamp(endDate, true)
                        };
                        selectedMessages = ordered.filter(message => message.timestamp >= range.startTime && message.timestamp <= range.endTime);
                    }

                    memoryManualBusy = true;
                    const button = document.getElementById('memory-manual-summarize-btn');
                    button.disabled = true;
                    button.textContent = '正在生成…';
                    setMemoryOperationStatus(`正在总结 ${selectedMessages.length} 条消息…`);
                    await generateMemorySummary(selectedMessages, sourceType, range, settings);
                    maybeAdvanceManualCursor(settings, sourceType, selectedMessages, range);
                    await persistMemorySettings(settings);
                    renderMemoryList();
                    renderMemoryProgress();
                    setMemoryOperationStatus('Memory 已生成', 'success');
                } catch (error) {
                    console.error('Manual memory summary failed:', error);
                    setMemoryOperationStatus(`生成失败：${error.message}`, 'error');
                } finally {
                    memoryManualBusy = false;
                    const button = document.getElementById('memory-manual-summarize-btn');
                    button.disabled = false;
                    button.textContent = '生成 Memory';
                }
            }

            function renderMemoryPage(resetRanges = false) {
                loadMemorySettingsIntoUI();
                renderMemorySourceOverview(resetRanges);
                renderMemoryProgress();
                renderMemoryList();
                updateManualMemoryRangeVisibility();
            }

            function initializeMemoryFeature() {
                if (memoryFeatureInitialized) return;
                memoryFeatureInitialized = true;
                document.querySelectorAll('input[name="memory-summary-mode"]').forEach(input => input.addEventListener('change', updateMemoryModeVisibility));
                document.querySelectorAll('input[name="memory-summarizer-type"]').forEach(input => input.addEventListener('change', updateMemorySummarizerVisibility));
                document.querySelectorAll('input[name="memory-manual-source"]').forEach(input => input.addEventListener('change', updateManualMemoryRangeVisibility));
                document.getElementById('memory-proxy-select').addEventListener('change', event => populateMemoryModelSelect(event.target.value));
                document.getElementById('memory-save-settings-btn').addEventListener('click', saveMemorySettingsFromUI);
                document.getElementById('memory-manual-summarize-btn').addEventListener('click', runManualMemorySummary);
                renderMemoryPage(true);
                scheduleMemoryAutoSummary();
            }
