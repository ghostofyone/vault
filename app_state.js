// app_state.js (updated)
/**
 * app_state.js - Core State & Authentication
 */

window.App = {
    state: {
        currentUser: null,
        displayName: null, 
        avatar: null, 
        rooms: [], 
        sessions: {}, // Stores full session objects (key, messages, etc) for entered rooms
        activeRoom: null, 
        messages: [], // Reference to activeRoom.messages
        notifications: [], 
        sidebarTab: 'rooms', 
        sidebarSearch: '', 
        activeRoomUsers: [], 
        hasFetchedUsers: false,
        replyTo: null,
        pendingAttachments: [], 
        editMsgId: null,
        isSending: false, 
        isRecording: false,
        mediaRecorder: null,
        recChunks: [],
        recTimer: null,
        recTime: 0,
        recBlob: null,
        
        // Polling & Network Logic
        pollTimeout: null, 
        pollDelay: 2500,   
        isOffline: !navigator.onLine,
        
        expiryInterval: null,
        oldestLoadedId: null,
        pinnedId: null,
        isBusy: false,
        mediaCache: {},
        memoryKeys: {}, 
        pendingScrollMsgId: null,
        notifPrefs: {
            master: true, 
            msg: true,
            reply: true,
            react: true,
            join: true
        }
    },

    getLsKey(key) {
        if (!this.state.currentUser) return 'vault_guest_' + key;
        return `vault_${this.state.currentUser}_${key}`;
    },

    async init() {
        this.initNetworkListeners();
        this.bindEvents();
        this.toggleGlobalLoader(true, "در حال احراز هویت...");
        
        const auth = await window.API.post('check_auth', {});
        this.toggleGlobalLoader(false);

        if (auth.status === 'success') {
            this.state.currentUser = auth.username;
            this.state.displayName = auth.display_name;
            this.state.avatar = auth.avatar;
            this.onAuthenticated();
        } else {
            this.handleLogout(true); // silent
        }

        window.addEventListener('beforeunload', () => {
            // Only clear volatile memory state
            this.state.memoryKeys = {};
            this.state.sessions = {};
            this.state.activeRoom = null;
        });
    },

    initNetworkListeners() {
        window.addEventListener('offline', () => {
            this.state.isOffline = true;
            this.updateRoomHeader(); 
            this.toast("اتصال اینترنت قطع شد", true);
            document.body.classList.add('app-offline');
        });

        window.addEventListener('online', () => {
            this.state.isOffline = false;
            this.updateRoomHeader();
            this.toast("اتصال برقرار شد", false);
            document.body.classList.remove('app-offline');
            
            if (this.state.activeRoom) {
                this.state.pollDelay = 2500;
                if(this.state.pollTimeout) clearTimeout(this.state.pollTimeout);
                this.fetchMessages(true); 
            }
        });
    },

    async onAuthenticated() {
        this.updateProfileUI();
        await this.syncRooms(); 
        this.populateEmojiPicker();
        
        const savedPrefs = JSON.parse(localStorage.getItem(this.getLsKey('notif_prefs')));
        if (savedPrefs) this.state.notifPrefs = { ...this.state.notifPrefs, ...savedPrefs };
        
        document.getElementById('chk-os-notif').checked = this.state.notifPrefs.master;
        
        if (this.state.expiryInterval) clearInterval(this.state.expiryInterval);
        this.state.expiryInterval = setInterval(() => this.checkExpiry(), 2000);
        
        // Auto‑rejoin the room the user was in before the refresh
        await this.autoJoinLastRoom();
        
        if (this.startPolling) this.startPolling();
        if (this.fetchRoomUsers) this.fetchRoomUsers();
    },

    async autoJoinLastRoom() {
        const lastRoomName = localStorage.getItem(this.getLsKey('last_active_room'));
        if (!lastRoomName) return;

        let password = this.state.memoryKeys[lastRoomName];
        if (!password) {
            password = localStorage.getItem(this.getLsKey('rkey_' + lastRoomName));
            if (password) {
                this.state.memoryKeys[lastRoomName] = password; // restore to memory
            }
        }

        if (!password) {
            localStorage.removeItem(this.getLsKey('last_active_room'));
            return;
        }

        const room = this.state.rooms.find(r => r.name === lastRoomName);
        if (!room) {
            localStorage.removeItem(this.getLsKey('last_active_room'));
            return;
        }

        this._suppressTransition = true;
        try {
            await this.joinRoom(lastRoomName, password);
        } catch (e) {
            console.error('Auto‑join failed', e);
            localStorage.removeItem(this.getLsKey('last_active_room'));
        } finally {
            setTimeout(() => {
                this._suppressTransition = false;
            }, 200);
        }
    },

    updateProfileUI() {
        const btnIcon = $('#sidebar-my-icon');
        const btnImg = $('#sidebar-my-avatar');
        if (this.state.avatar) {
            btnImg.src = 'uploads/' + this.state.avatar;
            btnImg.classList.remove('hidden');
            btnIcon.classList.add('hidden');
        } else {
            btnImg.classList.add('hidden');
            btnIcon.classList.remove('hidden');
        }

        const modalImg = $('#profile-avatar-img');
        const modalPlaceholder = $('#profile-avatar-placeholder');
        const removeBtn = $('#btn-remove-avatar');

        if (this.state.avatar) {
            modalImg.src = 'uploads/' + this.state.avatar;
            modalImg.classList.remove('hidden');
            modalPlaceholder.classList.add('hidden');
            if(removeBtn) removeBtn.classList.remove('hidden');
        } else {
            modalImg.classList.add('hidden');
            modalPlaceholder.classList.remove('hidden');
            const name = this.state.displayName || this.state.currentUser || "?";
            modalPlaceholder.innerText = name.charAt(0).toUpperCase();
            if(removeBtn) removeBtn.classList.add('hidden');
        }
    },

    async handleLogin() {
        const u = document.getElementById('login-user').value;
        const p = document.getElementById('login-pass').value;
        
        this.setBusy(true, "در حال بررسی...");
        
        const res = await window.API.post('login', { username: u, password: p });
        this.setBusy(false);
        
        if (res.status === 'success') {
            this.state.currentUser = res.username;
            this.state.displayName = res.display_name;
            this.state.avatar = res.avatar;
            this.modal(null);
            this.onAuthenticated();
            this.toast("خوش آمدید " + (res.display_name || res.username));
            document.getElementById('login-pass').value = '';
        } else {
            this.toast(res.message || "ورود ناموفق", true);
        }
    },

    async handleRegister() {
        const u = document.getElementById('reg-user').value;
        const p = document.getElementById('reg-pass').value;
        const p2 = document.getElementById('reg-pass-confirm').value;

        if (p !== p2) {
            this.toast("رمز عبور و تکرار آن مطابقت ندارند", true);
            return;
        }

        this.setBusy(true, "ایجاد حساب...");
        
        const res = await window.API.post('register', { username: u, password: p });
        this.setBusy(false);
        
        if (res.status === 'success') {
             this.state.currentUser = res.username;
             this.state.displayName = null;
             this.state.avatar = null;
             this.modal(null);
             this.onAuthenticated();
             this.toast("حساب کاربری ایجاد شد!");
             document.getElementById('reg-pass').value = '';
             document.getElementById('reg-pass-confirm').value = '';
        } else {
            this.toast(res.message || "ثبت نام ناموفق", true);
        }
    },

    handleLogout(silent = false) {
        if (this.state.pollTimeout) {
            clearTimeout(this.state.pollTimeout);
            this.state.pollTimeout = null;
        }
        
        if (silent) {
            this.cleanupLocalSession();
            
            this.state.currentUser = null; 
            this.toggleGlobalLoader(false);
            this.modal('auth');
            this.toast("نشست شما منقضی شد. لطفاً مجدداً وارد شوید.", true);
        } else {
            $('#chk-logout-nuke').checked = false;
            this.modal('logout');
        }
    },

    async confirmLogout() {
        if ($('#chk-logout-nuke').checked) {
            if (confirm("آیا مطمئن هستید؟ این عمل غیرقابل بازگشت است و تمام پیام‌های شما در همه اتاق‌ها حذف خواهد شد.")) {
                this.toggleGlobalLoader(true, "حذف تاریخچه...");
                await window.API.post('delete_user_history', {}); // Global delete
                this.performLogout();
            }
        } else {
            this.performLogout();
        }
    },

    async performLogout() {
        try {
            await window.API.post('logout', {});
        } catch(e) { console.warn("Logout API failed", e); }
        
        this.cleanupLocalSession();
        this.toggleGlobalLoader(false);
        this.modal('auth');
    },

    cleanupLocalSession() {
        if (this.state.pollTimeout) clearTimeout(this.state.pollTimeout);
        this.state.pollTimeout = null;

        if (this.state.currentUser) {
            const prefix = `vault_${this.state.currentUser}_rkey_`;
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith(prefix)) localStorage.removeItem(k);
            });
            localStorage.removeItem(this.getLsKey('last_active_room'));
        }

        this.state.currentUser = null;
        this.state.displayName = null;
        this.state.avatar = null;

        this.leaveRoom(); 
        
        this.state.memoryKeys = {};
        this.state.sessions = {};
        this.state.activeRoom = null;
        this.state.messages = [];
        this.state.rooms = [];
        this.state.notifications = [];
        
        sessionStorage.clear();
        
        if (this.renderRoomList) this.renderRoomList();
    },
    
    async deleteRoomHistory() {
        if (!this.state.activeRoom) return;
        if (confirm("تمام پیام‌ها و فایل‌های ارسالی شما در این اتاق حذف خواهند شد. آیا مطمئن هستید؟")) {
            this.toggleGlobalLoader(true, "حذف پیام‌ها...");
            const res = await window.API.post('delete_user_history', { room_id: this.state.activeRoom.id });
            this.toggleGlobalLoader(false);
            if (res.status === 'success') {
                this.toast(res.message || "تاریخچه پاک شد");
                this.fetchMessages();
            } else {
                this.toast(res.message || "خطا در حذف", true);
            }
        }
    },

    saveNotifPrefs() {
        localStorage.setItem(this.getLsKey('notif_prefs'), JSON.stringify(this.state.notifPrefs));
    },

    async syncRooms() {
        if (!this.state.currentUser) {
            this.state.rooms = [];
            if(this.renderRoomList) this.renderRoomList();
            return;
        }

        if (this.state.isOffline) return; 

        try {
            const res = await window.API.post('get_joined_rooms', {});
            if (res.status === 'success') {
                const existingMap = new Map();
                this.state.rooms.forEach(r => existingMap.set(r.name, r.lastEventTime || (Date.now() / 1000)));

                this.state.rooms = res.rooms.map(serverRoom => {
                    if (!this.state.memoryKeys[serverRoom.name] && this.state.currentUser) {
                        const lsKey = this.getLsKey('rkey_' + serverRoom.name);
                        const storedPass = localStorage.getItem(lsKey);
                        if (storedPass) this.state.memoryKeys[serverRoom.name] = storedPass;
                    }

                    const ramKey = this.state.memoryKeys[serverRoom.name];
                    const inSession = !!this.state.sessions[serverRoom.id];
                    return {
                        name: serverRoom.name,
                        id: serverRoom.id,
                        keyStr: ramKey || null,
                        needsKey: !ramKey && !inSession,
                        lastEventTime: existingMap.get(serverRoom.name) || (Date.now() / 1000)
                    };
                });
            } else if (res.status === 'error' && (res.message === 'نیاز به احراز هویت' || res.message === 'نشست نامعتبر')) {
                 this.handleLogout(true);
            }
        } catch (e) {
            console.error("Sync failed", e);
        }
        this.renderRoomList();
    },

    saveKey(name, keyStr) {
        this.state.memoryKeys[name] = keyStr;
        if (this.state.currentUser) {
            localStorage.setItem(this.getLsKey('rkey_' + name), keyStr);
        }
        this.syncRooms(); 
    },

    removeKey(name) {
        delete this.state.memoryKeys[name];
        if (this.state.currentUser) {
            localStorage.removeItem(this.getLsKey('rkey_' + name));
        }
        this.syncRooms();
    },

    handleNewEvents(newMsgs, newReactions, roomObj) {
        const myName = this.state.currentUser; 
        const prefs = this.state.notifPrefs;
        let shouldTriggerBrowser = false;
        let lastBrowserTriggerMsg = "";
        let browserTriggerTitle = "فعالیت والت";
        let hasNewPanelItem = false;
        
        const roomName = roomObj.name;
        const roomId = roomObj.id;
        const roomKey = roomObj.key || roomObj.keyStr; 

        newMsgs.forEach(m => {
            if (m.username === myName) return; 

            let isReplyToMe = false;
            if (m.reply_to_id && roomObj.messages) {
                 isReplyToMe = roomObj.messages.some(orig => orig.id === m.reply_to_id && orig.username === myName);
            }

            const senderName = m.sender_display_name || m.username;

            if (m.type === 'system') {
                try {
                    const sysData = JSON.parse(m.encrypted_data);
                    if (sysData.event === 'join') {
                        if (prefs.join) {
                            this.addToNotificationPanel({
                                id: m.id, type: 'system',
                                title: `ورود کاربر`,
                                preview: `${sysData.username} وارد اتاق ${roomName} شد`,
                                time: m.created_at,
                                roomId: roomId,
                                roomName: roomName,
                                key: roomKey
                            });
                            hasNewPanelItem = true;

                            if (prefs.master) {
                                shouldTriggerBrowser = true;
                                lastBrowserTriggerMsg = `${sysData.username} وارد اتاق شد`;
                                browserTriggerTitle = `ورود کاربر (${roomName})`;
                            }
                        }
                    }
                } catch(e) {}
                return;
            }

            if (prefs.reply && isReplyToMe) {
                 let previewText = m.decrypted || "پیام رمزنگاری شده";
                 if(m.fileInfo) {
                     if(Array.isArray(m.fileInfo)) previewText = `[${m.fileInfo.length} فایل]`;
                     else previewText = `[فایل] ${m.fileInfo.name}`;
                 }
                 
                 this.addToNotificationPanel({
                    id: m.id, type: 'reply', 
                    title: `پاسخ از ${senderName}`,
                    preview: previewText,
                    time: m.created_at,
                    roomId: roomId,
                    roomName: roomName,
                    key: roomKey
                });
                hasNewPanelItem = true;
            } 
            else if (prefs.msg) {
                let previewText = m.decrypted || "پیام جدید";
                 if(m.fileInfo) {
                     if(Array.isArray(m.fileInfo)) previewText = `[${m.fileInfo.length} فایل]`;
                     else previewText = `[فایل] ${m.fileInfo.name}`;
                 }

                 this.addToNotificationPanel({
                    id: m.id, type: 'msg',
                    title: `${senderName}`,
                    preview: previewText,
                    time: m.created_at,
                    roomId: roomId,
                    roomName: roomName,
                    key: roomKey
                });
                hasNewPanelItem = true;
            }

            if (prefs.master) {
                if (prefs.msg || (isReplyToMe && prefs.reply)) {
                    shouldTriggerBrowser = true;
                    if(m.fileInfo) {
                        if(Array.isArray(m.fileInfo)) lastBrowserTriggerMsg = `[${m.fileInfo.length} فایل]`;
                        else lastBrowserTriggerMsg = `[فایل] ${m.fileInfo.name}`;
                    } else {
                        lastBrowserTriggerMsg = m.decrypted || "پیام جدید";
                    }
                    browserTriggerTitle = `${senderName} (${roomName})`;
                }
            }
        });

        newReactions.forEach(r => {
            if (r.reaction.username === myName) return; 

            if (prefs.react) {
                this.addToNotificationPanel({
                    id: r.msgId + '_react_' + r.reaction.username, type: 'react',
                    title: `${r.reaction.username} واکنش نشان داد ${r.reaction.reaction}`,
                    preview: "برای مشاهده کلیک کنید",
                    time: r.reaction.created_at,
                    roomId: roomId,
                    roomName: roomName,
                    key: roomKey
                });
                hasNewPanelItem = true;
            }

            if (prefs.master && prefs.react) {
                shouldTriggerBrowser = true;
                lastBrowserTriggerMsg = `${r.reaction.username} واکنش نشان داد ${r.reaction.reaction}`;
                browserTriggerTitle = `واکنش جدید (${roomName})`;
            }
        });

        if (hasNewPanelItem) this.renderNotificationPanel(true); 

        if (shouldTriggerBrowser && !document.hasFocus()) {
            this.sendOSNotification(browserTriggerTitle, lastBrowserTriggerMsg);
        }
    },

    cleanupNotifications(serverMessages) {
        if (!serverMessages || serverMessages.length === 0 || !this.state.activeRoom) return;
        
        const activeRoomId = this.state.activeRoom.id;

        const msgMap = new Map();
        serverMessages.forEach(m => msgMap.set(m.id, m));
        
        const oldestMsgTime = serverMessages[serverMessages.length - 1].created_at;
        const initialLength = this.state.notifications.length;
        
        this.state.notifications = this.state.notifications.filter(n => {
            if (n.roomId && n.roomId !== activeRoomId) return true;

            if (n.time < oldestMsgTime) return true;

            if (n.type === 'react') {
                const parts = n.id.split('_react_');
                if (parts.length < 2) return true; 
                const msgId = parts[0];
                const reactorUsername = parts[1];

                const msg = msgMap.get(msgId);
                if (msg) {
                    const hasReaction = msg.reactions && msg.reactions.some(r => r.username === reactorUsername);
                    return hasReaction;
                } else {
                    return false;
                }
            } else if (n.type === 'reply' || n.type === 'msg') {
                const msgId = n.id;
                if (msgMap.has(msgId)) return true;
                return false;
            }
            return true;
        });

        if (this.state.notifications.length !== initialLength) {
             this.renderNotificationPanel(false);
             const badge = document.getElementById('count-notifs');
             const currentBadge = parseInt(badge.innerText || '0');
             if (currentBadge > this.state.notifications.length) {
                 badge.innerText = this.state.notifications.length;
                 if (this.state.notifications.length === 0) badge.classList.add('hidden');
             }
        }
    },

    addToNotificationPanel(item) {
        if (this.state.notifications.some(n => n.id === item.id)) return;
        this.state.notifications.unshift(item);
        if (this.state.notifications.length > 50) {
            this.state.notifications = this.state.notifications.slice(0, 50);
        }
    },

    renderNotificationPanel(incrementBadge = false) {
        const list = $('#notif-list');
        if (!list) return;
        
        list.innerHTML = '';
        
        const badge = $('#count-notifs');
        
        if (this.state.notifications.length === 0) {
            list.innerHTML = '<div class="empty-state-sm">فعالیت جدیدی وجود ندارد</div>';
            if(badge) badge.classList.add('hidden');
            return;
        }

        if (incrementBadge && badge) {
            const current = parseInt(badge.innerText || '0');
            badge.innerText = current + 1;
            badge.classList.remove('hidden');
        } else if (badge) {
            badge.innerText = this.state.notifications.length;
            badge.classList.remove('hidden');
        }

        this.state.notifications.forEach(n => {
            const item = document.createElement('div');
            item.className = `notif-item unread`; 
            const timeStr = new Date(n.time * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) || '';
            let icon = '';
            if (n.type === 'reply') icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg>';
            else if (n.type === 'react') icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>';
            else icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

            item.innerHTML = `<div class="notif-icon">${icon}</div><div class="notif-content"><div class="notif-room">${this.escapeHtml(n.roomName)}</div><div class="notif-title">${n.title}</div><div class="notif-preview">${this.escapeHtml(n.preview)}</div><div class="notif-time">${timeStr}</div></div>`;
            
            item.onclick = async () => { 
                const realId = n.id.includes('_react_') ? n.id.split('_react_')[0] : n.id;
                
                if (!this.state.activeRoom || this.state.activeRoom.id !== n.roomId) {
                    if (this.state.sessions[n.roomId]) {
                        this.state.pendingScrollMsgId = realId;
                        this.switchRoom(n.roomId);
                    } else if (n.roomName && n.key) {
                        this.state.pendingScrollMsgId = realId; 
                        await this.joinRoom(n.roomName, n.key);
                    }
                } else {
                    $('#app').classList.add('mobile-chat-active');
                    this.scrollToMsg(realId, true);
                }
            };
            list.appendChild(item);
        });
    },

    markNotificationsRead() {
        const badge = $('#count-notifs');
        if(badge) {
            badge.innerText = '0';
            badge.classList.add('hidden');
        }
    },

    checkScrollPosition() {
        const c = $('#messages-container');
        const btn = $('#btn-scroll-bottom');
        if (c.scrollHeight - c.scrollTop - c.clientHeight > 150) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    },

    scrollToBottom(animate = true) {
        const c = $('#messages-container');
        c.scrollTo({ top: c.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
    },

    requestNotificationPermission() {
        if (!("Notification" in window)) return this.toast("مرورگر شما از اعلان‌ها پشتیبانی نمی‌کند", true);
        
        if (Notification.permission === 'default') {
            Promise.resolve(Notification.requestPermission()).then(permission => {
                if (permission === 'granted') {
                    this.toast("مجوز اعلان دریافت شد");
                    this.sendOSNotification("والت چت", "اعلان‌ها فعال شدند");
                } else {
                    this.toast("مجوز اعلان رد شد", true);
                    this.state.notifPrefs.master = false;
                    this.saveNotifPrefs();
                    const chk = document.getElementById('chk-os-notif');
                    if(chk) chk.checked = false;
                }
            });
        }
    },
    
    sendOSNotification(title, body) {
        if (!("Notification" in window)) return;
        
        if (this.state.notifPrefs.master && Notification.permission === "granted") {
            try {
                const options = {
                    body: body,
                    icon: 'favicon.ico', 
                    vibrate: [200, 100, 200],
                    tag: 'vault-chat-msg',
                    renotify: true
                };
                
                if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                    navigator.serviceWorker.ready.then(function(registration) {
                        registration.showNotification(title, options);
                    });
                } else {
                    const n = new Notification(title, options);
                    n.onclick = function() { 
                        window.focus(); 
                        if(window.App && window.App.scrollToBottom) window.App.scrollToBottom(false);
                        this.close();
                    };
                }
            } catch (e) {
                console.error("Notification trigger error", e);
            }
        }
    },

    modal(id) {
        $('#modal-overlay').classList.remove('active');
        $$('.modal-card').forEach(c => c.classList.add('hidden'));
        if (id) { $('#modal-overlay').classList.add('active'); $(`#modal-${id}`).classList.remove('hidden'); }
    },

    toggleGlobalLoader(show, text = "در حال کار...", percent = null) {
        const l = $('#global-loader');
        const progContainer = $('#progress-container');
        const progBar = $('#progress-bar');
        const progText = $('#progress-percent');
        if (show) {
            $('#loader-text').innerText = text;
            l.classList.remove('hidden');
            if (percent !== null) {
                progContainer.classList.remove('hidden');
                progText.classList.remove('hidden');
                progBar.style.width = percent + '%';
                progText.innerText = percent + '%';
            } else {
                progContainer.classList.add('hidden');
                progText.classList.add('hidden');
                progBar.style.width = '0%';
            }
            // SAFETY NET: auto-hide after 30 seconds if not hidden by then
            if (this._loaderSafetyTimer) clearTimeout(this._loaderSafetyTimer);
            this._loaderSafetyTimer = setTimeout(() => {
                if (!l.classList.contains('hidden')) {
                    console.warn('Global loader stuck – auto‑hiding');
                    l.classList.add('hidden');
                    progContainer.classList.add('hidden');
                    progText.classList.add('hidden');
                }
            }, 30000);
        } else {
            l.classList.add('hidden');
            progContainer.classList.add('hidden');
            progText.classList.add('hidden');
            if (this._loaderSafetyTimer) {
                clearTimeout(this._loaderSafetyTimer);
                this._loaderSafetyTimer = null;
            }
        }
    },

    setBusy(busy, msg) {
        this.state.isBusy = busy;
        if(busy && msg) {
            this.toast(msg, false, true); 
        } else if (!busy) {
            const t = $('#toast');
            if (t.classList.contains('show') && t.dataset.type === 'process') {
                t.classList.remove('show');
            }
        }
    },

    toastTimeout: null, 

    toast(msg, err = false, isProcess = false) {
        const t = $('#toast');
        t.innerText = msg;
        t.style.borderRightColor = err ? '#ff4444' : '#00d369';
        t.dataset.type = isProcess ? 'process' : 'info';
        
        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        
        t.classList.add('show');
        
        if (!isProcess) {
            this.toastTimeout = setTimeout(() => {
                t.classList.remove('show');
            }, 6000);
        }
    },

    populateEmojiPicker() {
        const p = $('#full-emoji-picker');
        p.innerHTML = '';
        for (const [cat, emojis] of Object.entries(window.EMOJI_LIST)) {
            const h = document.createElement('div'); h.className = 'emoji-category'; h.innerText = cat; p.appendChild(h);
            emojis.forEach(e => {
                const s = document.createElement('span'); s.innerText = e;
                s.onclick = () => { const input = $('#msg-input'); input.value += e; this.adjustInputHeight(); this.checkInputDirection(); input.focus(); p.classList.add('hidden'); };
                p.appendChild(s);
            });
        }
    },

    adjustInputHeight() {
        const input = $('#msg-input');
        input.style.height = 'auto';
        input.style.height = (input.scrollHeight) + 'px';
    },

    checkInputDirection() {
        const input = $('#msg-input');
        if (!input) return;
        const rtlRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
        if (!input.value || rtlRegex.test(input.value)) { input.style.direction = 'rtl'; input.style.textAlign = 'right'; } 
        else { input.style.direction = 'ltr'; input.style.textAlign = 'left'; }
    },

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
