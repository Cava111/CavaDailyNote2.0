/* Cava Notebook - 02-cloud-sync.js
 * Supabase Auth + local-first message sync MVP.
 * Only text and emoji-name messages sync. Images and ledger/schedule cards stay local.
 */
            const CLOUD_MESSAGE_TABLE = 'cava_messages';
            const CLOUD_SYNC_INTERVAL_MS = 30000;
            const CLOUD_SYNC_PAGE_SIZE = 500;
            let cavaSupabaseClient = null;
            let cavaCloudSession = null;
            let cavaAuthSubscription = null;
            let cloudSyncTimeout = null;
            let cloudSyncInterval = null;
            let cloudSyncInFlight = false;
            let cloudSyncListenersReady = false;
            let cloudSyncLastSuccessAt = null;
            let cloudSyncLastError = '';

            function getSupabaseConfig() {
                const config = state.config.supabase || {};
                return {
                    url: String(config.url || '').trim().replace(/\/+$/, ''),
                    publishableKey: String(config.publishableKey || '').trim()
                };
            }

            function isSupabaseConfigured() {
                const config = getSupabaseConfig();
                return /^https:\/\/[^/]+\.supabase\.co$/i.test(config.url) && Boolean(config.publishableKey);
            }

            function setCloudNotice(message, type = '') {
                const notice = document.getElementById('cloud-account-notice');
                if (!notice) return;
                notice.textContent = message || '';
                notice.className = `cloud-account-notice ${type}`.trim();
            }

            function setCloudStatusDisplay(message, status = 'local') {
                const header = document.getElementById('sync-status-indicator');
                const details = document.getElementById('cloud-sync-status');
                [header, details].forEach(element => {
                    if (!element) return;
                    element.textContent = message;
                    element.dataset.status = status;
                    element.title = message;
                });
            }

            function formatSyncTime(timestamp) {
                if (!timestamp) return '';
                return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            async function getPendingMessageCount() {
                return db.messages.where('syncStatus').equals('pending').count();
            }

            async function refreshCloudSyncUI() {
                const pendingCount = await getPendingMessageCount();
                const email = cavaCloudSession?.user?.email || '';
                const emailLabel = document.getElementById('cloud-current-user');
                const loginButton = document.getElementById('cloud-login-btn');
                const registerButton = document.getElementById('cloud-register-btn');
                const logoutButton = document.getElementById('cloud-logout-btn');

                if (emailLabel) emailLabel.textContent = email ? `已登录：${email}` : '当前未登录';
                if (loginButton) loginButton.hidden = Boolean(email);
                if (registerButton) registerButton.hidden = Boolean(email);
                if (logoutButton) logoutButton.hidden = !email;

                if (!isSupabaseConfigured()) {
                    setCloudStatusDisplay('本地模式', 'local');
                    return;
                }
                if (!cavaCloudSession) {
                    setCloudStatusDisplay(pendingCount ? `本地 · 待同步 ${pendingCount}` : '本地 · 未登录', pendingCount ? 'pending' : 'local');
                    return;
                }
                if (cloudSyncInFlight) {
                    setCloudStatusDisplay(pendingCount ? `同步中 · ${pendingCount}` : '同步中', 'syncing');
                    return;
                }
                if (cloudSyncLastError) {
                    setCloudStatusDisplay('同步失败', 'error');
                    return;
                }
                if (pendingCount) {
                    setCloudStatusDisplay(`待同步 ${pendingCount}`, 'pending');
                    return;
                }
                const timeLabel = formatSyncTime(cloudSyncLastSuccessAt);
                setCloudStatusDisplay(timeLabel ? `已同步 ${timeLabel}` : '已同步', 'synced');
            }

            function cloudDateToMillis(value, fallback = Date.now()) {
                if (!value) return fallback;
                const parsed = new Date(value).getTime();
                return Number.isFinite(parsed) ? parsed : fallback;
            }

            function localMessageToCloud(message) {
                const character = message.senderId
                    ? state.characters.find(item => item.id === message.senderId)
                    : null;
                return {
                    user_id: cavaCloudSession.user.id,
                    id: message.syncId,
                    timestamp_ms: Number(message.timestamp) || Number(message.createdAt) || Date.now(),
                    role: message.role || 'user',
                    content: String(message.content || ''),
                    type: message.type || 'text',
                    sender_sync_id: character?.syncId || message.senderSyncId || null,
                    sender_name: character?.name || message.senderName || null,
                    response_group_id: message.responseGroupId || null,
                    source: message.source || 'cava_app',
                    created_at: new Date(Number(message.createdAt) || Number(message.timestamp) || Date.now()).toISOString(),
                    updated_at: new Date(Number(message.updatedAt) || Number(message.timestamp) || Date.now()).toISOString(),
                    deleted_at: message.deletedAt ? new Date(Number(message.deletedAt)).toISOString() : null
                };
            }

            function cloudMessageToLocal(row, localId = undefined) {
                const character = row.sender_sync_id
                    ? state.characters.find(item => item.syncId === row.sender_sync_id)
                    : null;
                const record = {
                    syncId: row.id,
                    timestamp: Number(row.timestamp_ms) || cloudDateToMillis(row.created_at),
                    role: row.role || 'user',
                    content: row.content || '',
                    type: row.type || 'text',
                    senderId: character?.id || null,
                    senderSyncId: row.sender_sync_id || null,
                    senderName: row.sender_name || character?.name || null,
                    responseGroupId: row.response_group_id || null,
                    source: row.source || 'cava_app',
                    createdAt: cloudDateToMillis(row.created_at),
                    updatedAt: cloudDateToMillis(row.updated_at),
                    deletedAt: row.deleted_at ? cloudDateToMillis(row.deleted_at) : null,
                    syncStatus: 'synced'
                };
                if (localId !== undefined) record.id = localId;
                return record;
            }

            async function fetchAllCloudMessages() {
                const rows = [];
                for (let from = 0; ; from += CLOUD_SYNC_PAGE_SIZE) {
                    const { data, error } = await cavaSupabaseClient
                        .from(CLOUD_MESSAGE_TABLE)
                        .select('*')
                        .order('updated_at', { ascending: true })
                        .range(from, from + CLOUD_SYNC_PAGE_SIZE - 1);
                    if (error) throw error;
                    rows.push(...(data || []));
                    if (!data || data.length < CLOUD_SYNC_PAGE_SIZE) break;
                }
                return rows;
            }

            async function reconcileCloudMessages(cloudRows) {
                const localRows = await db.messages.toArray();
                const localBySyncId = new Map(localRows.filter(item => item.syncId).map(item => [item.syncId, item]));
                const changedRecords = [];

                cloudRows.forEach(row => {
                    const local = localBySyncId.get(row.id);
                    const cloudUpdatedAt = cloudDateToMillis(row.updated_at, 0);
                    if (!local) {
                        changedRecords.push(cloudMessageToLocal(row));
                        return;
                    }
                    const localUpdatedAt = Number(local.updatedAt) || Number(local.timestamp) || 0;
                    if (cloudUpdatedAt > localUpdatedAt || (cloudUpdatedAt === localUpdatedAt && local.syncStatus === 'pending')) {
                        changedRecords.push(cloudMessageToLocal(row, local.id));
                    }
                });

                if (!changedRecords.length) return false;
                await db.messages.bulkPut(changedRecords);
                state.messages = await db.messages.orderBy('timestamp').filter(message => !message.deletedAt).toArray();
                if (!state.currentlyEditingMsgId && !state.isSelectionMode) renderChatMessages(false);
                return true;
            }

            async function pushPendingMessages() {
                const pending = (await db.messages.where('syncStatus').equals('pending').toArray())
                    .filter(isMessageCloudSyncEligible);
                if (!pending.length) return;

                for (let index = 0; index < pending.length; index += 100) {
                    const batch = pending.slice(index, index + 100);
                    const payload = batch.map(localMessageToCloud);
                    const { error } = await cavaSupabaseClient
                        .from(CLOUD_MESSAGE_TABLE)
                        .upsert(payload, { onConflict: 'user_id,id' });
                    if (error) throw error;

                    await db.transaction('rw', db.messages, async () => {
                        for (const sent of batch) {
                            const current = await db.messages.get(sent.id);
                            if (current && Number(current.updatedAt) === Number(sent.updatedAt)) {
                                await db.messages.update(sent.id, { syncStatus: 'synced' });
                            }
                        }
                    });
                }
            }

            async function runMessageSync() {
                if (cloudSyncInFlight || !cavaSupabaseClient || !cavaCloudSession || !navigator.onLine) {
                    await refreshCloudSyncUI();
                    return;
                }
                cloudSyncInFlight = true;
                cloudSyncLastError = '';
                await refreshCloudSyncUI();
                try {
                    const beforePush = await fetchAllCloudMessages();
                    await reconcileCloudMessages(beforePush);
                    await pushPendingMessages();
                    const afterPush = await fetchAllCloudMessages();
                    await reconcileCloudMessages(afterPush);
                    cloudSyncLastSuccessAt = Date.now();
                } catch (error) {
                    cloudSyncLastError = error?.message || String(error);
                    console.error('Cava message sync failed:', error);
                    setCloudNotice(`同步失败：${cloudSyncLastError}`, 'error');
                } finally {
                    cloudSyncInFlight = false;
                    await refreshCloudSyncUI();
                }
            }

            function scheduleMessageSync(delay = 800) {
                clearTimeout(cloudSyncTimeout);
                cloudSyncTimeout = setTimeout(() => runMessageSync(), delay);
            }

            async function disposeSupabaseClient() {
                if (cavaAuthSubscription) {
                    cavaAuthSubscription.unsubscribe();
                    cavaAuthSubscription = null;
                }
                cavaSupabaseClient = null;
                cavaCloudSession = null;
            }

            async function createConfiguredSupabaseClient() {
                await disposeSupabaseClient();
                if (!isSupabaseConfigured()) return null;
                if (!window.supabase?.createClient) {
                    throw new Error('Supabase 程序没有加载成功；请确认当前设备可以访问 jsDelivr CDN。');
                }
                const config = getSupabaseConfig();
                cavaSupabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: false
                    }
                });
                const { data, error } = await cavaSupabaseClient.auth.getSession();
                if (error) throw error;
                cavaCloudSession = data.session;
                const { data: listener } = cavaSupabaseClient.auth.onAuthStateChange((_event, session) => {
                    cavaCloudSession = session;
                    setTimeout(async () => {
                        await refreshCloudSyncUI();
                        if (session) scheduleMessageSync(0);
                    }, 0);
                });
                cavaAuthSubscription = listener.subscription;
                return cavaSupabaseClient;
            }

            async function saveSupabaseSettings() {
                const url = document.getElementById('cloud-supabase-url').value.trim().replace(/\/+$/, '');
                const publishableKey = document.getElementById('cloud-supabase-key').value.trim();
                if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(url)) {
                    setCloudNotice('Project URL 看起来不对，应该像：https://abcdef.supabase.co', 'error');
                    return;
                }
                if (!publishableKey) {
                    setCloudNotice('请粘贴 Publishable key（旧项目里也可能叫 anon public key）。', 'error');
                    return;
                }
                state.config.supabase = { url, publishableKey };
                await db.appConfig.put(state.config);
                try {
                    await createConfiguredSupabaseClient();
                    setCloudNotice('Supabase 项目连接已保存。现在可以注册或登录。', 'success');
                    await refreshCloudSyncUI();
                    if (cavaCloudSession) scheduleMessageSync(0);
                } catch (error) {
                    setCloudNotice(`连接失败：${error.message}`, 'error');
                }
            }

            function getCloudCredentials() {
                return {
                    email: document.getElementById('cloud-email').value.trim(),
                    password: document.getElementById('cloud-password').value
                };
            }

            async function registerCloudAccount() {
                if (!cavaSupabaseClient) {
                    setCloudNotice('请先保存上面的 Supabase 项目连接。', 'error');
                    return;
                }
                const { email, password } = getCloudCredentials();
                if (!email || !password) {
                    setCloudNotice('请填写邮箱和密码。', 'error');
                    return;
                }
                const { data, error } = await cavaSupabaseClient.auth.signUp({ email, password });
                document.getElementById('cloud-password').value = '';
                if (error) {
                    setCloudNotice(`注册失败：${error.message}`, 'error');
                    return;
                }
                if (data.session) {
                    setCloudNotice('注册并登录成功，正在上传本地文字聊天。', 'success');
                    scheduleMessageSync(0);
                } else {
                    setCloudNotice('注册成功。请去邮箱点击确认链接，然后回到这里点“登录”。', 'success');
                }
            }

            async function loginCloudAccount() {
                if (!cavaSupabaseClient) {
                    setCloudNotice('请先保存上面的 Supabase 项目连接。', 'error');
                    return;
                }
                const { email, password } = getCloudCredentials();
                if (!email || !password) {
                    setCloudNotice('请填写邮箱和密码。', 'error');
                    return;
                }
                const { error } = await cavaSupabaseClient.auth.signInWithPassword({ email, password });
                document.getElementById('cloud-password').value = '';
                if (error) {
                    setCloudNotice(`登录失败：${error.message}`, 'error');
                    return;
                }
                setCloudNotice('登录成功，正在同步文字聊天。', 'success');
                scheduleMessageSync(0);
            }

            async function logoutCloudAccount() {
                if (!cavaSupabaseClient) return;
                const { error } = await cavaSupabaseClient.auth.signOut();
                if (error) {
                    setCloudNotice(`退出失败：${error.message}`, 'error');
                    return;
                }
                cavaCloudSession = null;
                setCloudNotice('已退出。Cava 继续使用本地数据，不会清空任何内容。', 'success');
                await refreshCloudSyncUI();
            }

            function setupCloudSyncListeners() {
                if (cloudSyncListenersReady) return;
                cloudSyncListenersReady = true;
                document.getElementById('cloud-save-project-btn').addEventListener('click', saveSupabaseSettings);
                document.getElementById('cloud-register-btn').addEventListener('click', registerCloudAccount);
                document.getElementById('cloud-login-btn').addEventListener('click', loginCloudAccount);
                document.getElementById('cloud-logout-btn').addEventListener('click', logoutCloudAccount);
                document.getElementById('cloud-sync-now-btn').addEventListener('click', () => runMessageSync());
                document.getElementById('sync-status-indicator').addEventListener('click', () => navigateTo('more-screen'));
                window.addEventListener('online', () => scheduleMessageSync(0));
                window.addEventListener('offline', () => refreshCloudSyncUI());
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') scheduleMessageSync(0);
                });
                cloudSyncInterval = setInterval(() => scheduleMessageSync(0), CLOUD_SYNC_INTERVAL_MS);
            }

            async function initializeCloudSync() {
                setupCloudSyncListeners();
                const config = getSupabaseConfig();
                document.getElementById('cloud-supabase-url').value = config.url;
                document.getElementById('cloud-supabase-key').value = config.publishableKey;
                await refreshCloudSyncUI();
                if (!isSupabaseConfigured()) return;
                try {
                    await createConfiguredSupabaseClient();
                    await refreshCloudSyncUI();
                    if (cavaCloudSession) scheduleMessageSync(0);
                } catch (error) {
                    cloudSyncLastError = error.message;
                    setCloudNotice(`Supabase 初始化失败：${error.message}`, 'error');
                    await refreshCloudSyncUI();
                }
            }
