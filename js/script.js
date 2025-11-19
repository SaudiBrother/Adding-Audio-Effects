const EFFECTS_CONFIG = {
    eq: { id: 'eq', name: 'Parametric EQ', icon: 'fa-solid fa-sliders', color: 'var(--c-warning)', params: { lowGain: { name: 'Low', type: 'knob', min: -24, max: 24, value: 0, step: 0.1, unit: 'dB' }, midGain: { name: 'Mid', type: 'knob', min: -24, max: 24, value: 0, step: 0.1, unit: 'dB' }, highGain: { name: 'High', type: 'knob', min: -24, max: 24, value: 0, step: 0.1, unit: 'dB' } } },
    compressor: { id: 'compressor', name: 'Compressor', icon: 'fa-solid fa-compress', color: 'var(--c-danger)', params: { threshold: { name: 'Thresh', type: 'knob', min: -60, max: 0, value: -24, step: 1, unit: 'dB' }, ratio: { name: 'Ratio', type: 'knob', min: 1, max: 20, value: 4, step: 0.1, unit: ':1' }, attack: { name: 'Attack', type: 'knob', min: 0, max: 1, value: 0.003, step: 0.001, unit: 's' }, release: { name: 'Release', type: 'knob', min: 0.01, max: 1, value: 0.25, step: 0.001, unit: 's' } } },
    delay: { id: 'delay', name: 'Stereo Delay', icon: 'fa-solid fa-stopwatch', color: 'var(--c-primary)', params: { time: { name: 'Time', type: 'knob', min: 0.01, max: 1.0, value: 0.3, step: 0.01, unit: 's' }, feedback: { name: 'F.Back', type: 'knob', min: 0, max: 0.9, value: 0.4, step: 0.01, unit: '%' }, mix: { name: 'Mix', type: 'knob', min: 0, max: 1, value: 0.4, step: 0.01, unit: '%' } } },
    reverb: { id: 'reverb', name: 'Reverb', icon: 'fa-solid fa-water', color: 'var(--c-accent)', params: { mix: { name: 'Mix', type: 'knob', min: 0, max: 1, value: 0.3, step: 0.01, unit: '%' }, decay: { name: 'Decay', type: 'knob', min: 0.5, max: 5, value: 2, step: 0.1, unit: 's' } } }
};

class DAWApp {
    constructor() {
        this.dom = {};
        this.audio = { ctx: null, nodes: {}, masterGain: null, analyser: null };
        this.state = {
            isPlaying: false, fileLoaded: false, audioBuffer: null,
            startTime: 0, startOffset: 0,
            fxChainOrder: JSON.parse(localStorage.getItem('fxChainOrder')) || ['eq', 'compressor', 'delay', 'reverb'],
            fxParams: {},
            masterPeak: 0, lastPeakTime: 0
        };
        this.visualizers = {};
        this.draggedElement = null;
    }

    init() {
        this.cacheDOM();
        this.initState();
        this.initAudioContext();
        this.initUI();
        this.initEventListeners();
        this.renderFXChain();
        this.startUpdateLoop();
        // Filter valid effects only
        this.state.fxChainOrder = this.state.fxChainOrder.filter(id => EFFECTS_CONFIG[id]);
    }

    cacheDOM() {
        const $ = (s) => document.querySelector(s);
        this.dom = {
            fileInput: $('#file-input'), uploadBtn: $('#upload-trigger-btn'),
            fileName: $('#file-name'), playBtn: $('#play-pause-btn'), playIcon: $('#play-pause-btn i'),
            downloadBtn: $('#download-btn'),
            waveformContainer: $('#waveform-container'), waveformCanvas: $('#waveform-canvas'), progressCanvas: $('#progress-overlay'), playhead: $('#playhead'),
            currentTime: $('#current-time'), totalDuration: $('#total-duration'),
            spectrogramCanvas: $('#spectrogram-canvas'), oscilloscopeCanvas: $('#oscilloscope-canvas'),
            fxChainContainer: $('#fx-chain-container'), moduleTemplate: $('#fx-module-template'),
            themeSelector: $('#theme-selector'), mainPanel: $('#main-panel'), 
            controlsPanel: $('#controls-panel'), resizer: $('#panel-resizer'),
            masterMeterBar: $('#master-meter-bar'), masterPeak: $('#master-peak-indicator'), masterReadout: $('#master-db-readout'),
            emptyMsg: $('#empty-chain-msg'), toastContainer: $('#toast-container'),
            resetBtn: $('#global-reset-btn')
        };
    }

