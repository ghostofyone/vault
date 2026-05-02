/**
 * Secure Vault Chat - Utilities
 * Contains: Crypto, API, Emoji List, DOM Helpers
 */

window.enc = new TextEncoder();
window.dec = new TextDecoder();

// --- Crypto Utilities ---
window.CryptoUtils = {
    async deriveRoomKey(password, salt) {
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw", window.enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]
        );
        return window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: window.enc.encode(salt),
                iterations: 600000, // MILITARY GRADE: Increased from 200k to 600k for 2025 Security Standards
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
        );
    },
    async generateMessageKey() {
        return window.crypto.subtle.generateKey(
            { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
        );
    },
    // For Text / Metadata (Returns Base64 String)
    async encryptContent(data, msgKey) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encoded = (typeof data === 'string') ? window.enc.encode(data) : data;
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, msgKey, encoded);
        return { iv: this.buf2hex(iv), data: this.buf2base64(ciphertext) };
    },
    // For Large Files (Returns Raw ArrayBuffer)
    async encryptBuffer(data, msgKey) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, msgKey, data);
        return { iv: this.buf2hex(iv), data: ciphertext }; 
    },
    async encryptMessageKey(msgKey, roomKey) {
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const rawKey = await window.crypto.subtle.exportKey("raw", msgKey);
        const encryptedKey = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, roomKey, rawKey);
        return { iv: this.buf2hex(iv), data: this.buf2base64(encryptedKey) };
    },
    async decryptEnvelope(envelope, roomKey) {
        try {
            const keyIv = this.hex2buf(envelope.keyIV);
            const keyData = this.base642buf(envelope.keyData);
            const rawMsgKey = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: keyIv }, roomKey, keyData);
            const msgKey = await window.crypto.subtle.importKey("raw", rawMsgKey, { name: "AES-GCM" }, true, ["decrypt"]);

            const contentIv = this.hex2buf(envelope.contentIV);
            const contentData = this.base642buf(envelope.contentData);
            const decryptedBuffer = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: contentIv }, msgKey, contentData);
            return decryptedBuffer;
        } catch (e) {
            return null;
        }
    },
    // Helper to decrypt simple content encrypted directly with room key (for verifier)
    async decryptSimple(obj, key) {
        try {
            const iv = this.hex2buf(obj.iv);
            const data = this.base642buf(obj.data);
            const dec = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
            return window.dec.decode(dec);
        } catch (e) {
            return null;
        }
    },
    buf2hex(buffer) { return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join(''); },
    hex2buf(hex) { return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))); },
    buf2base64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
        return btoa(binary);
    },
    base642buf(base64) {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
    },
    generateSalt() { return Math.random().toString(36).substring(2) + Date.now().toString(36); }
};

// --- API Wrapper ---
window.API = {
    // Robust fetch with timeout
    async fetchWithTimeout(resource, options = {}) {
        const { timeout = 25000 } = options; // 25s default timeout
        
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal  
        });
        clearTimeout(id);
        return response;
    },

    async post(action, data, retries = 2) {
        const fd = new FormData();
        fd.append('action', action);
        
        for (const k in data) {
            if (data[k] instanceof Blob) {
                fd.append(k, data[k]);
            } else if (typeof data[k] === 'object' && data[k] !== null) {
                fd.append(k, JSON.stringify(data[k]));
            } else {
                fd.append(k, data[k]);
            }
        }

        for (let i = 0; i <= retries; i++) {
            try {
                // Determine timeout based on action type
                const timeout = (action === 'upload_file' || action === 'send_message') ? 45000 : 20000;
                
                const res = await this.fetchWithTimeout('api.php', { 
                    method: 'POST', 
                    body: fd,
                    timeout: timeout
                });

                if (res.status === 429) throw new Error("آرام باشید! شما محدود شده‌اید.");
                if (res.status >= 500) throw new Error("خطای سرور");
                
                return await res.json();
            } catch (e) {
                const isNetworkError = e.name === 'AbortError' || e.message === 'Failed to fetch' || e.message.includes('NetworkError');
                
                // Only retry on network errors, not logic errors
                if (isNetworkError && i < retries) {
                    // Exponential backoff: 500ms, 1000ms...
                    await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
                    continue;
                }
                
                // If it's the last attempt or a non-retriable error
                return { status: 'error', message: e.message || 'خطای اتصال/سرور' };
            }
        }
    },

    uploadFile(action, data, onProgress) {
        return new Promise((resolve, reject) => {
            const fd = new FormData();
            fd.append('action', action);
            
            for (const k in data) {
                if (data[k] instanceof Blob) {
                    fd.append(k, data[k]);
                } else if (typeof data[k] === 'object' && data[k] !== null) {
                    fd.append(k, JSON.stringify(data[k]));
                } else {
                    fd.append(k, data[k]);
                }
            }

            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'api.php', true);
            
            // Set timeout for uploads (e.g., 60 seconds)
            xhr.timeout = 60000;

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    onProgress(percent);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const res = JSON.parse(xhr.responseText);
                        resolve(res);
                    } catch(e) { reject(new Error("پاسخ نامعتبر JSON")); }
                } else if (xhr.status === 429) {
                    reject(new Error("آرام باشید! محدود شده‌اید."));
                } else {
                    reject(new Error("آپلود ناموفق بود"));
                }
            };

            xhr.ontimeout = () => reject(new Error("زمان درخواست تمام شد (کندی اینترنت)"));
            xhr.onerror = () => reject(new Error("خطای شبکه"));
            
            try {
                xhr.send(fd);
            } catch(e) {
                reject(new Error("خطای اتصال"));
            }
        });
    }
};

window.EMOJI_LIST = {
    "صورت‌ها": ["😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧","😷","🤒","🤒","🤕"],
    "اشارات": ["👋","🤚","🖐","✋","🖖","👌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪"],
    "قلب‌ها": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝"],
    "اشیاء/نمادها": ["🔥","✨","🌟","💫","💥","💢","💦","💧","💤","💣","💬","👁️‍🗨️","🛑","✅","❌","💯","🎉","🎈","🎁","🏆","🏅","🥇","🥈","🥉"]
};

// --- DOM Helpers ---
window.$ = sel => document.querySelector(sel);
window.$$ = sel => document.querySelectorAll(sel);
