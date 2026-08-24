/* Cava Notebook - 02-cloud-sync.js
 * Local-first Supabase sync for every non-binary, non-secret record.
 * Base64 media and credentials stay on the current device.
 */
            const CLOUD_MESSAGE_TABLE = 'cava_messages';
            const CLOUD_RECORD_TABLE = 'cava_records';
            const CLOUD_SYNC_INTERVAL_MS = 30000;
            const CLOUD_SYNC_PAGE_SIZE = 500;
            const CLOUD_SYNC_BATCH_SIZE = 100;
            const CLOUD_ENTITY_DEFINITIONS = Object.freeze([
                { type: 'api_proxy', store: 'apiProxies' },
                { type: 'ai_character', store: 'aiCharacters' },
                { type: 'transaction', store: 'transactions' },
                { type: 'transaction_template', store: 'transactionTemplates' },
                { type: 'currency', store: 'currencies' },
                { type: 'schedule', store: 'schedules' },
                { type: 'diary', store: 'diaries' },
                { type: 'memory', store: 'memories' },
                { type: 'app_config', store: 'appConfig' }
            ]);
            const CLOUD_ENTITY_BY_TYPE = new Map(CLOUD_ENTITY_DEFINITIONS.map(item => [item.type, item]));
            const CLOUD_LOCAL_METADATA_FIELDS = new Set([
                'id', 'syncId', 'createdAt', 'updatedAt', 'deletedAt', 'syncStatus'
            ]);
            const CLOUD_SECRET_FIELD_NAMES = new Set([
                'key', 'apikey', 'secret', 'secretkey', 'clientsecret', 'password',
                'authorization', 'token', 'authtoken', 'apitoken', 'bearertoken',
                'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken', 'privatekey',
                'servicerole', 'servicerolekey', 'publishablekey', 'anonkey'
            ]);
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

            async function getPendingCloudCount() {
                const counts = await Promise.all([
                    db.messages.where('syncStatus').equals('pending').count(),
                    ...CLOUD_ENTITY_DEFINITIONS.map(item => db.table(item.store).where('syncStatus').equals('pending').count())
                ]);
                return counts.reduce((total, count) => total + count, 0);
            }

            async function refreshCloudSyncUI() {
                const pendingCount = await getPendingCloudCount();
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
                } else if (!cavaCloudSession) {
                    setCloudStatusDisplay(pendingCount ? `本地 · 待同步 ${pendingCount}` : '本地 · 未登录', pendingCount ? 'pending' : 'local');
                } else if (cloudSyncInFlight) {
                    setCloudStatusDisplay(pendingCount ? `同步中 · ${pendingCount}` : '同步中', 'syncing');
                } else if (cloudSyncLastError) {
                    setCloudStatusDisplay('同步失败', 'error');
                } else if (pendingCount) {
                    setCloudStatusDisplay(`待同步 ${pendingCount}`, 'pending');
                } else {
                    const timeLabel = formatSyncTime(cloudSyncLastSuccessAt);
                    setCloudStatusDisplay(timeLabel ? `已同步 ${timeLabel}` : '已同步', 'synced');
                }
            }

            function cloudDateToMillis(value, fallback = Date.now()) {
                if (!value) return fallback;
                const parsed = new Date(value).getTime();
                return Number.isFinite(parsed) ? parsed : fallback;
            }

            function normalizeCloudFieldName(name) {
                return String(name || '').replace(/[\s_-]/g, '').toLowerCase();
            }

            function isBase64DataUrl(value) {
                return typeof value === 'string' && /^data:[^;,]+;base64,/i.test(value.trim());
            }

            function sanitizeValueForCloud(value, seen = new WeakSet()) {
                if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
                if (typeof value === 'string') return isBase64DataUrl(value) ? undefined : value;
                if (value instanceof Date) return value.toISOString();
                if (typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
                if (Array.isArray(value)) {
                    return value.map(item => sanitizeValueForCloud(item, seen)).filter(item => item !== undefined);
                }
                if (typeof value !== 'object' || seen.has(value)) return undefined;
                seen.add(value);
                const result = {};
                Object.entries(value).forEach(([key, item]) => {
                    if (CLOUD_SECRET_FIELD_NAMES.has(normalizeCloudFieldName(key))) return;
                    const clean = sanitizeValueForCloud(item, seen);
                    if (clean !== undefined) result[key] = clean;
                });
                seen.delete(value);
                return result;
            }

            function deepMergeCloudData(localValue, cloudValue) {
                if (Array.isArray(cloudValue)) return cloudValue.map(item => deepMergeCloudData(undefined, item));
                if (!cloudValue || typeof cloudValue !== 'object') return cloudValue;
                const base = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? { ...localValue } : {};
                Object.entries(cloudValue).forEach(([key, value]) => {
                    base[key] = deepMergeCloudData(base[key], value);
                });
                return base;
            }

            async function buildCloudRelationContext() {
                const [proxies, characters, transactions, schedules, messages] = await Promise.all([
                    db.apiProxies.toArray(), db.aiCharacters.toArray(), db.transactions.toArray(),
                    db.schedules.toArray(), db.messages.toArray()
                ]);
                const makeMaps = rows => ({
                    byId: new Map(rows.filter(row => row.id != null).map(row => [Number(row.id), row])),
                    bySyncId: new Map(rows.filter(row => row.syncId).map(row => [row.syncId, row]))
                });
                return {
                    proxies: makeMaps(proxies),
                    characters: makeMaps(characters),
                    transactions: makeMaps(transactions),
                    schedules: makeMaps(schedules),
                    messages: makeMaps(messages)
                };
            }

            function recordSyncIdByLocalId(maps, localId, fallback = null) {
                if (localId == null) return fallback;
                return maps.byId.get(Number(localId))?.syncId || fallback;
            }

            function recordLocalIdBySyncId(maps, syncId, fallback = null) {
                if (!syncId) return fallback;
                return maps.bySyncId.get(syncId)?.id ?? fallback;
            }

            function sanitizeRecordForCloud(entityType, record, context) {
                const source = {};
                Object.entries(record || {}).forEach(([key, value]) => {
                    if (!CLOUD_LOCAL_METADATA_FIELDS.has(key)) source[key] = value;
                });

                if (entityType === 'ai_character') {
                    source.proxySyncId = recordSyncIdByLocalId(context.proxies, source.proxyId, source.proxySyncId || null);
                    source.backupProxySyncId = recordSyncIdByLocalId(context.proxies, source.backupProxyId, source.backupProxySyncId || null);
                    delete source.proxyId;
                    delete source.backupProxyId;
                } else if (entityType === 'diary') {
                    source.charSyncId = recordSyncIdByLocalId(context.characters, source.charId, source.charSyncId || null);
                    delete source.charId;
                } else if (entityType === 'memory') {
                    source.sourceStartSyncId = recordSyncIdByLocalId(context.messages, source.sourceStartId, source.sourceStartSyncId || null);
                    source.sourceEndSyncId = recordSyncIdByLocalId(context.messages, source.sourceEndId, source.sourceEndSyncId || null);
                    delete source.sourceStartId;
                    delete source.sourceEndId;
                } else if (entityType === 'app_config' && source.memorySettings) {
                    const settings = { ...source.memorySettings };
                    settings.characterSyncId = recordSyncIdByLocalId(context.characters, settings.characterId, settings.characterSyncId || null);
                    settings.proxySyncId = recordSyncIdByLocalId(context.proxies, settings.proxyId, settings.proxySyncId || null);
                    settings.messageCursorSyncId = recordSyncIdByLocalId(context.messages, settings.messageCursorId, settings.messageCursorSyncId || null);
                    delete settings.characterId;
                    delete settings.proxyId;
                    delete settings.messageCursorId;
                    source.memorySettings = settings;
                }
                return sanitizeValueForCloud(source) || {};
            }

            function cloudPayloadToLocal(entityType, payload, context) {
                const result = deepMergeCloudData({}, payload || {});
                if (entityType === 'ai_character') {
                    result.proxyId = recordLocalIdBySyncId(context.proxies, result.proxySyncId, result.proxyId ?? null);
                    result.backupProxyId = recordLocalIdBySyncId(context.proxies, result.backupProxySyncId, result.backupProxyId ?? null);
                } else if (entityType === 'diary') {
                    result.charId = recordLocalIdBySyncId(context.characters, result.charSyncId, result.charId ?? null);
                } else if (entityType === 'memory') {
                    result.sourceStartId = recordLocalIdBySyncId(context.messages, result.sourceStartSyncId, result.sourceStartId ?? null);
                    result.sourceEndId = recordLocalIdBySyncId(context.messages, result.sourceEndSyncId, result.sourceEndId ?? null);
                } else if (entityType === 'app_config' && result.memorySettings) {
                    const settings = result.memorySettings;
                    settings.characterId = recordLocalIdBySyncId(context.characters, settings.characterSyncId, settings.characterId ?? null);
                    settings.proxyId = recordLocalIdBySyncId(context.proxies, settings.proxySyncId, settings.proxyId ?? null);
                    settings.messageCursorId = recordLocalIdBySyncId(context.messages, settings.messageCursorSyncId, settings.messageCursorId ?? null);
                }
                return result;
            }

            function getGenericLocalPrimaryKey(definition, record) {
                if (definition.store === 'appConfig') return 'main';
                if (definition.store === 'currencies') return record.code;
                return record.id;
            }

            async function fetchAllCloudRecords() {
                const rows = [];
                for (let from = 0; ; from += CLOUD_SYNC_PAGE_SIZE) {
                    const { data, error } = await cavaSupabaseClient
                        .from(CLOUD_RECORD_TABLE)
                        .select('*')
                        .order('updated_at', { ascending: true })
                        .range(from, from + CLOUD_SYNC_PAGE_SIZE - 1);
                    if (error) throw error;
                    rows.push(...(data || []));
                    if (!data || data.length < CLOUD_SYNC_PAGE_SIZE) break;
                }
                return rows;
            }

            async function reconcileCloudRecords(cloudRows) {
                let changed = false;
                for (const definition of CLOUD_ENTITY_DEFINITIONS) {
                    const relevantRows = cloudRows.filter(row => row.entity_type === definition.type);
                    if (!relevantRows.length) continue;
                    const table = db.table(definition.store);
                    const localRows = await table.toArray();
                    const localBySyncId = new Map(localRows.filter(item => item.syncId).map(item => [item.syncId, item]));
                    let context = await buildCloudRelationContext();

                    for (const row of relevantRows) {
                        const local = localBySyncId.get(row.id);
                        const cloudUpdatedAt = cloudDateToMillis(row.updated_at, 0);
                        const localUpdatedAt = Number(local?.updatedAt) || Number(local?.timestamp) || 0;
                        if (local && cloudUpdatedAt < localUpdatedAt) continue;
                        if (local && cloudUpdatedAt === localUpdatedAt && local.syncStatus !== 'pending') continue;

                        const mapped = cloudPayloadToLocal(definition.type, row.payload, context);
                        const record = deepMergeCloudData(local || {}, mapped);
                        record.syncId = row.id;
                        record.createdAt = cloudDateToMillis(row.created_at);
                        record.updatedAt = cloudUpdatedAt;
                        record.deletedAt = row.deleted_at ? cloudDateToMillis(row.deleted_at) : null;
                        record.syncStatus = 'synced';
                        if (definition.store === 'appConfig') record.id = 'main';
                        if (definition.store === 'currencies' && !record.code) continue;
                        if (local?.id != null) record.id = local.id;

                        await withCavaInternalCloudWrite(() => table.put(record));
                        localBySyncId.set(row.id, record);
                        changed = true;
                        if (definition.store === 'apiProxies' || definition.store === 'aiCharacters') {
                            context = await buildCloudRelationContext();
                        }
                    }
                }
                return changed;
            }

            async function pushPendingCloudRecords() {
                for (const definition of CLOUD_ENTITY_DEFINITIONS) {
                    const table = db.table(definition.store);
                    const pending = await table.where('syncStatus').equals('pending').toArray();
                    for (let index = 0; index < pending.length; index += CLOUD_SYNC_BATCH_SIZE) {
                        const batch = pending.slice(index, index + CLOUD_SYNC_BATCH_SIZE);
                        const context = await buildCloudRelationContext();
                        const payload = batch.map(record => ({
                            user_id: cavaCloudSession.user.id,
                            entity_type: definition.type,
                            id: record.syncId,
                            payload: sanitizeRecordForCloud(definition.type, record, context),
                            created_at: new Date(Number(record.createdAt) || Number(record.timestamp) || Date.now()).toISOString(),
                            updated_at: new Date(Number(record.updatedAt) || Number(record.timestamp) || Date.now()).toISOString(),
                            deleted_at: record.deletedAt ? new Date(Number(record.deletedAt)).toISOString() : null
                        }));
                        const { error } = await cavaSupabaseClient
                            .from(CLOUD_RECORD_TABLE)
                            .upsert(payload, { onConflict: 'user_id,entity_type,id' });
                        if (error) throw error;

                        await withCavaInternalCloudWrite(async () => {
                            await db.transaction('rw', table, async () => {
                                for (const sent of batch) {
                                    const primaryKey = getGenericLocalPrimaryKey(definition, sent);
                                    const current = await table.get(primaryKey);
                                    if (current && Number(current.updatedAt) === Number(sent.updatedAt)) {
                                        await table.update(primaryKey, { syncStatus: 'synced' });
                                    }
                                }
                            });
                        });
                    }
                }
            }

            function localMessageToCloud(message, context) {
                const character = context.characters.byId.get(Number(message.senderId));
                let relatedEntityType = message.relatedEntityType || null;
                let relatedSyncId = message.relatedSyncId || null;
                if (message.type === 'transaction') {
                    relatedEntityType = 'transaction';
                    relatedSyncId = recordSyncIdByLocalId(context.transactions, message.relatedId, relatedSyncId);
                } else if (message.type === 'schedule') {
                    relatedEntityType = 'schedule';
                    relatedSyncId = recordSyncIdByLocalId(context.schedules, message.relatedId, relatedSyncId);
                }
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
                    related_entity_type: relatedEntityType,
                    related_sync_id: relatedSyncId,
                    source: message.source || 'cava_app',
                    created_at: new Date(Number(message.createdAt) || Number(message.timestamp) || Date.now()).toISOString(),
                    updated_at: new Date(Number(message.updatedAt) || Number(message.timestamp) || Date.now()).toISOString(),
                    deleted_at: message.deletedAt ? new Date(Number(message.deletedAt)).toISOString() : null
                };
            }

            function cloudMessageToLocal(row, context, localId = undefined) {
                const character = context.characters.bySyncId.get(row.sender_sync_id);
                const relatedMaps = row.related_entity_type === 'transaction'
                    ? context.transactions
                    : (row.related_entity_type === 'schedule' ? context.schedules : null);
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
                    relatedId: relatedMaps ? recordLocalIdBySyncId(relatedMaps, row.related_sync_id, null) : null,
                    relatedEntityType: row.related_entity_type || null,
                    relatedSyncId: row.related_sync_id || null,
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
                const context = await buildCloudRelationContext();
                const changedRecords = [];
                cloudRows.forEach(row => {
                    const local = localBySyncId.get(row.id);
                    const cloudUpdatedAt = cloudDateToMillis(row.updated_at, 0);
                    const localUpdatedAt = Number(local?.updatedAt) || Number(local?.timestamp) || 0;
                    if (!local || cloudUpdatedAt > localUpdatedAt || (cloudUpdatedAt === localUpdatedAt && local.syncStatus === 'pending')) {
                        changedRecords.push(cloudMessageToLocal(row, context, local?.id));
                    }
                });
                if (!changedRecords.length) return false;
                await withCavaInternalCloudWrite(() => db.messages.bulkPut(changedRecords));
                return true;
            }

            async function pushPendingMessages() {
                const pending = (await db.messages.where('syncStatus').equals('pending').toArray())
                    .filter(isMessageCloudSyncEligible);
                for (let index = 0; index < pending.length; index += CLOUD_SYNC_BATCH_SIZE) {
                    const batch = pending.slice(index, index + CLOUD_SYNC_BATCH_SIZE);
                    const context = await buildCloudRelationContext();
                    const payload = batch.map(message => localMessageToCloud(message, context));
                    const { error } = await cavaSupabaseClient
                        .from(CLOUD_MESSAGE_TABLE)
                        .upsert(payload, { onConflict: 'user_id,id' });
                    if (error) throw error;
                    await withCavaInternalCloudWrite(async () => {
                        await db.transaction('rw', db.messages, async () => {
                            for (const sent of batch) {
                                const current = await db.messages.get(sent.id);
                                if (current && Number(current.updatedAt) === Number(sent.updatedAt)) {
                                    await db.messages.update(sent.id, { syncStatus: 'synced' });
                                }
                            }
                        });
                    });
                }
            }

            async function resolveAllLocalCloudReferences() {
                const context = await buildCloudRelationContext();
                await withCavaInternalCloudWrite(async () => {
                    for (const character of await db.aiCharacters.toArray()) {
                        const changes = {};
                        const proxyId = recordLocalIdBySyncId(context.proxies, character.proxySyncId, character.proxyId ?? null);
                        const backupProxyId = recordLocalIdBySyncId(context.proxies, character.backupProxySyncId, character.backupProxyId ?? null);
                        if (proxyId !== character.proxyId) changes.proxyId = proxyId;
                        if (backupProxyId !== character.backupProxyId) changes.backupProxyId = backupProxyId;
                        if (Object.keys(changes).length) await db.aiCharacters.update(character.id, changes);
                    }
                    for (const diary of await db.diaries.toArray()) {
                        const charId = recordLocalIdBySyncId(context.characters, diary.charSyncId, diary.charId ?? null);
                        if (charId !== diary.charId) await db.diaries.update(diary.id, { charId });
                    }
                    for (const memory of await db.memories.toArray()) {
                        const sourceStartId = recordLocalIdBySyncId(context.messages, memory.sourceStartSyncId, memory.sourceStartId ?? null);
                        const sourceEndId = recordLocalIdBySyncId(context.messages, memory.sourceEndSyncId, memory.sourceEndId ?? null);
                        if (sourceStartId !== memory.sourceStartId || sourceEndId !== memory.sourceEndId) {
                            await db.memories.update(memory.id, { sourceStartId, sourceEndId });
                        }
                    }
                    const config = await db.appConfig.get('main');
                    if (config?.memorySettings) {
                        const settings = { ...config.memorySettings };
                        settings.characterId = recordLocalIdBySyncId(context.characters, settings.characterSyncId, settings.characterId ?? null);
                        settings.proxyId = recordLocalIdBySyncId(context.proxies, settings.proxySyncId, settings.proxyId ?? null);
                        settings.messageCursorId = recordLocalIdBySyncId(context.messages, settings.messageCursorSyncId, settings.messageCursorId ?? null);
                        await db.appConfig.update('main', { memorySettings: settings });
                    }
                    for (const message of await db.messages.toArray()) {
                        const changes = {};
                        const senderId = recordLocalIdBySyncId(context.characters, message.senderSyncId, message.senderId ?? null);
                        const relatedMaps = message.relatedEntityType === 'transaction'
                            ? context.transactions
                            : (message.relatedEntityType === 'schedule' ? context.schedules : null);
                        const relatedId = relatedMaps
                            ? recordLocalIdBySyncId(relatedMaps, message.relatedSyncId, message.relatedId ?? null)
                            : message.relatedId;
                        if (senderId !== message.senderId) changes.senderId = senderId;
                        if (relatedId !== message.relatedId) changes.relatedId = relatedId;
                        if (Object.keys(changes).length) await db.messages.update(message.id, changes);
                    }
                });
            }

            async function refreshLocalStateAfterCloudSync() {
                await loadDataFromDB();
                if (!state.currentlyEditingMsgId && !state.isSelectionMode) renderChatMessages(false);
                renderLedger();
                renderSchedules();
                renderCharacterList();
                renderProxyList();
                renderCurrencyList();
                if (typeof renderMemoryPage === 'function') renderMemoryPage(false);
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
                    await reconcileCloudRecords(await fetchAllCloudRecords());
                    await reconcileCloudMessages(await fetchAllCloudMessages());
                    await resolveAllLocalCloudReferences();
                    await pushPendingCloudRecords();
                    await pushPendingMessages();
                    await reconcileCloudRecords(await fetchAllCloudRecords());
                    await reconcileCloudMessages(await fetchAllCloudMessages());
                    await resolveAllLocalCloudReferences();
                    await refreshLocalStateAfterCloudSync();
                    cloudSyncLastSuccessAt = Date.now();
                    setCloudNotice('全部安全数据已同步；图片和密钥仍只留在本机。', 'success');
                } catch (error) {
                    cloudSyncLastError = error?.message || String(error);
                    console.error('Cava cloud sync failed:', error);
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
                if (!window.supabase?.createClient) throw new Error('Supabase 程序没有加载成功；请确认当前设备可以访问 jsDelivr CDN。');
                const config = getSupabaseConfig();
                cavaSupabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
                    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
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
                    setCloudNotice('注册并登录成功，正在上传全部安全数据。', 'success');
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
                setCloudNotice('登录成功，正在同步全部安全数据。', 'success');
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
