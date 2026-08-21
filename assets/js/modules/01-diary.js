/* Cava Notebook - 01-diary.js */

            async function generateDiary() {
                if (!state.currentDiaryCharId || !state.currentDiaryDate) {
                    alert('请先选择角色');
                    return;
                }

                const character = state.characters.find(c => c.id === state.currentDiaryCharId);
                if (!character) {
                    alert('未找到选中的角色');
                    return;
                }

                const proxy = state.proxies.find(p => p.id === character.proxyId);
                if (!proxy || !character.model) {
                    alert(`角色 "${character.name}" 未配置API或模型`);
                    return;
                }

                // 显示加载状态
                const contentArea = document.getElementById('diary-content-area-inline');
                if (contentArea) {
                    contentArea.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; padding: 40px; flex-direction: column;">
                <div class="typing-indicator"><span>.</span><span>.</span><span>.</span></div>
                <p style="margin-top: 15px; color: var(--text-secondary);">正在生成日记...</p>
            </div>
        `;
                }

                try {
                    // 1. 准备所有需要替换的变量
                    // 这里的 state.currentDiaryDate 就是你日历上点击的那一天，是正确的！
                    const dateStr = `${state.currentDiaryDate.getFullYear()}年${state.currentDiaryDate.getMonth() + 1}月${state.currentDiaryDate.getDate()}日`;
                    const userId = state.config.userId || '用户';
                    const charName = character.name;

                    // 2. 构建用户信息字符串
                    let userProfileString = '';
                    if (state.config.userId || state.config.userGender || state.config.userBio) {
                        userProfileString += "[用户信息]\n";
                        if (state.config.userId) userProfileString += `- ID: ${state.config.userId}\n`;
                        if (state.config.userGender) userProfileString += `- 性别: ${state.config.userGender}\n`;
                        if (state.config.userBio) userProfileString += `- 简介: ${state.config.userBio}\n`;
                        userProfileString += '\n';
                    }

                    // --- 核心修改：拆分提示词 ---

                    // 3. 准备【系统提示词】，只包含不变的角色设定和用户信息
                    const systemPromptForAPI = `${character.prompt}\n\n${userProfileString}`;

                    // 4. 准备【最后的用户指令】，包含具体的写日记任务
                    const latestDiaryPromptTemplate = state.config.diaryPrompt; // 从数据库获取最新的模板
                    const finalInstruction = latestDiaryPromptTemplate
                        .replace(/{char}/g, charName)
                        .replace(/{user}/g, userId)
                        .replace(/{date}/g, dateStr);

                    const history = buildContext(8000).context;


                    const params = character.aiParams || {
                        temperature: 0.9, topP: 0.95, topK: 0, frequencyPenalty: 0, presencePenalty: 0
                    };

                    console.log('正在调用日记生成API...');

                    const messagesForAPI = [
                        { role: 'system', content: systemPromptForAPI }, 
                        ...history,                                     // 中间的对话历史
                        { role: 'user', content: finalInstruction }      // 结尾的最终指令！
                    ];

                    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${proxy.apiKey}`
                        },
                        body: JSON.stringify({
                            model: character.model,
                            messages: messagesForAPI, 
                            temperature: params.temperature,
                            top_p: params.topP,
                            top_k: params.topK,
                            frequency_penalty: params.frequencyPenalty,
                            presence_penalty: params.presencePenalty,
                            max_tokens: 3000
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(await response.text());
                    }

                    const data = await response.json();
                    const diaryContent = data.choices[0].message.content;
                    console.log('日记生成成功！');

                    const dateStrForDB = `${state.currentDiaryDate.getFullYear()}-${String(state.currentDiaryDate.getMonth() + 1).padStart(2, '0')}-${String(state.currentDiaryDate.getDate()).padStart(2, '0')}`;
                    const existingDiary = state.diaries.find(d => d.date === dateStrForDB && d.charId === state.currentDiaryCharId);

                    if (existingDiary) {
                        existingDiary.content = diaryContent;
                        existingDiary.timestamp = Date.now();
                        await db.diaries.put(existingDiary);
                    } else {
                        const newDiary = {
                            date: dateStrForDB,
                            charId: state.currentDiaryCharId,
                            content: diaryContent,
                            timestamp: Date.now()
                        };
                        const id = await db.diaries.add(newDiary);
                        state.diaries.push({ ...newDiary, id });
                    }

                    updateDiaryContentArea(state.currentDiaryDate);

                } catch (error) {
                    console.error('生成日记失败:', error);
                    alert('生成日记失败：' + error.message);
                    updateDiaryContentArea(state.currentDiaryDate);
                }
            }



            async function deleteDiary() {
                if (!confirm('确定要删除这篇日记吗？')) {
                    return;
                }

                const dateStr = `${state.currentDiaryDate.getFullYear()}-${String(state.currentDiaryDate.getMonth() + 1).padStart(2, '0')}-${String(state.currentDiaryDate.getDate()).padStart(2, '0')}`;
                const diary = state.diaries.find(d =>
                    d.date === dateStr && d.charId === state.currentDiaryCharId
                );

                if (diary) {
                    await db.diaries.delete(diary.id);
                    state.diaries = state.diaries.filter(d => d.id !== diary.id);
                    // 删除后，刷新日记区域
                    updateDiaryContentArea(state.currentDiaryDate);
                }
            }

