
/* [JS] V20.2 Full Restoration - The Engine in the Luxury Car */

// 確保所有資源載入後才執行
window.onload = function() {
    console.log("V20.2 System Initializing...");
    
    // ==========================================
    // 1. DOM 綁定 (抓取所有豪華介面的元件)
    // ==========================================
    const DOM = {
        video: document.querySelector('.input_video'),
        canvas: document.querySelector('.output_canvas'),
        // 使用安全檢查，避免 Canvas 上下文報錯
        ctx: document.querySelector('.output_canvas') ? document.querySelector('.output_canvas').getContext('2d') : null,
        loader: document.getElementById('loader'),
        
        // 顯示數據
        status: document.getElementById('status'),
        perclosDisplay: document.getElementById('main-perclos-display'),
        strategyDisplay: document.getElementById('strategy-display'),
        
        // 儀表板
        mTime: document.getElementById('metric-time'),
        mAlarms: document.getElementById('metric-alarms'),
        mFPS: document.getElementById('metric-fps'),
        mPerclos: document.getElementById('metric-perclos'),
        mPitch: document.getElementById('metric-pitch'),
        mYaw: document.getElementById('metric-yaw'),
        
        // 按鈕與控制
        btnBoot: document.getElementById('boot-btn'),
        btnMic: document.getElementById('btn-mic-toggle'),
        btnFalsePos: document.getElementById('btn-false-positive'),
        toggleDark: document.getElementById('darkModeToggle'),
        toggleChart: document.getElementById('toggleChart'),
        btnAudioStatus: document.getElementById('btn-audio-status'),
        btnVoiceTest: document.getElementById('btn-voice-test'),
        
        // 防禦核心按鈕
        btnDefCalib: document.getElementById('btn-def-calib'),
        btnDef3D: document.getElementById('btn-def-3d'),
        btnDefIris: document.getElementById('btn-def-iris'),
        defenseInfo: document.getElementById('defense-info-text'),
        
        // Modal 戰功牆
        modal: document.getElementById('changelog-modal'),
        btnLogTrigger: document.getElementById('changelog-trigger'),
        btnCloseLog: document.getElementById('close-changelog'),

        // 音量
        sliderAlarm: document.getElementById('volAlarmSlider'),
        sliderVoice: document.getElementById('volVoiceSlider')
    };

    // ==========================================
    // 2. 系統變數
    // ==========================================
    const CONFIG = {
        threshold: 0.25,
        aggressive_threshold: 0.35,
        def_dualCalib: true,
        def_3dComp: true,
        def_iris: false
    };

    let STATE = {
        cameraActive: false,
        audioUnlocked: false,
        micActive: false,
        strategy: 'conservative',
        lastFrameTime: Date.now(),
        frameCount: 0,
        startTime: Date.now(),
        alarmCount: 0
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
    // 3. 核心功能函數
    // ==========================================

    async function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        STATE.audioUnlocked = true;
        
        if(DOM.btnAudioStatus) {
            DOM.btnAudioStatus.innerText = "🔓 音效引擎就緒";
            DOM.btnAudioStatus.classList.replace('system-btn', 'green-btn');
        }
        speak("V20.2 系統全機能啟動");
    }

    function speak(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        u.volume = DOM.sliderVoice ? (DOM.sliderVoice.value / 100) : 1;
        window.speechSynthesis.speak(u);
    }

    function playTone(freq) {
        if (!STATE.audioUnlocked || !audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        const vol = DOM.sliderAlarm ? (DOM.sliderAlarm.value / 100) : 1;
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    }

    // 幾何運算
    function calculateEAR(landmarks, indices) {
        const d = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        const p1 = landmarks[indices[0]], p4 = landmarks[indices[3]];
        const p2 = landmarks[indices[1]], p6 = landmarks[indices[5]];
        const p3 = landmarks[indices[2]], p5 = landmarks[indices[4]];
        return (d(p2, p6) + d(p3, p5)) / (2.0 * d(p1, p4));
    }

    function calculateHeadPose(landmarks) {
        const W = DOM.canvas.width, H = DOM.canvas.height;
        const nose = landmarks[1], chin = landmarks[152];
        const left = landmarks[226], right = landmarks[446];
        let pitch = (nose.y * H - chin.y * H) / H * 100 + 50; 
        let yaw = ((nose.x * W - (left.x + right.x)/2 * W) / (Math.abs(left.x - right.x) * W)) * 100;
        return { pitch: pitch - 50, yaw: yaw }; 
    }

    function updateDefenseUI() {
        const setBtn = (btn, active) => {
            if(!btn) return;
            if(active) { btn.classList.add('active'); btn.classList.remove('off'); btn.querySelector('.def-status').innerText='ON'; }
            else { btn.classList.remove('active'); btn.classList.add('off'); btn.querySelector('.def-status').innerText='OFF'; }
        };
        setBtn(DOM.btnDefCalib, CONFIG.def_dualCalib);
        setBtn(DOM.btnDef3D, CONFIG.def_3dComp);
        setBtn(DOM.btnDefIris, CONFIG.def_iris);
        
        let txt = [];
        if(CONFIG.def_dualCalib) txt.push("雙點");
        if(CONFIG.def_3dComp) txt.push("3D");
        if(DOM.defenseInfo) DOM.defenseInfo.innerText = "動態策略: " + (txt.join('+') || "關閉");
    }

    // 視覺循環
    function onResults(results) {
        STATE.frameCount++;
        if(!DOM.canvas || !DOM.video) return;

        DOM.canvas.width = DOM.video.videoWidth;
        DOM.canvas.height = DOM.video.videoHeight;
        DOM.ctx.save();
        DOM.ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);
        
        if (results.image) DOM.ctx.drawImage(results.image, 0, 0, DOM.canvas.width, DOM.canvas.height);

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            
            // EAR 計算
            const leftIndices = [33, 160, 158, 133, 153, 144];
            const rightIndices = [362, 385, 387, 263, 373, 380];
            let avgEAR = (calculateEAR(landmarks, leftIndices) + calculateEAR(landmarks, rightIndices)) / 2;
            
            // 3D 姿勢計算
            const pose = calculateHeadPose(landmarks);
            if(DOM.mPitch) DOM.mPitch.innerText = pose.pitch.toFixed(1) + "°";
            if(DOM.mYaw) DOM.mYaw.innerText = pose.yaw.toFixed(1) + "°";
            
            // 3D 補償邏輯
            if (CONFIG.def_3dComp) {
                avgEAR = avgEAR * (1 + (pose.pitch * 0.002));
            }

            // 疲勞判斷
            const isClosed = avgEAR < CONFIG.threshold;
            DATA.closedFrameHistory.push(isClosed ? 1 : 0);
            if (DATA.closedFrameHistory.length > 150) DATA.closedFrameHistory.shift();
            
            if (isClosed) DATA.closedSeconds += 1/30; else DATA.closedSeconds = 0;
            const perclos = DATA.closedFrameHistory.reduce((a,b)=>a+b,0) / DATA.closedFrameHistory.length;

            // UI 更新
            if(DOM.perclosDisplay) DOM.perclosDisplay.innerText = `疲勞指數: ${(perclos*100).toFixed(1)}%`;
            if(DOM.mPerclos) DOM.mPerclos.innerText = (perclos*100).toFixed(1) + "%";
            
            const elapsed = Math.floor((Date.now() - STATE.startTime)/1000);
            const mins = Math.floor(elapsed/60).toString().padStart(2,'0');
            const secs = (elapsed%60).toString().padStart(2,'0');
            if(DOM.mTime) DOM.mTime.innerText = `${mins}:${secs}`;

            if (DOM.mFPS) {
                const fps = Math.round(1000 / (Date.now() - STATE.lastFrameTime));
                DOM.mFPS.innerText = fps + " FPS";
            }
            STATE.lastFrameTime = Date.now();

            // 繪圖
            DOM.ctx.strokeStyle = isClosed ? '#ef4444' : '#10b981';
            DOM.ctx.lineWidth = 2;
            const x = landmarks[1].x * DOM.canvas.width;
            const y = landmarks[1].y * DOM.canvas.height;
            DOM.ctx.strokeRect(x - 60, y - 80, 120, 160); // 簡易人臉框

            // 警報邏輯
            if (DATA.closedSeconds > 1.5 || perclos > 0.4) {
                DOM.status.className = "status-text danger";
                DOM.status.innerHTML = `<span class="line-1">🚨 危險</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
                if (STATE.frameCount % 15 === 0) {
                    playTone(880);
                    if(navigator.vibrate) navigator.vibrate(200);
                }
                // 警報計數
                if (DATA.closedSeconds > 1.5 && DATA.closedSeconds < 1.6) {
                    STATE.alarmCount++;
                    if(DOM.mAlarms) DOM.mAlarms.innerText = STATE.alarmCount + " 次";
                }
            } else {
                DOM.status.className = "status-text safe";
                DOM.status.innerHTML = `<span class="line-1">✅ 監控中</span><span class="line-2">EAR: ${avgEAR.toFixed(2)}</span>`;
            }
            
            // 圖表更新
            if (chart && STATE.frameCount % 5 === 0) {
                chart.data.datasets[0].data.push(perclos * 100);
                chart.data.datasets[0].data.shift();
                chart.update('none');
            }
        }
        DOM.ctx.restore();
    }

    // 4. 事件綁定 (恢復所有按鈕功能)
    if(DOM.btnBoot) {
        DOM.btnBoot.addEventListener('click', async () => {
            document.getElementById('system-boot-overlay').style.display = 'none';
            initAudio();
            
            DOM.loader.style.display = 'flex';
            
            if(document.getElementById('perclosChart')) {
                const ctx = document.getElementById('perclosChart').getContext('2d');
                chart = new Chart(ctx, {
                    type: 'line',
                    data: { labels: Array(50).fill(''), datasets: [{ label: 'PERCLOS', data: Array(50).fill(0), borderColor: '#f59e0b', fill: true }] },
                    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } }, animation: false }
                });
            }

            faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
            faceMesh.setOptions({maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
            faceMesh.onResults(onResults);

            camera = new Camera(DOM.video, {
                onFrame: async () => { await faceMesh.send({image: DOM.video}); },
                width: 1280, height: 720
            });
            
            await camera.start();
            DOM.loader.style.display = 'none';
            STATE.cameraActive = true;
            STATE.startTime = Date.now();
        });
    }

    // 附屬功能
    if(DOM.toggleDark) DOM.toggleDark.addEventListener('change', (e) => document.body.classList.toggle('dark-mode', e.target.checked));
    
    // 防禦核心
    if(DOM.btnDefCalib) DOM.btnDefCalib.addEventListener('click', () => { CONFIG.def_dualCalib = !CONFIG.def_dualCalib; updateDefenseUI(); });
    if(DOM.btnDef3D) DOM.btnDef3D.addEventListener('click', () => { CONFIG.def_3dComp = !CONFIG.def_3dComp; updateDefenseUI(); });
    if(DOM.btnDefIris) DOM.btnDefIris.addEventListener('click', () => { CONFIG.def_iris = !CONFIG.def_iris; updateDefenseUI(); });
    
    if(DOM.btnFalsePos) DOM.btnFalsePos.addEventListener('click', () => { CONFIG.threshold -= 0.02; speak("已降低標準"); });
    if(DOM.btnMic) DOM.btnMic.addEventListener('click', () => { STATE.micActive = !STATE.micActive; DOM.btnMic.classList.toggle('off'); speak(STATE.micActive?"麥克風開":"麥克風關"); });
    if(DOM.btnVoiceTest) DOM.btnVoiceTest.addEventListener('click', () => speak("語音測試正常"));
    
    // 戰功牆
    if(DOM.btnLogTrigger) DOM.btnLogTrigger.addEventListener('click', () => DOM.modal.style.display = 'flex');
    if(DOM.btnCloseLog) DOM.btnCloseLog.addEventListener('click', () => DOM.modal.style.display = 'none');
    if(DOM.toggleChart) DOM.toggleChart.addEventListener('click', () => {
        const c = document.getElementById('chartContainer');
        c.style.display = c.style.display === 'none' ? 'block' : 'none';
    });
};
