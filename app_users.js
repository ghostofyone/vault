/**
 * app_users.js - User Profile & Member Management
 */

Object.assign(window.App, {
    async fetchRoomUsers() {
        if (!this.state.currentUser) return;
        
        // Always fetch ALL shared users to show global buddy list
        let endpoint = 'get_all_shared_users';
        let payload = {};

        try {
            const res = await window.API.post(endpoint, payload);
            if (res.status === 'success' && Array.isArray(res.members)) {
                this.state.activeRoomUsers = res.members;
            }
        } catch (e) { 
            console.error("Fetch users error", e); 
        } finally {
            this.state.hasFetchedUsers = true;
            this.renderUserList();
        }
    },

    renderUserList() {
        const cont = $('#users-list');
        const countSpan = $('#count-users');
        
        // No longer check for activeRoom to show list
        // if (!this.state.activeRoom) ...
        
        let users = this.state.activeRoomUsers || [];
        
        const query = this.state.sidebarSearch;
        if (query) {
            users = users.filter(u => 
                (u.username && u.username.toLowerCase().includes(query)) || 
                (u.display_name && u.display_name.toLowerCase().includes(query))
            );
        }

        countSpan.innerText = users.length;
        
        if (users.length === 0) {
            if (!this.state.hasFetchedUsers) {
                cont.innerHTML = '<div class="empty-state-sm">در حال بارگذاری...</div>';
            } else {
                cont.innerHTML = '<div class="empty-state-sm">' + (query ? 'نتیجه‌ای یافت نشد' : 'کاربری یافت نشد') + '</div>';
            }
            return;
        }

        cont.innerHTML = '';
        users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'user-item expanded-layout';
            
            const display = u.display_name || u.username;
            const initial = display.charAt(0).toUpperCase();
            
            // New Badge Logic
            let roleBadge = '';
            if (u.is_creator) roleBadge = '<span class="user-badge creator">سازنده</span>';
            else if (u.is_owner) roleBadge = '<span class="user-badge owner">مالک</span>';

            let onlineIndicator = '';
            if (u.is_online) {
                onlineIndicator = '<div class="online-indicator pulse"></div>';
            }

            // Fix for cropping: Use wrapper for both text and image modes
            // The wrapper acts as relative container, indicator is absolute inside it but outside the clipped content
            let avatarContent = '';
            if (u.avatar) {
                avatarContent = `<img src="uploads/${u.avatar}" alt="${this.escapeHtml(display)}">`;
            } else {
                avatarContent = `<div class="avatar-text">${initial}</div>`;
            }
            
            let avatarHtml = `<div class="user-avatar-wrap">${avatarContent}${onlineIndicator}</div>`;

            // Room list logic
            let roomsHtml = '';
            if (u.room_list && u.room_list.length > 0) {
                const primaryRoom = u.room_list[0];
                const otherRooms = u.room_list.slice(1);
                
                // Check if primary room is actually the active shared room
                const isActive = (u.active_shared_room === primaryRoom);
                const activeClass = isActive ? 'active-room' : '';
                const activeTitle = isActive ? 'آخرین اتاق فعال' : 'اتاق مشترک';

                let othersHtml = '';
                let toggleBtn = '';
                
                if (otherRooms.length > 0) {
                    // Unique ID for toggle
                    const toggleId = 'toggle-' + Math.random().toString(36).substr(2, 9);
                    toggleBtn = `<button class="expand-rooms-btn" onclick="event.stopPropagation(); document.getElementById('${toggleId}').classList.toggle('hidden'); this.classList.toggle('open');">...</button>`;
                    const items = otherRooms.map(r => `<span class="room-tag">${this.escapeHtml(r)}</span>`).join('');
                    othersHtml = `<div id="${toggleId}" class="hidden-rooms hidden">${items}</div>`;
                }

                roomsHtml = `
                    <div class="user-rooms-container">
                        <div class="primary-room-row">
                            <span class="room-tag ${activeClass}" title="${activeTitle}">${this.escapeHtml(primaryRoom)}</span>
                            ${toggleBtn}
                        </div>
                        ${othersHtml}
                    </div>
                `;
            }

            div.innerHTML = `
                <div class="user-item-top">
                    ${avatarHtml}
                    <div class="user-info-row">
                        <div class="user-name-wrapper">
                            <span class="user-name-display">${this.escapeHtml(display)}</span>
                            ${roleBadge}
                        </div>
                        <span class="status-text-mini">${u.is_online ? 'آنلاین' : 'آفلاین'}</span>
                    </div>
                </div>
                ${roomsHtml}
            `;
            
            div.onclick = (e) => {
                if (e.target.closest('.expand-rooms-btn')) return;
                if (u.active_shared_room) {
                    this.jumpToUserInRoom(u.username, u.active_shared_room);
                } else if (u.room_list && u.room_list.length > 0) {
                    // Fallback to first room if no active shared room
                    this.jumpToUserInRoom(u.username, u.room_list[0]);
                }
            };
            
            cont.appendChild(div);
        });
    },

    async handleAvatarUpload(file) {
        if (!file) return;
        this.setBusy(true, "آپلود تصویر...");
        
        const res = await window.API.uploadFile('update_avatar', { avatar: file });
        this.setBusy(false);
        
        if (res.status === 'success') {
            this.state.avatar = res.avatar;
            this.updateProfileUI();
            this.toast('تصویر پروفایل تغییر کرد');
            if (this.updateMyAvatarInDOM) this.updateMyAvatarInDOM(res.avatar);
        } else {
            this.toast(res.message || "خطا در آپلود", true);
        }
        $('#profile-avatar-input').value = '';
    },

    async removeAvatar() {
        if(!confirm("آیا مطمئن هستید که می‌خواهید تصویر پروفایل را حذف کنید؟")) return;
        this.setBusy(true, "حذف تصویر...");
        const res = await window.API.post('remove_avatar', {});
        this.setBusy(false);
        
        if (res.status === 'success') {
            this.state.avatar = null;
            this.updateProfileUI();
            this.toast('تصویر پروفایل حذف شد');
            if (this.updateMyAvatarInDOM) this.updateMyAvatarInDOM(null);
        } else {
            this.toast(res.message || "خطا در حذف", true);
        }
    },

    async saveProfileName() {
        const val = $('#profile-display-name').value.trim();
        this.setBusy(true, "ذخیره نام...");
        const res = await window.API.post('update_profile', { display_name: val });
        this.setBusy(false);
        
        if (res.status === 'success') {
            this.state.displayName = res.display_name;
            this.updateProfileUI(); 
            this.toast('نام نمایشی بروز شد');
            if (this.updateMyDisplayNameInDOM) this.updateMyDisplayNameInDOM(res.display_name);
        } else {
            this.toast(res.message || "خطا در بروزرسانی", true);
        }
    },

    async changePassword() {
        const oldP = $('#profile-old-pass').value;
        const newP = $('#profile-new-pass').value;
        const confP = $('#profile-confirm-pass').value;

        if (newP !== confP) return this.toast("رمز عبور جدید و تکرار آن مطابقت ندارند", true);
        if (newP.length < 8) return this.toast("رمز عبور جدید باید حداقل ۸ کاراکتر باشد", true);

        this.setBusy(true, "تغییر رمز عبور...");
        const res = await window.API.post('change_password', { old_password: oldP, new_password: newP });
        this.setBusy(false);

        if (res.status === 'success') {
            this.toast('رمز عبور با موفقیت تغییر کرد');
            $('#profile-old-pass').value = '';
            $('#profile-new-pass').value = '';
            $('#profile-confirm-pass').value = '';
        } else {
            this.toast(res.message || "خطا در تغییر رمز", true);
        }
    }
});
