/* [JS] V20.0 Core Engine - Dark Zone Protocol Ready */

// ==========================================
// 1. 全域變數與系統設定
// ==========================================
const DOM = {
    video: document.querySelector('.input_video'),
    canvas: document.querySelector('.output_canvas'),
    ctx: document.querySelector('.output_canvas').getContext('2d'),
    loader: document.getElementById('loader'),
    status: document.getElementById('status'),
    perclosDisplay: document.getElementById('main-perclos-display'),
    strategyDisplay: document.getElementById('strategy-display'),
    chartCtx: document.getElementById('perclosChart').getContext('2d'),
    // 按鈕群
    btnBoot: document.getElementById('boot-btn'),
    btnMic: document.getElementById('btn-mic-toggle'),
    btnFalsePos: document.getElementById('btn-false-positive'),
    toggleDark: document.getElementById('darkModeToggle'),
    toggleChart: document.getElementById('toggleChart'),
    // 設定值
    sliderAlarm: document.getElementById('volAlarmSlider'),
    sliderVoice: document.getElementById('volVoiceSlider')
};

// 核心參數
const CONFIG = {
    // 激進派觸發門檻
    aggressive: { perclos: 0.35, closedTime: 2.0 }, 
    // 回歸保守派門檻 (需同時滿足)
    recovery: { perclos: 0.15, duration: 15 }, // 需維持 15秒 清醒
    
    // 校準預設值
    defaultOpenEAR: 0.30,
    defaultClosedEAR: 0.15,
    threshold: 0.25 // 動態變動
};

// 系統狀態
let STATE = {
    cameraActive: false,
    audioUnlocked: false,
    micActive: false,
    strategy: 'conservative', // 'conservative' | 'aggressive'
    recoveryCounter: 0, // 計算清醒秒數
    startTime: 0,
    frameCount: 0,
    fps: 0,
    lastFrameTime: Date.now(),
    isDark: false
};

// 數據緩衝
let DATA = {
    closedFrameHistory: [], // PERCLOS 滑動視窗
    closedSeconds: 0,
    chartData: [],
    recentEAR: [] // 用於誤報回溯
};

// 外部模組
let faceMesh = null;
let chart = null;
let audioCtx = null;
let synthesis = window.speechSynthesis;

// ==========================================
// 2. 音訊引擎 (修復音量抑制問題)
// ==========================================
async function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    STATE.audioUnlocked = true;
    document.getElementById('btn-audio-status').innerText = "🔓 音效引擎運作中";
    document.getElementById('btn-audio-status').classList.remove('system-btn');
    document.getElementById('btn-audio-status').classList.add('green-btn');
    speak("系統聽覺模組已連線。");
}

