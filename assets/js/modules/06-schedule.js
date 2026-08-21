/* Cava Notebook - 06-schedule.js */
            // --- Schedule & Calendar Logic (NEW & UPDATED) ---
            function setupSchedulePanelListeners() {
                document.getElementById('schedule-type-once').addEventListener('click', () => setScheduleType('once'));
                document.getElementById('schedule-type-long').addEventListener('click', () => setScheduleType('long'));
                setupImportanceStars();
                document.getElementById('confirm-schedule-btn').addEventListener('click', confirmSchedule);
                document.getElementById('cancel-schedule-btn').addEventListener('click', hideSchedulePanel);
                document.getElementById('deadline-display-text').addEventListener('click', () => { state.calendarState.mode = 'deadline'; showCalendarModal(); });
                document.getElementById('end-date-display-text').addEventListener('click', () => { state.calendarState.mode = 'endDate'; showCalendarModal(); });

                document.getElementById('recurrence-options').addEventListener('click', (e) => {
                    const btn = e.target.closest('button');
                    if (btn) {
                        document.querySelectorAll('#recurrence-options button').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        renderRecurrenceDaySelector(btn.dataset.type);
                    }
                });
            }
            function setupCalendarModalListeners() {
                document.getElementById('close-calendar-btn').addEventListener('click', () => document.getElementById('calendar-modal').classList.remove('visible'));
                document.getElementById('prev-month-btn').addEventListener('click', () => {
                    state.calendarState.month--;
                    if (state.calendarState.month < 0) {
                        state.calendarState.month = 11;
                        state.calendarState.year--;
                    }
                    renderCalendar(state.calendarState.year, state.calendarState.month);
                });
                document.getElementById('next-month-btn').addEventListener('click', () => {
                    state.calendarState.month++;
                    if (state.calendarState.month > 11) {
                        state.calendarState.month = 0;
                        state.calendarState.year++;
                    }
                    renderCalendar(state.calendarState.year, state.calendarState.month);
                });
                document.getElementById('calendar-grid').addEventListener('click', (e) => {
                    const dayEl = e.target.closest('.calendar-day');
                    if (dayEl && !dayEl.classList.contains('other-month')) {
                        const selectedDate = new Date(state.calendarState.year, state.calendarState.month, parseInt(dayEl.textContent));
                        if (state.calendarState.mode === 'deadline') {
                            state.currentSchedule.deadlineDate = selectedDate;
                            updateDeadlineDisplay();
                        } else if (state.calendarState.mode === 'endDate') {
                            state.currentSchedule.endDate = selectedDate;
                            updateEndDateDisplay();
                        }
                        document.getElementById('calendar-modal').classList.remove('visible');
                    }
                });
                document.getElementById('clear-date-btn').addEventListener('click', () => {
                    if (state.calendarState.mode === 'deadline') {
                        state.currentSchedule.deadlineDate = null;
                        updateDeadlineDisplay();
                    } else if (state.calendarState.mode === 'endDate') {
                        state.currentSchedule.endDate = null;
                        updateEndDateDisplay();
                    }
                    document.getElementById('calendar-modal').classList.remove('visible');
                });
            }
            function showSchedulePanel(id = null) {
                const titleEl = document.getElementById('schedule-panel-title');
                titleEl.textContent = id ? '编辑日程' : '新建日程';
                resetScheduleState(id);
                ELS.schedulePanel.classList.add('visible');
                ELS.app.style.overflow = 'hidden';
            }
            function hideSchedulePanel() { ELS.schedulePanel.classList.remove('visible'); ELS.app.style.overflow = 'initial'; state.currentlyEditingScheduleId = null; }

            function setScheduleType(type) {
                const isLong = type === 'long';
                document.getElementById('schedule-type-once').classList.toggle('active', !isLong);
                document.getElementById('schedule-type-long').classList.toggle('active', isLong);
                document.getElementById('recurrence-section').style.display = isLong ? 'block' : 'none';
                document.getElementById('end-date-section').style.display = isLong ? 'block' : 'none';
                document.getElementById('deadline-label').textContent = isLong ? '开始日期' : '截止日期';
            }

            function renderRecurrenceDaySelector(type) {
                const container = document.getElementById('recurrence-selector-days');
                container.innerHTML = '';
                let options = [];
                if (type === 'weekly') {
                    options = ['日', '一', '二', '三', '四', '五', '六'].map((day, i) => ({ value: i, text: `周${day}` }));
                } else if (type === 'monthly') {
                    for (let i = 1; i <= 31; i++) options.push({ value: i, text: `${i}日` });
                    options.push({ value: 'last', text: '最后一天' });
                }
                options.forEach(opt => {
                    container.innerHTML += `<label><input type="checkbox" name="recurrence-day" value="${opt.value}"> ${opt.text}</label>`;
                });
            }

            function setupImportanceStars() {
                document.getElementById('importance-stars').addEventListener('click', (e) => {
                    const starEl = e.target.closest('.star');
                    if (!starEl) return;
                    const score = parseFloat(document.getElementById('importance-score').textContent);
                    const starIndex = Array.from(starEl.parentElement.children).indexOf(starEl);
                    const baseScore = starIndex * 2;
                    if (score === baseScore + 2) {
                        updateStarsDisplay(baseScore + 1);
                    } else {
                        updateStarsDisplay(baseScore + 2);
                    }
                });
            }
            function updateStarsDisplay(score) {
                document.getElementById('importance-score').textContent = score.toFixed(1);
                const stars = document.querySelectorAll('#importance-stars .star');
                const halfScore = score / 2;
                stars.forEach((star, index) => {
                    star.classList.remove('filled', 'half');
                    if (halfScore >= index + 1) {
                        star.classList.add('filled');
                    } else if (halfScore > index) {
                        star.classList.add('half');
                    }
                });
            }
            function resetScheduleState(id = null) {
                state.currentlyEditingScheduleId = id;
                let schedule = { eventType: 'once', title: '', description: '', importance: 0, deadline: null, completed: false, recurrence: null, endDate: null, completedDates: [] };
                if (id) {
                    const existing = state.schedules.find(s => s.id === id);
                    if (existing) schedule = JSON.parse(JSON.stringify(existing));
                }

                state.currentSchedule.deadlineDate = schedule.deadline ? new Date(schedule.deadline.year, schedule.deadline.month - 1, schedule.deadline.day) : null;
                state.currentSchedule.endDate = schedule.endDate ? new Date(schedule.endDate) : null;

                setScheduleType(schedule.eventType);
                if (schedule.recurrence) {
                    const btn = document.querySelector(`#recurrence-options button[data-type="${schedule.recurrence.type}"]`);
                    if (btn) btn.click();
                    setTimeout(() => {
                        if (schedule.recurrence.days) {
                            schedule.recurrence.days.forEach(day => {
                                const cb = document.querySelector(`input[name="recurrence-day"][value="${day}"]`);
                                if (cb) cb.checked = true;
                            });
                        }
                    }, 0);
                }

                document.getElementById('schedule-title-input').value = schedule.title;
                updateStarsDisplay(schedule.importance);
                updateDeadlineDisplay();
                updateEndDateDisplay();
                document.getElementById('deadline-hour-input').value = schedule.deadline?.hour ?? '';
                document.getElementById('deadline-minute-input').value = schedule.deadline?.minute ?? '';
                document.getElementById('schedule-description-input').value = schedule.description;
            }
            async function confirmSchedule() {
                const title = document.getElementById('schedule-title-input').value.trim();
                if (!title) { alert('请输入日程标题！'); return; }

                const hourVal = document.getElementById('deadline-hour-input').value;
                const minuteVal = document.getElementById('deadline-minute-input').value;
                const hour = (hourVal !== '' && !isNaN(parseInt(hourVal))) ? parseInt(hourVal) : null;
                const minute = (minuteVal !== '' && !isNaN(parseInt(minuteVal))) ? parseInt(minuteVal) : null;

                const deadline = state.currentSchedule.deadlineDate ? {
                    year: state.currentSchedule.deadlineDate.getFullYear(),
                    month: state.currentSchedule.deadlineDate.getMonth() + 1,
                    day: state.currentSchedule.deadlineDate.getDate(),
                    hour: (hour >= 0 && hour <= 23) ? hour : null,
                    minute: (minute >= 0 && minute <= 59) ? minute : null,
                } : null;

                const isLongTerm = document.getElementById('schedule-type-long').classList.contains('active');
                let recurrence = null;
                if (isLongTerm) {
                    const activeBtn = document.querySelector('#recurrence-options button.active');
                    if (activeBtn) {
                        const type = activeBtn.dataset.type;
                        let days = [];
                        if (type === 'daily') {
                            recurrence = { type: 'daily' };
                        } else {
                            document.querySelectorAll('input[name="recurrence-day"]:checked').forEach(cb => {
                                days.push(isNaN(parseInt(cb.value)) ? cb.value : parseInt(cb.value));
                            });
                            if (days.length > 0) recurrence = { type, days };
                        }
                    }
                }

                const scheduleData = {
                    timestamp: Date.now(),
                    eventType: isLongTerm ? 'long' : 'once',
                    title: title,
                    importance: parseFloat(document.getElementById('importance-score').textContent),
                    deadline: deadline,
                    description: document.getElementById('schedule-description-input').value.trim(),
                    completed: false,
                    recurrence: recurrence,
                    endDate: state.currentSchedule.endDate ? state.currentSchedule.endDate.toISOString() : null,
                    completedDates: [],
                };

                if (state.currentlyEditingScheduleId) {
                    const existing = state.schedules.find(s => s.id === state.currentlyEditingScheduleId);
                    scheduleData.id = state.currentlyEditingScheduleId;
                    scheduleData.completed = existing.completed;
                    scheduleData.timestamp = existing.timestamp;
                    scheduleData.completedDates = existing.completedDates || [];
                    await db.schedules.put(scheduleData);
                    const index = state.schedules.findIndex(s => s.id === scheduleData.id);
                    state.schedules[index] = scheduleData;
                } else {
                    const id = await db.schedules.add(scheduleData);
                    scheduleData.id = id;
                    state.schedules.push(scheduleData);
                    const msgId = await db.messages.add({ timestamp: scheduleData.timestamp, role: 'user', content: ``, type: 'schedule', relatedId: id });
                    state.messages.push({ id: msgId, timestamp: scheduleData.timestamp, role: 'user', type: 'schedule', relatedId: id });
                }

                hideSchedulePanel();
                renderSchedules();
                renderChatMessages();
            }
            function classifySchedule(schedule) {
                const now = new Date();
                now.setHours(0, 0, 0, 0);
                const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
                let isUrgent = false;

                if (schedule.eventType !== 'long' && schedule.deadline) {
                    const deadlineDate = new Date(schedule.deadline.year, schedule.deadline.month - 1, schedule.deadline.day);
                    if (deadlineDate <= threeDaysLater) isUrgent = true;
                }

                const isImportant = schedule.importance >= 7;
                if (isImportant && isUrgent) return 1;
                if (isImportant && !isUrgent) return 2;
                if (!isImportant && isUrgent) return 3;
                return 4;
            }

            // --- NEW: Schedule Page Rendering ---
            function updateSchedulePage() {
                const wrapper = document.querySelector('.schedule-pages-wrapper');
                const dots = document.querySelectorAll('.schedule-page-dots .dot');
                const titles = ['今日待办', '所有日程', '日历视图'];

                wrapper.style.transform = `translateX(-${state.schedulePageIndex * 33.333}%)`;
                dots.forEach((dot, i) => dot.classList.toggle('active', i === state.schedulePageIndex));
                document.getElementById('schedule-page-title').textContent = titles[state.schedulePageIndex];
            }

            function renderSchedules() {
                renderTodayTasks();
                renderQuadrantView();
                renderCalendarView();

                let completedCount = state.schedules.filter(s => s.eventType === 'once' && s.completed).length;
                state.schedules.forEach(s => {
                    if (s.eventType === 'long' && Array.isArray(s.completedDates)) {
                        completedCount += s.completedDates.length;
                    }
                });
                document.getElementById('schedule-count').innerHTML = `已完成${completedCount}项事件 ${appIcon('star', 'svg-icon-inline')}`;
            }

            function renderTodayTasks() {
                const container = document.getElementById('today-tasks-content');
                container.innerHTML = ''; // 这一行保持不变，用于清空
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

                const todayIncomplete = [];
                const todayCompleted = [];

                // 这部分筛选逻辑保持不变
                state.schedules.forEach(s => {
                    let isTodayTask = false;
                    if (s.eventType === 'once') {
                        if (s.deadline) {
                            const deadlineDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                            if (deadlineDate.getTime() === today.getTime()) isTodayTask = true;
                        }
                    } else if (s.eventType === 'long' && s.recurrence) {
                        if (s.endDate && new Date(s.endDate) < today) return;
                        if (s.deadline) {
                            const startDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                            if (startDate > today) return;
                        }

                        const dayOfWeek = today.getDay();
                        const dayOfMonth = today.getDate();

                        switch (s.recurrence.type) {
                            case 'daily': isTodayTask = true; break;
                            case 'weekly': isTodayTask = s.recurrence.days.includes(dayOfWeek); break;
                            case 'monthly':
                                const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
                                if (s.recurrence.days.includes('last') && dayOfMonth === daysInMonth) isTodayTask = true;
                                else isTodayTask = s.recurrence.days.includes(dayOfMonth);
                                break;
                        }
                    }

                    if (isTodayTask) {
                        let isCompleted = (s.eventType === 'once') ? s.completed : (s.completedDates && s.completedDates.includes(todayStr));
                        if (isCompleted) todayCompleted.push(s);
                        else todayIncomplete.push(s);
                    }
                });

                todayIncomplete.sort((a, b) => b.importance - a.importance);
                todayCompleted.sort((a, b) => b.timestamp - a.timestamp);

                // --- 这是唯一的修改之处 ---
                if (todayIncomplete.length > 0) {
                    // 【修复】不再使用 innerHTML +=，而是使用 appendChild
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'schedule-section-title';
                    titleDiv.textContent = '待完成';
                    container.appendChild(titleDiv);

                    todayIncomplete.forEach(s => container.appendChild(createTodayTaskItem(s, todayStr)));
                }

                if (todayCompleted.length > 0) {
                    // 【修复】不再使用 innerHTML +=，而是使用 appendChild
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'schedule-section-title';
                    titleDiv.textContent = '已完成';
                    if (todayIncomplete.length > 0) {
                        titleDiv.style.marginTop = '20px';
                    }
                    container.appendChild(titleDiv);

                    todayCompleted.forEach(s => container.appendChild(createTodayTaskItem(s, todayStr)));
                }
                // --- 修改结束 ---

                if (todayIncomplete.length === 0 && todayCompleted.length === 0) {
                    container.innerHTML = '<div class="empty-state">今天没有待办事项，轻松一下吧！</div>';
                }
            }

            function createTodayTaskItem(s, todayStr) {
                const item = document.createElement('div');
                item.className = 'today-task-item';
                if (s.importance >= 7) item.classList.add('important');

                let isCompleted = (s.eventType === 'once') ? s.completed : (s.completedDates && s.completedDates.includes(todayStr));
                if (isCompleted) item.classList.add('completed');

                item.innerHTML = `<div class="title">${s.title}</div><div class="checkbox">${appIcon('check')}</div>`;
                item.querySelector('.checkbox').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (s.eventType === 'once') {
                        s.completed = !s.completed;
                        await db.schedules.update(s.id, { completed: s.completed });
                    } else if (s.eventType === 'long') {
                        if (!s.completedDates) s.completedDates = [];
                        if (isCompleted) {
                            s.completedDates = s.completedDates.filter(d => d !== todayStr);
                        } else {
                            s.completedDates.push(todayStr);
                        }
                        await db.schedules.update(s.id, { completedDates: s.completedDates });
                    }
                    renderSchedules();
                    renderChatMessages(false);
                });
                item.addEventListener('click', () => showScheduleDetailModal(s.id));
                return item;
            }

            function renderQuadrantView() {
                const quadrants = { 1: [], 2: [], 3: [], 4: [] };
                const completedOnce = [];
                const completedLong = [];

                state.schedules.forEach(s => {
                    // 这个分类逻辑保持不变
                    if (s.eventType === 'once') {
                        if (s.completed) {
                            completedOnce.push(s);
                        } else {
                            quadrants[classifySchedule(s)].push(s);
                        }
                    } else if (s.eventType === 'long' && s.completedDates && s.completedDates.length > 0) {
                        completedLong.push(s);
                    }
                });

                for (let i = 1; i <= 4; i++) {
                    const container = document.getElementById(`quadrant-${i}-items`);
                    container.innerHTML = '';

                    if (quadrants[i].length > 0) {
                        // --- 这里是修改的核心 ---
                        quadrants[i].sort((a, b) => {
                            // 1. 按重要性降序排列 (值越大越靠前)
                            const importanceDiff = b.importance - a.importance;
                            if (importanceDiff !== 0) {
                                return importanceDiff;
                            }

                            // 2. 如果重要性相同，则按截止日期升序排列 (日期越早越靠前)
                            // 将 deadline 对象转换为时间戳，没有 deadline 的视为无穷大，排在最后
                            const aDdlTime = a.deadline ? new Date(a.deadline.year, a.deadline.month - 1, a.deadline.day, a.deadline.hour || 0, a.deadline.minute || 0).getTime() : Infinity;
                            const bDdlTime = b.deadline ? new Date(b.deadline.year, b.deadline.month - 1, b.deadline.day, b.deadline.hour || 0, b.deadline.minute || 0).getTime() : Infinity;

                            return aDdlTime - bDdlTime;

                        }).forEach(s => container.appendChild(createScheduleItemElement(s)));
                    } else {
                        container.innerHTML = `<div class="empty-state">无</div>`;
                    }
                }

                // 下面的已完成部分逻辑保持不变
                const completedContainer = document.getElementById('completed-items');
                completedContainer.innerHTML = '';

                completedOnce.sort((a, b) => b.timestamp - a.timestamp);
                completedLong.sort((a, b) => b.timestamp - a.timestamp);

                const allCompleted = [...completedOnce, ...completedLong];

                if (allCompleted.length > 0) {
                    allCompleted.forEach(s => completedContainer.appendChild(createScheduleItemElement(s)));
                } else {
                    completedContainer.innerHTML = `<div class="empty-state">还没有已完成的日程</div>`;
                }
            }

            function renderCalendarView() {
                const now = new Date();
                renderMonthCalendarForView(now.getFullYear(), now.getMonth());
                document.getElementById('calendar-event-list').innerHTML = ''; // Clear event list on initial render
            }

            function renderMonthCalendarForView(year, month) {
                const container = document.getElementById('month-calendar-view');
                const grid = document.createElement('div');
                grid.className = 'calendar-grid';

                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const eventsByDate = {};

                for (let day = 1; day <= daysInMonth; day++) {
                    const checkDate = new Date(year, month, day);
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    eventsByDate[dateStr] = [];

                    state.schedules.forEach(s => {
                        let isTaskForThisDay = false;
                        if (s.eventType === 'once' && s.deadline) {
                            const deadlineDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                            if (deadlineDate.getTime() === checkDate.getTime()) isTaskForThisDay = true;
                        } else if (s.eventType === 'long' && s.recurrence) {
                            if (s.endDate && new Date(s.endDate) < checkDate) return;
                            if (s.deadline) {
                                const startDate = new Date(s.deadline.year, s.deadline.month - 1, s.deadline.day);
                                if (startDate > checkDate) return;
                            }

                            if (s.recurrence.type === 'daily') isTaskForThisDay = true;
                            else if (s.recurrence.type === 'weekly') isTaskForThisDay = s.recurrence.days.includes(checkDate.getDay());
                            else if (s.recurrence.type === 'monthly') {
                                if (s.recurrence.days.includes('last') && day === daysInMonth) isTaskForThisDay = true;
                                else isTaskForThisDay = s.recurrence.days.includes(day);
                            }
                        }
                        if (isTaskForThisDay) eventsByDate[dateStr].push(s);
                    });
                }

                const header = `<div class="calendar-header"><span class="calendar-month-year">${year}年 ${month + 1}月</span></div><div class="calendar-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>`;
                const firstDay = new Date(year, month, 1).getDay();

                for (let i = 0; i < firstDay; i++) { grid.insertAdjacentHTML('beforeend', `<div></div>`); }
                for (let i = 1; i <= daysInMonth; i++) {
                    const dayEl = document.createElement('div');
                    dayEl.className = 'calendar-day';
                    dayEl.textContent = i;
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;

                    if (eventsByDate[dateStr] && eventsByDate[dateStr].length > 0) {
                        const hasImportant = eventsByDate[dateStr].some(s => s.importance >= 7);
                        const dot = document.createElement('div');
                        dot.className = `event-dot ${hasImportant ? 'important' : 'normal'}`;
                        dayEl.appendChild(dot);
                    }

                    if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
                        dayEl.classList.add('today');
                    }
                    dayEl.addEventListener('click', () => renderEventsForDate(dateStr, eventsByDate[dateStr]));
                    grid.appendChild(dayEl);
                }
                container.innerHTML = header;
                container.appendChild(grid);
            }

            function renderEventsForDate(dateStr, events) {
                const listContainer = document.getElementById('calendar-event-list');
                listContainer.innerHTML = ''; // 清空

                // --- 事件显示部分 (和原来一样) ---
                const parts = dateStr.split('-');
                const year = parseInt(parts[0]);
                const month = parseInt(parts[1]);
                const day = parseInt(parts[2]);
                const formattedDate = `${year}年${month}月${day}日`;

                const titleDiv = document.createElement('div');
                titleDiv.className = 'schedule-section-title';
                titleDiv.textContent = `${formattedDate} 的事件`;
                listContainer.appendChild(titleDiv);

                if (!events || events.length === 0) {
                    const emptyDiv = document.createElement('div');
                    emptyDiv.className = 'empty-state';
                    emptyDiv.textContent = '当天没有事件';
                    listContainer.appendChild(emptyDiv);
                } else {
                    events.sort((a, b) => b.importance - a.importance).forEach(s => {
                        const item = document.createElement('div');
                        item.className = 'event-item';
                        let timeStr = '';
                        if (s.deadline && s.deadline.hour !== null && s.deadline.minute !== null) {
                            timeStr = `${String(s.deadline.hour).padStart(2, '0')}:${String(s.deadline.minute).padStart(2, '0')}`;
                        }
                        item.innerHTML = `<div class="event-title">${s.title}</div><div class="event-time">${timeStr}</div>`;
                        listContainer.appendChild(item);
                    });
                }

                // --- 新增：日记功能区 ---
                const hr = document.createElement('hr'); // 添加一条分割线
                hr.style.cssText = "border: none; border-top: 1px solid var(--border-color); margin: 20px 0;";
                listContainer.appendChild(hr);

                const diaryContainer = document.createElement('div');
                diaryContainer.id = 'diary-section-container';
                listContainer.appendChild(diaryContainer);

                // 更新 state 中的当前日期
                state.currentDiaryDate = new Date(year, month - 1, day);

                // 调用辅助函数来渲染日记UI
                renderDiarySection(diaryContainer, state.currentDiaryDate);
            }

            // 辅助函数1：渲染整个日记区域
            function renderDiarySection(container, date) {
                const dateStr = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;

                // 创建日记区域的 HTML 结构
                container.innerHTML = `
        <div class="schedule-section-title" style="display: flex; justify-content: space-between; align-items: center;">
            <span>${dateStr} 的日记</span>
            <button id="edit-diary-prompt-btn-inline" style="padding: 4px 8px; font-size: 12px; border-radius: 6px; background: var(--bg-soft); border: none; cursor: pointer;">编辑提示词</button>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin: 15px 0;">
            <label style="flex-shrink: 0;">角色：</label>
            <select id="diary-char-select-inline" style="flex-grow: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--accent-primary); background: var(--bg-secondary); color: var(--text-primary);"></select>
        </div>
        <div id="diary-content-area-inline">
            <!-- 日记内容或生成按钮会在这里动态添加 -->
        </div>
    `;

                // 填充角色选择器
                const charSelect = container.querySelector('#diary-char-select-inline');
                if (state.characters.length > 0) {
                    state.characters.forEach(char => {
                        const option = document.createElement('option');
                        option.value = char.id;
                        option.textContent = char.name;
                        charSelect.appendChild(option);
                    });
                    // 默认选中当前角色或第一个角色
                    if (state.currentDiaryCharId && state.characters.some(c => c.id === state.currentDiaryCharId)) {
                        charSelect.value = state.currentDiaryCharId;
                    } else {
                        state.currentDiaryCharId = state.characters[0].id;
                        charSelect.value = state.currentDiaryCharId;
                    }
                }

                // --- 绑定事件监听 ---

                // 1. 绑定角色选择器的切换事件
                charSelect.addEventListener('change', (e) => {
                    state.currentDiaryCharId = parseInt(e.target.value);
                    updateDiaryContentArea(date); // 切换角色后更新日记内容
                });

                // 2. 绑定“编辑提示词”按钮的点击事件
                container.querySelector('#edit-diary-prompt-btn-inline').addEventListener('click', () => {
                    // 每次点击时，都从 state.config中读取最新的提示词
                    document.getElementById('diary-system-prompt').value = state.config.diaryPrompt;

                    // 弹出编辑模态框
                    document.getElementById('diary-prompt-modal').classList.add('visible');
                });

                // 初始加载日记内容
                updateDiaryContentArea(date);
            }


            // 辅助函数2：更新日记内容区域（显示日记、生成按钮或加载中）
            async function updateDiaryContentArea(date) {
                const contentArea = document.getElementById('diary-content-area-inline');
                if (!contentArea) return;

                const dateStrForDB = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                const diary = state.diaries.find(d => d.date === dateStrForDB && d.charId === state.currentDiaryCharId);
                const character = state.characters.find(c => c.id === state.currentDiaryCharId);

                if (diary) {
                    // 如果有日记，显示日记内容和删除按钮
                    contentArea.innerHTML = `
            <div id="diary-text-inline" style="background: var(--bg-soft); border-radius: 12px; padding: 20px; white-space: pre-wrap; line-height: 1.8; font-size: 15px; max-height: 400px; overflow-y: auto;"></div>
            <button id="delete-diary-btn-inline" class="form-button" style="margin-top: 15px; background-color: var(--expense-color);">删除日记</button>
        `;
                    contentArea.querySelector('#diary-text-inline').textContent = diary.content;
                    contentArea.querySelector('#delete-diary-btn-inline').addEventListener('click', deleteDiary);
                } else {
                    // 如果没有日记，显示生成按钮
                    const btnText = character ? `${appIcon('diary', 'svg-icon-inline')} 生成${character.name}的日记` : `${appIcon('diary', 'svg-icon-inline')} 生成日记`;
                    contentArea.innerHTML = `
            <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
                <p>暂无日记</p>
                <button id="generate-diary-btn-inline" class="form-button" style="margin-top: 10px;">${btnText}</button>
            </div>
        `;
                    contentArea.querySelector('#generate-diary-btn-inline').addEventListener('click', async () => {
                        // 显示加载动画
                        contentArea.innerHTML = `
                <div style="display: flex; justify-content: center; align-items: center; padding: 40px; flex-direction: column;">
                    <div class="typing-indicator"><span>.</span><span>.</span><span>.</span></div>
                    <p style="margin-top: 15px; color: var(--text-secondary);">正在生成日记...</p>
                </div>
            `;
                        await generateDiary(); // 调用生成日记的函数
                        updateDiaryContentArea(date); // 生成后再次更新界面
                    });
                }
            }

            function createScheduleItemElement(schedule) {
                const item = document.createElement('div');
                item.className = 'schedule-item';

                let isCompleted = schedule.completed;
                if (schedule.eventType === 'long') {
                    isCompleted = false; // In "All Schedules" view, long-term tasks are not shown as completable
                }
                if (isCompleted) item.classList.add('completed');

                item.dataset.id = schedule.id;

                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'schedule-item-details';
                detailsDiv.innerHTML = `<div class="title">${schedule.title}</div>`;

                if (schedule.deadline) {
                    const ddl = document.createElement('div');
                    ddl.className = 'ddl';
                    const label = schedule.eventType === 'long' ? '开始' : 'DDL';
                    ddl.textContent = `${label}: ${formatDeadline(schedule.deadline)}`;
                    detailsDiv.appendChild(ddl);
                }

                const checkbox = document.createElement('div');
                checkbox.className = 'checkbox';
                checkbox.innerHTML = appIcon('check');
                if (schedule.eventType === 'long') {
                    checkbox.style.display = 'none'; // Don't show checkbox for long term in this view
                }

                item.appendChild(detailsDiv);
                item.appendChild(checkbox);

                checkbox.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (schedule.eventType === 'once') {
                        schedule.completed = !schedule.completed;
                        await db.schedules.update(schedule.id, { completed: schedule.completed });
                        renderSchedules();
                        renderChatMessages(false);
                    }
                });
                item.addEventListener('click', () => showScheduleDetailModal(schedule.id));
                return item;
            }
            function showScheduleDetailModal(id) {
                const schedule = state.schedules.find(s => s.id === id);
                if (!schedule) return;
                state.currentlyEditingScheduleId = id;
                const modal = document.getElementById('schedule-detail-modal');
                document.getElementById('detail-title').textContent = schedule.title;
                document.getElementById('detail-description').textContent = schedule.description || '无';
                document.getElementById('detail-importance').textContent = `${schedule.importance.toFixed(1)} / 10.0`;
                document.getElementById('detail-deadline').textContent = schedule.deadline ? formatDeadline(schedule.deadline) : '无';
                document.getElementById('detail-type').textContent = schedule.eventType === 'long' ? '长期事件' : '单次事件';
                modal.classList.add('visible');
            }
            function handleEditScheduleFromModal() {
                document.getElementById('schedule-detail-modal').classList.remove('visible');
                showSchedulePanel(state.currentlyEditingScheduleId);
            }
            async function handleDeleteScheduleFromModal() {
                if (!confirm('确定要删除此日程及其聊天记录吗？')) return;
                const id = state.currentlyEditingScheduleId;
                const msg = state.messages.find(m => m.relatedId === id && m.type === 'schedule');

                await db.schedules.delete(id);
                state.schedules = state.schedules.filter(s => s.id !== id);
                if (msg) {
                    await db.messages.delete(msg.id);
                    state.messages = state.messages.filter(m => m.id !== msg.id);
                }

                document.getElementById('schedule-detail-modal').classList.remove('visible');
                renderSchedules();
                renderChatMessages(false);
                state.currentlyEditingScheduleId = null;
            }
            function formatDeadline(deadlineObj) {
                if (!deadlineObj) return '无';
                const { year, month, day, hour, minute } = deadlineObj;
                let str = '';
                if (year && month && day) str += `${year}年${month}月${day}日`;

                if (hour != null && minute != null) {
                    if (str) str += ' ';
                    str += `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                }
                return str.trim() || '无';
            }
            function showCalendarModal() {
                const now = new Date();
                let initialDate = now;
                if (state.calendarState.mode === 'deadline' && state.currentSchedule.deadlineDate) {
                    initialDate = state.currentSchedule.deadlineDate;
                } else if (state.calendarState.mode === 'endDate' && state.currentSchedule.endDate) {
                    initialDate = state.currentSchedule.endDate;
                }

                state.calendarState.year = initialDate.getFullYear();
                state.calendarState.month = initialDate.getMonth();
                renderCalendar(state.calendarState.year, state.calendarState.month);
                document.getElementById('calendar-modal').classList.add('visible');
            }
            function renderCalendar(year, month) {
                const grid = document.getElementById('calendar-grid');
                document.getElementById('calendar-month-year').textContent = `${year}年 ${month + 1}月`;
                grid.innerHTML = '';
                const firstDay = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const today = new Date();

                for (let i = 0; i < firstDay; i++) {
                    grid.insertAdjacentHTML('beforeend', `<div></div>`);
                }
                for (let i = 1; i <= daysInMonth; i++) {
                    const dayEl = document.createElement('div');
                    dayEl.className = 'calendar-day';
                    dayEl.textContent = i;
                    if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
                        dayEl.classList.add('today');
                    }

                    let dateToCheck = null;
                    if (state.calendarState.mode === 'deadline') dateToCheck = state.currentSchedule.deadlineDate;
                    else if (state.calendarState.mode === 'endDate') dateToCheck = state.currentSchedule.endDate;

                    if (dateToCheck && year === dateToCheck.getFullYear() && month === dateToCheck.getMonth() && i === dateToCheck.getDate()) {
                        dayEl.classList.add('selected');
                    }
                    grid.appendChild(dayEl);
                }
            }
            function updateDeadlineDisplay() {
                const textEl = document.getElementById('deadline-display-text');
                if (state.currentSchedule.deadlineDate) {
                    textEl.textContent = formatDeadline({
                        year: state.currentSchedule.deadlineDate.getFullYear(),
                        month: state.currentSchedule.deadlineDate.getMonth() + 1,
                        day: state.currentSchedule.deadlineDate.getDate()
                    });
                    textEl.style.color = 'var(--text-primary)';
                } else {
                    textEl.textContent = '选择日期';
                    textEl.style.color = 'var(--text-secondary)';
                    document.getElementById('deadline-hour-input').value = '';
                    document.getElementById('deadline-minute-input').value = '';
                }
            }
            function updateEndDateDisplay() {
                const textEl = document.getElementById('end-date-display-text');
                if (state.currentSchedule.endDate) {
                    textEl.textContent = formatDeadline({
                        year: state.currentSchedule.endDate.getFullYear(),
                        month: state.currentSchedule.endDate.getMonth() + 1,
                        day: state.currentSchedule.endDate.getDate()
                    });
                    textEl.style.color = 'var(--text-primary)';
                } else {
                    textEl.textContent = '永不结束';
                    textEl.style.color = 'var(--text-secondary)';
                }
            }

            // --- Forward to Chat ---
            async function forwardLedgerToChat() {
                const { filtered, displayCurrency } = getFilteredTransactions();
                const isChartView = document.getElementById('ledger-view-wrapper').style.transform === 'translateX(-50%)';

                if (isChartView) {
                    // Sync pie chart data
                    const expenseData = {};
                    const incomeData = {};
                    filtered.forEach(t => {
                        const data = t.type === 'expense' ? expenseData : incomeData;
                        if (!data[t.category]) data[t.category] = 0;
                        data[t.category] += t.displayAmount;
                    });

                    const totalExpense = Object.values(expenseData).reduce((s, a) => s + a, 0);
                    const totalIncome = Object.values(incomeData).reduce((s, a) => s + a, 0);

                    const summaryData = {
                        title: `${generatePieChartSubtitle()}的账单总结`,
                        totalExpense,
                        totalIncome,
                        expenseDetails: Object.entries(expenseData).map(([catId, amount]) => ({
                            id: catId,
                            name: CATEGORIES.expense.find(c => c.id === catId)?.name || '未知',
                            amount,
                            percentage: totalExpense > 0 ? (amount / totalExpense * 100) : 0
                        })),
                        incomeDetails: Object.entries(incomeData).map(([catId, amount]) => ({
                            id: catId,
                            name: CATEGORIES.income.find(c => c.id === catId)?.name || '未知',
                            amount,
                            percentage: totalIncome > 0 ? (amount / totalIncome * 100) : 0
                        })),
                        currency: displayCurrency
                    };

                    if (totalExpense === 0 && totalIncome === 0) { alert('当前筛选条件下没有数据可同步'); return; }
                    if (!confirm('要将当前图表分析同步到聊天中吗？')) return;

                    const newMsg = { timestamp: Date.now(), role: 'user', content: JSON.stringify(summaryData), type: 'pie_chart_summary' };
                    const id = await db.messages.add(newMsg);
                    state.messages.push({ ...newMsg, id });
                } else {
                    // Sync list data
                    if (filtered.length === 0) { alert('当前筛选条件下没有数据可同步'); return; }
                    if (!confirm('要将当前筛选的账本列表同步到聊天中吗？')) return;

                    const summaryData = filtered.map(t => ({
                        type: t.type,
                        amount: t.amount,
                        currency: t.currency,
                        category: CATEGORIES[t.type].find(c => c.id === t.category)?.name || '未知',
                        remark: t.remark
                    }));

                    const newMsg = { timestamp: Date.now(), role: 'user', content: JSON.stringify(summaryData), type: 'ledger_summary' };
                    const id = await db.messages.add(newMsg);
                    state.messages.push({ ...newMsg, id });
                }
                navigateTo('accounting-screen');
                renderChatMessages(true, true);
            }
            async function forwardScheduleToChat() {
                if (!confirm('要将完整的日程信息同步到聊天中吗？')) return;

                const summaryData = state.schedules.map(s => ({
                    title: s.title,
                    eventType: s.eventType,
                    importance: s.importance,
                    deadline: s.deadline ? formatDeadline(s.deadline) : '无',
                    description: s.description,
                    completed: s.completed
                }));

                const newMsg = { timestamp: Date.now(), role: 'user', content: JSON.stringify(summaryData), type: 'schedule_summary' };
                const id = await db.messages.add(newMsg);
                state.messages.push({ ...newMsg, id });
                navigateTo('accounting-screen');
                renderChatMessages(true, true);
            }

            // --- Ledger Filter Modals ---
            function openMonthFilterModal() {
                const modal = document.getElementById('ledger-month-filter-modal');
                const list = document.getElementById('month-filter-list');
                list.innerHTML = '';

                const availableMonths = [...new Set(state.transactions.map(t => {
                    const d = new Date(t.timestamp);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                }))].sort().reverse();

                availableMonths.forEach(monthStr => {
                    const item = document.createElement('div');
                    item.className = 'filter-item';
                    const isChecked = state.ledgerFilters.months.includes(monthStr);
                    item.innerHTML = `
                    <input type="checkbox" id="month-${monthStr}" value="${monthStr}" ${isChecked ? 'checked' : ''}>
                    <label for="month-${monthStr}">${monthStr.replace('-', '年')}月</label>
                `;
                    list.appendChild(item);
                });
                modal.classList.add('visible');
            }

            function openCategoryFilterModal() {
                const modal = document.getElementById('ledger-category-filter-modal');
                const renderList = (type) => {
                    const list = document.getElementById('category-filter-list');
                    list.innerHTML = '';
                    CATEGORIES[type].forEach(cat => {
                        const item = document.createElement('div');
                        item.className = 'filter-item';
                        const isChecked = state.ledgerFilters.type === type && state.ledgerFilters.categories.includes(cat.id);
                        item.innerHTML = `
                        <input type="checkbox" id="cat-${cat.id}" value="${cat.id}" ${isChecked ? 'checked' : ''}>
                        <label for="cat-${cat.id}">${cat.name}</label>
                    `;
                        list.appendChild(item);
                    });
                };

                const tabs = modal.querySelectorAll('.filter-tab');
                tabs.forEach(tab => {
                    tab.classList.toggle('active', tab.dataset.type === state.ledgerFilters.type);
                    tab.onclick = () => {
                        tabs.forEach(t => t.classList.remove('active'));
                        tab.classList.add('active');
                        renderList(tab.dataset.type);
                    };
                });

                renderList(state.ledgerFilters.type);
                modal.classList.add('visible');
            }

