/**
 * app_ui.js - Core UI Logic, Events, Notifications & Navigation
 */

Object.assign(window.App, {
    bindEvents() {
        $$('.auth-tab').forEach(b => {
            b.onclick = (e) => {
                $$('.auth-tab').forEach(t => t.classList.remove('active'));
                $$('.auth-section').forEach(s => s.classList.add('hidden'));
                e.target.classList.add('active');
                $(`#auth-form-${e.target.dataset.tab}`).classList.remove('hidden');
            };
        });

        $('#tab-rooms').onclick = () => this.switchSidebarTab('rooms');
        $('#tab-users').onclick = () => this.switchSidebarTab('users');
        $('#tab-notifs').onclick = () => this.switchSidebarTab('notifs');

        $('#sidebar-search-input').oninput = (e) => {
            this.state.sidebarSearch = e.target.value.trim().toLowerCase();
            if(this.state.sidebarSearch) $('#btn-clear-search').classList.remove('hidden');
            else $('#btn-clear-search').classList.add('hidden');
            
            if(this.state.sidebarTab === 'rooms') this.renderRoomList();
            else this.renderUserList();
        };
        $('#btn-clear-search').onclick = () => {
            this.state.sidebarSearch = '';
            $('#sidebar-search-input').value = '';
            $('#btn-clear-search').classList.add('hidden');
            if(this.state.sidebarTab === 'rooms') this.renderRoomList();
            else this.renderUserList();
        };

        $('#form-login').onsubmit = (e) => { e.preventDefault(); this.handleLogin(); };
        $('#form-register').onsubmit = (e) => { e.preventDefault(); this.handleRegister(); };
        $('#btn-logout').onclick = () => this.handleLogout(); // Now opens modal
        $('#btn-confirm-logout').onclick = () => this.confirmLogout();
        
        $('#btn-tab-join').onclick = () => { $('#join-name').value=''; $('#join-key').value=''; this.modal('join'); };
        $('#btn-hero-join').onclick = () => { $('#join-name').value=''; $('#join-key').value=''; this.modal('join'); };
        
        $$('.close-modal').forEach(b => b.onclick = () => this.modal(null));
        $$('.switch-modal').forEach(l => l.onclick = (e) => { e.preventDefault(); this.modal(l.dataset.target.replace('modal-', '')); });

        // MODIFIED: Clear last_active_room when going back to room list on mobile
        $('#btn-back').onclick = () => {
            localStorage.removeItem(this.getLsKey('last_active_room'));
            $('#app').classList.remove('mobile-chat-active');
        };
        
        $('#btn-leave-room').onclick = () => this.leaveRoom();
        
        $('#btn-refresh').onclick = async () => {
            const btn = $('#btn-refresh');
            btn.classList.add('pulse-highlight');
            
            try {
                // 1. Sync Room List (Safely)
                await this.syncRooms();

                // 2. Refresh Active Room Data
                if (this.state.activeRoom) {
                    const roomName = this.state.activeRoom.name;
                    
                    // Re-run join logic to get fresh metadata
                    const joinRes = await window.API.post('join_room', { name: roomName });
                    
                    if (joinRes.status === 'success') {
                        // Update Session Metadata in place
                        const session = this.state.sessions[joinRes.room_id];
                        if (session) {
                            session.expiry = parseInt(joinRes.expiry);
                            session.isOwner = joinRes.is_owner;
                            session.isCreator = joinRes.is_creator;
                            // session.key remains the same
                            
                            // Update UI elements dependent on metadata
                            this.updateRoomHeader();
                            if (session.isOwner) {
                                $('#owner-badge').classList.remove('hidden');
                                $('#btn-admin').classList.remove('hidden');
                            } else {
                                $('#owner-badge').classList.add('hidden');
                                $('#btn-admin').classList.add('hidden');
                            }
                        }
                    }

                    // Fetch Content
                    await this.fetchMessages(false, false, false);
                    if (this.state.sidebarTab === 'users') {
                        await this.fetchRoomUsers();
                    }
                }
            } catch (e) {
                console.error("Refresh failed", e);
                this.toast("بروزرسانی با خطا مواجه شد", true);
            } finally {
                setTimeout(() => btn.classList.remove('pulse-highlight'), 500);
            }
        };
        $('#btn-load-more').onclick = () => this.loadHistory();
        
        $('#messages-container').onscroll = () => this.checkScrollPosition();
        $('#btn-scroll-bottom').onclick = () => this.scrollToBottom(true);

        $('#btn-admin').onclick = () => { this.modal('admin'); this.renderAdminPanel(); };
        $('#btn-admin-nuke').onclick = () => this.adminAction('nuke');
        $('#btn-admin-delete').onclick = () => this.adminAction('delete_room');
        $('#chk-admin-lock').onchange = (e) => this.adminAction('toggle_lock', e.target.checked ? 1 : 0);
        $('#btn-admin-expiry').onclick = () => this.adminAction('update_expiry', $('#admin-expiry-change').value);
        $('#btn-unpin').onclick = () => this.adminAction('pin_message', null);
        $('#admin-user-search').oninput = (e) => this.searchUsers(e.target.value);
        
        $('#btn-nuke-self').onclick = () => this.deleteRoomHistory();

        $('#btn-open-profile').onclick = () => {
            this.modal('profile');
            $('#profile-display-name').value = this.state.displayName || '';
            $('#profile-old-pass').value = '';
            $('#profile-new-pass').value = '';
            $('#profile-confirm-pass').value = '';
            this.updateProfileUI(); 
        };

        $('.profile-avatar-uploader').onclick = () => $('#profile-avatar-input').click();
        $('#profile-avatar-input').onchange = (e) => this.handleAvatarUpload(e.target.files[0]);
        $('#btn-remove-avatar').onclick = (e) => { e.stopPropagation(); this.removeAvatar(); };

        $('#btn-save-profile').onclick = () => this.saveProfileName();
        $('#btn-change-pass').onclick = () => this.changePassword();

        $('#pinned-msg-bar').onclick = (e) => {
            if(!e.target.closest('#btn-unpin') && this.state.pinnedId) this.scrollToMsg(this.state.pinnedId, true);
        };

        $('#form-create').onsubmit = (e) => { e.preventDefault(); this.createRoom(); };
        $('#form-join').onsubmit = (e) => { e.preventDefault(); this.handleJoinSubmit(); };
        $('#btn-gen-key').onclick = () => $('#create-key').value = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);

        $('#btn-send').onclick = () => this.handleSendClick();
        
        const input = $('#msg-input');
        input.onkeydown = (e) => { 
            if (e.key === 'Enter' && !e.shiftKey) {
                if (window.innerWidth <= 768) return; 
                e.preventDefault(); this.handleSendClick(); 
            }
        };
        input.oninput = () => { this.adjustInputHeight(); this.checkInputDirection(); };

        // ========== NEW: Dismiss stuck loader when interacting with the input area ==========
        // If the global loader is visible and NOT showing progress, hide it.
        input.addEventListener('focus', () => {
            const loader = $('#global-loader');
            if (loader && !loader.classList.contains('hidden')) {
                if (!this._loaderSafetyTimer) {
                    console.warn('Loader dismissed by input focus');
                    this.toggleGlobalLoader(false);
                }
            }
        });

        // Also dismiss on tap/click of the entire input area (footer)
        $('#input-area').addEventListener('click', (e) => {
            const loader = $('#global-loader');
            if (loader && !loader.classList.contains('hidden')) {
                if (!this._loaderSafetyTimer) {
                    this.toggleGlobalLoader(false);
                }
                // Focus the textarea after dismissing
                $('#msg-input').focus();
            }
        });

        $('#btn-cancel-reply').onclick = () => { this.setReply(null); this.cancelEdit(); };
        $('#btn-cancel-attach').onclick = () => this.clearAttachment();
        $('#btn-attach').onclick = () => $('#file-input-all').click();
        $('#file-input-all').onchange = (e) => {
             Array.from(e.target.files).forEach(f => this.handleFile(f, 'auto'));
             $('#file-input-all').value = ''; 
        };
        
        $('#btn-mic').onclick = () => this.startRecording();
        $('#btn-voice-cancel').onclick = () => this.cancelRecord();
        $('#btn-voice-stop').onclick = () => this.stopRecording();
        $('#btn-voice-discard').onclick = () => this.cancelRecord();
        $('#btn-voice-send').onclick = () => this.sendVoice();

        $('#btn-emoji-toggle').onclick = (e) => { e.stopPropagation(); $('#full-emoji-picker').classList.toggle('hidden'); };

        $('#btn-clear-notifs').onclick = (e) => {
            e.stopPropagation();
            this.state.notifications = [];
            this.renderNotificationPanel();
            this.markNotificationsRead();
        };

        $('#chk-os-notif').onchange = (e) => {
            const checked = e.target.checked;
            this.state.notifPrefs.master = checked;
            this.saveNotifPrefs();
            if (checked) this.requestNotificationPermission();
        };

        const updatePref = (key, val) => { 
            this.state.notifPrefs[key] = val; 
            this.saveNotifPrefs(); 
            this.refreshNotifControls();
        };

        $('#filter-msg').onclick = () => updatePref('msg', !this.state.notifPrefs.msg);
        $('#filter-reply').onclick = () => updatePref('reply', !this.state.notifPrefs.reply);
        $('#filter-react').onclick = () => updatePref('react', !this.state.notifPrefs.react);
        $('#filter-join').onclick = () => updatePref('join', !this.state.notifPrefs.join);

        $('#toast').onclick = () => {
            const el = $('#toast');
            const text = el.innerText;
            if (text) {
                navigator.clipboard.writeText(text).catch(err => console.error(err));
            }
            el.classList.remove('show');
            if (this.toastTimeout) clearTimeout(this.toastTimeout);
        };

        $('#tv-btn-close').onclick = () => this.closeTextViewer();
        $('#tv-btn-copy').onclick = () => {
            const txt = $('#tv-content').textContent;
            this.copyToClipboard(txt);
        };

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.reaction-pill') && !e.target.closest('.emoji-picker')) $('#emoji-picker').classList.add('hidden');
            if (!e.target.closest('#full-emoji-picker') && !e.target.closest('#btn-emoji-toggle')) $('#full-emoji-picker').classList.add('hidden');
            if (!e.target.closest('.search-results') && !e.target.closest('#admin-user-search')) $('#admin-search-results').classList.add('hidden');
        });
        $('.lightbox-close').onclick = () => $('#lightbox').classList.remove('active');
    },

    // ... (rest of app_ui.js remains identical, I'll include the whole file for completeness)

    refreshNotifControls() {
        const p = this.state.notifPrefs;
        $('#chk-os-notif').checked = p.master;
        
        const toggleClass = (id, active) => {
             const el = $(id);
             if(active) el.classList.add('active'); else el.classList.remove('active');
        };
        toggleClass('#filter-msg', p.msg);
        toggleClass('#filter-reply', p.reply);
        toggleClass('#filter-react', p.react);
        toggleClass('#filter-join', p.join);
    },

    switchSidebarTab(tab) {
        this.state.sidebarTab = tab;
        $('#tab-rooms').classList.toggle('active', tab === 'rooms');
        $('#tab-users').classList.toggle('active', tab === 'users');
        $('#tab-notifs').classList.toggle('active', tab === 'notifs');
        
        $('#view-rooms').classList.toggle('active', tab === 'rooms');
        $('#view-users').classList.toggle('active', tab === 'users');
        $('#view-notifs').classList.toggle('active', tab === 'notifs');

        if (tab === 'users') {
            this.renderUserList(); 
            this.fetchRoomUsers(); 
        } else if (tab === 'notifs') {
            this.markNotificationsRead();
        } else {
            this.renderRoomList();
        }
    },

    showReactions(msgId) {
        setTimeout(() => {
            const picker = $('#emoji-picker'); 
            picker.classList.remove('hidden'); 
            picker.innerHTML = '';
            const reactions = ['👍','❤️','😂','😮','😢','😡','🔥','🎉','👀','💯','🤝','🧠','↩'];
            
            reactions.forEach(char => {
                const s = document.createElement('span'); 
                s.innerText = char;
                s.onclick = (e) => { e.stopPropagation(); this.sendReaction(msgId, char); };
                picker.appendChild(s);
            });
        }, 10);
    },

    async sendReaction(msgId, char) {
        $('#emoji-picker').classList.add('hidden');
        if (char === '↩') { const msg = this.state.messages.find(m => m.id === msgId); this.setReply(msg ? msg.id : null); return; }
        await window.API.post('react', { msg_id: msgId, username: this.state.activeRoom.username, reaction: char });
        this.fetchMessages(); 
    },

    setReply(msgId) {
        if (msgId) {
            const msg = this.state.messages.find(m => m.id === msgId);
            if(!msg) return;
            this.state.replyTo = msg; $('#reply-preview').classList.remove('hidden'); $('#reply-user').innerText = msg.sender_display_name || msg.username;
            
            let txt = msg.decrypted;
            if(msg.fileInfo) {
                if(Array.isArray(msg.fileInfo)) txt = `[${msg.fileInfo.length} فایل]`;
                else txt = `[${msg.fileInfo.type.split('/')[0]}] ${msg.fileInfo.name}`;
            }
            $('#reply-text').innerText = txt; $('#msg-input').focus();
        } else { this.state.replyTo = null; $('#reply-preview').classList.add('hidden'); }
    },
    
    scrollToMsg(id, animate = false) {
        requestAnimationFrame(() => {
            const container = document.getElementById('messages-container');
            if (!id) { 
                container.scrollTo({ top: container.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
                return; 
            }
            const el = document.getElementById(`msg-row-${id}`); 
            if (el && container) {
                const elRect = el.getBoundingClientRect(); const cRect = container.getBoundingClientRect();
                const target = container.scrollTop + (elRect.top - cRect.top) - (cRect.height/2) + (elRect.height/2);
                container.scrollTo({ top: target, behavior: animate ? 'smooth' : 'auto' });
                if (animate) { 
                    const bubble = el.querySelector('.msg');
                    if(bubble) {
                        bubble.classList.remove('pulse-highlight'); 
                        void bubble.offsetWidth; 
                        bubble.classList.add('pulse-highlight'); 
                        setTimeout(() => bubble.classList.remove('pulse-highlight'), 3000); 
                    }
                }
            } else this.toast("پیام بارگذاری نشده است (به بالا اسکرول کنید)", true);
        });
    },

    removeMessageFromDom(id) {
        const el = document.getElementById('msg-row-' + id);
        if (el) {
            if (el.classList.contains('expired')) return;
            el.classList.add('expired'); setTimeout(() => { if (el && el.parentNode) { const c = el.parentNode; el.remove(); this.cleanupDateDividers(c); } }, 500); 
        }
    },

    copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => this.toast("کپی شد!")); },

    async jumpToUserInRoom(username, roomName) {
        if (this.state.activeRoom && this.state.activeRoom.name === roomName) {
            this.findAndScrollToUserMessage(username);
        } else {
            const room = this.state.rooms.find(r => r.name === roomName);
            if (room) {
                await this.switchRoom(room.id);
                this.findAndScrollToUserMessage(username);
            } else {
                this.toast("اتاق یافت نشد", true);
            }
        }
    },

    findAndScrollToUserMessage(username) {
        const msgs = this.state.messages;
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].username === username) {
                this.scrollToMsg(msgs[i].id, true);
                return;
            }
        }
        this.toast("پیامی از این کاربر در پیام‌های اخیر یافت نشد", true);
    }
});
