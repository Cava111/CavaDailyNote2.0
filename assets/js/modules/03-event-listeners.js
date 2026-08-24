/* Cava Notebook - 03-event-listeners.js */
            function setupPanelSwipeDismiss(panel, onDismiss, scrollableSelector = null) {
                let startY = 0;
                let startX = 0;
                let startTime = 0;
                let dragDistance = 0;
                let isTracking = false;
                const scrollable = scrollableSelector ? panel.querySelector(scrollableSelector) : null;

                const resetPanelPosition = () => {
                    panel.classList.remove('is-dragging');
                    panel.style.removeProperty('transform');
                    setTimeout(() => panel.style.removeProperty('transition'), 220);
                };

                panel.addEventListener('touchstart', event => {
                    if (!panel.classList.contains('visible') || event.touches.length !== 1) return;
                    const target = event.target;
                    const startedOnHeader = Boolean(target.closest('.panel-header'));
                    const startedOnScrollableTop = scrollable
                        && scrollable.contains(target)
                        && scrollable.scrollTop <= 0
                        && !target.closest('button, input, textarea, select, label');
                    if (!startedOnHeader && !startedOnScrollableTop) return;

                    const touch = event.touches[0];
                    startY = touch.clientY;
                    startX = touch.clientX;
                    startTime = performance.now();
                    dragDistance = 0;
                    isTracking = true;
                    panel.style.removeProperty('transition');
                }, { passive: true });

                panel.addEventListener('touchmove', event => {
                    if (!isTracking || event.touches.length !== 1) return;
                    const touch = event.touches[0];
                    const deltaY = touch.clientY - startY;
                    const deltaX = touch.clientX - startX;
                    if (deltaY <= 0 || Math.abs(deltaX) > deltaY) return;

                    dragDistance = deltaY;
                    panel.classList.add('is-dragging');
                    panel.style.transform = `translateY(${dragDistance}px)`;
                    event.preventDefault();
                }, { passive: false });

                const finishDrag = () => {
                    if (!isTracking) return;
                    isTracking = false;
                    const duration = Math.max(performance.now() - startTime, 1);
                    const velocity = dragDistance / duration;
                    const shouldDismiss = dragDistance >= 90 || (dragDistance >= 45 && velocity > 0.55);

                    panel.classList.remove('is-dragging');
                    panel.style.transition = 'transform 180ms cubic-bezier(0.4, 0, 0.2, 1)';
                    if (shouldDismiss) {
                        panel.style.transform = 'translateY(100%)';
                        setTimeout(() => {
                            onDismiss();
                            resetPanelPosition();
                        }, 180);
                    } else {
                        panel.style.transform = 'translateY(0)';
                        setTimeout(resetPanelPosition, 180);
                    }
                };

                panel.addEventListener('touchend', finishDrag, { passive: true });
                panel.addEventListener('touchcancel', finishDrag, { passive: true });
            }

            function setupEventListeners() {
                ELS.navItems.forEach(item => item.addEventListener('click', () => navigateTo(item.dataset.page)));

                // Auto-saving settings
                document.getElementById('setting-chat-name').addEventListener('input', e => updateConfig('chatName', e.target.value));
                document.getElementById('setting-user-id').addEventListener('input', e => updateConfig('userId', e.target.value));
                document.getElementById('setting-user-gender').addEventListener('change', e => updateConfig('userGender', e.target.value));
                document.getElementById('setting-user-bio').addEventListener('input', e => updateConfig('userBio', e.target.value));
                document.getElementById('max-tokens-input').addEventListener('change', e => updateConfig('maxTokens', parseInt(e.target.value) || 4096));
                ELS.themeSelectors.forEach(radio => radio.addEventListener('change', (e) => {
                    ELS.body.dataset.theme = e.target.value;
                    updateConfig('theme', e.target.value);
                }));

                document.getElementById('upload-user-avatar-btn').addEventListener('click', () => document.getElementById('setting-chat-avatar-input').click());
                document.getElementById('setting-chat-avatar-input').addEventListener('change', (e) => {
                    handleAvatarUpload(e, (base64) => { ELS.chatAvatar.src = base64; updateConfig('chatAvatar', base64); });
                });

                document.getElementById('setting-chat-bg-input').addEventListener('change', async (e) => { if (!e.target.files[0]) return; const base64 = await fileToBase64(e.target.files[0]); updateConfig('background', base64); });
                document.getElementById('remove-bg-btn').addEventListener('click', async () => { updateConfig('background', ''); });

                ELS.chatInput.addEventListener('input', updateSendButtonState);
                ELS.sendBtn.addEventListener('click', sendUserMessage);
                ELS.chatMoreBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    toggleChatMoreMenu();
                });
                document.addEventListener('click', (event) => {
                    if (!event.target.closest('#chat-input-area')) closeChatMoreMenu();
                });
                ELS.chatMessages.addEventListener('scroll', () => {
                    if (state.isLoadingMore) return;
                    if (ELS.chatMessages.scrollTop < 100 && state.messagesDisplayed < state.messages.length) {
                        state.isLoadingMore = true;
                        state.messagesDisplayed = Math.min(state.messagesDisplayed + 50, state.messages.length);
                        renderChatMessages(false, false);
                        setTimeout(() => { state.isLoadingMore = false; }, 100);
                    }
                });

                document.getElementById('image-upload-btn').addEventListener('click', () => { closeChatMoreMenu(); document.getElementById('image-upload-input').click(); });
                document.getElementById('chat-add-transaction-btn').addEventListener('click', () => { closeChatMoreMenu(); showTransactionPanel(); });
                document.getElementById('chat-add-schedule-btn').addEventListener('click', () => { closeChatMoreMenu(); showSchedulePanel(); });
                document.getElementById('manage-emoji-packs-btn').addEventListener('click', openEmojiPackManager);
                document.getElementById('emoji-pack-btn').addEventListener('click', showEmojiPackSelector);
                document.getElementById('image-upload-input').addEventListener('change', sendUserImage);
                document.getElementById('close-transaction-panel').addEventListener('click', hideTransactionPanel);
                document.getElementById('close-schedule-panel').addEventListener('click', hideSchedulePanel);
                document.getElementById('type-expense-btn').addEventListener('click', () => switchTransactionType('expense'));
                document.getElementById('type-income-btn').addEventListener('click', () => switchTransactionType('income'));
                document.querySelector('.numpad').addEventListener('click', handleNumpad);
                document.getElementById('numpad-delete').addEventListener('click', handleNumpadDelete);
                document.getElementById('numpad-confirm').addEventListener('click', confirmTransaction);
                document.getElementById('currency-selector').addEventListener('click', toggleCurrency);
                // Template functionality
                document.getElementById('template-dropdown-btn').addEventListener('click', toggleTemplateMenu);
                document.getElementById('save-as-template-btn').addEventListener('click', saveAsTemplate);

                async function toggleTemplateMenu() {
                    const menu = document.getElementById('template-menu');
                    if (menu.style.display === 'none') {
                        await loadTemplates();
                        menu.style.display = 'block';
                    } else {
                        menu.style.display = 'none';
                    }
                }

                async function loadTemplates() {
                    const templates = await db.transactionTemplates.filter(item => !item.deletedAt).toArray();
                    const listEl = document.getElementById('template-list');
                    listEl.innerHTML = '';

                    if (templates.length === 0) {
                        listEl.innerHTML = '<div style="padding: 8px; color: var(--text-secondary); font-size: 14px;">暂无模板</div>';
                    } else {
                        templates.forEach(template => {
                            const item = document.createElement('div');
                            item.style.cssText = 'padding: 8px; cursor: pointer; border-radius: 6px; margin-bottom: 4px; background: var(--bg-main); display: flex; justify-content: space-between; align-items: center;';
                            item.innerHTML = `
                <span>${template.name}</span>
                <span style="font-size: 20px; color: var(--text-secondary);" data-id="${template.id}" class="delete-template">×</span>
            `;
                            item.addEventListener('click', (e) => {
                                if (!e.target.classList.contains('delete-template')) {
                                    applyTemplate(template);
                                }
                            });
                            listEl.appendChild(item);
                        });

                        // Add delete listeners
                        listEl.querySelectorAll('.delete-template').forEach(btn => {
                            btn.addEventListener('click', async (e) => {
                                e.stopPropagation();
                                if (confirm('删除此模板？')) {
                                    await softDeleteCloudRecord('transactionTemplates', parseInt(e.target.dataset.id));
                                    await loadTemplates();
                                }
                            });
                        });
                    }
                }

                function applyTemplate(template) {
                    state.currentTransaction = {
                        type: template.type,
                        category: template.category,
                        amountStr: String(template.amount),
                        currency: template.currency
                    };
                    document.getElementById('transaction-remark-input').value = template.remark || '';
                    document.getElementById('currency-selector').textContent = template.currency;
                    updateAmountDisplay();
                    switchTransactionType(template.type, template.category);
                    document.getElementById('template-menu').style.display = 'none';
                }

                async function saveAsTemplate() {
                    const name = prompt('模板名称：');
                    if (!name) return;

                    const template = {
                        name,
                        type: state.currentTransaction.type,
                        category: state.currentTransaction.category,
                        amount: parseFloat(state.currentTransaction.amountStr) || 0,
                        currency: state.currentTransaction.currency,
                        remark: document.getElementById('transaction-remark-input').value
                    };

                    await db.transactionTemplates.add(template);
                    alert('模板已保存！');
                    document.getElementById('template-menu').style.display = 'none';
                }

                setupSchedulePanelListeners();
                setupCalendarModalListeners();
                setupPanelSwipeDismiss(ELS.transactionPanel, hideTransactionPanel);
                setupPanelSwipeDismiss(ELS.schedulePanel, hideSchedulePanel, '.schedule-form');

                // Ledger page listeners
                document.getElementById('ledger-month-filter-btn').addEventListener('click', openMonthFilterModal);
                document.getElementById('ledger-category-filter-btn').addEventListener('click', openCategoryFilterModal);
                ELS.ledgerSort.addEventListener('change', renderLedger);
                document.getElementById('ledger-type-filter').addEventListener('change', renderLedger);
                ELS.ledgerCurrency.addEventListener('change', renderLedger);
                document.getElementById('forward-ledger-btn').addEventListener('click', forwardLedgerToChat);
                document.getElementById('schedule-forward-select').addEventListener('change', async (e) => {
                    const type = e.target.value;
                    if (!type) return;

                    if (type === 'today') {
                        await forwardTodayTasksToChat();
                    } else if (type === 'calendar') {
                        await forwardCalendarViewToChat();
                    } else if (type === 'all') {
                        await forwardScheduleToChat();
                    }

                    e.target.value = ''; // Reset select
                });

                async function forwardTodayTasksToChat() {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

                    const todayTasks = state.schedules.filter(s => {
                        if (s.eventType === 'once') {
                            if (!s.deadline) return false;
                            const dDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                            dDate.setHours(0, 0, 0, 0);
                            return dDate.getTime() === today.getTime();
                        } else if (s.eventType === 'long') {
                            if (!s.recurrence) return false;
                            if (s.endDate && new Date(s.endDate) < today) return false;
                            if (s.deadline) {
                                const startDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                                if (startDate > today) return false;
                            }

                            if (s.recurrence.type === 'daily') return true;
                            if (s.recurrence.type === 'weekly') {
                                return s.recurrence.days && s.recurrence.days.includes(today.getDay());
                            }
                            if (s.recurrence.type === 'monthly') {
                                const dayOfMonth = today.getDate();
                                const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
                                return s.recurrence.days && (s.recurrence.days.includes(dayOfMonth) ||
                                    (s.recurrence.days.includes('last') && dayOfMonth === lastDay));
                            }
                        }
                        return false;
                    });

                    const pending = [];
                    const completed = [];

                    todayTasks.forEach(task => {
                        const isCompleted = task.eventType === 'once' ? task.completed :
                            (task.completedDates && task.completedDates.includes(todayStr));
                        if (isCompleted) completed.push(task);
                        else pending.push(task);
                    });

                    const summaryData = { pending, completed, date: todayStr };

                    const newMsg = { timestamp: Date.now(), role: 'user', content: JSON.stringify(summaryData), type: 'today_tasks_summary' };
                    await createMessageRecord(newMsg);
                    navigateTo('accounting-screen');
                    renderChatMessages(true, true);
                }

                async function forwardCalendarViewToChat() {
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = today.getMonth();
                    const monthDays = new Date(year, month + 1, 0).getDate();

                    const monthEvents = {};

                    for (let day = 1; day <= monthDays; day++) {
                        const date = new Date(year, month, day);
                        const events = state.schedules.filter(s => {
                            if (s.eventType === 'once') {
                                if (!s.deadline) return false;
                                const dDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                                return dDate.getFullYear() === year && dDate.getMonth() === month && dDate.getDate() === day;
                            } else if (s.eventType === 'long') {
                                if (!s.recurrence) return false;
                                if (s.endDate && new Date(s.endDate) < date) return false;
                                if (s.deadline) {
                                    const startDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                                    if (startDate > date) return false;
                                }

                                if (s.recurrence.type === 'daily') return true;
                                if (s.recurrence.type === 'weekly') {
                                    return s.recurrence.days && s.recurrence.days.includes(date.getDay());
                                }
                                if (s.recurrence.type === 'monthly') {
                                    const lastDay = new Date(year, month + 1, 0).getDate();
                                    return s.recurrence.days && (s.recurrence.days.includes(day) ||
                                        (s.recurrence.days.includes('last') && day === lastDay));
                                }
                            }
                            return false;
                        });

                        if (events.length > 0) {
                            monthEvents[day] = events.map(e => ({ title: e.title, type: e.eventType }));
                        }
                    }

                    const summaryData = { year, month: month + 1, events: monthEvents };

                    const newMsg = { timestamp: Date.now(), role: 'user', content: JSON.stringify(summaryData), type: 'calendar_view_summary' };
                    await createMessageRecord(newMsg);
                    navigateTo('accounting-screen');
                    renderChatMessages(true, true);
                }

                setupModal('manage-proxies-btn', 'api-proxy-modal', 'close-proxy-modal', renderProxyList);
                setupModal('manage-characters-btn', 'ai-character-modal', 'close-character-modal', renderCharacterList);
                setupModal('manage-currencies-btn', 'currency-list-modal', 'close-currency-list-modal', renderCurrencyList);
                setupModal('manage-system-prompts-btn', 'system-prompts-modal', null, openSystemPromptsEditor);
                document.getElementById('add-proxy-btn').addEventListener('click', () => openProxyEditor());
                document.getElementById('add-character-btn').addEventListener('click', () => openCharacterEditor());
                document.getElementById('add-currency-btn').addEventListener('click', () => openCurrencyEditor());
                setupEditorModal('proxy-editor-modal', saveProxy);
                setupEditorModal('character-editor-modal', saveCharacter);
                setupEditorModal('currency-editor-modal', saveCurrency);
                setupEditorModal('system-prompts-modal', saveSystemPrompts);
                setupEditorModal('ledger-month-filter-modal', () => { applyLedgerFilters(); document.getElementById('ledger-month-filter-modal').classList.remove('visible'); });
                setupEditorModal('ledger-category-filter-modal', () => { applyLedgerFilters(); document.getElementById('ledger-category-filter-modal').classList.remove('visible'); });
                setupEditorModal('cropper-modal', null);
                setupModal(null, 'ai-character-selector-modal', null, null);
                document.querySelector('#ai-character-selector-modal .cancel-btn').addEventListener('click', () => {
                    document.getElementById('ai-character-selector-modal').classList.remove('visible');
                });

                // 在你的 <script> 标签里找到这一行:
                setupModal(null, 'message-action-menu', null);

                // 把下面这段代码粘贴到它的后面
                // Fix message action menu close
                document.getElementById('message-action-menu').addEventListener('click', (e) => {
                    if (e.target.classList.contains('modal-overlay')) {
                        document.getElementById('message-action-menu').classList.remove('visible');
                    }
                });
                // 新增这段，专门处理“取消”按钮的点击
                document.querySelector('#message-action-menu .cancel-btn').addEventListener('click', () => {
                    document.getElementById('message-action-menu').classList.remove('visible');
                });

                const scheduleDetailModal = document.getElementById('schedule-detail-modal');
                scheduleDetailModal.querySelector('#close-schedule-detail-modal').addEventListener('click', () => scheduleDetailModal.classList.remove('visible'));
                scheduleDetailModal.querySelector('#edit-schedule-btn').addEventListener('click', handleEditScheduleFromModal);
                scheduleDetailModal.querySelector('#delete-schedule-btn').addEventListener('click', handleDeleteScheduleFromModal);

                document.getElementById('export-json-btn').addEventListener('click', exportAsJSON);
                document.getElementById('import-json-btn').addEventListener('click', () => document.getElementById('import-json-input').click());
                document.getElementById('import-json-input').addEventListener('change', importFromJSON);
                document.getElementById('export-txt-btn').addEventListener('click', exportAsTXT);

                ELS.chatSettingsBtn.addEventListener('click', toggleSidebar);
                ELS.sidebarOverlay.addEventListener('click', toggleSidebar);
                ELS.previewContextBtn.addEventListener('click', toggleContextPreview);

                document.getElementById('cancel-selection-btn').addEventListener('click', exitSelectionMode);
                document.getElementById('delete-selected-btn').addEventListener('click', deleteSelectedMessages);

                // --- NEW: Ledger view swipe logic ---
                let ledgerTouchStartX = 0;
                let ledgerViewIndex = 0; // 0 for list, 1 for chart

                function updateLedgerView() {
                    const wrapper = document.getElementById('ledger-view-wrapper');
                    wrapper.style.transform = `translateX(-${ledgerViewIndex * 50}%)`;
                    document.getElementById('toggle-ledger-view-btn').innerHTML = ledgerViewIndex === 0 ? `图表 ${appIcon('chart', 'svg-icon-inline')}` : `列表 ${appIcon('list', 'svg-icon-inline')}`;
                }

                document.getElementById('ledger-page-content').addEventListener('touchstart', e => {
                    ledgerTouchStartX = e.changedTouches[0].screenX;
                }, { passive: true });

                document.getElementById('ledger-page-content').addEventListener('touchend', e => {
                    const touchEndX = e.changedTouches[0].screenX;
                    const swipeDist = touchEndX - ledgerTouchStartX;
                    if (Math.abs(swipeDist) < 50) return;

                    if (swipeDist < 0 && ledgerViewIndex === 0) { // Swipe left
                        ledgerViewIndex = 1;
                        updateLedgerView();
                    } else if (swipeDist > 0 && ledgerViewIndex === 1) { // Swipe right
                        ledgerViewIndex = 0;
                        updateLedgerView();
                    }
                });

                document.getElementById('toggle-ledger-view-btn').addEventListener('click', () => {
                    ledgerViewIndex = ledgerViewIndex === 0 ? 1 : 0;
                    updateLedgerView();
                });

                // Ledger list item click for editing
                ELS.ledgerList.addEventListener('click', (e) => {
                    const item = e.target.closest('.ledger-item');
                    if (item && item.dataset.id) {
                        showLedgerDetail(parseInt(item.dataset.id));
                    }
                });

                function showLedgerDetail(id) {
                    const t = state.transactions.find(t => t.id === id);
                    if (!t) return;

                    const category = CATEGORIES[t.type].find(c => c.id === t.category);

                    document.getElementById('ledger-detail-type').textContent = t.type === 'expense' ? '支出' : '收入';
                    document.getElementById('ledger-detail-category').innerHTML = `${appIcon(category?.icon || 'circle-help', 'svg-icon-inline')} ${category?.name || '未知'}`;
                    document.getElementById('ledger-detail-amount').textContent = `${t.amount.toFixed(2)} ${t.currency}`;
                    document.getElementById('ledger-detail-remark').textContent = t.remark || '无备注';
                    document.getElementById('ledger-detail-time').textContent = new Date(t.timestamp).toLocaleString();

                    const modal = document.getElementById('ledger-detail-modal');

                    document.getElementById('edit-ledger-btn').onclick = () => {
                        modal.classList.remove('visible');
                        showTransactionPanel(id);
                    };

                    document.getElementById('delete-ledger-btn').onclick = async () => {
                        if (confirm('确定要删除这条记账及其聊天记录吗？')) {
                            const msg = state.messages.find(m => m.relatedId === id && m.type === 'transaction');
                            await softDeleteCloudRecord('transactions', id);
                            state.transactions = state.transactions.filter(t => t.id !== id);
                            if (msg) {
                                await deleteMessageRecord(msg.id);
                            }
                            modal.classList.remove('visible');
                            renderLedger();
                            renderChatMessages(false, true);
                        }
                    };

                    document.getElementById('close-ledger-detail-modal').onclick = () => {
                        modal.classList.remove('visible');
                    };

                    modal.classList.add('visible');
                }

                // NEW: Schedule page swipe listeners
                const scheduleSwipeContainer = document.querySelector('.schedule-swipe-container');
                const schedulePagesWrapper = document.querySelector('.schedule-pages-wrapper');
                let scheduleTouchStartX = 0;
                scheduleSwipeContainer.addEventListener('touchstart', e => {
                    scheduleTouchStartX = e.changedTouches[0].screenX;
                }, { passive: true });

                scheduleSwipeContainer.addEventListener('touchend', e => {
                    const touchEndX = e.changedTouches[0].screenX;
                    const swipeDist = touchEndX - scheduleTouchStartX;
                    if (Math.abs(swipeDist) < 50) return;

                    if (swipeDist < 0 && state.schedulePageIndex < 2) { // Swipe left
                        state.schedulePageIndex++;
                    } else if (swipeDist > 0 && state.schedulePageIndex > 0) { // Swipe right
                        state.schedulePageIndex--;
                    }
                    updateSchedulePage();
                });

                // 日记模态框事件监听
                document.getElementById('close-diary-modal').addEventListener('click', () => {
                    document.getElementById('diary-modal').classList.remove('visible');
                });

                document.getElementById('edit-diary-prompt-btn').addEventListener('click', () => {
                    loadDiaryGenerationSettingsIntoUI();
                    document.getElementById('diary-prompt-modal').classList.add('visible');
                });

                document.getElementById('save-diary-prompt').addEventListener('click', async () => {
                    await saveDiaryGenerationSettingsFromUI();
                    alert('日记提示词与上下文设置已保存！');
                    document.getElementById('diary-prompt-modal').classList.remove('visible');
                });



                document.querySelector('#diary-prompt-modal .cancel-btn').addEventListener('click', () => {
                    document.getElementById('diary-prompt-modal').classList.remove('visible');
                });

                document.getElementById('diary-char-select').addEventListener('change', async (e) => {
                    const charId = parseInt(e.target.value);
                    if (charId && state.currentDiaryDate) {
                        state.currentDiaryCharId = charId;
                        await loadDiaryForDate(state.currentDiaryDate, charId);
                    }
                });

                document.getElementById('generate-diary-btn').addEventListener('click', generateDiary);
                document.getElementById('delete-diary-btn').addEventListener('click', deleteDiary);

                // 日记相关函数
                async function showDiaryModal(date) {
                    state.currentDiaryDate = date;

                    // 设置标题
                    const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
                    document.getElementById('diary-modal-title').textContent = `${dateStr}的日记`;

                    // 填充角色选择器
                    const charSelect = document.getElementById('diary-char-select');
                    charSelect.innerHTML = '<option value="">选择角色</option>';
                    state.characters.forEach(char => {
                        const option = document.createElement('option');
                        option.value = char.id;
                        option.textContent = char.name;
                        charSelect.appendChild(option);
                    });

                    // 如果有默认角色，选择第一个
                    if (state.characters.length > 0 && !state.currentDiaryCharId) {
                        state.currentDiaryCharId = state.characters[0].id;
                        charSelect.value = state.currentDiaryCharId;
                    } else if (state.currentDiaryCharId) {
                        charSelect.value = state.currentDiaryCharId;
                    }

                    // 加载日记
                    if (state.currentDiaryCharId) {
                        await loadDiaryForDate(date, state.currentDiaryCharId);
                    } else {
                        showDiaryEmptyState();
                    }

                    document.getElementById('diary-modal').classList.add('visible');
                }

                async function loadDiaryForDate(date, charId) {
                    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                    const diary = state.diaries.find(d => d.date === dateStr && d.charId === charId);

                    if (diary) {
                        showDiaryContent(diary.content);
                    } else {
                        showDiaryEmptyState();
                    }
                }

                function showDiaryContent(content) {
                    document.getElementById('diary-empty-state').style.display = 'none';
                    document.getElementById('diary-loading').style.display = 'none';
                    document.getElementById('diary-display').style.display = 'block';
                    document.getElementById('diary-text').textContent = content;

                    const char = state.characters.find(c => c.id === state.currentDiaryCharId);
                    if (char) {
                        document.getElementById('generate-diary-btn').innerHTML = `${appIcon('diary', 'svg-icon-inline')} 生成${char.name}的日记`;
                    }
                }

                function showDiaryEmptyState() {
                    document.getElementById('diary-display').style.display = 'none';
                    document.getElementById('diary-loading').style.display = 'none';
                    document.getElementById('diary-empty-state').style.display = 'block';

                    const char = state.characters.find(c => c.id === state.currentDiaryCharId);
                    if (char && state.currentDiaryDate) {
                        const dateStr = `${state.currentDiaryDate.getFullYear()}年${state.currentDiaryDate.getMonth() + 1}月${state.currentDiaryDate.getDate()}日`;
                        document.getElementById('generate-diary-btn').innerHTML = `${appIcon('diary', 'svg-icon-inline')} 生成${char.name}${dateStr}的日记`;
                    }
                }

                function showDiaryLoading() {
                    document.getElementById('diary-empty-state').style.display = 'none';
                    document.getElementById('diary-display').style.display = 'none';
                    document.getElementById('diary-loading').style.display = 'block';
                }

                setupCharParamListeners();
            }