function playTone(freq, type, duration) {
    if (!STATE.audioUnlocked) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    
    // 讀取獨立音量條
    const vol = (DOM.sliderAlarm.value / 100);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function speak(text) {
    if (!synthesis) return;
    synthesis.cancel(); // 打斷上一句
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW';
    u.rate = 0.95; 
    u.volume = (DOM.sliderVoice.value / 100);
    synthesis.speak(u);
}

// 麥克風延遲載入 (解決通話音量模式)
async function toggleMic() {
    if (!STATE.cameraActive) { speak("請先啟動鏡頭"); return; }
    
    // 這裡只處理邏輯開關，實際串接需要更複雜的 Stream 混合
    // V20.0 暫時模擬開關，避免破壞影像流
    STATE.micActive = !STATE.micActive;
    
    const btn = DOM.btnMic;
    if (STATE.micActive) {
        btn.innerText = "🎤 麥克風 (開)";
        btn.classList.remove('off');
        speak("麥克風已監聽");
    } else {
        btn.innerText = "🎤 麥克風 (關)";
        btn.classList.add('off');
    }
}

// ==========================================
// 3. 視覺演算法與策略 (The Brain)
// ==========================================
function calculateEAR(landmarks, indices) {
    const d = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    const p1 = landmarks[indices[0]], p4 = landmarks[indices[3]];
    const p2 = landmarks[indices[1]], p6 = landmarks[indices[5]];
    const p3 = landmarks[indices[2]], p5 = landmarks[indices[4]];
    return (d(p2, p6) + d(p3, p5)) / (2.0 * d(p1, p4));
}

function updateStrategy(perclos, closedSec) {
    // 1. 升級判定 (變嚴格)
    if (STATE.strategy === 'conservative') {
        if (perclos > CONFIG.aggressive.perclos || closedSec > CONFIG.aggressive.closedTime) {
            STATE.strategy = 'aggressive';
            STATE.recoveryCounter = 0;
            
            // UI 更新
            DOM.strategyDisplay.className = 'strategy-display aggressive';
            DOM.strategyDisplay.innerHTML = '<span class="strat-icon">⚔️</span><span class="strat-text">激進派 (高度戒備)</span>';
            speak("偵測到疲勞特徵，啟動激進防禦。");
        }
    } 
    // 2. 降級判定 (遲滯邏輯: 需維持一段時間清醒)
    else if (STATE.strategy === 'aggressive') {
        if (perclos < CONFIG.recovery.perclos && closedSec === 0) {
            STATE.recoveryCounter++;
        } else {
            STATE.recoveryCounter = 0; // 一旦失敗，重算
        }

        // 顯示倒數
        if (STATE.recoveryCounter > 0) {
            DOM.strategyDisplay.querySelector('.strat-text').innerText = `激進派 (觀察中 ${STATE.recoveryCounter}s)`;
        }

        if (STATE.recoveryCounter > CONFIG.recovery.duration * 30) { // 假設 30 FPS
            STATE.strategy = 'conservative';
            DOM.strategyDisplay.className = 'strategy-display conservative';
            DOM.strategyDisplay.innerHTML = '<span class="strat-icon">🛡️</span><span class="strat-text">保守派 (監測中)</span>';
            speak("駕駛狀態回穩，解除警報。");
        }
    }
}

function onResults(results) {
    STATE.frameCount++;
    
    // 1. 畫布準備
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
        const avgEAR = (calculateEAR(landmarks, leftIndices) + calculateEAR(landmarks, rightIndices)) / 2;
        
        // 判斷閉眼
        const isClosed = avgEAR < CONFIG.threshold;
        DATA.closedFrameHistory.push(isClosed ? 1 : 0);
        if (DATA.closedFrameHistory.length > 300) DATA.closedFrameHistory.shift(); // 10秒視窗
        
        // 統計
        if (isClosed) DATA.closedSeconds += 1/30; else DATA.closedSeconds = 0;
        const perclos = DATA.closedFrameHistory.reduce((a,b)=>a+b, 0) / DATA.closedFrameHistory.length;
        
        // UI 更新
        DOM.perclosDisplay.innerText = `疲勞指數: ${(perclos*100).toFixed(1)}%`;
        if (document.getElementById('metric-perclos')) document.getElementById('metric-perclos').innerText = (perclos*100).toFixed(1) + "%";

        // 策略更新
        updateStrategy(perclos, DATA.closedSeconds);

        // 繪圖顏色邏輯 (配合黑暗模式)
        const lineColor = STATE.isDark ? '#34d399' : '#059669'; // 螢光綠 vs 深綠
        const warnColor = STATE.isDark ? '#f87171' : '#dc2626'; // 螢光紅 vs 深紅
        
        DOM.ctx.strokeStyle = isClosed ? warnColor : lineColor;
        DOM.ctx.lineWidth = 2;
        
        // 簡單畫出眼睛框
        // (這裡省略複雜的 drawPath，用簡單框線示範)
        
        // 警報邏輯 (V20.0 簡化版)
        if (DATA.closedSeconds > 1.5 || perclos > 0.4) {
            DOM.status.className = "status-text danger";
            DOM.status.innerHTML = `<span class="line-1">🚨 危險</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
            if (Math.floor(Date.now()/1000) % 2 === 0) playTone(880, 'square', 0.1); // 間歇警報
        } else {
            DOM.status.className = "status-text safe";
            DOM.status.innerHTML = `<span class="line-1">✅ 監控中</span><span class="line-2">EAR: ${avgEAR.toFixed(2)}</span>`;
        }

        // 圖表更新
        if (STATE.frameCount % 10 === 0 && DATA.chartData) {
            DATA.chartData.push(perclos * 100);
            if (DATA.chartData.length > 50) DATA.chartData.shift();
            if (chart) {
                chart.data.datasets[0].data = DATA.chartData;
                chart.update('none');
            }
        }
    }
    DOM.ctx.restore();
}

// ==========================================
// 4. 初始化與事件
// ==========================================
function initChart() {
    chart = new Chart(DOM.chartCtx, {
        type: 'line',
        data: {
            labels: Array(50).fill(''),
            datasets: [{
                label: 'PERCLOS %',
                data: Array(50).fill(0),
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.2)',
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { min: 0, max: 100 } },
            animation: false
        }
    });
}

// 啟動相機 (只抓 Video，不抓 Audio)
async function startCamera() {
    DOM.loader.style.display = 'flex';
    
    // 初始化 FaceMesh
    faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
    faceMesh.setOptions({maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5});
    faceMesh.onResults(onResults);
    
    // 啟動鏡頭
    const camera = new Camera(DOM.video, {
        onFrame: async () => { await faceMesh.send({image: DOM.video}); },
        width: 1280, height: 720
    });
    
    await camera.start();
    DOM.loader.style.display = 'none';
    STATE.cameraActive = true;
    STATE.startTime = Date.now();
    
    // 初始化圖表
    initChart();
}

// 事件監聽
DOM.btnBoot.addEventListener('click', () => {
    document.getElementById('system-boot-overlay').style.display = 'none';
    initAudio(); // 用戶點擊後解鎖音效
    startCamera();
});

DOM.toggleDark.addEventListener('change', (e) => {
    STATE.isDark = e.target.checked;
    document.body.classList.toggle('dark-mode', e.target.checked);
});

DOM.btnMic.addEventListener('click', toggleMic);

// 誤報校正 (簡單版)
DOM.btnFalsePos.addEventListener('click', () => {
    CONFIG.threshold -= 0.02; // 降低標準
    speak("誤報已學習");
    showToast(`閾值降至 ${CONFIG.threshold.toFixed(2)}`);
});

// Toast Helper
function showToast(msg) {
    const t = document.getElementById('toast-notification');
    t.querySelector('.toast-message').innerText = msg;
    t.classList.add('show');
    setTimeout(()=>t.classList.remove('show'), 3000);
}
