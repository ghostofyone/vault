// app_rooms.js (updated)
/**
 * app_rooms.js - Room Management Logic
 */

Object.assign(window.App, {
    async createRoom() {
        if(this.state.isBusy) return;
        this.setBusy(true, "در حال ایجاد...");
        this.toggleGlobalLoader(true, "ایجاد اتاق...");
        
        const name = $('#create-name').value;
        const pass = $('#create-key').value;
        const expiry = $('#create-expiry').value;
        const salt = window.CryptoUtils.generateSalt();

        try {
            const key = await window.CryptoUtils.deriveRoomKey(pass, salt);
            const verifierBlob = await window.CryptoUtils.encryptContent("VAULT-ACCESS-OK", key);
            const verifierStr = JSON.stringify(verifierBlob);

            const res = await window.API.post('create_room', { name, salt, verifier: verifierStr, expiry });
            this.setBusy(false);

            if (res.status === 'success') {
                this.saveKey(name, pass);
                // SECURITY: Clear inputs immediately
                $('#create-name').value = '';
                $('#create-key').value = '';
                setTimeout(() => { this.joinRoom(name, pass); this.modal(null); }, 600);
            } else {
                this.toggleGlobalLoader(false);
                this.toast(res.message || "خطا در ایجاد", true);
            }
        } catch (e) {
             console.error(e);
             this.toggleGlobalLoader(false);
             this.toast("خطای رمزنگاری", true);
        }
    },

    async handleJoinSubmit() {
        if(this.state.isBusy) return;
        const name = $('#join-name').value;
        const pass = $('#join-key').value;
        this.joinRoom(name, pass);
    },

    async joinRoom(name, pass) {
        if(this.state.isBusy) return;
        this.setBusy(true, "در حال پیوستن...");
        this.toggleGlobalLoader(true, "ورود به والت...");

        let res = await window.API.post('join_room', { name });

        if (res.status !== 'success') {
             this.setBusy(false);
             this.toggleGlobalLoader(false);
             return this.toast(res.message || "اتصال ناموفق", true);
        }

        try {
            const key = await window.CryptoUtils.deriveRoomKey(pass, res.salt);
            
            if (res.verifier) {
                try {
                    const vObj = JSON.parse(res.verifier);
                    const checkStr = await window.CryptoUtils.decryptSimple(vObj, key);
                    if (checkStr !== "VAULT-ACCESS-OK") throw new Error("Verification Failed");
                } catch (verifyErr) {
                     this.setBusy(false);
                     this.toggleGlobalLoader(false);
                     $('#join-key').value = '';
                     $('#join-key').focus();
                     return this.toast("رمز عبور اشتباه است. دسترسی غیرمجاز.", true);
                }
            }
            
            // SECURITY: Save key to memory AND local storage (via updated saveKey in app_state.js)
            this.saveKey(name, pass);
            // SECURITY: Clear inputs immediately
            $('#join-name').value = '';
            $('#join-key').value = '';
            
            this.modal(null);

            const session = { 
                id: res.room_id, 
                name, 
                key, 
                username: res.username, 
                expiry: parseInt(res.expiry), 
                isOwner: res.is_owner, 
                isCreator: res.is_creator,
                messages: [], // Initialize memory
                lastEventTime: Date.now()/1000
            };
            
            this.state.sessions[res.room_id] = session;
            
            // Switch to it – wrapped in try-catch so loader is always hidden
            try {
                await this.switchRoom(res.room_id);
            } catch (e) {
                console.error("switchRoom failed in joinRoom", e);
                this.toast("خطا در ورود به اتاق", true);
                this.setBusy(false);
                this.toggleGlobalLoader(false);
            }

        } catch (e) {
            console.error(e);
            this.toast("خطای کلید رمزنگاری", true);
            this.setBusy(false);
            this.toggleGlobalLoader(false);
        }
    },
    
    async switchRoom(roomId) {
        const session = this.state.sessions[roomId];
        if (!session) return;
        
        this.state.activeRoom = session;
        this.state.messages = session.messages; // Reference assignment
        
        // UI Updates
        $('#chat-placeholder').classList.add('hidden');
        $('#active-chat').classList.remove('hidden');

        // Handle CSS transition suppression for instant auto‑join
        const appEl = document.getElementById('app');
        if (this._suppressTransition) {
            const elements = [appEl, document.querySelector('.sidebar'), document.querySelector('.chat-interface')];
            elements.forEach(el => el && (el.style.transition = 'none'));
        }
        
        $('#app').classList.add('mobile-chat-active');

        if (this._suppressTransition) {
            void appEl.offsetWidth;
            setTimeout(() => {
                const elements = [appEl, document.querySelector('.sidebar'), document.querySelector('.chat-interface')];
                elements.forEach(el => el && (el.style.transition = ''));
            }, 50);
        }
        
        this.updateRoomHeader();
        
        if (session.isOwner) {
            $('#owner-badge').classList.remove('hidden');
            $('#btn-admin').classList.remove('hidden');
        } else {
            $('#owner-badge').classList.add('hidden');
            $('#btn-admin').classList.add('hidden');
        }
        
        // Reset view for new room
        this.state.oldestLoadedId = null;
        $('#messages-container').innerHTML = `
            <button class="load-more-btn hidden" id="btn-load-more">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> بارگذاری پیام‌های قدیمی
            </button>
            <div class="encryption-notice"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg><span>رمزنگاری سرتاسری. سرور نمی‌تواند پیام‌های شما را بخواند.</span></div>
        `;
        $('#btn-load-more').onclick = () => this.loadHistory();
        
        // Initial render from cache if available
        if (session.messages.length > 0) {
            this.refreshDOM(session.messages, false, true, true);
        }
        
        this.startPolling(); // Restart polling for new active room priority
        this.refreshNotifControls();
        this.renderRoomList(); // Update active state in sidebar
        this.fetchRoomUsers();
        
        this.setBusy(false);
        this.toggleGlobalLoader(false);

        // Wait for fetch to complete if needed
        try {
            await this.fetchMessages(false, true);
        } catch (e) {
            console.error("fetchMessages error in switchRoom", e);
        } finally {
            // Always persist last active room
            localStorage.setItem(this.getLsKey('last_active_room'), session.name);
        }
    },

    updateRoomHeader() {
        if (!this.state.activeRoom) return;
        const r = this.state.activeRoom;
        
        $('#header-room-name').textContent = r.name;
        
        let subText = "";
        
        // Network Status Check
        if (this.state.isOffline) {
             subText = '<span style="color:#ffaa00; font-weight:bold;">⚠️ در انتظار شبکه...</span>';
        } else {
             if (r.expiry > 0) {
                 let expTime = "";
                 if (r.expiry >= 1440) expTime = (r.expiry/1440).toFixed(0) + ' روز';
                 else if (r.expiry >= 60) expTime = (r.expiry/60).toFixed(1) + ' ساعت';
                 else expTime = r.expiry + ' دقیقه';
                 subText = `عمر پیام ها: ${expTime}`;
             } else {
                 subText = "عمر پیام ها: هرگز";
             }
        }
        $('#header-expiry').innerHTML = subText;
    },

    leaveRoom() {
        if (this.state.activeRoom) {
            // SECURITY: Wipe key from Memory AND LocalStorage
            const name = this.state.activeRoom.name;
            if (name) {
                this.removeKey(name); 
            }
            delete this.state.sessions[this.state.activeRoom.id];

            // Clear the stored last active room so it won't be restored on refresh
            localStorage.removeItem(this.getLsKey('last_active_room'));
        }
        
        this.state.activeRoom = null;
        this.state.activeRoomUsers = [];
        this.renderUserList(); 
        
        // Stop Polling Timeout
        if (this.state.pollTimeout) clearTimeout(this.state.pollTimeout);
        
        Object.values(this.state.mediaCache).forEach(url => URL.revokeObjectURL(url));
        this.state.mediaCache = {};
        $('#active-chat').classList.add('hidden');
        $('#chat-placeholder').classList.remove('hidden');
        $('#app').classList.remove('mobile-chat-active');
        
        // Sync to update UI (needsKey will become true)
        this.syncRooms();
    },

    async deleteRoomFromList(name) {
        if(!confirm(`آیا از اتاق "${name}" خارج می‌شوید؟ برای بازگشت به رمز عبور نیاز خواهید داشت.`)) return;
        
        const res = await window.API.post('leave_room', { name });
        if (res.status === 'success') {
            if (this.state.activeRoom && this.state.activeRoom.name === name) this.leaveRoom();
            this.removeKey(name); // Deletes from RAM and LocalStorage
            
            // Also remove session if exists by name lookup
            const sessionId = Object.keys(this.state.sessions).find(id => this.state.sessions[id].name === name);
            if (sessionId) delete this.state.sessions[sessionId];
            
        } else {
            this.toast(res.message || "خروج ناموفق بود", true);
        }
    },

    renderRoomList() {
        const cont = $('#rooms-list');
        const countSpan = $('#count-rooms');
        cont.innerHTML = '';
        
        const query = this.state.sidebarSearch;
        const filteredRooms = this.state.rooms.filter(r => r.name.toLowerCase().includes(query));
        
        countSpan.innerText = filteredRooms.length;

        if (filteredRooms.length === 0) {
            cont.innerHTML = `<div class="empty-state-fancy sidebar-empty-cta"><p class="empty-text">${query ? 'نتیجه‌ای یافت نشد' : 'عضو هیچ اتاقی نیستید.'}</p>${!query ? '<button class="btn-empty-join" onclick="App.modal(\'join\')">پیوستن به اتاق <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></button>' : ''}</div>`;
            return;
        }
        
        filteredRooms.forEach(r => {
            const div = document.createElement('div');
            const isActive = this.state.activeRoom && this.state.activeRoom.name === r.name;
            const isUnlocked = !!this.state.sessions[r.id];
            
            div.className = `room-item ${isActive ? 'active' : ''} ${!isUnlocked && r.needsKey ? 'locked' : ''}`;
            
            // Show lock icon only if NOT unlocked AND needs key
            const lockIcon = (!isUnlocked && r.needsKey) 
                ? `<span class="locked-icon" title="کلید گم شده - رمز عبور را مجدداً وارد کنید"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffd700" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>` 
                : '';

            div.innerHTML = `<div class="room-details"><strong>${lockIcon} ${this.escapeHtml(r.name)}</strong></div><button class="icon-btn del-btn" title="ترک اتاق"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
            
            div.onclick = () => {
                if (this.state.activeRoom && this.state.activeRoom.id === r.id) {
                    $('#app').classList.add('mobile-chat-active');
                    return;
                }

                if (isUnlocked) {
                    this.switchRoom(r.id);
                } else if (r.needsKey) {
                    $('#join-name').value = r.name;
                    $('#join-key').value = '';
                    this.modal('join');
                    setTimeout(() => $('#join-key').focus(), 100);
                } else {
                    this.joinRoom(r.name, r.keyStr);
                }
            };

            div.querySelector('.del-btn').onclick = (e) => {
                e.stopPropagation();
                this.deleteRoomFromList(r.name);
            };
            cont.appendChild(div);
        });
    },

    checkExpiry() {
        if (!this.state.activeRoom || this.state.activeRoom.expiry === 0) return;
        const now = Date.now() / 1000;
        const expirySeconds = this.state.activeRoom.expiry * 60;
        
        const expiredIds = this.state.messages
            .filter(m => (now - m.created_at) > expirySeconds && m.id !== this.state.pinnedId)
            .map(m => m.id);
        
        if (expiredIds.length > 0) {
            // Update the reference array directly
            const valid = this.state.messages.filter(m => !expiredIds.includes(m.id));
            this.state.messages.length = 0; 
            valid.forEach(v => this.state.messages.push(v));

            expiredIds.forEach(id => {
                const el = document.getElementById(`msg-row-${id}`); 
                if (el && !el.classList.contains('expired')) {
                    el.style.height = el.offsetHeight + 'px';
                    el.classList.add('expired'); 
                    setTimeout(() => { if(el.parentNode) { const c = el.parentNode; el.remove(); this.cleanupDateDividers(c); } }, 500);
                }
            });
        }
    },

    cleanupDateDividers(container) {
        const dividers = container.querySelectorAll('.date-divider');
        dividers.forEach(div => {
            let next = div.nextElementSibling;
            while(next && next.classList.contains('expired')) next = next.nextElementSibling;
            const isNextMsg = next && next.classList.contains('msg-row') && !next.classList.contains('expired');
            if (!isNextMsg) div.remove();
        });
    }
});
