/* Cava Notebook - 05-ledger.js */
            function getFilteredTransactions() {
                const typeFilter = document.getElementById('ledger-type-filter')?.value || 'all';
                const { months, categories, type } = state.ledgerFilters;
                const sort = ELS.ledgerSort.value;
                const displayCurrency = ELS.ledgerCurrency.value;

                const allCurrencies = [{ code: 'RMB', rate: 1 }, ...state.currencies];
                const toRate = allCurrencies.find(c => c.code === displayCurrency)?.rate || 1;

                let transactionsWithDisplayAmount = state.transactions.map(t => {
                    const fromRate = allCurrencies.find(c => c.code === t.currency)?.rate || 1;
                    const amountInRMB = t.amount * fromRate;
                    const displayAmount = amountInRMB / toRate;
                    return { ...t, displayAmount };
                });

                let filtered = transactionsWithDisplayAmount;
                // Filter by type (all/expense/income)
                if (typeFilter !== 'all') {
                    filtered = filtered.filter(t => t.type === typeFilter);
                }

                // Filter by month
                if (months.length > 0) {
                    filtered = filtered.filter(t => {
                        const date = new Date(t.timestamp);
                        const monthStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                        return months.includes(monthStr);
                    });
                }

                // Filter by category
                if (categories.length > 0) {
                    filtered = filtered.filter(t => t.type === type && categories.includes(t.category));
                }

                filtered.sort((a, b) => {
                    switch (sort) {
                        case 'time_asc': return a.timestamp - b.timestamp;
                        case 'amount_desc': return b.displayAmount - a.displayAmount;
                        case 'amount_asc': return a.displayAmount - b.displayAmount;
                        default: return b.timestamp - a.timestamp;
                    }
                });

                return { filtered, displayCurrency };
            }

            function renderLedger() {
                const { filtered, displayCurrency } = getFilteredTransactions();

                // Render List
                ELS.ledgerList.innerHTML = '';
                let totalExpense = 0, totalIncome = 0;

                if (filtered.length === 0) {
                    ELS.ledgerList.innerHTML = '<li class="empty-state">没有符合筛选条件的记录</li>';
                } else {
                    filtered.forEach(t => {
                        if (t.type === 'expense') totalExpense += t.displayAmount;
                        else totalIncome += t.displayAmount;

                        const category = CATEGORIES[t.type].find(c => c.id === t.category);
                        const li = document.createElement('li');
                        li.className = 'ledger-item';
                        li.dataset.id = t.id;
                        li.innerHTML = `<div class="icon">${appIcon(category?.icon || 'circle-help')}</div><div class="details"><div class="remark">${t.remark || category?.name || '一笔账'}</div><div class="time">${new Date(t.timestamp).toLocaleString()}</div></div><div class="amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${t.displayAmount.toFixed(2)} ${displayCurrency}</div>`;
                        ELS.ledgerList.appendChild(li);
                    });
                }
                ELS.ledgerSummary.innerHTML = `总支出 (${displayCurrency}): <span style="color:var(--expense-color)">${totalExpense.toFixed(2)}</span> | 总收入 (${displayCurrency}): <span style="color:var(--income-color)">${totalIncome.toFixed(2)}</span>`;

                // Render Charts
                renderPieCharts(filtered, displayCurrency);

                // Update total count
                ELS.ledgerCount.innerHTML = `已记账${state.transactions.length}笔 ${appIcon('trend-up', 'svg-icon-inline')}`;
            }

            function generatePieChartSubtitle() {
                const { months, categories, type } = state.ledgerFilters;

                let timeText;
                if (months.length === 0) {
                    timeText = '全时间';
                } else {
                    const sorted = months.map(m => new Date(m + '-01')).sort((a, b) => a - b);
                    const isContinuous = sorted.every((date, i) => {
                        if (i === 0) return true;
                        const prev = sorted[i - 1];
                        return prev.getFullYear() === date.getFullYear() && prev.getMonth() + 1 === date.getMonth();
                    });

                    if (isContinuous && sorted.length > 1) {
                        const start = sorted[0];
                        const end = sorted[sorted.length - 1];
                        timeText = `${start.getFullYear()}年${start.getMonth() + 1}月 - ${end.getFullYear()}年${end.getMonth() + 1}月`;
                    } else {
                        timeText = sorted.map(d => `${d.getFullYear()}年${d.getMonth() + 1}月`).join('、');
                    }
                }

                let categoryText;
                const allCategoriesForType = CATEGORIES[type].map(c => c.id);
                if (categories.length === 0 || categories.length === allCategoriesForType.length) {
                    categoryText = '总共';
                } else {
                    categoryText = categories.map(catId => {
                        const cat = CATEGORIES[type].find(c => c.id === catId);
                        return cat ? cat.name : '';
                    }).filter(Boolean).join('、');
                }

                return `${timeText} ${categoryText}`;
            }

            function renderPieCharts(transactions, currency) {
                const subtitleText = generatePieChartSubtitle();

                const expenseData = {};
                const incomeData = {};

                transactions.forEach(t => {
                    const data = t.type === 'expense' ? expenseData : incomeData;
                    if (!data[t.category]) {
                        data[t.category] = 0;
                    }
                    data[t.category] += t.displayAmount;
                });

                const totalExpense = Object.values(expenseData).reduce((s, a) => s + a, 0);
                const totalIncome = Object.values(incomeData).reduce((s, a) => s + a, 0);

                document.getElementById('expense-pie-subtitle').innerHTML = `${subtitleText}<br><span style="font-weight: bold; color: var(--text-primary);">${totalExpense.toFixed(2)} ${currency}</span>`;
                document.getElementById('income-pie-subtitle').innerHTML = `${subtitleText}<br><span style="font-weight: bold; color: var(--text-primary);">${totalIncome.toFixed(2)} ${currency}</span>`;

                drawPieChart('expense-pie-chart', 'expense-pie-legend', expenseData, CATEGORIES.expense, currency, totalExpense);
                drawPieChart('income-pie-chart', 'income-pie-legend', incomeData, CATEGORIES.income, currency, totalIncome);
            }

            function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
                const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
                return {
                    x: centerX + (radius * Math.cos(angleInRadians)),
                    y: centerY + (radius * Math.sin(angleInRadians))
                };
            }

            function describeArc(x, y, radius, startAngle, endAngle) {
                const start = polarToCartesian(x, y, radius, endAngle);
                const end = polarToCartesian(x, y, radius, startAngle);
                const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
                const d = ["M", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y, "L", x, y, "L", start.x, start.y].join(" ");
                return d;
            }

            function drawPieChart(svgId, legendId, data, categoryDefinitions, currency, totalAmount) {
                const svg = document.getElementById(svgId);
                const legend = document.getElementById(legendId);
                svg.innerHTML = '';
                legend.innerHTML = '';
                svg.setAttribute('viewBox', '0 0 250 250');
                const tooltip = document.getElementById('pie-chart-tooltip');

                if (totalAmount === 0) {
                    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    text.setAttribute('x', '50%');
                    text.setAttribute('y', '50%');
                    text.setAttribute('text-anchor', 'middle');
                    text.setAttribute('fill', getComputedStyle(document.body).getPropertyValue('--text-secondary'));
                    text.textContent = '无数据';
                    svg.appendChild(text);
                    return;
                }

                const cx = 125, cy = 125, radius = 110;
                const colors = ['#f28b82', '#ffc107', '#8dd4bf', '#87c4f4', '#c58af9', '#f4aab6', '#fbc5a6', '#a1c9f4', '#b2e2a4', '#d6a3d6'];
                let colorIndex = 0;
                let startAngle = 0;

                const sortedData = Object.entries(data).sort(([, a], [, b]) => b - a);

                for (const [categoryId, amount] of sortedData) {
                    const percentage = (amount / totalAmount) * 100;
                    const angle = percentage / 100 * 360;
                    const endAngle = startAngle + angle;
                    const categoryInfo = categoryDefinitions.find(c => c.id === categoryId);
                    const categoryName = categoryInfo ? categoryInfo.name : '未知';
                    const color = colors[colorIndex++ % colors.length];

                    let chartElement;

                    // BUGFIX: Handle full circle case for single category
                    if (angle > 359.9) { // Use tolerance for float issues
                        chartElement = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                        chartElement.setAttribute("cx", cx);
                        chartElement.setAttribute("cy", cy);
                        chartElement.setAttribute("r", radius);
                    } else {
                        chartElement = document.createElementNS("http://www.w3.org/2000/svg", "path");
                        chartElement.setAttribute("d", describeArc(cx, cy, radius, startAngle, endAngle));
                    }

                    chartElement.setAttribute("fill", color);
                    chartElement.dataset.name = categoryName;
                    chartElement.dataset.amount = amount.toFixed(2);
                    chartElement.dataset.percent = percentage.toFixed(1);

                    chartElement.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const currentActive = svg.querySelector('.active');
                        if (currentActive && currentActive !== chartElement) currentActive.classList.remove('active');
                        chartElement.classList.toggle('active');

                        if (chartElement.classList.contains('active')) {
                            tooltip.innerHTML = `<strong>${chartElement.dataset.name}</strong><br>${chartElement.dataset.percent}%<br>${chartElement.dataset.amount} ${currency}`;
                            const chartViewRect = document.getElementById('ledger-chart-view').getBoundingClientRect();
                            const x = e.clientX - chartViewRect.left;
                            const y = e.clientY - chartViewRect.top + document.getElementById('ledger-chart-view').scrollTop;
                            tooltip.style.left = `${x}px`;
                            tooltip.style.top = `${y}px`;
                            tooltip.style.display = 'block';
                        } else {
                            tooltip.style.display = 'none';
                        }
                    });
                    svg.appendChild(chartElement);

                    const legendItem = document.createElement('div');
                    legendItem.className = 'legend-item';
                    legendItem.innerHTML = `<span class="legend-color-box" style="background-color: ${color};"></span><span>${categoryName}</span>`;
                    legend.appendChild(legendItem);

                    startAngle = endAngle;
                }
            }

            if (!document.getElementById('ledger-chart-view').dataset.listenerAttached) {
                document.getElementById('ledger-chart-view').addEventListener('click', (e) => {
                    if (e.target.tagName !== 'path' && e.target.tagName !== 'circle') {
                        document.getElementById('pie-chart-tooltip').style.display = 'none';
                        const currentActive = document.querySelector('#ledger-chart-view .active');
                        if (currentActive) currentActive.classList.remove('active');
                    }
                });
                document.getElementById('ledger-chart-view').dataset.listenerAttached = 'true';
            }

            function populateLedgerCurrencyFilter() {
                const select = ELS.ledgerCurrency;
                select.innerHTML = '';
                const allCurrenciesForFilter = [{ code: 'RMB', name: '人民币' }, ...state.currencies];
                allCurrenciesForFilter.forEach(c => {
                    const option = document.createElement('option');
                    option.value = c.code;
                    option.textContent = `${c.name} (${c.code})`;
                    select.appendChild(option);
                });
                select.value = 'RMB';
            }

            function showActionMenu(msgId) {
                const menu = document.getElementById('message-action-menu');
                const msg = state.messages.find(m => m.id === msgId);
                if (!msg) return;

                document.getElementById('multi-select-btn').onclick = () => { menu.classList.remove('visible'); enterSelectionMode(); };

                const editUserBtn = document.getElementById('edit-message-btn');
                const editAiBtn = document.getElementById('edit-ai-message-btn');
                const regenerateBtn = document.getElementById('regenerate-message-btn');
                const copyBtn = document.getElementById('copy-message-btn');
                const deleteBtn = document.getElementById('delete-message-btn');

                const isUserText = msg.role === 'user' && msg.type === 'text';
                const isUserTransaction = msg.role === 'user' && msg.type === 'transaction';
                const isUserSchedule = msg.role === 'user' && msg.type === 'schedule';
                const isAiText = msg.role === 'assistant' && msg.type === 'text';
                const isAiMessage = msg.role === 'assistant' && Boolean(msg.senderId);
                const isCopyable = isUserText || isAiText || (isUserTransaction && state.transactions.find(t => t.id === msg.relatedId)?.remark) || (isUserSchedule && state.schedules.find(s => s.id === msg.relatedId)?.description);

                editUserBtn.style.display = (isUserText || isUserTransaction || isUserSchedule) ? 'block' : 'none';
                if (isUserTransaction) editUserBtn.innerHTML = `${appIcon('edit', 'svg-icon-inline')} 编辑备注`;
                else if (isUserSchedule) editUserBtn.innerHTML = `${appIcon('edit', 'svg-icon-inline')} 编辑说明`;
                else editUserBtn.innerHTML = `${appIcon('edit', 'svg-icon-inline')} 编辑`;

                editAiBtn.style.display = isAiText ? 'block' : 'none';
                regenerateBtn.style.display = isAiMessage ? 'block' : 'none';
                copyBtn.style.display = isCopyable ? 'block' : 'none';

                editUserBtn.onclick = () => { menu.classList.remove('visible'); editMessage(msgId); };
                editAiBtn.onclick = () => { menu.classList.remove('visible'); editMessage(msgId); };
                regenerateBtn.onclick = () => { menu.classList.remove('visible'); regenerateAIResponse(msgId); };
                copyBtn.onclick = () => { menu.classList.remove('visible'); copyMessage(msgId); };
                deleteBtn.onclick = () => { menu.classList.remove('visible'); deleteMessage(msgId); };

                menu.classList.add('visible');
            }

            function getAIResponseGroup(message) {
                if (message.responseGroupId) {
                    return state.messages.filter(item => item.responseGroupId === message.responseGroupId);
                }

                const selectedIndex = state.messages.findIndex(item => item.id === message.id);
                if (selectedIndex === -1) return [message];
                let startIndex = selectedIndex;
                let endIndex = selectedIndex;

                while (startIndex > 0) {
                    const current = state.messages[startIndex];
                    const previous = state.messages[startIndex - 1];
                    const isSameLegacyResponse = previous.role === 'assistant'
                        && previous.senderId === message.senderId
                        && !previous.responseGroupId
                        && current.timestamp - previous.timestamp <= 10000;
                    if (!isSameLegacyResponse) break;
                    startIndex--;
                }

                while (endIndex < state.messages.length - 1) {
                    const current = state.messages[endIndex];
                    const next = state.messages[endIndex + 1];
                    const isSameLegacyResponse = next.role === 'assistant'
                        && next.senderId === message.senderId
                        && !next.responseGroupId
                        && next.timestamp - current.timestamp <= 10000;
                    if (!isSameLegacyResponse) break;
                    endIndex++;
                }

                return state.messages.slice(startIndex, endIndex + 1);
            }

            function requestRegenerationConfirmation(characterName) {
                if (state.config.skipRegenerateConfirm) return Promise.resolve(true);

                const modal = document.getElementById('regenerate-confirm-modal');
                const confirmButton = document.getElementById('confirm-regenerate-btn');
                const cancelButton = modal.querySelector('.cancel-btn');
                const dontRemind = document.getElementById('regenerate-dont-remind');
                document.getElementById('regenerate-confirm-text').textContent = `是否确认重新生成「${characterName}」本轮的全部消息？`;
                dontRemind.checked = false;
                modal.classList.add('visible');

                return new Promise(resolve => {
                    const finish = async confirmed => {
                        modal.classList.remove('visible');
                        modal.onclick = null;
                        if (confirmed && dontRemind.checked) await updateConfig('skipRegenerateConfirm', true);
                        resolve(confirmed);
                    };
                    confirmButton.onclick = () => finish(true);
                    cancelButton.onclick = () => finish(false);
                    modal.onclick = event => {
                        if (event.target === modal) finish(false);
                    };
                });
            }

            async function regenerateAIResponse(msgId) {
                if (state.isRegeneratingAIResponse) return;
                const message = state.messages.find(item => item.id === msgId);
                if (!message || message.role !== 'assistant' || !message.senderId) return;
                const character = state.characters.find(item => item.id === message.senderId);
                if (!character) {
                    alert('找不到这条消息对应的 AI 角色。');
                    return;
                }
                const proxy = state.proxies.find(item => item.id === character.proxyId);
                if (!proxy || !character.model) {
                    alert(`角色 "${character.name}" 未配置主用API或模型，无法重生成。`);
                    return;
                }
                if (!await requestRegenerationConfirmation(character.name)) return;

                const responseMessages = getAIResponseGroup(message);
                const responseIds = responseMessages.map(item => item.id).filter(id => typeof id === 'number');
                state.isRegeneratingAIResponse = true;
                try {
                    if (responseIds.length > 0) await db.messages.bulkDelete(responseIds);
                    const responseIdSet = new Set(responseMessages.map(item => item.id));
                    state.messages = state.messages.filter(item => !responseIdSet.has(item.id));
                    renderChatMessages(false);
                    await triggerAIResponse(character);
                } catch (error) {
                    console.error('Regeneration failed:', error);
                    alert(`重生成失败：${error.message}`);
                } finally {
                    state.isRegeneratingAIResponse = false;
                }
            }

            function cancelCurrentEdit() {
                if (!state.currentlyEditingMsgId) return;
                const msgElement = document.getElementById(state.currentlyEditingMsgId);
                if (msgElement) {
                    const bubble = msgElement.querySelector('.message-bubble');
                    if (bubble) bubble.classList.remove('editing');
                    const editContainer = msgElement.querySelector('.inline-edit-container');
                    if (editContainer) editContainer.remove();
                }
                state.currentlyEditingMsgId = null;
            }

            async function editMessage(msgId) {
                cancelCurrentEdit();
                state.currentlyEditingMsgId = msgId;

                const msgIndex = state.messages.findIndex(m => m.id === msgId);
                if (msgIndex === -1) return;
                const msg = state.messages[msgIndex];

                const msgElement = document.getElementById(msgId);
                if (!msgElement) return;

                const bubble = msgElement.querySelector('.message-bubble');
                let targetContainer, originalText;

                if (msg.type === 'transaction') {
                    targetContainer = msgElement.querySelector('.transaction-remark');
                    originalText = state.transactions.find(t => t.id === msg.relatedId)?.remark || '';
                } else if (msg.type === 'schedule') {
                    targetContainer = msgElement.querySelector('.schedule-description');
                    originalText = state.schedules.find(s => s.id === msg.relatedId)?.description || '';
                } else if (msg.type === 'text') {
                    targetContainer = msgElement.querySelector('.content-text').parentElement;
                    originalText = msg.content;
                } else {
                    return;
                }
                if (!targetContainer) {
                    alert("此项目没有可编辑的文本。");
                    cancelCurrentEdit();
                    return;
                }

                bubble.classList.add('editing');

                const editContainer = document.createElement('div');
                editContainer.className = 'inline-edit-container';

                const textarea = document.createElement('textarea');
                textarea.className = 'inline-edit-textarea';
                textarea.value = originalText.replace(/<br>/g, '\n');

                const autoResizeTextarea = () => {
                    textarea.style.height = 'auto';
                    textarea.style.height = `${textarea.scrollHeight}px`;
                };
                textarea.addEventListener('input', autoResizeTextarea);

                const actions = document.createElement('div');
                actions.className = 'inline-edit-actions';

                const saveBtn = document.createElement('button');
                saveBtn.innerHTML = appIcon('check');
                saveBtn.className = 'save';

                const cancelBtn = document.createElement('button');
                cancelBtn.innerHTML = appIcon('x');
                cancelBtn.className = 'cancel';

                actions.append(saveBtn, cancelBtn);
                editContainer.append(textarea, actions);
                targetContainer.append(editContainer);

                autoResizeTextarea();
                textarea.focus();
                textarea.select();

                cancelBtn.onclick = (e) => { e.stopPropagation(); cancelCurrentEdit(); renderChatMessages(false); };

                saveBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const newText = textarea.value.trim();

                    if (msg.type === 'transaction') {
                        const trans = state.transactions.find(t => t.id === msg.relatedId);
                        if (trans) trans.remark = newText;
                        await db.transactions.update(msg.relatedId, { remark: newText });
                        if (document.getElementById('ledger-screen').classList.contains('active')) renderLedger();
                    } else if (msg.type === 'schedule') {
                        const schedule = state.schedules.find(s => s.id === msg.relatedId);
                        if (schedule) schedule.description = newText;
                        await db.schedules.update(msg.relatedId, { description: newText });
                        if (document.getElementById('schedule-screen').classList.contains('active')) renderSchedules();
                    } else if (msg.type === 'text') {
                        state.messages[msgIndex].content = newText;
                        await db.messages.update(msgId, { content: newText });
                    }

                    state.currentlyEditingMsgId = null;
                    renderChatMessages(false);
                };
            }

            async function deleteMessage(msgId) {
                if (!confirm('确定要删除这条消息吗？')) return;
                const msg = state.messages.find(m => m.id === msgId);
                if (!msg) return;
                if (msg.type === 'transaction' && msg.relatedId) {
                    await db.transactions.delete(msg.relatedId);
                    state.transactions = state.transactions.filter(t => t.id !== msg.relatedId);
                    renderLedger();
                } else if (msg.type === 'schedule' && msg.relatedId) {
                    await db.schedules.delete(msg.relatedId);
                    state.schedules = state.schedules.filter(s => s.id !== msg.relatedId);
                    renderSchedules();
                }
                await db.messages.delete(msgId);
                state.messages = state.messages.filter(m => m.id !== msgId);
                renderChatMessages(false);
            }
            async function copyMessage(msgId) {
                const msg = state.messages.find(m => m.id === msgId);
                if (!msg) return;

                let textToCopy = '';
                if (msg.type === 'text') {
                    textToCopy = msg.content;
                } else if (msg.type === 'transaction') {
                    textToCopy = state.transactions.find(t => t.id === msg.relatedId)?.remark || '';
                } else if (msg.type === 'schedule') {
                    textToCopy = state.schedules.find(s => s.id === msg.relatedId)?.description || '';
                }

                if (textToCopy && navigator.clipboard) {
                    try {
                        await navigator.clipboard.writeText(textToCopy);
                        alert('已复制！');
                    } catch (err) {
                        console.error('无法复制文本: ', err);
                        alert('复制失败！');
                    }
                }
            }

            function enterSelectionMode() { cancelCurrentEdit(); state.isSelectionMode = true; document.getElementById('accounting-screen').classList.add('selection-mode-active'); }
            function exitSelectionMode() { state.isSelectionMode = false; document.getElementById('accounting-screen').classList.remove('selection-mode-active'); state.selectedMessages.forEach(id => { document.querySelector(`.message-wrapper[data-id="${id}"]`)?.classList.remove('selected'); }); state.selectedMessages.clear(); }
            function toggleMessageSelection(msgId) { const wrapper = document.querySelector(`.message-wrapper[data-id="${msgId}"]`); if (state.selectedMessages.has(msgId)) { state.selectedMessages.delete(msgId); wrapper?.classList.remove('selected'); } else { state.selectedMessages.add(msgId); wrapper?.classList.add('selected'); } }
            async function deleteSelectedMessages() {
                const count = state.selectedMessages.size;
                if (count === 0) return;
                if (!confirm(`确定要删除选中的 ${count} 条消息吗？`)) return;

                const msgIdsToDelete = Array.from(state.selectedMessages);
                const transIdsToDelete = [];
                const scheduleIdsToDelete = [];

                for (const msgId of msgIdsToDelete) {
                    const msg = state.messages.find(m => m.id === msgId);
                    if (msg) {
                        if (msg.type === 'transaction' && msg.relatedId) transIdsToDelete.push(msg.relatedId);
                        if (msg.type === 'schedule' && msg.relatedId) scheduleIdsToDelete.push(msg.relatedId);
                    }
                }

                if (transIdsToDelete.length > 0) await db.transactions.bulkDelete(transIdsToDelete);
                if (scheduleIdsToDelete.length > 0) await db.schedules.bulkDelete(scheduleIdsToDelete);
                await db.messages.bulkDelete(msgIdsToDelete);

                state.transactions = state.transactions.filter(t => !transIdsToDelete.includes(t.id));
                state.schedules = state.schedules.filter(s => !scheduleIdsToDelete.includes(s.id));
                state.messages = state.messages.filter(m => !msgIdsToDelete.includes(m.id));

                exitSelectionMode();
                renderChatMessages(false);
                renderLedger();
                renderSchedules();
            }

            // --- Transaction Panel Logic ---
            function showTransactionPanel(id = null) {
                state.currentlyEditingTransactionId = id;
                const remarkInput = document.getElementById('transaction-remark-input');
                const actionsContainer = document.getElementById('numpad-actions');

                // Remove existing delete button if any
                const existingDeleteBtn = document.getElementById('delete-transaction-btn');
                if (existingDeleteBtn) existingDeleteBtn.remove();

                if (id) {
                    const t = state.transactions.find(t => t.id === id);
                    if (!t) { resetTransactionState(); return; }
                    state.currentTransaction = {
                        type: t.type,
                        category: t.category,
                        amountStr: String(t.amount),
                        currency: t.currency
                    };
                    document.getElementById('transaction-panel-title').textContent = '编辑记账';
                    remarkInput.value = t.remark || '';

                    // Add delete button
                    const deleteBtn = document.createElement('button');
                    deleteBtn.id = 'delete-transaction-btn';
                    deleteBtn.className = 'delete-transaction';
                    deleteBtn.textContent = '删除';
                    deleteBtn.onclick = async () => {
                        if (confirm('确定要删除这条记账及其聊天记录吗？')) {
                            const msg = state.messages.find(m => m.relatedId === id && m.type === 'transaction');
                            await db.transactions.delete(id);
                            state.transactions = state.transactions.filter(t => t.id !== id);
                            if (msg) {
                                await db.messages.delete(msg.id);
                                state.messages = state.messages.filter(m => m.id !== msg.id);
                            }
                            hideTransactionPanel();
                            renderLedger();
                            renderChatMessages(false);
                        }
                    };
                    actionsContainer.appendChild(deleteBtn);

                } else {
                    resetTransactionState();
                    document.getElementById('transaction-panel-title').textContent = '新建记账';
                    remarkInput.value = '';
                }

                document.getElementById('currency-selector').textContent = state.currentTransaction.currency;
                updateAmountDisplay();
                switchTransactionType(state.currentTransaction.type, state.currentTransaction.category);

                ELS.transactionPanel.classList.add('visible');
                ELS.app.style.overflow = 'hidden';
            }

            function hideTransactionPanel() {
                ELS.transactionPanel.classList.remove('visible');
                ELS.app.style.overflow = 'initial';
                state.currentlyEditingTransactionId = null;
            }

            function switchTransactionType(type, preselectedCategory = null) {
                state.currentTransaction.type = type;
                document.getElementById('type-expense-btn').classList.toggle('active', type === 'expense');
                document.getElementById('type-income-btn').classList.toggle('active', type === 'income');
                renderCategories(preselectedCategory);
            }

            function renderCategories(preselectedCategory = null) {
                ELS.categorySelector.innerHTML = '';
                const cats = CATEGORIES[state.currentTransaction.type];
                cats.forEach(cat => {
                    const item = document.createElement('div');
                    item.className = 'category-item';
                    item.dataset.id = cat.id;
                    item.innerHTML = `<div class="icon">${appIcon(cat.icon)}</div><div class="name">${cat.name}</div>`;
                    item.addEventListener('click', () => selectCategory(cat.id));
                    ELS.categorySelector.appendChild(item);
                });
                if (preselectedCategory && cats.some(c => c.id === preselectedCategory)) {
                    selectCategory(preselectedCategory);
                } else if (cats.length > 0) {
                    selectCategory(cats[0].id);
                }
            }

            function selectCategory(catId) { state.currentTransaction.category = catId; document.querySelectorAll('.category-item').forEach(item => item.classList.toggle('selected', item.dataset.id === catId)); }
            function handleNumpad(e) { const key = e.target.dataset.key; if (!key) return; let amount = state.currentTransaction.amountStr; if (key === '.') { if (!amount.includes('.')) amount += '.'; } else { if (amount === '0') amount = key; else if (amount.includes('.') && amount.split('.')[1].length >= 2) return; else amount += key; } state.currentTransaction.amountStr = amount; updateAmountDisplay(); }
            function handleNumpadDelete() { let amount = state.currentTransaction.amountStr; amount = amount.slice(0, -1); if (amount === '') amount = '0'; state.currentTransaction.amountStr = amount; updateAmountDisplay(); }
            function toggleCurrency() { const currencies = ['RMB', ...state.currencies.map(c => c.code)]; const currentIndex = currencies.indexOf(state.currentTransaction.currency); const nextIndex = (currentIndex + 1) % currencies.length; const newCurrency = currencies[nextIndex]; state.currentTransaction.currency = newCurrency; document.getElementById('currency-selector').textContent = newCurrency; if (!state.currentlyEditingTransactionId) localStorage.setItem('lastSelectedCurrency', newCurrency); }
            function updateAmountDisplay() { ELS.amountDisplay.textContent = state.currentTransaction.amountStr; }

            async function confirmTransaction() {
                const amount = parseFloat(state.currentTransaction.amountStr);
                if (amount <= 0) { alert('金额必须大于0'); return; }

                const remark = document.getElementById('transaction-remark-input').value.trim();

                if (state.currentlyEditingTransactionId) {
                    const transIndex = state.transactions.findIndex(t => t.id === state.currentlyEditingTransactionId);
                    if (transIndex > -1) {
                        const originalTransaction = state.transactions[transIndex];
                        const updatedTransaction = {
                            ...originalTransaction,
                            type: state.currentTransaction.type,
                            category: state.currentTransaction.category,
                            amount: amount,
                            currency: state.currentTransaction.currency,
                            remark: remark
                        };
                        await db.transactions.put(updatedTransaction);
                        state.transactions[transIndex] = updatedTransaction;

                        hideTransactionPanel();
                        renderLedger();
                        renderChatMessages(false);
                    }
                } else {
                    const newTransaction = {
                        timestamp: Date.now(),
                        type: state.currentTransaction.type,
                        category: state.currentTransaction.category,
                        amount: amount,
                        currency: state.currentTransaction.currency,
                        remark: remark
                    };
                    const transId = await db.transactions.add(newTransaction);
                    const msgId = await db.messages.add({
                        timestamp: newTransaction.timestamp,
                        role: 'user',
                        content: ``,
                        type: 'transaction',
                        relatedId: transId
                    });
                    state.transactions.push({ ...newTransaction, id: transId });
                    state.messages.push({ id: msgId, timestamp: newTransaction.timestamp, role: 'user', type: 'transaction', relatedId: transId });

                    hideTransactionPanel();
                    resetTransactionState();
                    renderChatMessages();
                }
            }

            function resetTransactionState() {
                const lastCurrency = localStorage.getItem('lastSelectedCurrency') || 'RMB';
                state.currentTransaction = { type: 'expense', category: null, amountStr: '0', currency: lastCurrency };
                updateAmountDisplay();
                document.getElementById('currency-selector').textContent = lastCurrency;
                document.getElementById('transaction-remark-input').value = '';
            }

