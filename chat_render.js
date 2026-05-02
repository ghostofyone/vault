/**
 * chat_render.js - Rendering & Media
 */

Object.assign(window.App, {
    refreshDOM(serverList, prepend = false, isInitial = false, forceScrollAnimated = false) {
        const cont = document.getElementById('messages-container');
        const loadMoreBtn = document.getElementById('btn-load-more');
        const anchor = loadMoreBtn ? loadMoreBtn.nextSibling : null;
        
        serverList.forEach((msg) => {
            const local = this.state.messages.find(function(m) { return m.id === msg.id; });
            if (!local) return; 

            let el = document.getElementById('msg-row-' + local.id);
            if (el) {
                this.updateReactionsUI(local);
                if (local.is_edited) {
                    const contentEl = el.querySelector('.msg-content');
                    if (contentEl && contentEl.innerText !== local.decrypted) {
                        contentEl.innerText = local.decrypted;
                        if (this.detectRTL(local.decrypted)) el.querySelector('.msg').classList.add('rtl'); else el.querySelector('.msg').classList.remove('rtl');
                        if(!el.querySelector('.msg-edited-tag')) {
                            const timeEl = el.querySelector('.msg-time');
                            if (timeEl) { const tag = document.createElement('span'); tag.className = 'msg-edited-tag'; tag.innerText = '(ویرایش شده)'; timeEl.parentNode.insertBefore(tag, timeEl); }
                        }
                    }
                }
            } else {
                const dateKey = window.JalaliConverter.format(local.created_at, 'date_only');
                const myIndex = this.state.messages.findIndex(function(m) { return m.id === local.id; });
                
                let showDate = (myIndex === 0);
                if (!showDate) {
                    const prevDateKey = window.JalaliConverter.format(this.state.messages[myIndex - 1].created_at, 'date_only');
                    showDate = (prevDateKey !== dateKey);
                }
                
                if (showDate) {
                    const div = document.createElement('div'); div.className = 'date-divider'; 
                    div.innerText = window.JalaliConverter.getMonthName(local.created_at);
                    if (prepend) cont.insertBefore(div, anchor); else cont.appendChild(div);
                }

                el = this.createMessageEl(local);
                if (prepend) cont.insertBefore(el, anchor);
                else {
                    cont.appendChild(el);
                    if (!isInitial && !forceScrollAnimated) {
                        const isNearBottom = cont.scrollHeight - cont.scrollTop - cont.clientHeight < 100;
                        if (isNearBottom) cont.scrollTop = cont.scrollHeight; 
                    }
                }
            }
        });

        if (isInitial) {
            requestAnimationFrame(function() { cont.scrollTop = cont.scrollHeight; });
        } else if (forceScrollAnimated) {
            this.scrollToMsg(null, true);
        }

        // New Logic: Scroll to Pending Message ID if set (e.g. from notification click)
        if (this.state.pendingScrollMsgId) {
            // Give a tiny delay for DOM painting
            setTimeout(() => {
                if (document.getElementById('msg-row-' + this.state.pendingScrollMsgId)) {
                    this.scrollToMsg(this.state.pendingScrollMsgId, true);
                    this.state.pendingScrollMsgId = null;
                }
            }, 300);
        }
    },

    createMessageEl(msg) {
        const isMe = msg.username === this.state.activeRoom.username;
        const container = document.createElement('div');
        container.className = isMe ? 'msg-row out' : 'msg-row in';
        container.id = 'msg-row-' + msg.id;

        const div = document.createElement('div');
        div.className = isMe ? 'msg out' : 'msg in';
        if (msg.decrypted && this.detectRTL(msg.decrypted)) div.classList.add('rtl');
        
        const timeStr = window.JalaliConverter.format(msg.created_at, 'time_only');
        const senderName = msg.sender_display_name ? msg.sender_display_name : msg.username;
        
        let replyHtml = '';
        if (msg.reply_to_id && msg.reply_to_id !== 'null') {
            const orig = this.state.messages.find(function(m) { return m.id === msg.reply_to_id; });
            if (orig) {
                let txt = orig.decrypted;
                if(orig.fileInfo) {
                    if(Array.isArray(orig.fileInfo)) txt = '[' + orig.fileInfo.length + ' فایل]';
                    else txt = '[فایل] ' + orig.fileInfo.name;
                }
                const replyName = orig.sender_display_name || orig.username;
                replyHtml = '<div class="reply-context" onclick="window.App.scrollToMsg(\'' + orig.id + '\', true)"><strong>' + this.escapeHtml(replyName) + '</strong>' + this.escapeHtml(txt.substring(0,50)) + '...</div>';
            } else replyHtml = '<div class="reply-context"><strong>نامشخص</strong>پیام بارگذاری نشده</div>';
        }

        let mediaHtml = '';
        if (msg.fileInfo) {
            const files = Array.isArray(msg.fileInfo) ? msg.fileInfo : [msg.fileInfo];
            const audios = []; const videos = []; const images = []; const texts = []; const others = [];
            const textExts = ['txt', 'md', 'json', 'js', 'css', 'html', 'php', 'py', 'java', 'c', 'cpp', 'h', 'xml', 'log', 'csv', 'sql', 'sh', 'bat', 'ini', 'conf', 'yaml', 'yml'];

            files.forEach(function(file, idx) {
                const item = { file: file, idx: idx, cacheKey: msg.id + '_' + idx };
                if (file.type.indexOf('audio') !== -1) audios.push(item);
                else if (file.type.indexOf('video') !== -1) videos.push(item);
                else if (file.type.indexOf('image') === 0) images.push(item);
                else {
                    const parts = file.name.split('.');
                    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
                    if (file.type.startsWith('text/') || textExts.includes(ext) || file.type === 'application/json' || file.type === 'application/javascript') texts.push(item);
                    else others.push(item);
                }
            });

            mediaHtml += '<div class="msg-media-stack">';
            for (let i = 0; i < audios.length; i++) {
                const item = audios[i];
                mediaHtml += '<div class="msg-audio-group">';
                if (this.state.mediaCache[item.cacheKey]) mediaHtml += '<audio controls src="' + this.state.mediaCache[item.cacheKey] + '" class="msg-audio-player"></audio>';
                else {
                     mediaHtml += '<div class="msg-audio-wrapper" style="flex:1; font-size:0.8rem; color:#aaa;" id="audio-' + item.cacheKey + '">بارگذاری صوت...</div>'; 
                     if (!document.getElementById('audio-' + item.cacheKey)) setTimeout(() => this.loadMediaBatch(item.file, div, 'audio', item.cacheKey), 0);
                }
                mediaHtml += '<button class="audio-dl-btn" title="دانلود" onclick="event.stopPropagation(); window.App.downloadFile(\'' + msg.id + '\', ' + item.idx + ')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button></div>';
            }
            for (let i = 0; i < videos.length; i++) {
                const item = videos[i];
                if (this.state.mediaCache[item.cacheKey]) {
                     mediaHtml += '<div class="msg-media-wrapper"><video controls src="' + this.state.mediaCache[item.cacheKey] + '" class="msg-video"></video><div class="media-dl-btn" onclick="event.stopPropagation(); window.App.downloadFile(\'' + msg.id + '\', ' + item.idx + ')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></div></div>';
                } else { mediaHtml += '<div class="msg-loader" id="video-' + item.cacheKey + '">بارگذاری ویدیو...</div>'; this.loadMediaBatch(item.file, div, 'video', item.cacheKey); }
            }
            if (images.length > 0) {
                mediaHtml += '<div class="msg-image-grid">';
                for (let i = 0; i < images.length; i++) {
                    const item = images[i];
                    if (this.state.mediaCache[item.cacheKey]) {
                        mediaHtml += '<div class="msg-image-wrapper"><img src="' + this.state.mediaCache[item.cacheKey] + '" class="msg-image" onclick="window.App.openLightbox(\'' + item.cacheKey + '\')"><div class="media-dl-btn" onclick="event.stopPropagation(); window.App.downloadFile(\'' + msg.id + '\', ' + item.idx + ')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></div></div>';
                    } else { mediaHtml += '<div class="msg-loader" id="img-loader-' + item.cacheKey + '">بارگذاری...</div>'; this.downloadAndShowImageBatch(item.file, div, item.cacheKey); }
                }
                mediaHtml += '</div>';
            }
            for (let i = 0; i < texts.length; i++) {
                const item = texts[i];
                const sizeStr = item.file.size ? this.formatBytes(item.file.size) : '';
                mediaHtml += `<div class="text-file-card"><div class="tf-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div><div class="tf-info"><div class="tf-name">${this.escapeHtml(item.file.name)}</div><div class="tf-size">${sizeStr}</div></div><div class="tf-actions"><button class="tf-btn view" onclick="event.preventDefault(); event.stopPropagation(); window.App.openTextViewer('${msg.id}', ${item.idx});" title="مشاهده"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg></button><button class="tf-btn dl" onclick="event.preventDefault(); event.stopPropagation(); window.App.downloadFile('${msg.id}', ${item.idx});" title="دانلود"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button></div></div>`;
            }
            if (others.length > 0) {
                mediaHtml += '<div class="msg-file-list">';
                for (let i = 0; i < others.length; i++) {
                    const item = others[i];
                    const sizeStr = item.file.size ? this.formatBytes(item.file.size) : '';
                    mediaHtml += '<a href="#" class="msg-file" onclick="event.preventDefault(); window.App.downloadFile(\'' + msg.id + '\', ' + item.idx + ');" style="font-size:0.8rem; padding:5px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path></svg><div class="file-info-wrap"><span class="file-name-text">' + this.escapeHtml(item.file.name) + '</span><span style="font-size:0.7em;opacity:0.7">' + sizeStr + '</span></div></a>';
                }
                mediaHtml += '</div>';
            }
            mediaHtml += '</div>';
        }

        let textHtml = '';
        if (msg.decrypted && msg.decrypted.trim() !== '') {
            const marginStyle = msg.fileInfo ? 'margin-top:8px;' : '';
            textHtml = '<div class="msg-content" style="' + marginStyle + '">' + this.escapeHtml(msg.decrypted) + '</div>';
        }

        const editTag = msg.is_edited ? '<span class="msg-edited-tag">(ویرایش شده)</span>' : '';
        const canEdit = isMe && (Date.now()/1000 - msg.created_at) < 600;
        const isOwner = this.state.activeRoom.isOwner;

        let actions = '<div class="msg-actions"><button class="action-btn" title="پاسخ" onclick="window.App.setReply(\'' + msg.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg></button><button class="action-btn" title="واکنش" onclick="window.App.showReactions(\'' + msg.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg></button>';
        
        if (!msg.fileInfo) {
            const safeText = encodeURIComponent(msg.decrypted || '');
            actions += '<button class="action-btn" title="کپی" onclick="window.App.copyToClipboard(decodeURIComponent(\'' + safeText + '\'))"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>';
        } else {
            actions += '<button class="action-btn" title="دانلود همه" onclick="window.App.downloadAllFiles(\'' + msg.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>';
        }

        if (canEdit || isOwner) actions += '<button class="action-btn" title="ویرایش" onclick="window.App.startEdit(\'' + msg.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>';
        if (isMe || isOwner) actions += '<button class="action-btn" title="حذف" onclick="window.App.deleteMessage(\'' + msg.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>';
        if (isOwner) actions += '<button class="action-btn" title="سنجاق کردن" onclick="window.App.adminAction(\'pin_message\', \'' + msg.id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg></button>';
        actions += '</div>';

        let avatarHtml = '';
        if (msg.sender_avatar) avatarHtml = `<img src="uploads/${msg.sender_avatar}" class="msg-avatar-small">`;

        div.innerHTML = '<div class="msg-header">' + avatarHtml + '<span class="sender-name">' + this.escapeHtml(senderName) + '</span><span class="msg-time">' + editTag + ' ' + timeStr + '</span></div>' + replyHtml + mediaHtml + textHtml + '<div class="msg-footer"><div class="msg-reactions" id="reactions-' + msg.id + '"></div></div>' + actions;
        container.appendChild(div);
        return container;
    },

    updateMyAvatarInDOM(newAvatar) {
        this.state.messages.forEach(m => { if (m.username === this.state.currentUser) m.sender_avatar = newAvatar; });
        const myRows = document.querySelectorAll('.msg-row.out');
        myRows.forEach(row => {
            const header = row.querySelector('.msg-header');
            if (header) {
                let img = header.querySelector('.msg-avatar-small');
                if (newAvatar) {
                    if (img) img.src = 'uploads/' + newAvatar;
                    else { img = document.createElement('img'); img.className = 'msg-avatar-small'; img.src = 'uploads/' + newAvatar; header.prepend(img); }
                } else { if (img) img.remove(); }
            }
        });
    },
    
    updateMyDisplayNameInDOM(newDisplayName) {
        const myUsername = this.state.currentUser;
        this.state.messages.forEach(m => { 
            if (m.username === myUsername) m.sender_display_name = newDisplayName; 
        });
        
        // Update all message rows belonging to me
        const myRowsOut = document.querySelectorAll('.msg-row.out');
        myRowsOut.forEach(row => {
            const nameEl = row.querySelector('.sender-name');
            if (nameEl) nameEl.innerText = newDisplayName || myUsername;
        });
    },

    async downloadAndShowImageBatch(fileObj, div, cacheKey) {
        const blob = await this.fetchDecryptedFileObject(fileObj);
        if (blob) {
            const url = URL.createObjectURL(blob); this.state.mediaCache[cacheKey] = url;
            const loader = document.getElementById('img-loader-' + cacheKey);
            if(loader) {
                const parts = cacheKey.split('_'); const msgId = parts[0]; const idx = parts[1];
                const wrapper = document.createElement('div'); wrapper.className = 'msg-image-wrapper';
                wrapper.innerHTML = '<img src="' + url + '" class="msg-image" onclick="window.App.openLightbox(\'' + cacheKey + '\')">' +
                                    '<div class="media-dl-btn" onclick="event.stopPropagation(); window.App.downloadFile(\'' + msgId + '\', ' + idx + ')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></div>';
                loader.replaceWith(wrapper);
            }
        } else { const loader = document.getElementById('img-loader-' + cacheKey); if(loader) loader.innerText = 'خطا در بارگذاری'; }
    },

    async loadMediaBatch(fileObj, div, type, cacheKey) {
        const wrapperId = (type === 'audio') ? 'audio-' + cacheKey : 'video-' + cacheKey;
        try {
            const blob = await this.fetchDecryptedFileObject(fileObj);
            if (blob) {
                const url = URL.createObjectURL(blob); this.state.mediaCache[cacheKey] = url;
                let player = document.createElement(type === 'audio' ? 'audio' : 'video');
                player.className = type === 'audio' ? 'msg-audio-player' : 'msg-video';
                player.controls = true; player.preload = "metadata"; player.src = url; player.style.width = '100%';
                
                const dw = document.getElementById(wrapperId); 
                if (dw) {
                    if (type === 'video') {
                        const parts = cacheKey.split('_'); const msgId = parts[0]; const idx = parts[1];
                        const wrapper = document.createElement('div'); wrapper.className = 'msg-media-wrapper';
                        wrapper.appendChild(player);
                        const dlBtn = document.createElement('div'); dlBtn.className = 'media-dl-btn';
                        dlBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';
                        dlBtn.onclick = function(e) { e.stopPropagation(); window.App.downloadFile(msgId, idx); };
                        wrapper.appendChild(dlBtn); dw.replaceWith(wrapper);
                    } else dw.replaceWith(player);
                }
            }
        } catch(e) { console.error(e); }
    },

    openLightbox(cacheKey) {
        if(this.state.mediaCache[cacheKey]) {
            document.getElementById('lightbox').classList.add('active');
            document.getElementById('lightbox-img').src = this.state.mediaCache[cacheKey];
            const dlBtn = document.getElementById('lightbox-download');
            dlBtn.href = this.state.mediaCache[cacheKey]; dlBtn.download = 'image-' + cacheKey + '.png';
        }
    },

    updateReactionsUI(msg) {
        const container = document.getElementById('reactions-' + msg.id);
        if (!container) return;
        const counts = {}; const userMap = {};
        if (msg.reactions) {
            msg.reactions.forEach(function(r) { 
                if (!counts[r.reaction]) { counts[r.reaction] = 0; userMap[r.reaction] = []; }
                counts[r.reaction]++; userMap[r.reaction].push(r.username);
            });
        }
        let html = ''; const myName = this.state.activeRoom.username; 
        for (const key in counts) {
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
                let users = userMap[key]; const iReacted = users.includes(myName);
                let tooltipUsers = [...users]; if (iReacted) { tooltipUsers = tooltipUsers.filter(function(u) { return u !== myName; }); tooltipUsers.unshift('شما'); }
                const tooltip = tooltipUsers.join(', '); const activeClass = iReacted ? 'active' : '';
                html += '<div class="reaction-pill ' + activeClass + '" title="' + this.escapeHtml(tooltip) + '" onclick="window.App.sendReaction(\'' + msg.id + '\', \'' + key + '\'); event.stopPropagation();">' + key + ' <span class="count">' + counts[key] + '</span></div>';
            }
        }
        container.innerHTML = html;
    },

    detectRTL(text) { return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text); },

    removeMessageFromDom(id) {
        const el = document.getElementById('msg-row-' + id);
        if (el) {
            if (el.classList.contains('expired')) return;
            el.classList.add('expired'); setTimeout(() => { if (el && el.parentNode) { const c = el.parentNode; el.remove(); this.cleanupDateDividers(c); } }, 500); 
        }
    },

    copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => this.toast("کپی شد!")); },

    formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 بایت'; const k = 1024; const i = Math.floor(Math.log(bytes) / Math.log(k));
        const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
        return (bytes / Math.pow(k, i)).toFixed(decimals < 0 ? 0 : decimals) + ' ' + sizes[i];
    }
});

// IMPORTANT: Updated scrollToMsg to target .msg bubble for highlight
window.App.scrollToMsg = function(id, animate = false) {
    requestAnimationFrame(() => {
        const container = document.getElementById('messages-container');
        if (!id) { 
            container.scrollTo({ top: container.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
            return; 
        }
        const row = document.getElementById(`msg-row-${id}`); 
        if (row && container) {
            const elRect = row.getBoundingClientRect(); const cRect = container.getBoundingClientRect();
            const target = container.scrollTop + (elRect.top - cRect.top) - (cRect.height/2) + (elRect.height/2);
            container.scrollTo({ top: target, behavior: animate ? 'smooth' : 'auto' });
            if (animate) { 
                const bubble = row.querySelector('.msg');
                if (bubble) {
                    bubble.classList.remove('pulse-highlight'); 
                    void bubble.offsetWidth; 
                    bubble.classList.add('pulse-highlight'); 
                    setTimeout(() => bubble.classList.remove('pulse-highlight'), 3000); 
                }
            }
        } else this.toast("پیام بارگذاری نشده است (به بالا اسکرول کنید)", true);
    });
};
