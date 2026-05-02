/**
 * app_media.js - File Handling, Media Players & Viewers
 */

Object.assign(window.App, {
    async handleFile(file, type) {
        if (!file) return;
        
        const MAX_FILE_SIZE = 500 * 1024 * 1024; 
        const MAX_BATCH_SIZE = 100 * 1024 * 1024; 
        const MAX_COUNT = 10;
        
        if (file.size > MAX_FILE_SIZE) return this.toast(`فایل ${file.name} بزرگتر از ۵۰ مگابایت است`, true);
        
        if (type === 'voice') {
            this.sendVoiceDirectly(file);
            return;
        }

        if (type === 'auto') {
            if (file.type.indexOf('image') === 0) type = 'image';
            else if (file.type.indexOf('audio') !== -1) type = 'audio';
            else if (file.type.indexOf('video') !== -1) type = 'video';
            else type = 'file'; 
        }

        const currentTotalSize = this.state.pendingAttachments.reduce((acc, item) => acc + item.file.size, 0);
        if (currentTotalSize + file.size > MAX_BATCH_SIZE) return this.toast("مجموع حجم فایل‌ها از ۱۰۰ مگابایت بیشتر می‌شود", true);
        if (this.state.pendingAttachments.length >= MAX_COUNT) return this.toast("حداکثر ۱۰ فایل همزمان مجاز است", true);

        const tempId = Date.now() + Math.random().toString(36);
        this.state.pendingAttachments.push({ file, type, id: tempId });
        
        this.renderAttachmentPreview();
        $('#msg-input').focus();
    },

    renderAttachmentPreview() {
        const list = $('#attach-list');
        list.innerHTML = '';
        const drawer = $('#attachment-preview');
        
        if (this.state.pendingAttachments.length === 0) {
            drawer.classList.add('hidden');
            return;
        }

        drawer.classList.remove('hidden');
        
        this.state.pendingAttachments.forEach((item, index) => {
             const card = document.createElement('div');
             card.className = 'attach-card';
             
             const fileUrl = URL.createObjectURL(item.file);
             item.previewUrl = fileUrl; 

             let contentHtml = '';
             
             if (item.type === 'image') {
                 contentHtml = `<img src="${fileUrl}" class="preview-image" alt="Preview">`;
             } 
             else if (item.type === 'video') {
                 card.classList.add('wide-card'); 
                 contentHtml = `<video src="${fileUrl}" class="preview-video" controls></video>`;
             }
             else if (item.type === 'audio') {
                 card.classList.add('wide-card'); 
                 contentHtml = `
                    <div class="file-card-content">
                        <audio src="${fileUrl}" controls class="preview-audio-ctrl"></audio>
                        <div class="file-name-preview">${this.escapeHtml(item.file.name)}</div>
                    </div>`;
             }
             else {
                 const parts = item.file.name.split('.');
                 const ext = parts.length > 1 ? parts.pop().substring(0,4) : 'FILE';
                 contentHtml = `
                    <div class="file-card-content">
                        <div class="file-ext-badge">${this.escapeHtml(ext)}</div>
                        <div class="file-name-preview">${this.escapeHtml(item.file.name)}</div>
                    </div>`;
             }

             card.innerHTML = `
                ${contentHtml}
                <button class="attach-remove-btn" title="حذف">&times;</button>
             `;
             
             card.querySelector('.attach-remove-btn').onclick = (e) => {
                 e.stopPropagation();
                 this.removeAttachment(index);
             };
             
             list.appendChild(card);
        });
    },

    removeAttachment(index) {
        const item = this.state.pendingAttachments[index];
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);

        this.state.pendingAttachments.splice(index, 1);
        this.renderAttachmentPreview();
    },

    clearAttachment() { 
        this.state.pendingAttachments.forEach(item => {
            if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        this.state.pendingAttachments = []; 
        this.renderAttachmentPreview(); 
    },

    getFileIcon(type) {
        if(type === 'image') return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
        if(type === 'audio') return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';
        if(type === 'video') return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>';
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
    },
    
    async sendVoiceDirectly(file) {
        const tempId = Date.now() + 'voice';
        this.state.pendingAttachments = [{ file, type: 'voice', id: tempId }];
        this.sendPendingAttachment(); 
    },

    async downloadAndShowImage(msg, div) {
        if (this.state.mediaCache[msg.id]) {
            const img = document.createElement('img'); img.src = this.state.mediaCache[msg.id]; img.className = 'msg-image'; img.onclick = () => this.openLightbox(msg.id);
            const c = div.querySelector('.msg-loader') || div.querySelector('.msg-image'); if(c) c.replaceWith(img);
            return;
        }
        const blob = await this.fetchDecryptedFile(msg);
        if (blob) {
            const url = URL.createObjectURL(blob); this.state.mediaCache[msg.id] = url;
            const img = document.createElement('img'); img.src = url; img.className = 'msg-image'; img.onclick = () => this.openLightbox(msg.id);
            const c = div.querySelector('.msg-loader') || div.querySelector('.msg-image'); if(c) c.replaceWith(img);
        } else {
             const c = div.querySelector('.msg-loader') || div.querySelector('.msg-image'); if(c) c.innerHTML = '<span style="color:#ff4444;font-size:0.8rem">⚠️ بارگذاری تصویر ناموفق بود</span>';
        }
    },

    async loadMedia(msg, div, type) {
        const wrapperId = (type === 'audio') ? `audio-${msg.id}` : `video-${msg.id}`;
        try {
            if(!msg.fileInfo) throw new Error("متادیتای فایل موجود نیست");
            const blob = await this.fetchDecryptedFile(msg);
            if (blob) {
                const url = URL.createObjectURL(blob); this.state.mediaCache[msg.id] = url;
                let player = document.createElement(type === 'audio' ? 'audio' : 'video');
                player.className = type === 'audio' ? 'msg-audio-player' : 'msg-video';
                player.controls = true; player.preload = "metadata"; player.src = url;
                const dw = div.querySelector(`[id="${wrapperId}"]`); if (dw) dw.replaceWith(player.cloneNode(true));
                const lw = document.getElementById(wrapperId); if (lw) lw.replaceWith(player);
            } else throw new Error("رمزگشایی ناموفق بود");
        } catch(e) {
            const errMsg = `<span style="color:#ff4444;font-size:0.8rem">⚠️ خطا: ${this.escapeHtml(e.message)}</span>`;
            const dw = div.querySelector(`[id="${wrapperId}"]`); if (dw) dw.innerHTML = errMsg;
            const lw = document.getElementById(wrapperId); if (lw) lw.innerHTML = errMsg;
        }
    },

    async downloadFile(msgId, fileIndex = 0) {
        const msg = this.state.messages.find(function(m) { return m.id === msgId; });
        if(!msg || !msg.fileInfo) return;
        
        let targetFile = msg.fileInfo;
        if (Array.isArray(msg.fileInfo)) {
            if (msg.fileInfo[fileIndex]) targetFile = msg.fileInfo[fileIndex];
            else return;
        }

        const isGlobal = !document.getElementById('global-loader').classList.contains('hidden');
        if (!isGlobal) this.toggleGlobalLoader(true, "رمزگشایی فایل...", 0);
        
        const blob = await this.fetchDecryptedFileObject(targetFile); 
        
        if (!isGlobal) this.toggleGlobalLoader(false);
        
        if (blob) {
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = targetFile.name;
            document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 10000); 
        } else this.toast("رمزگشایی ناموفق بود.", true);
    },

    async downloadAllFiles(msgId) {
        const msg = this.state.messages.find(function(m) { return m.id === msgId; });
        if(!msg || !msg.fileInfo) return;
        const files = Array.isArray(msg.fileInfo) ? msg.fileInfo : [msg.fileInfo];
        
        this.toast("شروع دانلود فایل‌ها...");
        this.toggleGlobalLoader(true, "در حال دانلود گروهی...");
        
        for(let i=0; i<files.length; i++) {
            await this.downloadFile(msgId, i);
            await new Promise(r => setTimeout(r, 800));
        }
        
        this.toggleGlobalLoader(false);
        this.toast("دانلود تمام شد");
    },
    
    async fetchDecryptedFileObject(fileObj) {
        try {
            let res; let lastErr;
            // Retry fetch loop for files
            for (let i = 0; i < 3; i++) {
                try { 
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout per file attempt
                    res = await fetch(fileObj.url, { cache: 'no-cache', signal: controller.signal }); 
                    clearTimeout(timeoutId);
                    if (res.status === 200) break; 
                    throw new Error(`Server returned ${res.status}`); 
                } catch(e) { lastErr = e; }
                await new Promise(r => setTimeout(r, 1000));
            }
            if (!res || res.status !== 200) throw new Error(lastErr ? lastErr.message : "خطای شبکه/سرور");
            const encryptedBlob = await res.blob();
            if (encryptedBlob.type.indexOf('text/html') !== -1) throw new Error("محتوای فایل نامعتبر است");
            const encryptedBuf = await encryptedBlob.arrayBuffer();
            const decryptedBuf = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: window.CryptoUtils.hex2buf(fileObj.fileIV) }, fileObj.msgKey, encryptedBuf);
            return new Blob([decryptedBuf], { type: fileObj.type });
        } catch (e) { console.error("File decrypt/fetch error", e); return null; }
    },

    async fetchDecryptedFile(msg) {
        if (Array.isArray(msg.fileInfo)) return this.fetchDecryptedFileObject(msg.fileInfo[0]);
        return this.fetchDecryptedFileObject(msg.fileInfo);
    },

    async openTextViewer(msgId, fileIndex) {
        this.toggleGlobalLoader(true, "در حال بارگذاری متن...");

        const msg = this.state.messages.find(m => m.id === msgId);
        if(!msg || !msg.fileInfo) {
             this.toggleGlobalLoader(false);
             return;
        }
        
        let targetFile = msg.fileInfo;
        if(Array.isArray(msg.fileInfo)) targetFile = msg.fileInfo[fileIndex];

        try {
            const blob = await this.fetchDecryptedFileObject(targetFile);
            if(blob) {
                const text = await blob.text();
                $('#tv-filename').innerText = targetFile.name;
                const contentEl = $('#tv-content');
                contentEl.textContent = text;
                
                const rtlRegex = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
                if (rtlRegex.test(text)) {
                    contentEl.style.direction = 'rtl';
                    contentEl.style.textAlign = 'right';
                } else {
                    contentEl.style.direction = 'ltr';
                    contentEl.style.textAlign = 'left';
                }
                
                const dlBtn = $('#tv-btn-download');
                if(dlBtn) {
                     const newDlBtn = dlBtn.cloneNode(true);
                     dlBtn.parentNode.replaceChild(newDlBtn, dlBtn);
                     newDlBtn.onclick = () => this.downloadFile(msgId, fileIndex);
                }

                $('#modal-text-viewer').classList.remove('hidden');
            } else {
                this.toast("خطا در باز کردن فایل", true);
            }
        } catch(e) {
            console.error(e);
            this.toast("خطا در خواندن فایل", true);
        }
        this.toggleGlobalLoader(false);
    },

    closeTextViewer() {
        $('#modal-text-viewer').classList.add('hidden');
        $('#tv-content').textContent = ''; 
    },

    openLightbox(cacheKey) {
        if(this.state.mediaCache[cacheKey]) {
            document.getElementById('lightbox').classList.add('active');
            document.getElementById('lightbox-img').src = this.state.mediaCache[cacheKey];
            const dlBtn = document.getElementById('lightbox-download');
            dlBtn.href = this.state.mediaCache[cacheKey];
            dlBtn.download = 'image-' + cacheKey + '.png';
        }
    },

    formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 بایت'; const k = 1024; const i = Math.floor(Math.log(bytes) / Math.log(k));
        const sizes = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
        return (bytes / Math.pow(k, i)).toFixed(decimals < 0 ? 0 : decimals) + ' ' + sizes[i];
    }
});
