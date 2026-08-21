/* Cava Notebook - 07-data-tools.js */
            function applyLedgerFilters() {
                // Month filter
                const monthModal = document.getElementById('ledger-month-filter-modal');
                const selectedMonths = [];
                monthModal.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                    if (cb.value !== '__all__') selectedMonths.push(cb.value);
                });
                state.ledgerFilters.months = selectedMonths;

                // Category filter
                const categoryModal = document.getElementById('ledger-category-filter-modal');
                const activeTab = categoryModal.querySelector('.filter-tab.active');
                if (activeTab) {
                    state.ledgerFilters.type = activeTab.dataset.type;
                    const selectedCategories = [];
                    categoryModal.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                        selectedCategories.push(cb.value);
                    });
                    state.ledgerFilters.categories = selectedCategories;
                }

                renderLedger();
            }

            // --- General & Utility Functions ---
            function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result); reader.onerror = error => reject(error); }); }

            let cropper = null;
            function handleAvatarUpload(event, callback) {
                const file = event.target.files[0];
                if (!file) return;

                const modal = document.getElementById('cropper-modal');
                const image = document.getElementById('cropper-image');
                const saveBtn = modal.querySelector('.save-btn');

                const reader = new FileReader();
                reader.onload = (e) => {
                    image.src = e.target.result;
                    modal.classList.add('visible');

                    if (cropper) cropper.destroy();
                    cropper = new Cropper(image, {
                        aspectRatio: 1,
                        viewMode: 1,
                        background: false,
                        autoCropArea: 0.8,
                    });

                    saveBtn.onclick = () => {
                        const canvas = cropper.getCroppedCanvas({ width: 256, height: 256, });
                        const croppedBase64 = canvas.toDataURL('image/png');
                        callback(croppedBase64);
                        modal.classList.remove('visible');
                        cropper.destroy();
                        cropper = null;
                    };
                };
                reader.readAsDataURL(file);
                event.target.value = '';
            }

            function download(filename, text, mimeType = 'text/plain') {
                const blob = new Blob(['\uFEFF' + text], { type: `${mimeType};charset=utf-8` });
                const element = document.createElement('a');
                element.href = URL.createObjectURL(blob);
                element.setAttribute('download', filename);
                element.style.display = 'none';
                document.body.appendChild(element);
                element.click();
                document.body.removeChild(element);
                URL.revokeObjectURL(element.href);
            }

            async function exportAsJSON() {
                const dataToExport = {
                    appConfig: await db.appConfig.toArray(),
                    transactions: await db.transactions.toArray(),
                    messages: await db.messages.toArray(),
                    apiProxies: await db.apiProxies.toArray(),
                    aiCharacters: await db.aiCharacters.toArray(),
                    currencies: await db.currencies.toArray(),
                    schedules: await db.schedules.toArray(),
                    emojiPacks: await db.emojiPacks.toArray()
                };
                download('Cava-Backup.json', JSON.stringify(dataToExport, null, 2), 'application/json');
            }
            async function importFromJSON(e) {
                const file = e.target.files[0];
                if (!file) return;
                if (!confirm('导入数据将覆盖现有所有数据，确定要继续吗？')) return;
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        await db.delete();
                        await db.open();
                        if (data.appConfig) await db.appConfig.bulkPut(data.appConfig);
                        if (data.transactions) await db.transactions.bulkPut(data.transactions);
                        if (data.messages) await db.messages.bulkPut(data.messages);
                        if (data.apiProxies) await db.apiProxies.bulkPut(data.apiProxies);
                        if (data.aiCharacters) await db.aiCharacters.bulkPut(data.aiCharacters);
                        if (data.currencies) await db.currencies.bulkPut(data.currencies);
                        if (data.schedules) await db.schedules.bulkPut(data.schedules);
                        if (data.emojiPacks) await db.emojiPacks.bulkPut(data.emojiPacks);
                        alert('导入成功！页面将刷新。');
                        location.reload();
                    } catch (err) { alert(`导入失败: ${err.message}`); }
                };
                reader.readAsText(file);
            }

            async function exportAsTXT() {
                let content = `=== ${state.config.chatName} 导出记录 ===\n`;
                content += `导出时间: ${new Date().toLocaleString()}\n\n`;

                state.messages.forEach(msg => {
                    const time = new Date(msg.timestamp).toLocaleString();
                    let text = '';

                    if (msg.type === 'text') {
                        text = msg.content;
                    } else if (msg.type === 'transaction') {
                        const t = state.transactions.find(t => t.id === msg.relatedId);
                        if (t) {
                            const category = CATEGORIES[t.type].find(c => c.id === t.category);
                            text = `[记账] ${t.type === 'expense' ? '支出' : '收入'} ${t.amount}${t.currency} - ${category?.name || '未知'} - 备注: ${t.remark || '无'}`;
                        }
                    } else if (msg.type === 'schedule') {
                        const s = state.schedules.find(s => s.id === msg.relatedId);
                        if (s) {
                            const deadlineStr = s.deadline ? formatDeadline(s.deadline) : '无';
                            const eventTypeStr = s.eventType === 'long' ? '长期事件' : '单次事件';
                            text = `[日程-${eventTypeStr}] ${s.title} - 重要度: ${s.importance.toFixed(1)} - 截止: ${deadlineStr} - 说明: ${s.description || '无'} - 状态: ${s.completed ? '已完成' : '未完成'}`;
                        }
                    } else if (msg.type === 'image') {
                        text = '[图片]';
                    } else if (msg.type === 'ledger_summary') {
                        if (!msg.content) {
                            text = '[账本摘要同步]';
                        } else {
                            try {
                                const data = JSON.parse(msg.content);
                                text = `[账本摘要同步] 共${data.length}条记录\n`;
                                text += data.map(t => `  - ${t.type === 'expense' ? '支出' : '收入'} ${t.amount}${t.currency} (${t.category}): ${t.remark || '无'}`).join('\n');
                            } catch (e) {
                                text = '[账本摘要同步] (数据格式错误)';
                            }
                        }
                    } else if (msg.type === 'schedule_summary') {
                        if (!msg.content) {
                            text = '[日程摘要同步]';
                        } else {
                            try {
                                const data = JSON.parse(msg.content);
                                text = `[日程摘要同步] 共${data.length}个日程\n`;
                                text += data.map(s => `  - [${s.eventType}] ${s.title} (重要度: ${s.importance})`).join('\n');
                            } catch (e) {
                                text = '[日程摘要同步] (数据格式错误)';
                            }
                        }
                    } else if (msg.type === 'pie_chart_summary') {
                        if (!msg.content) {
                            text = '[图表分析同步]';
                        } else {
                            try {
                                const data = JSON.parse(msg.content);
                                text = `[图表分析同步] ${data.title}\n`;
                                if (data.totalExpense > 0) {
                                    text += `  总支出: ${data.totalExpense.toFixed(2)} ${data.currency}\n`;
                                    text += data.expenseDetails.map(d => `    - ${d.name}: ${d.amount.toFixed(2)} (${d.percentage.toFixed(1)}%)`).join('\n');
                                }
                                if (data.totalIncome > 0) {
                                    text += `\n  总收入: ${data.totalIncome.toFixed(2)} ${data.currency}\n`;
                                    text += data.incomeDetails.map(d => `    - ${d.name}: ${d.amount.toFixed(2)} (${d.percentage.toFixed(1)}%)`).join('\n');
                                }
                            } catch (e) {
                                text = `[图表分析同步] (数据格式错误)`;
                            }
                        }
                    } else if (msg.type === 'today_tasks_summary') {
                        const data = JSON.parse(msg.content);
                        text = `[今日待办同步] 待完成${data.pending.length}项，已完成${data.completed.length}项`;
                    } else if (msg.type === 'calendar_view_summary') {
                        const data = JSON.parse(msg.content);
                        const totalEvents = Object.values(data.events).flat().length;
                        text = `[日历视图同步] ${data.year}年${data.month}月共${totalEvents}个日程事项`;
                    }

                    let sender = msg.role === 'user' ? '我' : 'AI';
                    if (msg.role === 'assistant' && msg.senderId) {
                        const character = state.characters.find(c => c.id === msg.senderId);
                        if (character) sender = character.name;
                    }

                    content += `[${time}] ${sender}: ${text}\n\n`;
                });

                const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${state.config.chatName}_${new Date().toISOString().split('T')[0]}.txt`;
                a.click();
                URL.revokeObjectURL(url);
            }
            function toggleSidebar() { ELS.sidebar.classList.toggle('visible'); ELS.sidebarOverlay.classList.toggle('visible'); }
            async function toggleContextPreview() { if (ELS.sidebarPreviewContent.style.display === 'block') { ELS.sidebarPreviewContent.style.display = 'none'; return; } const { context, tokens } = buildContext(state.config.maxTokens); ELS.sidebarTokenCount.textContent = tokens; ELS.sidebarPreviewContent.textContent = JSON.stringify(context, null, 2); ELS.sidebarPreviewContent.style.display = 'block'; }

