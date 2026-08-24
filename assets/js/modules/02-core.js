/* Cava Notebook - 02-core.js */
            const db = new Dexie('WarmBookkeepingDB_v10'); // Upped version for schema change
            db.version(10).stores({
                appConfig: 'id',
                transactions: '++id, timestamp, type, category, amount, currency, remark',
                messages: '++id, timestamp, role, content, type, senderId, relatedId',
                apiProxies: '++id, name, url, apiKey, models',
                aiCharacters: '++id, name, prompt, avatar, proxyId, model, backupProxyId, backupModel',
                currencies: 'code, name, rate',
                transactionTemplates: '++id, name, type, category, amount, currency, remark',
                schedules: '++id, timestamp, title, description, importance, deadline, eventType, completed, recurrence, endDate, completedDates',
                emojiPacks: '++id, name, image, timestamp',
                diaries: '++id, date, charId, content, timestamp'
            });

            // v11 adds summary memories without changing or migrating existing records.
            db.version(11).stores({
                appConfig: 'id',
                transactions: '++id, timestamp, type, category, amount, currency, remark',
                messages: '++id, timestamp, role, content, type, senderId, relatedId',
                apiProxies: '++id, name, url, apiKey, models',
                aiCharacters: '++id, name, prompt, avatar, proxyId, model, backupProxyId, backupModel',
                currencies: 'code, name, rate',
                transactionTemplates: '++id, name, type, category, amount, currency, remark',
                schedules: '++id, timestamp, title, description, importance, deadline, eventType, completed, recurrence, endDate, completedDates',
                emojiPacks: '++id, name, image, timestamp',
                diaries: '++id, date, charId, content, timestamp',
                memories: '++id, startTime, endTime, sourceType, sourceStartId, sourceEndId, recallMode, sortOrder, createdAt'
            });

            // v12 prepares plain chat messages for local-first cloud sync.
            // Existing numeric IDs stay in place so old relations and UI code keep working.
            db.version(12).stores({
                appConfig: 'id',
                transactions: '++id, timestamp, type, category, amount, currency, remark',
                messages: '++id, &syncId, timestamp, updatedAt, deletedAt, syncStatus, role, content, type, senderId, relatedId',
                apiProxies: '++id, name, url, apiKey, models',
                aiCharacters: '++id, &syncId, name, prompt, avatar, proxyId, model, backupProxyId, backupModel',
                currencies: 'code, name, rate',
                transactionTemplates: '++id, name, type, category, amount, currency, remark',
                schedules: '++id, timestamp, title, description, importance, deadline, eventType, completed, recurrence, endDate, completedDates',
                emojiPacks: '++id, name, image, timestamp',
                diaries: '++id, date, charId, content, timestamp',
                memories: '++id, startTime, endTime, sourceType, sourceStartId, sourceEndId, recallMode, sortOrder, createdAt'
            }).upgrade(async transaction => {
                const migrationTime = Date.now();
                await transaction.table('aiCharacters').toCollection().modify(character => {
                    character.syncId = character.syncId || createLegacySyncId('character', [
                        character.id, character.name, character.prompt
                    ]);
                });
                await transaction.table('messages').toCollection().modify(message => {
                    Object.assign(message, ensureMessageSyncMetadata(message, migrationTime));
                });
            });

            const DEFAULT_SYSTEM_PROMPTS = {
                sendTime: true,
                sendModel: true,
                sendRole: true,
                ledger: '这是我的记账条目数据，请你帮我分析一下：{data}',
                schedule: '这是我的日程数据，请你帮我分析一下：{data}',
                pie: '这是我账本图表数据，请你帮我分析一下：{data}'
            };

            const DEFAULT_MEMORY_SETTINGS = {
                mode: 'messages',
                messageInterval: 50,
                dateIntervalDays: 3,
                autoEnabled: false,
                summarizerType: 'character',
                characterId: null,
                proxyId: null,
                model: '',
                tokenLimit: 2000,
                messageCursorId: null,
                dateCursor: null
            };

            const defaultLedgerDate = new Date();
            const DEFAULT_LEDGER_MONTH = `${defaultLedgerDate.getFullYear()}-${String(defaultLedgerDate.getMonth() + 1).padStart(2, '0')}`;

            let state = {
                config: {}, proxies: [], characters: [], messages: [], transactions: [], currencies: [], schedules: [], emojiPacks: [], diaries: [], memories: [],
                currentTransaction: { type: 'expense', category: null, amountStr: '0', currency: 'RMB' },
                currentSchedule: {},
                calendarState: { year: new Date().getFullYear(), month: new Date().getMonth(), selectedDate: null, mode: 'deadline' },
                ledgerFilters: { months: [DEFAULT_LEDGER_MONTH], type: 'expense', categories: [] },
                isSelectionMode: false,
                selectedMessages: new Set(),
                currentlyEditingMsgId: null,
                currentlyEditingTransactionId: null,
                currentlyEditingScheduleId: null,
                schedulePageIndex: 0,
                messagesDisplayed: 50,
                isLoadingMore: false,
                currentDiaryCharId: null,
                currentDiaryDate: null
            };

            const ELS = {
                body: document.body,
                app: document.getElementById('app-container'), pages: document.querySelectorAll('.page'), navItems: document.querySelectorAll('.nav-item'),
                chatHeaderTitle: document.getElementById('chat-header-title'), chatAvatar: document.getElementById('setting-chat-avatar-preview'),
                chatMessages: document.getElementById('chat-messages'), chatInput: document.getElementById('chat-input'), sendBtn: document.getElementById('send-btn'),
                chatCharacterBar: document.getElementById('chat-character-bar'), chatActionsBar: document.getElementById('chat-actions-bar'), chatMoreBtn: document.getElementById('chat-more-btn'),
                accountingScreen: document.getElementById('accounting-screen'), transactionPanel: document.getElementById('transaction-panel'),
                schedulePanel: document.getElementById('schedule-panel'),
                amountDisplay: document.getElementById('amount-display'), categorySelector: document.getElementById('category-selector'),
                ledgerList: document.getElementById('ledger-list'), ledgerSummary: document.getElementById('ledger-summary'),
                ledgerSort: document.getElementById('ledger-sort'),
                ledgerCurrency: document.getElementById('ledger-currency'),
                ledgerCount: document.getElementById('ledger-count'),
                themeSelectors: document.querySelectorAll('input[name="theme"]'),
                sidebar: document.getElementById('chat-sidebar'),
                sidebarOverlay: document.getElementById('sidebar-overlay'),
                chatSettingsBtn: document.getElementById('chat-settings-btn'),
                sidebarTokenCount: document.getElementById('sidebar-token-count'),
                previewContextBtn: document.getElementById('preview-context-btn'),
                sidebarPreviewContent: document.getElementById('sidebar-preview-content'),
            };

            const CATEGORIES = {
                expense: [{ id: 'food', name: '餐饮美食', icon: 'utensils' }, { id: 'shopping', name: '购物消费', icon: 'shopping-bag' }, { id: 'transport', name: '交通出行', icon: 'bus' }, { id: 'entertainment', name: '文化娱乐', icon: 'film' }, { id: 'games', name: '游戏相关', icon: 'gamepad' }, { id: 'housing', name: '居家生活', icon: 'house' }, { id: 'medical', name: '医疗健康', icon: 'heart-pulse' }, { id: 'social', name: '人情往来', icon: 'gift' }, { id: 'study', name: '学习提升', icon: 'graduation-cap' }, { id: 'other', name: '其他支出', icon: 'receipt' },],
                income: [{ id: 'salary', name: '工资', icon: 'briefcase' }, { id: 'bonus', name: '奖金', icon: 'award' }, { id: 'investment', name: '理财', icon: 'trend-up' }, { id: 'part-time', name: '兼职', icon: 'hand-coins' }, { id: 'other', name: '其他收入', icon: 'wallet' },]
            };
            const DEFAULT_AVATAR = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNTAiIGZpbGw9IiNGQUUxRDUiLz48cGF0aCBkPSJNNzIgMzVBNiA2IDAgMSAwIDYwIDM1IDYgNiAwIDAgMCA3MiAzNW0tNDQgMEE2IDYgMCAxIDAgMTYgMzUgNiA2IDAgMCAwIDI4IDM1TTMzIDYwYTQwIDQwIDAgMCAwIDM0IDBjLTEuNS05LTcuNS0xNS0xNy0xNVMzNC41IDUxIDMzIDYwWiIgZmlsbD0iIzhDN0I3MyIvPjwvc3ZnPg==';

            function createCavaSyncId() {
                if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
                const bytes = new Uint8Array(16);
                if (globalThis.crypto?.getRandomValues) {
                    globalThis.crypto.getRandomValues(bytes);
                } else {
                    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
                }
                bytes[6] = (bytes[6] & 0x0f) | 0x40;
                bytes[8] = (bytes[8] & 0x3f) | 0x80;
                const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'));
                return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
            }

            function createLegacySyncId(namespace, values) {
                const input = `${namespace}:${JSON.stringify(values)}`;
                const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
                const words = seeds.map((seed, seedIndex) => {
                    let hash = seed >>> 0;
                    for (let index = 0; index < input.length; index++) {
                        hash ^= input.charCodeAt(index) + seedIndex;
                        hash = Math.imul(hash, 0x01000193) >>> 0;
                    }
                    return hash;
                });
                const bytes = new Uint8Array(16);
                words.forEach((word, wordIndex) => {
                    for (let offset = 0; offset < 4; offset++) {
                        bytes[wordIndex * 4 + offset] = (word >>> (offset * 8)) & 0xff;
                    }
                });
                bytes[6] = (bytes[6] & 0x0f) | 0x40;
                bytes[8] = (bytes[8] & 0x3f) | 0x80;
                const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'));
                return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
            }

            function isMessageCloudSyncEligible(messageOrType) {
                const type = typeof messageOrType === 'string' ? messageOrType : messageOrType?.type;
                // Images and records that depend on unsynced ledger/schedule rows stay local for this MVP.
                return type === 'text' || type === 'emoji_pack';
            }

            function ensureMessageSyncMetadata(message, fallbackTime = Date.now()) {
                const createdAt = Number(message.createdAt) || Number(message.timestamp) || fallbackTime;
                return {
                    ...message,
                    syncId: message.syncId || createLegacySyncId('message', [
                        message.id, message.timestamp, message.role, message.type, message.content,
                        message.senderId, message.relatedId, message.responseGroupId
                    ]),
                    createdAt,
                    updatedAt: Number(message.updatedAt) || createdAt,
                    deletedAt: message.deletedAt || null,
                    syncStatus: isMessageCloudSyncEligible(message)
                        ? (message.syncStatus || 'pending')
                        : 'local_only'
                };
            }

            function getMessageSenderSnapshot(message) {
                if (message.senderName) return message.senderName;
                if (!message.senderId) return null;
                return state.characters.find(character => character.id === message.senderId)?.name || null;
            }

            function requestMessageSyncSoon() {
                if (typeof scheduleMessageSync === 'function') scheduleMessageSync();
                if (typeof refreshCloudSyncUI === 'function') refreshCloudSyncUI();
            }

            async function createMessageRecord(messageData) {
                const now = Date.now();
                const record = {
                    ...messageData,
                    syncId: messageData.syncId || createCavaSyncId(),
                    createdAt: Number(messageData.createdAt) || Number(messageData.timestamp) || now,
                    updatedAt: Number(messageData.updatedAt) || now,
                    deletedAt: messageData.deletedAt || null,
                    syncStatus: isMessageCloudSyncEligible(messageData) ? 'pending' : 'local_only'
                };
                record.senderName = getMessageSenderSnapshot(record);
                const id = await db.messages.add(record);
                const stored = { ...record, id };
                if (!stored.deletedAt) state.messages.push(stored);
                requestMessageSyncSoon();
                return stored;
            }

            async function updateMessageRecord(messageId, changes) {
                const current = await db.messages.get(messageId);
                if (!current) return null;
                const updated = { ...current, ...changes, updatedAt: Date.now() };
                updated.senderName = getMessageSenderSnapshot(updated);
                updated.syncStatus = isMessageCloudSyncEligible(updated) ? 'pending' : 'local_only';
                await db.messages.put(updated);
                const stateIndex = state.messages.findIndex(message => message.id === messageId);
                if (stateIndex >= 0) state.messages[stateIndex] = updated;
                requestMessageSyncSoon();
                return updated;
            }

            async function deleteMessageRecord(messageId) {
                const current = await db.messages.get(messageId);
                if (!current) return;
                if (isMessageCloudSyncEligible(current)) {
                    const now = Date.now();
                    await db.messages.put({ ...current, deletedAt: now, updatedAt: now, syncStatus: 'pending' });
                } else {
                    await db.messages.delete(messageId);
                }
                state.messages = state.messages.filter(message => message.id !== messageId);
                requestMessageSyncSoon();
            }

            async function deleteMessageRecords(messageIds) {
                const records = (await db.messages.bulkGet(messageIds)).filter(Boolean);
                const now = Date.now();
                const tombstones = records
                    .filter(isMessageCloudSyncEligible)
                    .map(message => ({ ...message, deletedAt: now, updatedAt: now, syncStatus: 'pending' }));
                const localOnlyIds = records
                    .filter(message => !isMessageCloudSyncEligible(message))
                    .map(message => message.id);
                await db.transaction('rw', db.messages, async () => {
                    if (tombstones.length) await db.messages.bulkPut(tombstones);
                    if (localOnlyIds.length) await db.messages.bulkDelete(localOnlyIds);
                });
                const deletedSet = new Set(messageIds);
                state.messages = state.messages.filter(message => !deletedSet.has(message.id));
                requestMessageSyncSoon();
            }

            async function init() {
                await loadDataFromDB();
                setupEventListeners();
                navigateTo('accounting-screen');
                renderChatMessages();
                renderLedger();
                renderSchedules();
                applyConfigToUI();
                renderChatCharacterBar();
                updateSendButtonState();
                populateLedgerCurrencyFilter();
                initializeMemoryFeature();
                if (typeof initializeCloudSync === 'function') await initializeCloudSync();
            }


            async function loadDataFromDB() {
                const [config, proxies, characters, messages, transactions, currencies, schedules, emojiPacks, diaries, memories] = await Promise.all([
                    db.appConfig.get('main'),
                    db.apiProxies.toArray(),
                    db.aiCharacters.toArray(),
                    db.messages.orderBy('timestamp').filter(message => !message.deletedAt).toArray(),
                    db.transactions.orderBy('timestamp').toArray(),
                    db.currencies.toArray(),
                    db.schedules.toArray(),
                    db.emojiPacks.toArray(),
                    db.diaries.toArray(),
                    db.memories.orderBy('sortOrder').toArray()
                ]);

                const defaultDiaryPrompt = `请你写一篇{char}的视角中与{user}在{date}的这一天高度相关的日记，主要是你在这一天的对话中，对{user}行为的心理活动经过和情感变化，结合过往对话记录来写。日记写作风格需要按照依照{char}的性格特点。你在写日记时，对{char}统一使用第一人称「我」（如“我收到了她的消息”），对{user}则一般使用第三人称（如“她今天买奶茶花了二十块”），但偶尔插入对{user}第二人称直白的话（如“我想让你知道”），加强情感冲击。直接以“{date}，记录者：{char}”开头，2000字左右~`;

                const baseConfig = {
                    id: 'main',
                    chatName: '我的记事本',
                    chatAvatar: DEFAULT_AVATAR,
                    // 浏览器端公开连接信息。数据权限仍由 Supabase RLS 控制；不要在这里放 service_role/secret key。
                    supabase: {
                        url: 'https://omphkgpwcyqwdvuuipij.supabase.co',
                        publishableKey: 'sb_publishable_-1A9nlnpwUyhAxDVmfB6PA_OlEUgIuW'
                    },
                    maxTokens: 4096,
                    background: '',
                    theme: 'default',
                    userId: '',
                    userGender: '',
                    userBio: '',
                    skipRegenerateConfirm: false,
                    systemPromptSettings: DEFAULT_SYSTEM_PROMPTS,
                    diaryPrompt: defaultDiaryPrompt,
                    diaryLookbackDays: 3,
                    diaryLookaheadDays: 1,
                    diaryContextMaxTokens: 8000
                };

                state.config = {
                    ...baseConfig,
                    ...config,
                    systemPromptSettings: { ...DEFAULT_SYSTEM_PROMPTS, ...(config ? config.systemPromptSettings : {}) },
                    memorySettings: { ...DEFAULT_MEMORY_SETTINGS, ...(config ? config.memorySettings : {}) }
                };

                // 从数据库加载日记提示词，如果不存在则使用默认值
                currentDiaryPrompt = state.config.diaryPrompt || defaultDiaryPrompt;

                state.characters = characters.map(char => ({
                    ...char,
                    aiParams: char.aiParams || {
                        mode: 'default',
                        temperature: 0.8,
                        topP: 0.95,
                        topK: 0,
                        frequencyPenalty: 0,
                        presencePenalty: 0,
                    }
                }));

                state.proxies = proxies;
                state.messages = messages;
                state.transactions = transactions;
                state.schedules = schedules || [];
                state.emojiPacks = emojiPacks || [];
                state.diaries = diaries || [];
                state.memories = (memories || []).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

                if (currencies.length === 0) {
                    const preset = { code: 'HKD', name: '港币', rate: 0.92 };
                    await db.currencies.put(preset);
                    state.currencies = [preset];
                } else {
                    state.currencies = currencies;
                }
            }

            function applyConfigToUI() {
                ELS.chatHeaderTitle.textContent = state.config.chatName;
                document.getElementById('setting-chat-name').value = state.config.chatName;
                ELS.chatAvatar.src = state.config.chatAvatar || DEFAULT_AVATAR;
                document.getElementById('max-tokens-input').value = state.config.maxTokens;
                ELS.body.dataset.theme = state.config.theme || 'default';
                const themeRadio = document.querySelector(`input[name="theme"][value="${state.config.theme || 'default'}"]`);
                if (themeRadio) themeRadio.checked = true;
                ELS.accountingScreen.style.backgroundImage = state.config.background ? `url(${state.config.background})` : 'none';
                document.getElementById('setting-user-id').value = state.config.userId || '';
                document.getElementById('setting-user-gender').value = state.config.userGender || '';
                document.getElementById('setting-user-bio').value = state.config.userBio || '';
            }

            async function updateConfig(key, value) {
                state.config[key] = value;
                await db.appConfig.put(state.config);
                applyConfigToUI();
            }

            function navigateTo(pageId) {
                ELS.pages.forEach(p => p.classList.remove('active'));
                document.getElementById(pageId)?.classList.add('active');
                ELS.navItems.forEach(item => item.classList.toggle('active', item.dataset.page === pageId));
                if (pageId === 'ledger-screen') renderLedger();
                if (pageId === 'schedule-screen') renderSchedules();
                if (pageId === 'memory-screen' && typeof renderMemoryPage === 'function') renderMemoryPage(true);
            }

            // 这个函数用来展开和收起“高级设置”
            function toggleCharacterAdvancedSettings() {
                const settingsDiv = document.getElementById('character-advanced-settings');
                const arrowSpan = document.getElementById('char-advanced-arrow');
                if (settingsDiv.style.display === 'none') {
                    settingsDiv.style.display = 'block';
                    arrowSpan.textContent = '▲';
                } else {
                    settingsDiv.style.display = 'none';
                    arrowSpan.textContent = '▼';
                }
            }

            // 这里存放我们定义好的三种模式的参数
            const PARAM_PRESETS = {
                default: { temperature: 0.8, topP: 0.95, topK: 0, frequencyPenalty: 0, presencePenalty: 0 },
                assist: { temperature: 0.4, topP: 0.3, topK: 10, frequencyPenalty: 0.2, presencePenalty: 0.2 },
                companion: { temperature: 0.9, topP: 0.9, topK: 0, frequencyPenalty: 0, presencePenalty: 0 }
            };

            // 这个函数用来把一个角色的性格参数，显示到滑杆和开关上
            function applyCharParamsToEditor(params) {
                params = params || PARAM_PRESETS.default; // 如果没有参数，就用默认的
                const modeSelect = document.getElementById('character-param-mode');
                const customParamsDiv = document.getElementById('character-custom-params');

                modeSelect.value = params.mode || 'default';

                const currentValues = (params.mode === 'custom') ? params : (PARAM_PRESETS[params.mode] || PARAM_PRESETS.default);

                // 更新所有滑杆和数值显示
                document.getElementById('char-temperature').value = currentValues.temperature;
                document.getElementById('char-temp-value').textContent = currentValues.temperature.toFixed(2);
                document.getElementById('char-top-p').value = currentValues.topP;
                document.getElementById('char-topp-value').textContent = currentValues.topP.toFixed(2);
                document.getElementById('char-top-k').value = currentValues.topK;
                document.getElementById('char-topk-value').textContent = currentValues.topK;
                document.getElementById('char-freq-penalty').value = currentValues.frequencyPenalty;
                document.getElementById('char-freq-value').textContent = currentValues.frequencyPenalty.toFixed(2);
                document.getElementById('char-presence-penalty').value = currentValues.presencePenalty;
                document.getElementById('char-pres-value').textContent = currentValues.presencePenalty.toFixed(2);

                if (params.mode === 'custom') {
                    customParamsDiv.style.display = 'block';
                } else {
                    customParamsDiv.style.display = 'none';
                }
            }

            // 这个函数用来把滑杆和开关上的设置，收集起来准备保存
            function collectCharParamsFromEditor() {
                const mode = document.getElementById('character-param-mode').value;
                const aiParams = { mode: mode };

                if (mode === 'custom') {
                    aiParams.temperature = parseFloat(document.getElementById('char-temperature').value);
                    aiParams.topP = parseFloat(document.getElementById('char-top-p').value);
                    aiParams.topK = parseInt(document.getElementById('char-top-k').value);
                    aiParams.frequencyPenalty = parseFloat(document.getElementById('char-freq-penalty').value);
                    aiParams.presencePenalty = parseFloat(document.getElementById('char-presence-penalty').value);
                } else {
                    // 如果不是自定义，就把预设的参数也存一份进去，方便调用
                    Object.assign(aiParams, PARAM_PRESETS[mode] || PARAM_PRESETS.default);
                }
                return aiParams;
            }

            // 绑定所有事件！
            function setupCharParamListeners() {
                const advancedSettingsBtn = document.getElementById('toggle-advanced-settings-btn');
                if (advancedSettingsBtn) {
                    advancedSettingsBtn.addEventListener('click', toggleCharacterAdvancedSettings);
                }
                // 监听模式下拉菜单的变化
                document.getElementById('character-param-mode').addEventListener('change', (e) => {
                    const mode = e.target.value;
                    const customParamsDiv = document.getElementById('character-custom-params');
                    if (mode === 'custom') {
                        customParamsDiv.style.display = 'block';
                    } else {
                        customParamsDiv.style.display = 'none';
                        // 如果切换到预设模式，就立刻把预设值应用到界面上
                        applyCharParamsToEditor({ mode: mode, ...PARAM_PRESETS[mode] });
                    }
                });

                // 监听所有滑杆的拖动
                ['char-temperature', 'char-top-p', 'char-top-k', 'char-freq-penalty', 'char-presence-penalty'].forEach(id => {
                    const slider = document.getElementById(id);
                    if (slider) {
                        slider.addEventListener('input', (e) => {
                            const valueId = id.replace('char-temperature', 'char-temp-value')
                                .replace('char-top-p', 'char-topp-value')
                                .replace('char-top-k', 'char-topk-value')
                                .replace('char-freq-penalty', 'char-freq-value')
                                .replace('char-presence-penalty', 'char-pres-value');
                            const valueDisplay = document.getElementById(valueId);
                            if (valueDisplay) {
                                valueDisplay.textContent = parseFloat(e.target.value).toFixed(2);
                            }
                        });
                    }
                });
            }

