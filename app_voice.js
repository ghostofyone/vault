/**
 * app_voice.js - Voice Recording Logic
 */

Object.assign(window.App, {
    startRecording() {
        if (this.state.isRecording) return;
        try {
            navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
                this.state.mediaRecorder = new MediaRecorder(stream); this.state.recChunks = [];
                this.state.mediaRecorder.ondataavailable = e => this.state.recChunks.push(e.data);
                this.state.mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); this.onRecordingStopped(); };
                this.state.mediaRecorder.start(); this.state.isRecording = true;
                $('#voice-ui').classList.remove('hidden'); $('#voice-recording-state').classList.remove('hidden'); $('#voice-review-state').classList.add('hidden'); $('#input-area').classList.add('hidden');
                this.state.recTime = 0; $('#record-timer').innerText = "00:00";
                this.state.recTimer = setInterval(() => { this.state.recTime++; $('#record-timer').innerText = `${Math.floor(this.state.recTime/60).toString().padStart(2,'0')}:${(this.state.recTime%60).toString().padStart(2,'0')}`; }, 1000);
            }).catch(e => this.toast("دسترسی میکروفون رد شد", true));
        } catch (e) { this.toast("خطای میکروفون", true); }
    },
    stopRecording() { if (this.state.mediaRecorder && this.state.mediaRecorder.state === 'recording') this.state.mediaRecorder.stop(); },
    onRecordingStopped() {
        clearInterval(this.state.recTimer); this.state.recBlob = new Blob(this.state.recChunks, { type: 'audio/webm' });
        $('#voice-recording-state').classList.add('hidden'); $('#voice-review-state').classList.remove('hidden');
        $('#voice-preview-audio').src = URL.createObjectURL(this.state.recBlob);
    },
    sendVoice() { if (!this.state.recBlob) return; const file = new File([this.state.recBlob], "voice.webm", { type: 'audio/webm' }); this.handleFile(file, 'voice'); this.cancelRecord(); },
    cancelRecord() {
        if (this.state.mediaRecorder && this.state.mediaRecorder.state !== 'inactive') { this.state.mediaRecorder.onstop = null; this.state.mediaRecorder.stop(); }
        this.state.recChunks = []; this.state.recBlob = null; clearInterval(this.state.recTimer);
        const audio = $('#voice-preview-audio'); if(audio.src) { URL.revokeObjectURL(audio.src); audio.src = ''; }
        this.state.isRecording = false; $('#voice-ui').classList.add('hidden'); $('#input-area').classList.remove('hidden');
    }
});
