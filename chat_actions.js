/**
 * chat_actions.js - Logic for Messaging & Admin
 */

Object.assign(window.App, {
    async adminAction(type, value) {
        if (!this.state.activeRoom.isOwner) return;
        if (type === 'nuke' && !confirm("آیا مطمئن هستید که می‌خواهید تمام پیام‌ها را برای همیشه حذف کنید؟")) return;
        if (type === 'delete_room' && !confirm("آیا مطمئن هستید که می‌خواهید کل اتاق و تمام داده‌ها را حذف کنید؟")) return;

        if(type !== 'pin_message' && type !== 'toggle_lock') this.toggleGlobalLoader(true, "بروزرسانی اتاق...");
        const payload = { room_id: this.state.activeRoom.id, type: type };
        if (type === 'toggle_lock' || type === 'update_expiry') payload.value = value;
        if (type === 'pin_message') payload.msg_id = value;
        if (type === 'add_owner' || type === 'remove_owner') payload.username = value;

        const res = await window.API.post('admin_action', payload);
        if(type !== 'pin_message' && type !== 'toggle_lock') this.toggleGlobalLoader(false);
        
        if (res.status === 'success') {
            if (type !== 'toggle_lock') this.toast(res.message || "انجام شد");
            if (type === 'delete_room') {
                const name = this.state.activeRoom.name;
                this.state.rooms = this.state.rooms.filter(r => r.name !== name);
                localStorage.setItem(this.getLsKey('rooms'), JSON.stringify(this.state.rooms));
                this.renderRoomList();
                this.leaveRoom();
                this.modal(null);
            } else if (type === 'nuke') {
                this.state.messages.length = 0;
                this.state.oldestLoadedId = null;
                document.getElementById('messages-container').innerHTML = `<button class="load-more-btn hidden" id="btn-load-more"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> بارگذاری پیام‌های قدیمی</button><div class="encryption-notice"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>رمزنگاری سرتاسری. سرور نمی‌تواند پیام‌های شما را بخواند.</span></div>`;
                document.getElementById('btn-load-more').onclick = () => this.loadHistory();
                if(this.state.pinnedId) { this.state.pinnedId = null; document.getElementById('pinned-msg-bar').classList.add('hidden'); }
                this.fetchMessages(); this.modal(null);
            } else if (type === 'toggle_lock') {
                $('#chk-admin-lock').checked = (value == 1);
            } else if (type === 'update_expiry') {
                this.state.activeRoom.expiry = parseInt(value);
                this.updateRoomHeader(); 
                this.checkExpiry();
            } else if (type === 'pin_message') {
                this.fetchMessages(); 
            } else if (type === 'add_owner' || type === 'remove_owner') {
                this.renderAdminPanel();
            }
        } else {
            this.toast(res.message || "عملیات ناموفق", true);
            if (type === 'toggle_lock') $('#chk-admin-lock').checked = !value;
        }
    },

    async renderAdminPanel() {
        if (!this.state.activeRoom.isOwner) return;
        const searchInput = $('#admin-user-search');
        if (this.state.activeRoom.isCreator) searchInput.parentElement.classList.remove('hidden');
        else searchInput.parentElement.classList.add('hidden');

        const list = $('#admin-list');
        list.innerHTML = '<div style="color:#aaa;font-size:0.8rem;">در حال بارگذاری...</div>';
        
        const res = await window.API.post('admin_action', { room_id: this.state.activeRoom.id, type: 'get_owners' });
        list.innerHTML = '';
        if (res.status === 'success') {
            res.owners.forEach(u => {
                const div = document.createElement('div');
                div.className = 'admin-tag';
                let btnHtml = '';
                if (this.state.activeRoom.isCreator && !u.is_creator) btnHtml = `<button class="rm-admin-btn" title="حذف مدیر">&times;</button>`;
                div.innerHTML = `<span class="admin-name">${this.escapeHtml(u.username)}</span>${u.is_creator ? '<span class="tag-creator">سازنده</span>' : btnHtml}`;
                if (this.state.activeRoom.isCreator && !u.is_creator) {
                    div.querySelector('.rm-admin-btn').onclick = () => { if(confirm(`دسترسی مدیریت ${u.username} را لغو می‌کنید؟`)) this.adminAction('remove_owner', u.username); };
                }
                list.appendChild(div);
            });
        }
    },

    async searchUsers(query) {
        if (!this.state.activeRoom.isCreator) return;
        const results = $('#admin-search-results');
        if (query.length < 2) { results.classList.add('hidden'); return; }
        const res = await window.API.post('search_users', { query });
        results.innerHTML = '';
        if (res.status === 'success' && res.users.length > 0) {
            results.classList.remove('hidden');
            res.users.forEach(u => {
                const div = document.createElement('div'); div.className = 'search-result-item'; div.innerText = u;
                div.onclick = () => { $('#admin-user-search').value = ''; results.classList.add('hidden'); if(confirm(`کاربر ${u} را مدیر می‌کنید؟`)) this.adminAction('add_owner', u); };
                results.appendChild(div);
            });
        } else results.classList.add('hidden');
    },

    async handleSendClick() {
        if (this.state.editMsgId) this.submitEdit();
        else if (this.state.pendingAttachments.length > 0) this.sendPendingAttachment();
        else this.sendMessage();
    },

    async sendMessage(type = 'text', content = null, fileIds = null) {
        if (this.state.isSending) return;
        
        if (this.state.isOffline) {
            this.toast("اتصال اینترنت برقرار نیست", true);
            return;
        }
        
        if (!content) { content = $('#msg-input').value.trim(); if (!content && !fileIds) return; }
        if (!content && type === 'text') return;

        this.state.isSending = true;
        const sendBtn = $('#btn-send');
        if (sendBtn) sendBtn.style.opacity = '0.5';

        try {
            const msgKey = await window.CryptoUtils.generateMessageKey();
            let payload = (type === 'text') ? window.enc.encode(content) : content;
            
            const encContent = await window.CryptoUtils.encryptContent(payload, msgKey);
            const encKey = await window.CryptoUtils.encryptMessageKey(msgKey, this.state.activeRoom.key);

            const packet = { msgType: type, contentIV: encContent.iv, contentData: encContent.data, keyIV: encKey.iv, keyData: encKey.data };
            const replyId = this.state.replyTo ? this.state.replyTo.id : null;
            
            const nonce = window.CryptoUtils.generateSalt();

            const data = { 
                room_id: this.state.activeRoom.id, 
                username: this.state.activeRoom.username, 
                type: type, 
                encrypted_data: JSON.stringify(packet), 
                reply_to: replyId, 
                file_ids: fileIds,
                nonce: nonce 
            };
            
            const res = await window.API.post('send_message', data);

            if (res.status === 'success') {
                if (!res.duplicate) {
                    $('#msg-input').value = ''; this.adjustInputHeight();
                    if(this.checkInputDirection) this.checkInputDirection();
                    this.setReply(null); 
                }
                this.state.pollDelay = 2500;
                await this.fetchMessages(false, false, true);
            } else {
                this.toast(res.message || 'ارسال ناموفق', true);
            }
        } catch (err) {
            console.error(err);
            this.toast("خطای شبکه/رمزنگاری", true);
        } finally {
            this.state.isSending = false;
            if (sendBtn) sendBtn.style.opacity = '1';
        }
    },

    async submitEdit() {
        const msgId = this.state.editMsgId;
        const newText = $('#msg-input').value.trim();
        if(!newText) return;

        const msgKey = await window.CryptoUtils.generateMessageKey();
        const encContent = await window.CryptoUtils.encryptContent(window.enc.encode(newText), msgKey);
        const encKey = await window.CryptoUtils.encryptMessageKey(msgKey, this.state.activeRoom.key);
        
        const packet = { msgType: 'text', contentIV: encContent.iv, contentData: encContent.data, keyIV: encKey.iv, keyData: encKey.data };
        const payload = { msg_id: msgId, username: this.state.activeRoom.username, encrypted_data: JSON.stringify(packet) };
        const res = await window.API.post('edit_message', payload);

        if (res.status === 'success') {
            const localMsg = this.state.messages.find(m => m.id === msgId);
            if(localMsg) {
                localMsg.decrypted = newText; localMsg.is_edited = 1;
                const el = document.getElementById(`msg-${msgId}`);
                if(el) {
                    const contentEl = el.querySelector('.msg-content');
                    if (contentEl) { contentEl.innerText = newText; if (this.detectRTL(newText)) el.classList.add('rtl'); else el.classList.remove('rtl'); }
                    if(!el.querySelector('.msg-edited-tag')) {
                        const timeEl = el.querySelector('.msg-time');
                        if (timeEl) { const tag = document.createElement('span'); tag.className = 'msg-edited-tag'; tag.innerText = '(ویرایش شده)'; timeEl.parentNode.insertBefore(tag, timeEl); }
                    }
                }
            }
            this.cancelEdit(); this.fetchMessages();
        } else this.toast(res.message || "ویرایش ناموفق", true);
    },

    startEdit(msgId) {
        const msg = this.state.messages.find(m => m.id === msgId);
        if (!msg) return;

        this.state.editMsgId = msgId;
        this.state.replyTo = null; 
        $('#reply-preview').classList.add('hidden');
        
        const input = $('#msg-input');
        input.value = msg.decrypted; 
        input.focus();
        
        if(this.checkInputDirection) this.checkInputDirection();
        $('.chat-input-area').classList.add('editing');
        $('#reply-preview').classList.remove('hidden');
        $('#reply-user').innerText = "ویرایش پیام"; $('#reply-text').innerText = "برای لغو Esc را بزنید";
        this.adjustInputHeight();
    },

    cancelEdit() {
        this.state.editMsgId = null;
        $('#msg-input').value = ''; this.adjustInputHeight();
        if(this.checkInputDirection) this.checkInputDirection();
        $('.chat-input-area').classList.remove('editing');
        $('#reply-preview').classList.add('hidden');
    },

    async deleteMessage(msgId) {
        if(!confirm("این پیام حذف شود؟")) return;
        const res = await window.API.post('delete_message', { msg_id: msgId, username: this.state.activeRoom.username });
        if(res.status === 'success') {
            this.removeMessageFromDom(msgId);
            const filtered = this.state.messages.filter(m => m.id !== msgId);
            this.state.messages.length = 0;
            filtered.forEach(m => this.state.messages.push(m));
            
            if(this.state.pinnedId === msgId) this.fetchMessages();
        } else this.toast(res.message || "حذف ناموفق", true);
    },

    startPolling() {
        if (this.state.pollTimeout) clearTimeout(this.state.pollTimeout);
        this.state.pollDelay = 2500;

        if (this.state.activeRoom) {
            this.fetchMessages(false, true); 
        }
        
        this.pollLoop();
    },

    async pollLoop() {
        if (!this.state.currentUser) return;
        
        if (this.state.isOffline) {
            this.state.pollTimeout = setTimeout(() => this.pollLoop(), 5000);
            return;
        }

        // SAFETY: Recover from stuck voice UI (e.g., recording stopped but UI remains)
        if (this.state.isRecording === false && !this.state.recBlob && !$('#voice-ui').classList.contains('hidden')) {
            this.cancelRecord();
        }

        try {
            if (this.state.activeRoom) {
                await this.fetchMessages(true);
            }

            if (this.state.currentUser) {
                await this.fetchRoomUsers();
            }

            const bgSessions = Object.values(this.state.sessions).filter(s => 
                !this.state.activeRoom || s.id !== this.state.activeRoom.id
            );

            if (bgSessions.length > 0) {
                await this.checkBackgroundNotifications(bgSessions);
            }

            this.state.pollDelay = 2500;
        } catch (e) {
            console.warn("Polling failed, backing off", e);
            this.state.pollDelay = Math.min(this.state.pollDelay * 1.5, 30000);
        }

        if (this.state.currentUser) {
            this.state.pollTimeout = setTimeout(() => this.pollLoop(), this.state.pollDelay);
        }
    },

    async checkBackgroundNotifications(sessions) {
        for (const session of sessions) {
            try {
                const lastTime = session.lastEventTime || 0;
                
                const res = await window.API.post('get_messages', { 
                    room_id: session.id, 
                    limit: 10,
                    after_id: null 
                });

                if (res.status === 'success' && res.messages.length > 0) {
                     const newMsgs = [];
                     const newReactions = [];
                     
                     let maxTime = lastTime;

                     for (const msg of res.messages) {
                         if (msg.created_at > lastTime) {
                             if (msg.created_at > maxTime) maxTime = msg.created_at;
                             
                             try {
                                 await this.decryptMessageData(msg, session.key);
                                 newMsgs.push(msg);
                                 
                                 if (!session.messages) session.messages = [];
                                 
                                 if (!session.messages.some(m => m.id === msg.id)) {
                                     session.messages.push(msg);
                                 }
                             } catch(e) { console.error("BG Decrypt error", e); }
                         }
                         
                         if (msg.reactions) {
                             msg.reactions.forEach(r => {
                                 if (r.created_at > lastTime) {
                                     if (r.created_at > maxTime) maxTime = r.created_at;
                                     newReactions.push({ msgId: msg.id, reaction: r });
                                 }
                             });
                             if (session.messages) {
                                 const memMsg = session.messages.find(m => m.id === msg.id);
                                 if (memMsg) memMsg.reactions = msg.reactions;
                             }
                         }
                     }
                     
                     if (session.messages) session.messages.sort((a,b) => a.created_at - b.created_at);
                     
                     session.lastEventTime = maxTime;

                     if (newMsgs.length > 0 || newReactions.length > 0) {
                         this.handleNewEvents(newMsgs, newReactions, session);
                     }
                }
            } catch (err) {
                // Ignore background errors
            }
        }
    },

    async fetchMessages(isPoll = false, isInitial = false, forceScrollAnimated = false) {
        if (!this.state.activeRoom) return;
        
        const res = await window.API.post('get_messages', { room_id: this.state.activeRoom.id, limit: 50 });
        
        if (res.status === 'success') {
            if (this.cleanupNotifications) this.cleanupNotifications(res.messages);

            if (res.room_expiry !== undefined) this.state.activeRoom.expiry = parseInt(res.room_expiry);
            if (this.state.activeRoom.isOwner) $('#chk-admin-lock').checked = (res.is_locked == 1);
            
            this.updateRoomHeader();
            
            let serverMsgs = res.messages;
            if (this.state.activeRoom.expiry > 0) {
                 const now = Date.now() / 1000;
                 const expirySeconds = this.state.activeRoom.expiry * 60;
                 serverMsgs = serverMsgs.filter(m => (now - m.created_at) <= expirySeconds || m.id === res.pinned_id);
            }

            if (isPoll || !this.state.loadingHistory) {
                const serverIds = new Set(serverMsgs.map(m => m.id));
                const limit = 50;
                const isHistoryComplete = serverMsgs.length < limit;
                let cutoffTime = 0;
                if (serverMsgs.length > 0) {
                    const nonPinned = serverMsgs.filter(m => m.id !== res.pinned_id);
                    if(nonPinned.length > 0) cutoffTime = nonPinned[nonPinned.length - 1].created_at;
                }

                const idsToDelete = [];
                this.state.messages.forEach(localMsg => {
                    if (localMsg.id === res.pinned_id) return;
                    if (isHistoryComplete) {
                        if (!serverIds.has(localMsg.id)) idsToDelete.push(localMsg.id);
                        return;
                    }
                    if (localMsg.created_at >= cutoffTime) {
                        if (!serverIds.has(localMsg.id)) idsToDelete.push(localMsg.id);
                    }
                });
                if (idsToDelete.length > 0) {
                    idsToDelete.forEach(id => this.removeMessageFromDom(id));
                    const kept = this.state.messages.filter(m => !idsToDelete.includes(m.id));
                    this.state.messages.length = 0;
                    kept.forEach(k => this.state.messages.push(k));
                }
            }

            this.state.pinnedId = res.pinned_id;
            const pinBar = $('#pinned-msg-bar');
            if (res.pinned_id && res.pinned_msg) {
                await this.processMessage(res.pinned_msg);
                const pinMsg = this.state.messages.find(m => m.id === res.pinned_id) || res.pinned_msg;
                pinBar.classList.remove('hidden');
                if (this.state.activeRoom.isOwner) $('#btn-unpin').classList.remove('hidden'); else $('#btn-unpin').classList.add('hidden');
                const pinContentArea = $('#pinned-content-area'); pinContentArea.innerHTML = ''; 
                
                let fileInfo = pinMsg.fileInfo;
                if (Array.isArray(fileInfo)) fileInfo = fileInfo[0];

                if (fileInfo) {
                    if (fileInfo.type.startsWith('image')) {
                        const span = document.createElement('span'); 
                        span.className = 'pinned-text-wrap'; 
                        span.innerText = "🖼️ تصویر: " + this.escapeHtml(fileInfo.name); 
                        pinContentArea.appendChild(span);
                    } else if (fileInfo.type.includes('audio')) pinContentArea.innerHTML = '<span class="pinned-text-wrap">🎵 صوت: ' + this.escapeHtml(fileInfo.name) + '</span>';
                    else if (fileInfo.type.includes('video')) pinContentArea.innerHTML = '<span class="pinned-text-wrap">📹 ویدیو: ' + this.escapeHtml(fileInfo.name) + '</span>';
                    else pinContentArea.innerHTML = '<span class="pinned-text-wrap">📄 فایل: ' + this.escapeHtml(fileInfo.name) + '</span>';
                } else {
                    const span = document.createElement('span'); span.className = 'pinned-text-wrap';
                    span.innerText = (pinMsg.decrypted || 'خطای رمزگشایی').replace(/\n/g, ' '); pinContentArea.appendChild(span);
                }
            } else pinBar.classList.add('hidden');

            if (serverMsgs.length >= 50) $('#btn-load-more').classList.remove('hidden');
            else if (!this.state.oldestLoadedId) $('#btn-load-more').classList.add('hidden');

            for (const m of serverMsgs) await this.processMessage(m);

            if (this.state.messages.length > 0) {
                const timeSorted = [...this.state.messages].sort((a,b) => a.created_at - b.created_at);
                this.state.oldestLoadedId = timeSorted[0].id;
            }

            this.refreshDOM(serverMsgs, false, isInitial, forceScrollAnimated);
            
            if (isPoll) {
                const lastTime = this.state.activeRoom.lastEventTime || 0;
                
                const newMsgs = serverMsgs.filter(m => m.created_at > lastTime);
                const newReactions = [];
                serverMsgs.forEach(m => {
                    if (m.reactions && m.reactions.length > 0) {
                        m.reactions.forEach(r => {
                            if (r.created_at > lastTime) newReactions.push({ msgId: m.id, reaction: r });
                        });
                    }
                });

                if (newMsgs.length > 0 || newReactions.length > 0) {
                    this.handleNewEvents(newMsgs, newReactions, this.state.activeRoom);
                    this.state.activeRoom.lastEventTime = Date.now() / 1000;
                }
            }

            this.checkExpiry(); 
            this.checkScrollPosition();
        } else if (res.status === 'error') {
            if (res.message === 'نیاز به احراز هویت' || res.message === 'نشست نامعتبر') {
                this.handleLogout(true);
                return;
            }
            throw new Error(res.message);
        }
    },

    async processMessage(msg) {
        if (msg.type === 'system') {
             try {
                 const sysData = JSON.parse(msg.encrypted_data);
                 msg.decrypted = (sysData.event === 'join') ? `${sysData.username} وارد شد` : `${sysData.username} خارج شد`;
                 msg.is_system = true;
             } catch(e) { msg.decrypted = "System Event"; }
             
             if (!this.state.messages.find(m => m.id === msg.id)) {
                 this.state.messages.push(msg);
                 this.state.messages.sort((a,b) => a.created_at - b.created_at);
             }
             return;
        }

        const existing = this.state.messages.find(m => m.id === msg.id);
        if (existing) {
            existing.reactions = msg.reactions;
            if (existing.sender_avatar !== msg.sender_avatar) {
                existing.sender_avatar = msg.sender_avatar;
                const el = document.getElementById('msg-row-' + existing.id);
                if (el) {
                     const header = el.querySelector('.msg-header');
                     if (header) {
                         let img = header.querySelector('.msg-avatar-small');
                         if (msg.sender_avatar) {
                             if (img) img.src = 'uploads/' + msg.sender_avatar;
                             else {
                                 img = document.createElement('img');
                                 img.className = 'msg-avatar-small';
                                 img.src = 'uploads/' + msg.sender_avatar;
                                 header.prepend(img);
                             }
                         } else {
                             if (img) img.remove();
                         }
                     }
                }
            }

            if (existing.sender_display_name !== msg.sender_display_name) {
                existing.sender_display_name = msg.sender_display_name;
                const el = document.getElementById('msg-row-' + existing.id);
                if (el) {
                    const nameEl = el.querySelector('.sender-name');
                    if (nameEl) nameEl.textContent = msg.sender_display_name || msg.username;
                }
            }

            if (msg.is_edited && existing.encrypted_data !== msg.encrypted_data) {
                 try {
                    const envelope = JSON.parse(msg.encrypted_data);
                    const buf = await window.CryptoUtils.decryptEnvelope(envelope, this.state.activeRoom.key);
                    existing.decrypted = window.dec.decode(buf);
                    existing.encrypted_data = msg.encrypted_data; existing.is_edited = 1;
                 } catch(e) {}
            }
            return;
        }

        try {
            await this.decryptMessageData(msg, this.state.activeRoom.key);
            this.state.messages.push(msg);
            this.state.messages.sort((a,b) => a.created_at - b.created_at);
        } catch (e) { console.error("Decryption fail for msg", msg.id, e); }
    },

    async decryptMessageData(msg, key) {
        const envelope = JSON.parse(msg.encrypted_data);
        const decryptedBuf = await window.CryptoUtils.decryptEnvelope(envelope, key);
        const decryptedStr = window.dec.decode(decryptedBuf); 
        
        if (msg.type === 'file_link' || msg.type === 'image' || (decryptedStr.startsWith('[') && decryptedStr.includes('keyIV')) || (decryptedStr.startsWith('{') && decryptedStr.includes('keyIV'))) {
            try {
                const rawData = JSON.parse(decryptedStr);
                const fileList = Array.isArray(rawData) ? rawData : [rawData];
                const processedFiles = [];
                let caption = "";

                for (const fileItem of fileList) {
                    const fileMsgKeyRaw = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: window.CryptoUtils.hex2buf(fileItem.keyIV) }, key, window.CryptoUtils.base642buf(fileItem.keyData));
                    const fileMsgKey = await window.crypto.subtle.importKey("raw", fileMsgKeyRaw, { name: "AES-GCM" }, true, ["decrypt"]);
                    const metaBuf = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: window.CryptoUtils.hex2buf(fileItem.metaIV) }, fileMsgKey, window.CryptoUtils.base642buf(fileItem.metaData));
                    const meta = JSON.parse(window.dec.decode(metaBuf));
                    
                    const processedItem = { ...fileItem, ...meta, msgKey: fileMsgKey };
                    processedFiles.push(processedItem);

                    if (fileItem.captionIV && fileItem.captionData && !caption) {
                        try {
                            const captionBuf = await window.crypto.subtle.decrypt(
                                { name: "AES-GCM", iv: window.CryptoUtils.hex2buf(fileItem.captionIV) }, 
                                fileMsgKey, 
                                window.CryptoUtils.base642buf(fileItem.captionData)
                            );
                            caption = window.dec.decode(captionBuf);
                        } catch(ce) { console.warn("Caption decrypt failed", ce); }
                    }
                }

                msg.fileInfo = processedFiles;
                msg.decrypted = caption;
            } catch(e) { console.error("Batch decrypt error", e); msg.decrypted = decryptedStr; }
        } else {
            msg.decrypted = decryptedStr;
        }
    },
    
    async sendPendingAttachment() {
        if (this.state.isOffline) return this.toast("اتصال اینترنت برقرار نیست", true);

        const files = this.state.pendingAttachments;
        if (files.length === 0) return;

        const caption = $('#msg-input').value.trim();
        const totalFiles = files.length;
        this.toggleGlobalLoader(true, `آماده‌سازی ${totalFiles} فایل...`, 0);
        
        const filePackets = [];
        const uploadedIds = [];
        
        try {
            for (let i = 0; i < totalFiles; i++) {
                const { file, type } = files[i];
                const progressBase = (i / totalFiles) * 100;
                
                this.toggleGlobalLoader(true, `رمزنگاری فایل ${i+1} از ${totalFiles}...`, progressBase);

                const buffer = await file.arrayBuffer();
                const msgKey = await window.CryptoUtils.generateMessageKey();
                const encFile = await window.CryptoUtils.encryptBuffer(buffer, msgKey); 
                const encryptedBlob = new Blob([encFile.data], { type: 'application/octet-stream' });
                
                const meta = JSON.stringify({ name: file.name, type: file.type || 'application/octet-stream', size: file.size });
                const encMeta = await window.CryptoUtils.encryptContent(window.enc.encode(meta), msgKey);
                
                let encCaption = null;
                if (caption && i === 0) {
                    encCaption = await window.CryptoUtils.encryptContent(window.enc.encode(caption), msgKey);
                }

                const encKey = await window.CryptoUtils.encryptMessageKey(msgKey, this.state.activeRoom.key);

                this.toggleGlobalLoader(true, `آپلود فایل ${i+1} از ${totalFiles}...`, progressBase + 5);
                
                const uploadPayload = {
                    room_id: this.state.activeRoom.id,
                    encrypted_name: JSON.stringify({ metaIV: encMeta.iv, metaData: encMeta.data }),
                    file: encryptedBlob
                };
                
                const upRes = await window.API.uploadFile('upload_file', uploadPayload, (percent) => {
                    const stepPercent = percent * (1 / totalFiles);
                    const totalPercent = progressBase + stepPercent;
                    this.toggleGlobalLoader(true, `آپلود فایل ${i+1}...`, Math.round(totalPercent));
                });

                if (upRes.status !== 'success') throw new Error(`خطا در آپلود فایل ${file.name}`);
                
                uploadedIds.push(upRes.file_id);
                filePackets.push({ 
                    msgType: type, 
                    url: upRes.file_url, 
                    keyIV: encKey.iv, 
                    keyData: encKey.data, 
                    metaIV: encMeta.iv, 
                    metaData: encMeta.data, 
                    fileIV: encFile.iv,
                    captionIV: encCaption ? encCaption.iv : null,
                    captionData: encCaption ? encCaption.data : null
                });
            }

            await this.sendMessage('file_link', JSON.stringify(filePackets), uploadedIds);

            this.toast('ارسال شد!'); 
            this.clearAttachment();
            $('#msg-input').value = ''; this.adjustInputHeight();
            if(this.checkInputDirection) this.checkInputDirection();

        } catch(e) { console.error(e); this.toast(e.message || "خطا در ارسال فایل‌ها", true); }
        
        this.toggleGlobalLoader(false);
    }
});
