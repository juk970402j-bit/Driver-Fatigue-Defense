/* [JS] V20.1 One-Shot Fix - Complete Logic Transfer */

// 1. 等待所有外部連結 (MediaPipe) 下載完成
window.onload = function() {
    console.log("V20.1 Resources Loaded. Initializing...");
    
    // ==========================================
    // DOM 綁定
    // ==========================================
    const DOM = {
        video: document.querySelector('.input_video'),
        canvas: document.querySelector('.output_canvas'),
        ctx: document.querySelector('.output_canvas').getContext('2d'),
        loader: document.getElementById('loader'),
        status: document.getElementById('status'),
        perclosDisplay: document.getElementById('main-perclos-display'),
        strategyDisplay: document.getElementById('strategy-display'),
        btnBoot: document.getElementById('boot-btn'),
        btnMic: document.getElementById('btn-mic-toggle'),
        btnFalsePos: document.getElementById('btn-false-positive'),
        toggleDark: document.getElementById('darkModeToggle'),
        btnAudioStatus: document.getElementById('btn-audio-status'),
        sliderAlarm: document.getElementById('volAlarmSlider'),
        sliderVoice: document.getElementById('volVoiceSlider')
    };

    // ==========================================
    // 系統變數
    // ==========================================
    const CONFIG = {
        threshold: 0.25,
        aggressive_threshold: 0.35
    };

    let STATE = {
        cameraActive: false,
        audioUnlocked: false,
        micActive: false,
        strategy: 'conservative',
        lastFrameTime: Date.now(),
        frameCount: 0,
        startTime: Date.now()
    };

    let DATA = {
        closedFrameHistory: [],
        closedSeconds: 0,
        chartData: []
    };

    let faceMesh = null;
    let camera = null;
    let audioCtx = null;
    let chart = null;

    // ==========================================
    // 核心功能
    // ==========================================
    
    // 1. 音效引擎 (點擊啟動後才初始化)
    async function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        STATE.audioUnlocked = true;
        DOM.btnAudioStatus.innerText = "🔓 音效引擎就緒";
        DOM.btnAudioStatus.classList.replace('system-btn', 'green-btn');
        speak("系統啟動");
    }

    function speak(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        u.volume = DOM.sliderVoice.value / 100;
        window.speechSynthesis.speak(u);
    }

    function playTone(freq) {
        if (!STATE.audioUnlocked || !audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        gain.gain.setValueAtTime(DOM.sliderAlarm.value / 100, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    }

    // 2. 幾何運算
    function calculateEAR(landmarks, indices) {
        const d = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        const p1 = landmarks[indices[0]], p4 = landmarks[indices[3]];
        const p2 = landmarks[indices[1]], p6 = landmarks[indices[5]];
        const p3 = landmarks[indices[2]], p5 = landmarks[indices[4]];
        return (d(p2, p6) + d(p3, p5)) / (2.0 * d(p1, p4));
    }

    // 3. 視覺處理循環
    function onResults(results) {
        STATE.frameCount++;
        DOM.canvas.width = DOM.video.videoWidth;
        DOM.canvas.height = DOM.video.videoHeight;
        DOM.ctx.save();
        DOM.ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);
        
        if (results.image) DOM.ctx.drawImage(results.image, 0, 0, DOM.canvas.width, DOM.canvas.height);

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            const leftIndices = [33, 160, 158, 133, 153, 144];
            const rightIndices = [362, 385, 387, 263, 373, 380];
            const avgEAR = (calculateEAR(landmarks, leftIndices) + calculateEAR(landmarks, rightIndices)) / 2;
            
            // 判斷
            const isClosed = avgEAR < CONFIG.threshold;
            DATA.closedFrameHistory.push(isClosed ? 1 : 0);
            if (DATA.closedFrameHistory.length > 150) DATA.closedFrameHistory.shift();
            
            if (isClosed) DATA.closedSeconds += 1/30; else DATA.closedSeconds = 0;
            const perclos = DATA.closedFrameHistory.reduce((a,b)=>a+b,0) / DATA.closedFrameHistory.length;

            // UI
            DOM.perclosDisplay.innerText = `疲勞指數: ${(perclos*100).toFixed(1)}%`;
            if (document.getElementById('metric-fps')) {
                const fps = Math.round(1000 / (Date.now() - STATE.lastFrameTime));
                document.getElementById('metric-fps').innerText = fps + " FPS";
            }
            STATE.lastFrameTime = Date.now();

            // 繪圖
            DOM.ctx.strokeStyle = isClosed ? '#ef4444' : '#10b981';
            DOM.ctx.lineWidth = 2;
            // 簡化畫框邏輯
            const x = landmarks[1].x * DOM.canvas.width;
            const y = landmarks[1].y * DOM.canvas.height;
            DOM.ctx.strokeRect(x - 50, y - 50, 100, 100); // 測試用框

            // 警報
            if (DATA.closedSeconds > 1.5 || perclos > 0.4) {
                DOM.status.className = "status-text danger";
                DOM.status.innerHTML = `<span class="line-1">🚨 危險</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
                if (STATE.frameCount % 15 === 0) playTone(880);
            } else {
                DOM.status.className = "status-text safe";
                DOM.status.innerHTML = `<span class="line-1">✅ 監控中</span><span class="line-2">EAR: ${avgEAR.toFixed(2)}</span>`;
            }
            
            // 圖表
            if (chart && STATE.frameCount % 5 === 0) {
                chart.data.datasets[0].data.push(perclos * 100);
                chart.data.datasets[0].data.shift();
                chart.update('none');
            }
        }
        DOM.ctx.restore();
    }

    // 4. 啟動程序
    DOM.btnBoot.addEventListener('click', async () => {
        document.getElementById('system-boot-overlay').style.display = 'none';
        initAudio();
        
        DOM.loader.style.display = 'flex';
        
        // Chart 初始化
        const ctx = document.getElementById('perclosChart').getContext('2d');
        chart = new Chart(ctx, {
            type: 'line',
            data: { labels: Array(50).fill(''), datasets: [{ label: 'PERCLOS', data: Array(50).fill(0), borderColor: '#f59e0b', fill: true }] },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, animation: false }
        });

        // FaceMesh 初始化
        faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
        faceMesh.setOptions({maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
        faceMesh.onResults(onResults);

        // Camera 初始化
        camera = new Camera(DOM.video, {
            onFrame: async () => { await faceMesh.send({image: DOM.video}); },
            width: 1280, height: 720
        });
        
        await camera.start();
        DOM.loader.style.display = 'none';
        STATE.cameraActive = true;
    });

    // 輔助功能
    DOM.toggleDark.addEventListener('change', (e) => document.body.classList.toggle('dark-mode', e.target.checked));
    DOM.btnFalsePos.addEventListener('click', () => { CONFIG.threshold -= 0.02; speak("閾值降低"); });
    DOM.btnMic.addEventListener('click', () => { STATE.micActive = !STATE.micActive; DOM.btnMic.classList.toggle('off'); speak(STATE.micActive ? "麥克風開" : "麥克風關"); });
};