    initState() {
        const savedTheme = localStorage.getItem('theme') || 'theme-dark';
        document.documentElement.className = savedTheme;
        this.dom.themeSelector.value = savedTheme;

        for (const fxId of this.state.fxChainOrder) {
            this.state.fxParams[fxId] = { bypass: false };
            if (EFFECTS_CONFIG[fxId]) {
                for (const paramId in EFFECTS_CONFIG[fxId].params) {
                    this.state.fxParams[fxId][paramId] = EFFECTS_CONFIG[fxId].params[paramId].value;
                }
            }
        }
    }

    initAudioContext() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audio.ctx = new AudioContext();
        this.audio.masterGain = this.audio.ctx.createGain();
        this.audio.analyser = this.audio.ctx.createAnalyser();
        this.audio.analyser.fftSize = 2048; this.audio.analyser.smoothingTimeConstant = 0.8;
        this.audio.masterGain.connect(this.audio.analyser);
        this.audio.analyser.connect(this.audio.ctx.destination);
        this.audio.meterData = new Float32Array(this.audio.analyser.fftSize);
        this.reverbBuffer = this.createImpulseResponse(this.audio.ctx, 2.0, 2.0);
        this.createFXNodes(this.audio.ctx, this.audio.nodes);
    }

    createFXNodes(ctx, targetNodeStorage) {
        for (const fxId in EFFECTS_CONFIG) {
            const input = ctx.createGain();
            const output = ctx.createGain();
            const group = { input, output, nodes: {} };
            switch(fxId) {
                case 'eq':
                    group.nodes.low = ctx.createBiquadFilter(); group.nodes.low.type = 'lowshelf'; group.nodes.low.frequency.value = 320;
                    group.nodes.mid = ctx.createBiquadFilter(); group.nodes.mid.type = 'peaking'; group.nodes.mid.frequency.value = 1000; group.nodes.mid.Q.value = 1;
                    group.nodes.high = ctx.createBiquadFilter(); group.nodes.high.type = 'highshelf'; group.nodes.high.frequency.value = 3200;
                    input.connect(group.nodes.low).connect(group.nodes.mid).connect(group.nodes.high).connect(output);
                    break;
                case 'compressor':
                    group.nodes.comp = ctx.createDynamicsCompressor();
                    input.connect(group.nodes.comp).connect(output); break;
                case 'delay':
                    group.nodes.delay = ctx.createDelay(2.0);
                    group.nodes.feedback = ctx.createGain(); group.nodes.wet = ctx.createGain(); group.nodes.dry = ctx.createGain();
                    input.connect(group.nodes.dry).connect(output);
                    input.connect(group.nodes.delay); group.nodes.delay.connect(group.nodes.feedback).connect(group.nodes.delay); group.nodes.delay.connect(group.nodes.wet).connect(output);
                    break;
                case 'reverb':
                    group.nodes.conv = ctx.createConvolver();
                    group.nodes.conv.buffer = this.reverbBuffer; group.nodes.dry = ctx.createGain(); group.nodes.wet = ctx.createGain();
                    input.connect(group.nodes.dry).connect(output); input.connect(group.nodes.conv).connect(group.nodes.wet).connect(output);
                    break;
            }
            targetNodeStorage[fxId] = group;
        }
    }

    initUI() {
        this.visualizers.waveform = new Waveform(this.dom.waveformCanvas, this.dom.progressCanvas);
        this.visualizers.spectrogram = new Spectrogram(this.dom.spectrogramCanvas, this.audio.analyser);
        this.visualizers.oscilloscope = new Oscilloscope(this.dom.oscilloscopeCanvas, this.audio.analyser);
    }

    initEventListeners() {
        this.dom.uploadBtn.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', this.handleFileLoad.bind(this));
        this.dom.downloadBtn.addEventListener('click', this.handleDownload.bind(this));
        this.dom.resetBtn.addEventListener('click', this.handleGlobalReset.bind(this));
        
        this.dom.themeSelector.addEventListener('change', (e) => {
            document.documentElement.className = e.target.value;
            localStorage.setItem('theme', e.target.value);
        });

        const togglePlay = async () => { 
            if(this.audio.ctx.state === 'suspended') await this.audio.ctx.resume(); 
            this.togglePlayback(); 
        };
        this.dom.playBtn.addEventListener('click', togglePlay);
        
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && this.state.fileLoaded && !e.target.closest('input') && !e.target.closest('[role="slider"]')) {
                e.preventDefault(); togglePlay();
            }
        });

        this.dom.waveformContainer.addEventListener('click', this.handleSeek.bind(this));
        this.dom.waveformContainer.addEventListener('keydown', (e) => {
            if (!this.state.fileLoaded) return;
            let step = this.state.audioBuffer.duration * 0.05;
            if (e.code === 'ArrowRight') {
                this.state.startOffset = Math.min(this.state.audioBuffer.duration, this.state.startOffset + step);
                this.restartPlayback(); e.preventDefault();
            } else if (e.code === 'ArrowLeft') {
                this.state.startOffset = Math.max(0, this.state.startOffset - step);
                this.restartPlayback(); e.preventDefault();
            } else if (e.code === 'Space') {
                togglePlay(); e.preventDefault();
            }
        });

        this.initPanelResizer();
        this.initDragAndDrop();
    }

    // --- UI HELPERS ---
    showToast(msg, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="fa-solid ${type==='error'?'fa-circle-exclamation':type==='success'?'fa-check-circle':'fa-info-circle'}"></i> ${msg}`;
        this.dom.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- PLAYBACK & HANDLING ---
    async handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;
        if(this.state.isPlaying) this.pause();
        
        this.dom.fileName.textContent = "Decoding...";
        this.dom.playBtn.disabled = true; this.dom.downloadBtn.disabled = true;
        
        // Resume AudioContext on user gesture
        if(this.audio.ctx.state === 'suspended') await this.audio.ctx.resume();

        try {
            const arrayBuffer = await file.arrayBuffer();
            this.state.audioBuffer = await this.audio.ctx.decodeAudioData(arrayBuffer);
            this.state.fileLoaded = true;
            this.dom.fileName.textContent = file.name;
            this.dom.totalDuration.textContent = this.formatTime(this.state.audioBuffer.duration);
            this.dom.playBtn.disabled = false; this.dom.downloadBtn.disabled = false;
            this.state.startOffset = 0; this.updatePlayhead();
            this.visualizers.waveform.draw(this.state.audioBuffer);
            this.showToast(`Loaded: ${file.name}`, 'success');
        } catch (err) {
            console.error(err);
            this.dom.fileName.textContent = "Load Failed";
            this.showToast("Gagal memuat file audio. Format mungkin tidak didukung.", 'error');
        } finally {
            this.dom.fileInput.value = "";
        }
    }

    togglePlayback() { if (!this.state.fileLoaded) return; this.state.isPlaying ? this.pause() : this.play(); }
    
    play() {
        if(this.audio.sourceNode) { try{this.audio.sourceNode.disconnect();}catch(e){} }
        this.audio.sourceNode = this.audio.ctx.createBufferSource();
        this.audio.sourceNode.buffer = this.state.audioBuffer;
        this.connectFXChain(this.audio.sourceNode, this.audio.masterGain, this.audio.nodes);
        
        this.state.startTime = this.audio.ctx.currentTime;
        const offset = Math.min(this.state.startOffset, this.state.audioBuffer.duration);
        this.audio.sourceNode.start(0, offset);
        this.state.isPlaying = true;
        this.dom.playIcon.className = 'fa-solid fa-pause';
        
        this.audio.sourceNode.onended = () => {
            const playedTime = this.audio.ctx.currentTime - this.state.startTime;
            if (this.state.isPlaying && (playedTime + offset >= this.state.audioBuffer.duration - 0.1)) {
                this.pause();
                this.state.startOffset = 0; this.updatePlayhead();
            }
        };
    }

    pause() {
        if (this.audio.sourceNode) { try { this.audio.sourceNode.stop(); } catch(e) {} }
        if(this.state.isPlaying) this.state.startOffset += this.audio.ctx.currentTime - this.state.startTime;
        this.state.isPlaying = false;
        this.dom.playIcon.className = 'fa-solid fa-play';
    }

    restartPlayback() { if (this.state.isPlaying) { this.pause(); this.play(); } else { this.updatePlayhead(); } }

    handleSeek(e) {
        if (!this.state.fileLoaded) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.state.startOffset = pct * this.state.audioBuffer.duration;
        this.restartPlayback();
    }

    handleGlobalReset() {
        if(!confirm("Reset semua efek ke pengaturan awal?")) return;
        
        // Reset parameters to config defaults
        for (const fxId of this.state.fxChainOrder) {
            if (EFFECTS_CONFIG[fxId]) {
                this.state.fxParams[fxId].bypass = false;
                for (const paramId in EFFECTS_CONFIG[fxId].params) {
                    this.state.fxParams[fxId][paramId] = EFFECTS_CONFIG[fxId].params[paramId].value;
                }
            }
        }
        // Re-render UI and update audio nodes
        this.renderFXChain();
        this.showToast("Semua efek di-reset", "info");
    }

    connectFXChain(source, destination, nodeStorage) {
        source.disconnect(); let currentHead = source;
        this.state.fxChainOrder.forEach(fxId => {
            const nodes = nodeStorage[fxId];
            if(nodes) { currentHead.connect(nodes.input); currentHead = nodes.output; }
        });
        currentHead.connect(destination);
    }

    renderFXChain() {
        this.dom.fxChainContainer.innerHTML = '';
        if(this.state.fxChainOrder.length > 0) this.dom.emptyMsg.style.display = 'none';
        this.state.fxChainOrder.forEach(fxId => {
            if(EFFECTS_CONFIG[fxId]) {
                const el = this.createModuleElement(fxId, EFFECTS_CONFIG[fxId]);
                this.dom.fxChainContainer.appendChild(el);
            }
        });
        this.applyAllParams(this.audio.nodes, this.audio.ctx);
    }

    applyAllParams(targetNodes, ctx) {
        for (const fxId in this.state.fxParams) {
            for (const paramId in this.state.fxParams[fxId]) {
                this.updateSingleParamNode(targetNodes[fxId], fxId, paramId, this.state.fxParams[fxId][paramId], ctx);
            }
        }
    }

    updateSingleParamNode(fxGroup, fxId, paramId, value, ctx) {
        if (!fxGroup) return;
        const time = ctx.currentTime;
        if (paramId === 'bypass') { fxGroup.input.gain.setTargetAtTime(value ? 0 : 1, time, 0.02); return; }
        const { nodes } = fxGroup;
        switch(fxId) {
            case 'eq':
                if (paramId === 'lowGain') nodes.low.gain.setTargetAtTime(value, time, 0.01);
                if (paramId === 'midGain') nodes.mid.gain.setTargetAtTime(value, time, 0.01);
                if (paramId === 'highGain') nodes.high.gain.setTargetAtTime(value, time, 0.01); break;
            case 'compressor': if (nodes.comp[paramId]) nodes.comp[paramId].setTargetAtTime(value, time, 0.01); break;
            case 'delay':
                if (paramId === 'time') nodes.delay.delayTime.setTargetAtTime(value, time, 0.1);
                if (paramId === 'feedback') nodes.feedback.gain.setTargetAtTime(value, time, 0.01);
                if (paramId === 'mix') { nodes.dry.gain.setTargetAtTime(1 - value, time, 0.01); nodes.wet.gain.setTargetAtTime(value, time, 0.01); } break;
            case 'reverb':
                if (paramId === 'mix') { nodes.dry.gain.setTargetAtTime(1 - value, time, 0.01); nodes.wet.gain.setTargetAtTime(value, time, 0.01); } break;
        }
    }

    createModuleElement(fxId, config) {
        const clone = this.dom.moduleTemplate.content.cloneNode(true);
        const mod = clone.querySelector('.fx-module');
        mod.dataset.fxId = fxId; mod.style.borderLeftColor = config.color;
        mod.querySelector('.module-icon').className = config.icon;
        mod.querySelector('.fx-module-title').textContent = config.name;
        mod.querySelector('.fx-module-title').style.color = config.color;
        const container = mod.querySelector('.fx-module-controls');
        for (const pid in config.params) container.appendChild(this.createKnob(fxId, pid, config.params[pid]));

        const bypassToggle = mod.querySelector('.bypass-toggle');
        bypassToggle.checked = !this.state.fxParams[fxId].bypass;
        bypassToggle.addEventListener('change', (e) => {
            const isBypassed = !e.target.checked;
            this.state.fxParams[fxId].bypass = isBypassed;
            this.updateSingleParamNode(this.audio.nodes[fxId], fxId, 'bypass', isBypassed, this.audio.ctx);
            if(isBypassed) mod.classList.add('bypassed'); else mod.classList.remove('bypassed');
        });
        if(this.state.fxParams[fxId].bypass) mod.classList.add('bypassed');

        // KEYBOARD DRAG & DROP [ACCESSIBILITY]
        const dragHandle = mod.querySelector('.drag-handle');
        dragHandle.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mod.classList.contains('reordering')) {
                // Cancel Reorder
                e.preventDefault();
                mod.classList.remove('reordering');
                dragHandle.classList.remove('active');
                this.showToast("Reorder cancelled", 'info');
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (mod.classList.contains('reordering')) {
                    // Drop
                    mod.classList.remove('reordering');
                    dragHandle.classList.remove('active');
                    this.updateChainOrder();
                    this.showToast(`${config.name} moved`, 'success');
                } else {
                    // Grab
                    mod.classList.add('reordering');
                    dragHandle.classList.add('active');
                    this.showToast(`Moving ${config.name}. Use Arrows. ESC to cancel.`, 'reorder');
                }
            } else if (mod.classList.contains('reordering')) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = mod.previousElementSibling;
                    if (prev) { mod.parentNode.insertBefore(mod, prev); mod.focus(); }
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = mod.nextElementSibling;
                    if (next) { mod.parentNode.insertBefore(next, mod); mod.focus(); }
                }
            }
        });
        return mod;
    }

    createKnob(fxId, paramId, conf) {
        const group = document.createElement('div'); group.className = 'control-group';
        const wrapper = document.createElement('div'); wrapper.className = 'knob-wrapper'; wrapper.title = `Double click to reset ${conf.name}`;
        const ticks = document.createElement('div'); ticks.className = 'knob-ticks';
        for(let i=0; i<9; i++) { const t = document.createElement('div'); t.className = 'knob-tick'; t.style.transform = `rotate(${-135 + i*33.75}deg)`; ticks.appendChild(t); }
        const visual = document.createElement('div'); visual.className = 'knob-visual';
        const input = document.createElement('input'); input.type = 'range'; input.className = 'knob'; input.min = conf.min; input.max = conf.max;
        input.step = conf.step; input.value = conf.value;
        input.setAttribute('aria-label', `${conf.name} Control`);
        const label = document.createElement('label'); label.className = 'knob-label'; label.textContent = conf.name;
        const display = document.createElement('span'); display.className = 'knob-value';

        const update = (val) => {
            this.state.fxParams[fxId][paramId] = parseFloat(val);
            this.updateSingleParamNode(this.audio.nodes[fxId], fxId, paramId, parseFloat(val), this.audio.ctx);
            const pct = (val - conf.min) / (conf.max - conf.min);
            visual.style.setProperty('--rotation', `${-135 + (pct * 270)}deg`);
            let txt = parseFloat(val).toFixed(1);
            if (conf.unit === 'Hz') txt = val >= 1000 ? (val/1000).toFixed(1)+'k' : Math.round(val);
            display.textContent = txt + (conf.unit === ':1' ? '' : conf.unit);
        };

        input.addEventListener('input', (e) => update(e.target.value));
        input.addEventListener('dblclick', () => {
            input.value = conf.value; update(conf.value);
            display.classList.add('reset-flash');
            this.showToast(`Reset ${conf.name}`, 'info');
            setTimeout(() => display.classList.remove('reset-flash'), 300);
        });
        update(conf.value);
        wrapper.append(ticks, visual, input); group.append(wrapper, display, label);
        return group;
    }

    updateChainOrder() {
        const newOrder = [...this.dom.fxChainContainer.querySelectorAll('.fx-module')].map(el => el.dataset.fxId);
        this.state.fxChainOrder = newOrder;
        localStorage.setItem('fxChainOrder', JSON.stringify(newOrder));
        if (this.audio.sourceNode) this.connectFXChain(this.audio.sourceNode, this.audio.masterGain, this.audio.nodes);
    }

    async handleDownload() {
        if (!this.state.audioBuffer) return;
        const oldText = this.dom.downloadBtn.innerHTML;
        this.dom.downloadBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
        this.dom.downloadBtn.disabled = true;
        try {
            const offlineCtx = new OfflineAudioContext(2, this.state.audioBuffer.length, this.state.audioBuffer.sampleRate);
            const offlineNodes = {};
            this.createFXNodes(offlineCtx, offlineNodes);
            this.applyAllParams(offlineNodes, offlineCtx);
            if (offlineNodes.reverb && !this.state.fxParams.reverb.bypass) {
                const decay = this.state.fxParams.reverb.decay || 2.0;
                offlineNodes.reverb.nodes.conv.buffer = this.createImpulseResponse(offlineCtx, decay, decay);
            }
            const source = offlineCtx.createBufferSource();
            source.buffer = this.state.audioBuffer;
            this.connectFXChain(source, offlineCtx.destination, offlineNodes);
            source.start(0);
            const renderedBuffer = await offlineCtx.startRendering();
            const wav = this.bufferToWave(renderedBuffer);
            const url = URL.createObjectURL(wav);
            const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = `DAW_Render_${Date.now()}.wav`;
            document.body.appendChild(a); a.click(); setTimeout(() => URL.revokeObjectURL(url), 100);
            this.showToast("Render Selesai", 'success');
        } catch (e) {
            console.error(e);
            this.showToast("Gagal Render", 'error');
        } finally {
            this.dom.downloadBtn.innerHTML = oldText;
            this.dom.downloadBtn.disabled = false;
        }
    }

    startUpdateLoop() {
        const loop = () => {
            if (document.hidden) { requestAnimationFrame(loop); return; }
            if(this.state.isPlaying) this.updatePlayhead();
            if(this.state.fileLoaded) { this.visualizers.spectrogram.draw(); this.visualizers.oscilloscope.draw(); this.updateMeters(); }
            requestAnimationFrame(loop);
        }; loop();
    }

    updatePlayhead() {
        const dur = this.state.audioBuffer ? this.state.audioBuffer.duration : 1;
        let curr = this.state.startOffset;
        if(this.state.isPlaying) curr += (this.audio.ctx.currentTime - this.state.startTime);
        curr = Math.max(0, Math.min(curr, dur));
        const pct = (curr / dur) * 100;
        this.dom.playhead.style.left = `${pct}%`;
        this.dom.waveformContainer.setAttribute('aria-valuenow', Math.round(pct));
        this.dom.currentTime.textContent = this.formatTime(curr);
        this.visualizers.waveform.updateOverlay(pct);
    }

    updateMeters() {
        this.audio.analyser.getFloatTimeDomainData(this.audio.meterData);
        let sum = 0, peak = 0;
        for(let i=0; i<this.audio.meterData.length; i+=4) { const a = this.audio.meterData[i]; sum += a*a; if(Math.abs(a) > peak) peak = Math.abs(a); }
        const rms = Math.sqrt(sum / (this.audio.meterData.length/4));
        const db = 20 * Math.log10(rms || 0.0001);
        this.dom.masterMeterBar.style.width = `${Math.min(100, Math.max(0, (db + 60) / 60 * 100))}%`;
        this.dom.masterReadout.textContent = `${db.toFixed(1)} dB`;
        if (peak > this.state.masterPeak) { this.state.masterPeak = peak; this.state.lastPeakTime = Date.now();
        } else if (Date.now() - this.state.lastPeakTime > 1000) { this.state.masterPeak *= 0.95; }
        this.dom.masterPeak.style.left = `${Math.min(100, Math.max(0, (20 * Math.log10(this.state.masterPeak || 0.0001) + 60) / 60 * 100))}%`;
    }

    // --- FULLY IMPLEMENTED DRAG & DROP ---
    initDragAndDrop() {
        const container = this.dom.fxChainContainer;
        
        container.addEventListener('dragstart', e => {
            if(e.target.classList.contains('fx-module')) {
                this.draggedElement = e.target;
                e.target.classList.add('dragging');
                // Set drag effect
                e.dataTransfer.effectAllowed = 'move';
            }
        });

        container.addEventListener('dragend', e => {
            if(this.draggedElement) {
                this.draggedElement.classList.remove('dragging');
                this.draggedElement = null;
                this.updateChainOrder(); // Save order & reconnect Audio
            }
        });

        container.addEventListener('dragover', e => {
            e.preventDefault(); // Necessary to allow dropping
            e.dataTransfer.dropEffect = 'move';
            
            const afterElement = this.getDragAfterElement(container, e.clientY);
            const draggable = document.querySelector('.dragging');
            if (!draggable) return;

            if (afterElement == null) {
                container.appendChild(draggable);
            } else {
                container.insertBefore(draggable, afterElement);
            }
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.fx-module:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // --- IMPLEMENTED PANEL RESIZER ---
    initPanelResizer() {
        let isResizing = false;
        const resizer = this.dom.resizer;
        const panel = this.dom.controlsPanel;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            // Calculate new width from right side of screen
            const newWidth = document.body.clientWidth - e.clientX;
            // Min 300px, Max 600px
            if (newWidth > 300 && newWidth < 600) {
                panel.style.width = `${newWidth}px`;
            }
        });

        window.addEventListener('mouseup', () => {
            if(isResizing) {
                isResizing = false;
                document.body.style.cursor = 'default';
            }
        });
    }

    // --- UTILS ---
    formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 100);
        return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    }

    createImpulseResponse(ctx, duration, decay) {
        const len = ctx.sampleRate * duration;
        const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
        for(let c=0; c<2; c++) {
            const chData = buffer.getChannelData(c);
            for(let i=0; i<len; i++) chData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i/len, decay);
        }
        return buffer;
    }
    
    bufferToWave(abuffer) {
        const numOfChan = abuffer.numberOfChannels, length = abuffer.length * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length), view = new DataView(buffer);
        const channels = [], sampleRate = abuffer.sampleRate;
        let offset = 0, pos = 0;

        function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
        function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

        setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); 
        setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(sampleRate); setUint32(sampleRate * 2 * numOfChan); 
        setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

        for(let i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));
        while(pos < length) {
            for(let i = 0; i < numOfChan; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0;
                view.setInt16(pos, sample, true); pos += 2;
            }
            offset++;
        }
        return new Blob([buffer], { type: "audio/wav" });
    }
}

// Visualizer Classes (Simplified placeholders for context)
class Waveform {
    constructor(c1, c2) { this.c1 = c1; this.ctx1 = c1.getContext('2d'); this.c2 = c2; this.ctx2 = c2.getContext('2d'); this.data = null; }
    draw(buffer) { 
        this.data = buffer.getChannelData(0); 
        this.resize(); 
        this.paint(this.ctx1, '#363c47'); 
    }
    resize() {
        const p = this.c1.parentElement;
        this.c1.width = this.c2.width = p.clientWidth; this.c1.height = this.c2.height = p.clientHeight;
        if(this.data) this.paint(this.ctx1, '#363c47');
    }
    paint(ctx, color) {
        ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = color; ctx.beginPath();
        const step = Math.ceil(this.data.length / ctx.canvas.width);
        const amp = ctx.canvas.height / 2;
        for(let i=0; i<ctx.canvas.width; i++) {
            let min=1.0, max=-1.0;
            for(let j=0; j<step; j++) { const v = this.data[i*step + j]; if(v < min) min=v; if(v > max) max=v; }
            ctx.fillRect(i, (1+min)*amp, 1, Math.max(1, (max-min)*amp));
        }
    }
    updateOverlay(pct) {
        this.ctx2.clearRect(0,0,this.c2.width, this.c2.height);
        this.ctx2.fillStyle = 'rgba(13, 110, 253, 0.3)';
        this.ctx2.fillRect(0, 0, this.c2.width * (pct/100), this.c2.height);
    }
}
class Spectrogram {
    constructor(c, a) { this.c = c; this.ctx = c.getContext('2d'); this.a = a; this.d = new Uint8Array(a.frequencyBinCount); }
    draw() {
        this.a.getByteFrequencyData(this.d);
        const w = this.c.width, h = this.c.height;
        // Simple cascading or line viz
        this.ctx.fillStyle = 'rgba(0,0,0,0.1)'; this.ctx.fillRect(0,0,w,h);
        const barW = w / this.d.length * 2.5; let x = 0;
        for(let i=0; i<this.d.length; i++) {
            const val = this.d[i];
            this.ctx.fillStyle = `rgb(${val}, 50, 200)`;
            this.ctx.fillRect(x, h - val/255*h, barW, val/255*h);
            x += barW + 1;
        }
    }
}
class Oscilloscope {
    constructor(c, a) { this.c = c; this.ctx = c.getContext('2d'); this.a = a; this.d = new Uint8Array(a.fftSize); }
    draw() {
        this.a.getByteTimeDomainData(this.d);
        const w = this.c.width, h = this.c.height;
        this.ctx.fillStyle = '#252930'; this.ctx.fillRect(0,0,w,h);
        this.ctx.lineWidth = 2; this.ctx.strokeStyle = '#0d6efd'; this.ctx.beginPath();
        const slice = w * 1.0 / this.d.length; let x = 0;
        for(let i=0; i<this.d.length; i++) {
            const v = this.d[i] / 128.0; const y = v * h/2;
            i===0 ? this.ctx.moveTo(x,y) : this.ctx.lineTo(x,y);
            x += slice;
        }
        this.ctx.stroke();
    }
}

// Init
window.addEventListener('DOMContentLoaded', () => { const app = new DAWApp(); app.init(); });
