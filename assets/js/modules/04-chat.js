/* Cava Notebook - 04-chat.js */
            function closeChatMoreMenu() {
                ELS.chatActionsBar.hidden = true;
                ELS.chatMoreBtn.setAttribute('aria-expanded', 'false');
            }

            function toggleChatMoreMenu() {
                const shouldOpen = ELS.chatActionsBar.hidden;
                ELS.chatActionsBar.hidden = !shouldOpen;
                ELS.chatMoreBtn.setAttribute('aria-expanded', String(shouldOpen));
            }

            function updateSendButtonState() {
                const hasText = ELS.chatInput.value.trim().length > 0;
                ELS.sendBtn.disabled = !hasText;
                ELS.sendBtn.hidden = !hasText;
                ELS.chatMoreBtn.hidden = hasText;
                if (hasText) closeChatMoreMenu();
            }

            async function sendUserMessage() {
                if (ELS.sendBtn.disabled) return;
                const text = ELS.chatInput.value.trim();

                if (text) {
                    const newMsg = { timestamp: Date.now(), role: 'user', content: text, type: 'text' };
                    const id = await db.messages.add(newMsg);
                    state.messages.push({ ...newMsg, id });
                    ELS.chatInput.value = '';
                    renderChatMessages();
                    updateSendButtonState();
                }
            }

            async function sendUserImage(event) {
                const file = event.target.files[0];
                if (!file) return;

                // 压缩图片
                const compressedBase64 = await compressImage(file, 800, 0.8);

                const newMsg = { timestamp: Date.now(), role: 'user', content: compressedBase64, type: 'image' };
                const id = await db.messages.add(newMsg);
                state.messages.push({ ...newMsg, id });
                renderChatMessages();
                event.target.value = '';
            }

            async function compressImage(file, maxWidth = 800, quality = 0.7) {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');

                            let width = img.width;
                            let height = img.height;

                            // 计算缩放比例
                            if (width > maxWidth) {
                                height = (maxWidth / width) * height;
                                width = maxWidth;
                            }

                            canvas.width = width;
                            canvas.height = height;

                            // 绘制压缩后的图片
                            ctx.drawImage(img, 0, 0, width, height);

                            // 转换为base64
                            const compressedBase64 = canvas.toDataURL('image/webp', quality);
                            resolve(compressedBase64);
                        };
                        img.src = e.target.result;
                    };
                    reader.readAsDataURL(file);
                });
            }

            async function compressEmojiPack(file, maxSize = 400) {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const img = new Image();
                        img.onload = () => {
                            const canvas = document.createElement('canvas');
                            const ctx = canvas.getContext('2d');

                            let width = img.width;
                            let height = img.height;

                            // 计算缩放比例，最长边为400px
                            if (width > height && width > maxSize) {
                                height = (maxSize / width) * height;
                                width = maxSize;
                            } else if (height > width && height > maxSize) {
                                width = (maxSize / height) * width;
                                height = maxSize;
                            } else if (width === height && width > maxSize) {
                                width = maxSize;
                                height = maxSize;
                            }

                            canvas.width = width;
                            canvas.height = height;
                            ctx.drawImage(img, 0, 0, width, height);

                            const compressedBase64 = canvas.toDataURL('image/webp', 0.8);
                            resolve(compressedBase64);
                        };
                        img.src = e.target.result;
                    };
                    reader.readAsDataURL(file);
                });
            }

            async function triggerAIResponse(character) {
                const proxy = state.proxies.find(p => p.id === character.proxyId);
                const backupProxy = state.proxies.find(p => p.id === character.backupProxyId);
                if (!proxy || !character.model) {
                    alert(`角色 "${character.name}" 未配置主用API或模型，无法发言。`);
                    return;
                }

                const responseGroupId = `ai-response-${character.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const now = new Date();
                const formattedDateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                let userProfileString = '';
                if (state.config.userId || state.config.userGender || state.config.userBio) {
                    userProfileString += "[User Profile]\n";
                    if (state.config.userId) userProfileString += `- ID: ${state.config.userId}\n`;
                    if (state.config.userGender) userProfileString += `- Gender: ${state.config.userGender}\n`;
                    if (state.config.userBio) userProfileString += `- Bio: ${state.config.userBio}\n`;
                    userProfileString += '\n';
                }

                const { sendTime, sendModel, sendRole } = state.config.systemPromptSettings;
                let systemInfo = "[System Info]\n";
                if (sendModel) systemInfo += `- Current Model: ${character.model}\n`;
                if (sendTime) systemInfo += `- Current Time: ${formattedDateTime}\n`;
                if (sendRole) systemInfo += `- Your Role: ${character.name}\n`;
                systemInfo += `\n---\n\n`;

                const systemPrefix = userProfileString + systemInfo;
                const systemPrompt = systemPrefix + `${character.prompt}\n\n你的任务是作为聊天伙伴对用户的记账和聊天内容做出回应。你的回应需要符合你的人设。如果用户发了图片或表情包，你要像能看到一样进行评论。你也可以发送表情包，格式为[emoji:表情包名称]，当你发送表情包时，需要单独换行。可用的表情包有：${state.emojiPacks.map(e => e.name).join('、')}。请自然地进行对话。规则如下：\n1. 发送多条消息请用换行符(\\n)分隔，这会创建多个聊天气泡。\n2. 在单条消息内部换行，请直接使用 <br> 标签。`; const history = buildContext(state.config.maxTokens || 4096).context;

                // 1. 为主API的调用创建一个“思考中”气泡
                const thinkingBubbleId = addThinkingBubble(character);

                let responseText;
                try {
                    // 尝试调用主API
                    responseText = await callAPI(proxy, systemPrompt, history, character.model, character);
                    await processAIResponse(responseText, thinkingBubbleId, character, responseGroupId);
                } catch (mainError) {
                    console.error("Main API failed:", mainError);

                    // 2. 主API失败，将它的“思考中”气泡更新为错误信息，并【保留】它
                    await updateThinkingBubble(thinkingBubbleId, `[主API错误: ${mainError.message}]`, character.id, true, responseGroupId);

                    // 3. 检查是否有备用API，这里的 if/else 结构是修复语法错误的关键
                    if (backupProxy && character.backupModel) {
                        console.log("Main API failed, trying backup API...");

                        // 4. 为【备用API】的调用创建【新的】“思考中”气泡
                        const backupBubbleId = addThinkingBubble(character);

                        // 将调用备用API的逻辑【整个】放入 if 块内
                        try {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            let backupSystemInfo = "[System Info]\n";
                            if (sendModel) backupSystemInfo += `- Current Model: ${character.backupModel}\n`;
                            if (sendTime) backupSystemInfo += `- Current Time: ${formattedDateTime}\n`;
                            if (sendRole) backupSystemInfo += `- Your Role: ${character.name}\n`;
                            backupSystemInfo += `\n---\n\n`;
                            const backupSystemPrefix = userProfileString + backupSystemInfo;
                            const backupSystemPrompt = systemPrefix + `${character.prompt}\n\n你的任务是作为聊天伙伴对用户的记账和聊天内容做出回应。你的回应需要符合你的人设。如果用户发了图片或表情包，你要像能看到一样进行评论。你也可以发送表情包，格式为[emoji:表情包名称]，当你发送表情包时，需要单独换行。可用的表情包有：${state.emojiPacks.map(e => e.name).join('、')}。请自然地进行对话。规则如下：\n1. 发送多条消息请用换行符(\\n)分隔，这会创建多个聊天气泡。\n2. 在单条消息内部换行，请直接使用 <br> 标签。`;
                            // 尝试调用备用API
                            responseText = await callAPI(backupProxy, backupSystemPrompt, history, character.backupModel, character);

                            // 5. 【关键修改】备用API成功后，用它的结果更新【它自己】的“思考中”气泡
                            await processAIResponse(responseText, backupBubbleId, character, responseGroupId);

                        } catch (backupError) {
                            console.error("Backup API also failed:", backupError);
                            // 6. 【关键修改】如果备用API也失败了，则更新【它自己】的“思考中”气泡为错误信息
                            await updateThinkingBubble(backupBubbleId, `[备用API错误: ${backupError.message}]`, character.id, true, responseGroupId);
                        }
                    } else {
                        // 这个 else 块现在正确地跟在 if 后面
                        console.log("No backup API configured, stopping.");
                    }
                }
            }

            async function processAIResponse(text, bubbleId, character, responseGroupId) {
                const aiReplies = text.split('\n').map(r => r.trim()).filter(Boolean);

                if (aiReplies.length > 0) {
                    for (let i = 0; i < aiReplies.length; i++) {
                        let reply = aiReplies[i];
                        const isFirstMessage = (i === 0);

                        if (!isFirstMessage) {
                            await new Promise(resolve => setTimeout(resolve, Math.random() * 600 + 200));
                        }

                        const emojiRegex = /\[emoji:(.*?)\]/;
                        const emojiMatch = reply.match(emojiRegex);

                        if (emojiMatch) {
                            const emojiName = emojiMatch[1];
                            const emoji = state.emojiPacks.find(e => e.name === emojiName);

                            if (emoji) {
                                if (isFirstMessage) {
                                    await updateThinkingBubbleAsEmoji(bubbleId, emoji, character.id, responseGroupId);
                                } else {
                                    await addAIEmojiMessage(emoji, character.id, responseGroupId);
                                }
                            }

                            const remainingText = reply.replace(emojiRegex, '').trim();
                            if (remainingText) {
                                await addAIMessage(remainingText, character.id, responseGroupId);
                            }
                        } else {
                            if (isFirstMessage) {
                                await updateThinkingBubble(bubbleId, reply, character.id, false, responseGroupId);  // 修复：添加 bubbleId
                            } else {
                                await addAIMessage(reply, character.id, responseGroupId);
                            }
                        }
                    }
                } else {
                    await updateThinkingBubble(bubbleId, "[AI没有返回任何内容]", character.id, true, responseGroupId);  // 修复：添加 bubbleId
                }
            }

            // 添加新函数：
            async function updateThinkingBubbleAsEmoji(bubbleId, emoji, senderId, responseGroupId = null) {
                const newMsgData = {
                    timestamp: Date.now(),
                    role: 'assistant',
                    content: `[emoji:${emoji.name}]`,
                    type: 'emoji_pack',
                    senderId,
                    responseGroupId
                };
                const newId = await db.messages.add(newMsgData);
                state.messages.push({ ...newMsgData, id: newId });
                const bubbleWrapper = document.getElementById(bubbleId);
                if (bubbleWrapper) {
                    const newBubble = createMessageElement({ ...newMsgData, id: newId });
                    bubbleWrapper.parentElement.replaceChild(newBubble, bubbleWrapper);
                }
            }

            async function addAIEmojiMessage(emoji, senderId, responseGroupId = null) {
                const newMsg = {
                    timestamp: Date.now(),
                    role: 'assistant',
                    content: `[emoji:${emoji.name}]`,
                    type: 'emoji_pack',
                    senderId,
                    responseGroupId
                };
                const id = await db.messages.add(newMsg);
                state.messages.push({ ...newMsg, id });
                renderChatMessages();
            }

            function buildContext(maxTokens) {
                let context = [];
                let currentTokens = 0;
                const reversedMessages = [...state.messages].reverse();
                const { systemPromptSettings } = state.config;

                // 这个变量现在用来记录“上一个已处理消息的日期”
                let processedDateStr = null;

                for (let messageOffset = 0; messageOffset < reversedMessages.length; messageOffset++) {
                    const msg = reversedMessages[messageOffset];
                    let content;
                    let msgTokens = 0;
                    const role = msg.role === 'assistant' ? 'assistant' : 'user';

                    // --- 这部分解析消息内容的代码保持不变 ---
                    if (msg.type === 'transaction') {
                        const t = state.transactions.find(t => t.id === msg.relatedId);
                        if (!t) continue;
                        content = `[记账提醒] 我${t.type === 'expense' ? '花了' : '赚了'} ${t.amount}${t.currency}，分类是${CATEGORIES[t.type].find(c => c.id === t.category)?.name || '未知'}，备注是：“${t.remark}”`;
                        msgTokens = content.length * 2;
                    } else if (msg.type === 'schedule') {
                        const s = state.schedules.find(s => s.id === msg.relatedId);
                        if (!s) continue;
                        const deadlineStr = s.deadline ? formatDeadline(s.deadline) : '无';
                        const descriptionText = s.description ? `说明是"${s.description}"` : "无";
                        const statusText = s.completed ? '已完成' : '未完成';
                        const eventTypeStr = s.eventType === 'long' ? '长期事件' : '单次事件';
                        content = `[日程提醒-${eventTypeStr}] 我定了个${eventTypeStr}：'${s.title}'。重要程度是 ${s.importance.toFixed(1)}/10，截止日期是 ${deadlineStr}，${descriptionText}，当前状态：${statusText}。`;
                        msgTokens = content.length * 2;
                    } else if (msg.type === 'image') {
                        if (messageOffset < 5) {
                            content = [{ type: "image_url", image_url: { url: msg.content } }];
                            msgTokens = 1000;
                        } else {
                            content = '[image]';
                            msgTokens = content.length * 2;
                        }
                    } else if (msg.type === 'emoji_pack') {
                        const match = msg.content.match(/\[emoji:(.*?)\]/);
                        if (match) {
                            content = `[emoji:${match[1]}]`;
                            msgTokens = content.length * 2;
                        }
                    } else if (msg.type === 'ledger_summary') {
                        const data = JSON.stringify(getFilteredTransactions().filtered);
                        content = (systemPromptSettings.ledger || DEFAULT_SYSTEM_PROMPTS.ledger).replace('{data}', data);
                        msgTokens = content.length * 2;
                    } else if (msg.type === 'schedule_summary') {
                        const data = JSON.stringify(state.schedules);
                        content = (systemPromptSettings.schedule || DEFAULT_SYSTEM_PROMPTS.schedule).replace('{data}', data);
                        msgTokens = content.length * 2;
                    } else if (msg.type === 'pie_chart_summary') {
                        content = (systemPromptSettings.pie || DEFAULT_SYSTEM_PROMPTS.pie).replace('{data}', msg.content);
                        msgTokens = content.length * 2;
                    } else {
                        content = msg.content;
                        msgTokens = content.length * 2;
                    }
                    // --- 消息解析结束 ---

                    // ==================== 全新的智能时间戳逻辑 ====================
                    const msgDate = new Date(msg.timestamp);
                    const currentMsgDateStr = `${msgDate.getFullYear()}-${String(msgDate.getMonth() + 1).padStart(2, '0')}-${String(msgDate.getDate()).padStart(2, '0')}`;

                    let dateMarkerContent = null;
                    let dateMarkerTokens = 0;

                    // 检查：如果这不是循环的第一个消息，并且当前消息的日期与上一个处理的消息日期不同
                    if (processedDateStr && currentMsgDateStr !== processedDateStr) {
                        // 那么，我们就在此插入一个分割线，内容是“上一个处理的日期”
                        const prevDate = new Date(processedDateStr);
                        const month = prevDate.getMonth() + 1;
                        const day = prevDate.getDate();
                        dateMarkerContent = `\n——以下是${month}月${day}日的消息——\n`;
                        dateMarkerTokens = dateMarkerContent.length * 2;
                    }

                    // 检查加上分割线（如果需要）和消息本身后，是否会超出token限制
                    if (currentTokens + msgTokens + dateMarkerTokens > maxTokens) {
                        break; // 如果空间不足，则停止添加任何新消息
                    }

                    // 如果需要插入分割线，先把它放进上下文数组的最前面
                    if (dateMarkerContent) {
                        context.unshift({ role: 'system', content: dateMarkerContent });
                        currentTokens += dateMarkerTokens;
                    }

                    // 接着，把当前这条消息放进上下文数组的最前面
                    const finalRole = (msg.type !== 'text' && msg.role === 'user') ? 'user' : role;
                    const messageForContext = { role: finalRole, content };

                    if (finalRole === 'assistant' && msg.senderId) {
                        const character = state.characters.find(c => c.id === msg.senderId);
                        if (character) {
                            messageForContext.name = character.name; // 使用 name 字段
                        }
                    }
                    context.unshift(messageForContext);
                    currentTokens += msgTokens;

                    // 最后，更新“已处理日期”，为下一次循环做准备
                    processedDateStr = currentMsgDateStr;
                    // ===============================================================
                }
                return { context, tokens: currentTokens };
            }


            async function callAPI(proxy, systemPrompt, history, model, character) { // <--- 多了一个 character 参数
                // 从角色信息里读取他的专属性格参数，如果不存在则使用默认预设值
                const params = character.aiParams || PARAM_PRESETS.default;

                const res = await fetch(`${proxy.url}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${proxy.apiKey}` },
                    body: JSON.stringify({
                        model: model,
                        messages: [{ role: 'system', content: systemPrompt }, ...history],

                        // --- 核心修改在这里！---
                        // 把从角色对象中读取的性格参数放在这里
                        temperature: params.temperature,
                        top_p: params.topP,
                        top_k: params.topK,
                        frequency_penalty: params.frequencyPenalty,
                        presence_penalty: params.presencePenalty
                    })
                });

                // --- 函数后面已有的错误处理和返回数据的代码（保持不变）---
                if (!res.ok) {
                    const errorText = await res.text();
                    let errorMessage = '未知API错误';
                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error.message || errorText;
                    } catch (e) {
                        errorMessage = errorText;
                    }
                    throw new Error(errorMessage);
                }

                const data = await res.json();
                return data.choices[0].message.content;
            }

            async function addAIMessage(content, senderId = null, responseGroupId = null) {
                const newMsg = { timestamp: Date.now(), role: 'assistant', content, type: 'text', senderId, responseGroupId };
                const id = await db.messages.add(newMsg);
                state.messages.push({ ...newMsg, id });
                renderChatMessages();
            }

            function addThinkingBubble(character) {
                const bubbleId = `thinking-${Date.now()}`;
                const wrapper = createMessageElement({ id: bubbleId, role: 'assistant', type: 'text', senderId: character.id, content: `<div class="typing-indicator"><span>.</span><span>.</span><span>.</span></div>` });
                ELS.chatMessages.appendChild(wrapper); ELS.chatMessages.scrollTop = ELS.chatMessages.scrollHeight;
                return bubbleId;
            }

            async function updateThinkingBubble(bubbleId, content, senderId, isError = false, responseGroupId = null) {
                const newMsgData = { timestamp: Date.now(), role: 'assistant', content, type: 'text', senderId, responseGroupId };
                const newId = await db.messages.add(newMsgData);
                state.messages.push({ ...newMsgData, id: newId });
                const bubbleWrapper = document.getElementById(bubbleId);
                if (bubbleWrapper) { const newBubble = createMessageElement({ ...newMsgData, id: newId }, isError); bubbleWrapper.parentElement.replaceChild(newBubble, bubbleWrapper); }
                state.messages = state.messages.filter(m => m.id !== bubbleId);
            }

            function parseSimpleMarkdown(text) {
                if (!text) return '';

                // 1. 【顺序调整】我们先处理我们信任的 <br> 标签，把它换成一个临时的、不会被影响的换行符
                let processedText = text.replace(/<br\s*\/?>/gi, '\n');

                // 2. 【安全升级】现在再对剩余的HTML特殊字符进行转义，防止 XSS 攻击
                processedText = processedText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

                // 3.【核心改造】处理多行代码块，生成新的带头部的结构
                processedText = processedText.replace(/^```([a-z]*)?\n([\s\S]+?)\n```$/gm, (match, lang, code) => {
                    const languageName = lang || 'text';
                    const escapedCode = code.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    return `<div class="markdown-code-block-wrapper">
                            <div class="code-block-header">
                                <span class="language-name">${languageName}</span>
                                <button class="copy-code-btn" title="复制">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                </button>
                            </div>
                            <pre><code>${escapedCode}</code></pre>
                        </div>`;
                });

                // 4. 处理其他块级元素
                processedText = processedText.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr class="markdown-hr">');
                processedText = processedText.replace(/^### (.*$)/gm, '<h3 class="markdown-h">$1</h3>')
                    .replace(/^## (.*$)/gm, '<h2 class="markdown-h">$1</h2>')
                    .replace(/^# (.*$)/gm, '<h1 class="markdown-h">$1</h1>');
                processedText = processedText.replace(/(?:(?:^[ \t]*[-*+]) .*(?:\n|$))+/gm, (match) => {
                    const listItems = match.trim().split('\n').map(item =>
                        item.replace(/^[ \t]*[-*+] (.*)/, '<li>$1</li>')
                    ).join('');
                    return `<ul class="markdown-ul">${listItems}</ul>`;
                });

                // 5. 处理行内元素
                processedText = processedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                processedText = processedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
                processedText = processedText.replace(/`([^`]+)`/g, '<code class="markdown-code">$1</code>');

                // 6. 最后处理换行符，现在我们只需要把之前替换的 \n 转换回 <br>
                processedText = processedText.replace(/<\/div>|<pre>|<\/h[1-3]>|<\/ul>|<\/hr>/g, (match) => `${match}\n`);
                processedText = processedText.replace(/\n/g, '<br>');

                return processedText;
            }

            function attachCopyCodeListeners(container) {
                const copyButtons = container.querySelectorAll('.copy-code-btn');
                copyButtons.forEach(button => {
                    if (button.dataset.listenerAttached) return;

                    const originalContent = button.innerHTML; // 保存原始的 SVG 图标
                    const copiedContent = '已复制!'; // 定义复制成功后的文本

                    button.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const wrapper = button.closest('.markdown-code-block-wrapper');
                        const codeElement = wrapper.querySelector('pre > code');
                        if (codeElement) {
                            navigator.clipboard.writeText(codeElement.textContent).then(() => {
                                button.innerHTML = copiedContent; // 临时显示“已复制”
                                setTimeout(() => {
                                    button.innerHTML = originalContent; // 2秒后恢复图标
                                }, 2000);
                            }).catch(err => {
                                console.error('无法复制: ', err);
                                button.innerHTML = '失败';
                                setTimeout(() => {
                                    button.innerHTML = originalContent;
                                }, 2000);
                            });
                        }
                    });
                    button.dataset.listenerAttached = 'true';
                });
            }

            function createMessageElement(msg, isError = false) {
                const wrapper = document.createElement('div');
                wrapper.className = `message-wrapper ${msg.role === 'user' ? 'user' : 'ai'}`;
                if (isError) wrapper.classList.add('error');
                wrapper.id = msg.id;
                wrapper.dataset.id = msg.id;

                const checkbox = document.createElement('div');
                checkbox.className = 'message-selection-checkbox';
                checkbox.innerHTML = appIcon('check');
                wrapper.appendChild(checkbox);

                wrapper.addEventListener('click', (e) => {
                    if (state.isSelectionMode) {
                        e.stopPropagation();
                        toggleMessageSelection(msg.id);
                    }
                });

                let character = msg.senderId ? state.characters.find(c => c.id === msg.senderId) : null;

                const avatar = document.createElement('img');
                avatar.className = 'avatar';
                avatar.src = msg.role === 'user' ? (state.config.chatAvatar || DEFAULT_AVATAR) : (character ? character.avatar : DEFAULT_AVATAR);

                const messageBlock = document.createElement('div');
                messageBlock.className = 'message-block';

                if (msg.role === 'assistant' && character) {
                    const senderName = document.createElement('div');
                    senderName.className = 'sender-name';
                    senderName.textContent = character.name;
                    messageBlock.appendChild(senderName);
                }

                const bubble = document.createElement('div');
                bubble.className = 'message-bubble';
                bubble.classList.add(msg.type);

                const contentContainer = document.createElement('div');
                contentContainer.className = 'content';

                if (msg.type === 'transaction') {
                    const t = state.transactions.find(t => t.id === msg.relatedId);
                    if (!t) return wrapper;
                    const category = CATEGORIES[t.type].find(c => c.id === t.category);
                    const remarkText = t.remark || '没有备注哦~';
                    contentContainer.innerHTML = `<div class="transaction-card"><div class="transaction-header ${t.type}"><div class="icon">${appIcon(category?.icon || 'circle-help')}</div><div class="category-name">${category?.name || '未知分类'}</div></div><div class="transaction-body"><div class="transaction-amount">${t.type === 'expense' ? '-' : '+'}${t.amount.toFixed(2)}<span class="currency-label">${t.currency}</span></div><div class="transaction-remark"><span class="original-text">${remarkText}</span></div></div></div>`;
                } else if (msg.type === 'schedule') {
                    const s = state.schedules.find(s => s.id === msg.relatedId);
                    if (!s) return wrapper;
                    const deadlineStr = s.deadline ? formatDeadline(s.deadline) : '无';

                    let statusText = '未完成';
                    let statusClass = 'pending';

                    if (s.eventType === 'once' && s.completed) {
                        statusText = '已完成';
                        statusClass = 'completed';
                    } else if (s.eventType === 'long') {
                        const today = new Date();
                        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                        if (s.completedDates && s.completedDates.includes(todayStr)) {
                            statusText = '已完成 (今日)';
                            statusClass = 'completed';
                        }
                    }

                    contentContainer.innerHTML = `<div class="schedule-card"><div class="schedule-header"><div class="icon">${appIcon('tag')}</div><div class="type-name">${s.eventType === 'long' ? '长期事件' : '单次事件'}</div></div><div class="schedule-body"><div class="schedule-title">${s.title}</div><div class="schedule-importance">重要程度: ${s.importance.toFixed(1)}</div><div class="schedule-deadline">截止: ${deadlineStr}</div><div class="schedule-status ${statusClass}">状态: ${statusText}</div>${s.description ? `<div class="schedule-description"><span class="original-text">${s.description}</span></div>` : ''}</div></div>`;
                } else if (msg.type === 'image') {
                    contentContainer.innerHTML = `<img src="${msg.content}" class="chat-image" alt="用户发送的图片">`;
                } else if (msg.type === 'emoji_pack') {
                    // 解析表情包名称
                    const match = msg.content.match(/\[emoji:(.*?)\]/);
                    if (match) {
                        const emojiName = match[1];
                        const emoji = state.emojiPacks.find(e => e.name === emojiName);
                        if (emoji) {
                            contentContainer.innerHTML = `<img src="${emoji.image}" class="chat-image" alt="${emojiName}" style="max-width: 150px; max-height: 150px;">`;
                        } else {
                            contentContainer.innerHTML = `<span class="content-text">[表情包: ${emojiName}]</span>`;
                        }
                    }
                } else if (msg.type === 'ledger_summary') {
                    contentContainer.innerHTML = `<div class="summary-card"><div class="summary-header"><div class="icon">${appIcon('book')}</div><div class="type-name">我的账本</div></div><div class="summary-body"><div class="text">已将筛选账本信息同步给AI</div></div></div>`;
                } else if (msg.type === 'schedule_summary') {
                    contentContainer.innerHTML = `<div class="summary-card"><div class="summary-header"><div class="icon">${appIcon('calendar')}</div><div class="type-name">我的日程</div></div><div class="summary-body"><div class="text">已将最新日程信息同步给AI</div></div></div>`;
                } else if (msg.type === 'pie_chart_summary') {
                    contentContainer.innerHTML = `<div class="summary-card"><div class="summary-header"><div class="icon">${appIcon('chart')}</div><div class="type-name">账本图表</div></div><div class="summary-body"><div class="text">已将图表分析同步给AI</div></div></div>`;
                } else if (msg.type === 'today_tasks_summary') {
                    contentContainer.innerHTML = `<div class="summary-card"><div class="summary-header"><div class="icon">${appIcon('calendar-check')}</div><div class="type-name">今日待办</div></div><div class="summary-body"><div class="text">已将今日待办同步给AI</div></div></div>`;
                } else if (msg.type === 'calendar_view_summary') {
                    contentContainer.innerHTML = `<div class="summary-card"><div class="summary-header"><div class="icon">${appIcon('calendar')}</div><div class="type-name">日历视图</div></div><div class="summary-body"><div class="text">已将本月日程同步给AI</div></div></div>`;
                } else {
                    const contentSpan = document.createElement('span');
                    contentSpan.className = 'content-text';
                    contentSpan.innerHTML = msg.id.toString().startsWith('thinking-') ? msg.content : parseSimpleMarkdown(msg.content);
                    contentContainer.appendChild(contentSpan);
                }

                const metaContainer = document.createElement('div');
                metaContainer.className = 'message-meta';
                const timestamp = document.createElement('span');
                timestamp.className = 'timestamp';
                timestamp.textContent = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                const menuTrigger = document.createElement('span');
                menuTrigger.className = 'message-actions-trigger';
                menuTrigger.innerHTML = '⋮';
                menuTrigger.addEventListener('click', (e) => { e.stopPropagation(); cancelCurrentEdit(); showActionMenu(msg.id); });
                metaContainer.append(timestamp, menuTrigger);

                bubble.append(contentContainer, metaContainer);
                messageBlock.appendChild(bubble);

                if (msg.role === 'user') {
                    wrapper.append(messageBlock, avatar);
                } else {
                    wrapper.append(avatar, messageBlock);
                }

                return wrapper;
            }

            function renderChatMessages(shouldScrollToBottom = true, resetDisplay = false) {
                if (resetDisplay) {
                    state.messagesDisplayed = 50;
                }

                const lastScrollTop = ELS.chatMessages.scrollTop;
                const lastScrollHeight = ELS.chatMessages.scrollHeight;
                const isScrolledToBottom = lastScrollHeight - lastScrollTop - ELS.chatMessages.clientHeight < 1;

                const messagesToShow = state.messages.slice(-state.messagesDisplayed);
                const hasMore = state.messagesDisplayed < state.messages.length;

                ELS.chatMessages.innerHTML = '';

                // 添加加载更多提示
                if (hasMore) {
                    const loadMoreDiv = document.createElement('div');
                    loadMoreDiv.className = 'load-more-indicator';
                    loadMoreDiv.textContent = '向上滚动加载更多...';
                    ELS.chatMessages.appendChild(loadMoreDiv);
                }

                messagesToShow.forEach(msg => {
                    if (!msg.id.toString().startsWith('thinking-')) {
                        ELS.chatMessages.appendChild(createMessageElement(msg));
                    }
                });

                if (shouldScrollToBottom || isScrolledToBottom) {
                    ELS.chatMessages.scrollTop = ELS.chatMessages.scrollHeight;
                } else if (!resetDisplay) {
                    // 保持相对位置
                    const newScrollHeight = ELS.chatMessages.scrollHeight;
                    const scrollDiff = newScrollHeight - lastScrollHeight;
                    ELS.chatMessages.scrollTop = lastScrollTop + scrollDiff;
                }

                attachCopyCodeListeners(ELS.chatMessages); // 绑定复制代码按钮事件

            }

