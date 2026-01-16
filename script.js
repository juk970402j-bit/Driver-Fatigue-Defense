/* [JS] V20.2 Ultimate - Part 1/2: Core & Geometry */

// 確保所有資源 (MediaPipe, Chart.js) 載入後才執行
window.onload = function() {
    console.log("V20.2 Ultimate System Initializing...");
    
    // ==========================================
    // 1. DOM 綁定 (完整對應 HTML)
    // ==========================================
    const DOM = {
        // 核心影像元件
        video: document.querySelector('.input_video'),
        canvas: document.querySelector('.output_canvas'),
        ctx: document.querySelector('.output_canvas') ? document.querySelector('.output_canvas').getContext('2d') : null,
        loader: document.getElementById('loader'),
        
        // 顯示數據
        status: document.getElementById('status'),
        perclosDisplay: document.getElementById('main-perclos-display'),
        strategyDisplay: document.getElementById('strategy-display'),
        
        // 儀表板數據 (Dashboard)
        mTime: document.getElementById('metric-time'),
        mAlarms: document.getElementById('metric-alarms'),
        mFPS: document.getElementById('metric-fps'),
        mPerclos: document.getElementById('metric-perclos'),
        mPitch: document.getElementById('metric-pitch'),
        mYaw: document.getElementById('metric-yaw'),
        
        // 系統控制按鈕
        btnBoot: document.getElementById('boot-btn'),
        btnMic: document.getElementById('btn-mic-toggle'),
        btnFalsePos: document.getElementById('btn-false-positive'),
        toggleDark: document.getElementById('darkModeToggle'),
        toggleChart: document.getElementById('toggleChart'),
        toggleDisplay: document.getElementById('toggleDisplay'),
        toggleCamera: document.getElementById('toggleCamera'),
        
        // 音訊控制
        btnAudioStatus: document.getElementById('btn-audio-status'),
        btnVoiceTest: document.getElementById('btn-voice-test'),
        btnAudioTest: document.getElementById('btn-audio-test'),
        btnVibrateTest: document.getElementById('btn-vibrate-test'),
        sliderAlarm: document.getElementById('volAlarmSlider'),
        sliderVoice: document.getElementById('volVoiceSlider'),
        
        // 防禦核心 (Defense Core)
        btnDefCalib: document.getElementById('btn-def-calib'),
        btnDef3D: document.getElementById('btn-def-3d'),
        btnDefIris: document.getElementById('btn-def-iris'),
        defenseInfo: document.getElementById('defense-info-text'),
        
        // 戰功牆 Modal
        modal: document.getElementById('changelog-modal'),
        btnLogTrigger: document.getElementById('changelog-trigger'),
        btnCloseLog: document.getElementById('close-changelog'),

        // 圖表容器
        chartContainer: document.getElementById('chartContainer')
    };

    // 安全檢查：若關鍵元件遺失，提前報錯
    if (!DOM.video || !DOM.canvas || !DOM.btnBoot) {
        console.error("Critical DOM elements missing! Please check HTML.");
        return;
    }

    // ==========================================
    // 2. 系統變數與設定 (Configuration)
    // ==========================================
    const CONFIG = {
        threshold: 0.25,          // 預設閉眼門檻
        aggressive_threshold: 0.35,
        
        // 防禦開關預設值
        def_dualCalib: true,
        def_3dComp: true,
        def_iris: false,
        
        // 音訊頻率
        freq_warn: 440,
        freq_danger: 880
    };

    let STATE = {
        cameraActive: false,
        audioUnlocked: false,
        micActive: false,
        strategy: 'conservative', // 'conservative' | 'aggressive'
        
        lastFrameTime: Date.now(),
        frameCount: 0,
        startTime: Date.now(),
        
        alarmCount: 0,
        displayActive: true // 影像顯示開關
    };

    // 數據緩衝區
    let DATA = {
        closedFrameHistory: [],  // 0/1 歷史紀錄
        closedSeconds: 0,        // 連續閉眼秒數
        chartData: []            // 圖表數據點
    };

    // 外部物件參照
    let faceMesh = null;
    let camera = null;
    let audioCtx = null;
    let chart = null;

    // ==========================================
    // 3. 音訊引擎 (Audio Engine)
    // ==========================================
    async function initAudio() {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            STATE.audioUnlocked = true;
            
            if(DOM.btnAudioStatus) {
                DOM.btnAudioStatus.innerText = "🔓 音效引擎就緒";
                DOM.btnAudioStatus.classList.replace('system-btn', 'green-btn');
            }
            speak("V20.2 系統全機能啟動，防禦核心上線。");
        } catch(e) {
            console.error("Audio Init Failed:", e);
        }
    }

    // 文字轉語音 (TTS)
    function speak(text) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel(); // 打斷上一句
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        u.rate = 1.0;
        // 讀取獨立音量條
        u.volume = DOM.sliderVoice ? (DOM.sliderVoice.value / 100) : 1;
        window.speechSynthesis.speak(u);
    }

    // 警報音效 (Oscillator)
    function playTone(freq, type = 'square', duration = 0.2) {
        if (!STATE.audioUnlocked || !audioCtx) return;
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        // 讀取獨立音量條
        const vol = DOM.sliderAlarm ? (DOM.sliderAlarm.value / 100) : 1;
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration + 0.1);
    }

    // ==========================================
    // 4. 幾何演算法 (Geometry & Math)
    // ==========================================
    
    // 計算眼睛縱橫比 (EAR)
    function calculateEAR(landmarks, indices) {
        const d = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        const p1 = landmarks[indices[0]], p4 = landmarks[indices[3]];
        const p2 = landmarks[indices[1]], p6 = landmarks[indices[5]];
        const p3 = landmarks[indices[2]], p5 = landmarks[indices[4]];
        // EAR 公式
        return (d(p2, p6) + d(p3, p5)) / (2.0 * d(p1, p4));
    }

    // 計算頭部姿態 (3D Pose Estimation - 簡化版)
    function calculateHeadPose(landmarks) {
        const W = DOM.canvas.width, H = DOM.canvas.height;
        // 關鍵點: 鼻頭(1), 下巴(152), 左臉邊緣(226), 右臉邊緣(446)
        const nose = landmarks[1], chin = landmarks[152];
        const left = landmarks[226], right = landmarks[446];
        
        // 俯仰角 (Pitch) - 抬頭/低頭
        // 簡單估算：鼻頭與下巴的垂直距離變化
        let pitch = (nose.y * H - chin.y * H) / H * 100 + 50; 
        
        // 偏航角 (Yaw) - 左右轉頭
        // 簡單估算：鼻頭在左右臉邊緣的相對位置
        let yaw = ((nose.x * W - (left.x + right.x)/2 * W) / (Math.abs(left.x - right.x) * W)) * 100;
        
        return { pitch: pitch - 50, yaw: yaw }; 
    }

    // UI 更新輔助函數
    function updateDefenseUI() {
        const setBtn = (btn, active) => {
            if(!btn) return;
            if(active) { 
                btn.classList.add('active'); 
                btn.classList.remove('off'); 
                btn.querySelector('.def-status').innerText='ON'; 
            } else { 
                btn.classList.remove('active'); 
                btn.classList.add('off'); 
                btn.querySelector('.def-status').innerText='OFF'; 
            }
        };
        setBtn(DOM.btnDefCalib, CONFIG.def_dualCalib);
        setBtn(DOM.btnDef3D, CONFIG.def_3dComp);
        setBtn(DOM.btnDefIris, CONFIG.def_iris);
        
        let txt = [];
        if(CONFIG.def_dualCalib) txt.push("雙點");
        if(CONFIG.def_3dComp) txt.push("3D");
        if(DOM.defenseInfo) DOM.defenseInfo.innerText = "動態策略: " + (txt.join('+') || "關閉");
    }

/* --- Part 1 結束，請接續 Part 2 --- */
    // ==========================================
    // 5. 視覺處理循環 (The Visual Loop)
    // ==========================================
    function onResults(results) {
        STATE.frameCount++;
        
        // 確保 Canvas 尺寸正確
        if (DOM.canvas.width !== DOM.video.videoWidth) {
            DOM.canvas.width = DOM.video.videoWidth;
            DOM.canvas.height = DOM.video.videoHeight;
        }

        DOM.ctx.save();
        DOM.ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);
        
        // 繪製影像 (如果顯示開關是開的)
        if (STATE.displayActive && results.image) {
            DOM.ctx.drawImage(results.image, 0, 0, DOM.canvas.width, DOM.canvas.height);
        } else {
            // 省電模式：全黑背景
            DOM.ctx.fillStyle = "#000000";
            DOM.ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);
            DOM.ctx.fillStyle = "#333";
            DOM.ctx.font = "20px Arial";
            DOM.ctx.fillText("影像顯示已關閉 (運算中...)", 50, 50);
        }

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            
            // ---------------------------
            // A. 數值計算
            // ---------------------------
            const leftIndices = [33, 160, 158, 133, 153, 144];
            const rightIndices = [362, 385, 387, 263, 373, 380];
            
            // 原始 EAR
            let leftEAR = calculateEAR(landmarks, leftIndices);
            let rightEAR = calculateEAR(landmarks, rightIndices);
            let avgEAR = (leftEAR + rightEAR) / 2;
            
            // 3D 姿態補償 (V20.2 核心修復)
            const pose = calculateHeadPose(landmarks);
            
            if (CONFIG.def_3dComp) {
                // 當低頭時 (Pitch < 0)，EAR 會被壓縮，需要補償放大
                // 當抬頭時 (Pitch > 0)，EAR 會被拉伸，需要抑制
                // 經驗係數：每度補償 0.2%
                avgEAR = avgEAR * (1 - (pose.pitch * 0.002));
            }

            // ---------------------------
            // B. 疲勞判斷 (State Machine)
            // ---------------------------
            // 判斷閾值 (根據激進/保守模式動態調整)
            let currentThreshold = CONFIG.threshold;
            if (STATE.strategy === 'aggressive') {
                currentThreshold = CONFIG.aggressive_threshold;
            }

            const isClosed = avgEAR < currentThreshold;
            
            // 推進歷史陣列 (滑動視窗)
            DATA.closedFrameHistory.push(isClosed ? 1 : 0);
            if (DATA.closedFrameHistory.length > 150) DATA.closedFrameHistory.shift(); // 保持約 5-10秒 數據
            
            // 計算連續閉眼時間
            if (isClosed) {
                DATA.closedSeconds += 1/30; // 假設 30fps
            } else {
                DATA.closedSeconds = 0;
            }
            
            // 計算 PERCLOS (閉眼幀佔比)
            const perclos = DATA.closedFrameHistory.reduce((a,b)=>a+b,0) / DATA.closedFrameHistory.length;

            // 策略切換邏輯 (V19.6 Logic)
            if (STATE.strategy === 'conservative' && (perclos > 0.3 || DATA.closedSeconds > 1.0)) {
                STATE.strategy = 'aggressive';
                DOM.strategyDisplay.className = 'strategy-display aggressive';
                DOM.strategyDisplay.innerHTML = '<span class="strat-icon">⚔️</span><span class="strat-text">激進派 (高度戒備)</span>';
                speak("偵測到疲勞，切換激進防禦");
            } else if (STATE.strategy === 'aggressive' && perclos < 0.1 && DATA.closedSeconds === 0) {
                // 需維持一段時間清醒才切回 (這裡簡化，直接切回)
                 if(Math.random() > 0.99) { // 隨機延遲切回，模擬遲滯
                    STATE.strategy = 'conservative';
                    DOM.strategyDisplay.className = 'strategy-display conservative';
                    DOM.strategyDisplay.innerHTML = '<span class="strat-icon">🛡️</span><span class="strat-text">保守派 (監測中)</span>';
                 }
            }

            // ---------------------------
            // C. 視覺繪製 (Visuals - 還原綠色眼框！)
            // ---------------------------
            if (STATE.displayActive) {
                const eyeColor = isClosed ? '#ef4444' : '#10b981'; // 紅 vs 綠
                const lineWidth = isClosed ? 3 : 1;

                // 1. 使用 MediaPipe 內建工具畫出精確眼型 (V19.6 風格)
                // 注意：FACEMESH_RIGHT_EYE 等變數由 face_mesh.js 全域提供
                if(window.FACEMESH_RIGHT_EYE && window.FACEMESH_LEFT_EYE) {
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_RIGHT_EYE, {color: eyeColor, lineWidth: lineWidth});
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_LEFT_EYE, {color: eyeColor, lineWidth: lineWidth});
                    // 畫眉毛 (輔助判斷表情)
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_RIGHT_EYEBROW, {color: '#3b82f6', lineWidth: 1});
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_LEFT_EYEBROW, {color: '#3b82f6', lineWidth: 1});
                }
                
                // 2. 畫出簡單的頭部姿態指示線 (鼻頭指針)
                const noseX = landmarks[1].x * DOM.canvas.width;
                const noseY = landmarks[1].y * DOM.canvas.height;
                DOM.ctx.beginPath();
                DOM.ctx.moveTo(noseX, noseY);
                DOM.ctx.lineTo(noseX + pose.yaw * 2, noseY + pose.pitch * 2);
                DOM.ctx.strokeStyle = "#FFFF00";
                DOM.ctx.stroke();
            }

            // ---------------------------
            // D. UI 更新
            // ---------------------------
            if(DOM.perclosDisplay) DOM.perclosDisplay.innerText = `疲勞指數: ${(perclos*100).toFixed(1)}%`;
            if(DOM.mPerclos) DOM.mPerclos.innerText = (perclos*100).toFixed(1) + "%";
            
            // 時間更新
            const elapsed = Math.floor((Date.now() - STATE.startTime)/1000);
            const mins = Math.floor(elapsed/60).toString().padStart(2,'0');
            const secs = (elapsed%60).toString().padStart(2,'0');
            if(DOM.mTime) DOM.mTime.innerText = `${mins}:${secs}`;

            // 角度顯示
            if(DOM.mPitch) DOM.mPitch.innerText = pose.pitch.toFixed(1) + "°";
            if(DOM.mYaw) DOM.mYaw.innerText = pose.yaw.toFixed(1) + "°";

            // FPS 計算
            if (DOM.mFPS) {
                const fps = Math.round(1000 / (Date.now() - STATE.lastFrameTime));
                DOM.mFPS.innerText = fps + " FPS";
            }
            STATE.lastFrameTime = Date.now();

            // ---------------------------
            // E. 警報觸發 (The Alarm)
            // ---------------------------
            // 條件：連續閉眼 > 1.5秒 或 PERCLOS > 40%
            if (DATA.closedSeconds > 1.5 || perclos > 0.4) {
                DOM.status.className = "status-text danger";
                DOM.status.innerHTML = `<span class="line-1">🚨 危險</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
                
                // 間歇性警報 (每 15 幀響一次，避免太吵)
                if (STATE.frameCount % 15 === 0) {
                    playTone(CONFIG.freq_danger, 'sawtooth', 0.1); // 發出警報聲
                    if(navigator.vibrate) navigator.vibrate([200, 100, 200]); // 手機震動
                }
                
                // 警報計數 (避免重複計數，只在剛超過 1.5s 時加一次)
                if (DATA.closedSeconds > 1.5 && DATA.closedSeconds < 1.6) {
                    STATE.alarmCount++;
                    if(DOM.mAlarms) DOM.mAlarms.innerText = STATE.alarmCount + " 次";
                }
            } else if (isClosed) {
                // 短暫閉眼 (黃燈)
                DOM.status.className = "status-text warning";
                DOM.status.innerHTML = `<span class="line-1">⚠️ 注意</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
            } else {
                // 安全 (綠燈)
                DOM.status.className = "status-text safe";
                DOM.status.innerHTML = `<span class="line-1">✅ 監控中</span><span class="line-2">EAR: ${avgEAR.toFixed(2)}</span>`;
            }
            
            // ---------------------------
            // F. 圖表更新 (Chart.js)
            // ---------------------------
            if (chart && STATE.frameCount % 5 === 0) {
                // 移除舊資料，加入新資料 (捲動效果)
                chart.data.datasets[0].data.push(perclos * 100);
                chart.data.datasets[0].data.shift();
                chart.update('none'); // 'none' 模式不播放動畫，效能較好
            }
        }
        DOM.ctx.restore();
    }

    // ==========================================
    // 6. 事件監聽 (神經接駁)
    // ==========================================
    
    // 啟動按鈕
    if(DOM.btnBoot) {
        DOM.btnBoot.addEventListener('click', async () => {
            document.getElementById('system-boot-overlay').style.display = 'none';
            // 1. 初始化音效 (必須在用戶點擊時觸發)
            await initAudio();
            
            // 2. 顯示載入圈
            DOM.loader.style.display = 'flex';
            
            // 3. 初始化圖表
            if(document.getElementById('perclosChart')) {
                const ctx = document.getElementById('perclosChart').getContext('2d');
                chart = new Chart(ctx, {
                    type: 'line',
                    data: { 
                        labels: Array(50).fill(''), 
                        datasets: [{ 
                            label: 'PERCLOS', 
                            data: Array(50).fill(0), 
                            borderColor: '#f59e0b', 
                            backgroundColor: 'rgba(245, 158, 11, 0.2)',
                            fill: true,
                            tension: 0.4
                        }] 
                    },
                    options: { 
                        responsive: true, 
                        maintainAspectRatio: false, 
                        scales: { y: { min: 0, max: 100, display: true } }, 
                        plugins: { legend: { display: false } },
                        animation: false 
                    }
                });
            }

            // 4. 初始化 MediaPipe
            faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
            faceMesh.setOptions({
                maxNumFaces: 1, 
                refineLandmarks: true, 
                minDetectionConfidence: 0.5, 
                minTrackingConfidence: 0.5
            });
            faceMesh.onResults(onResults);

            // 5. 啟動相機
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

    // 附屬功能綁定
    if(DOM.toggleDark) DOM.toggleDark.addEventListener('change', (e) => document.body.classList.toggle('dark-mode', e.target.checked));
    
    // 防禦核心按鈕
    if(DOM.btnDefCalib) DOM.btnDefCalib.addEventListener('click', () => { CONFIG.def_dualCalib = !CONFIG.def_dualCalib; updateDefenseUI(); speak("雙點校準" + (CONFIG.def_dualCalib?"開啟":"關閉")); });
    if(DOM.btnDef3D) DOM.btnDef3D.addEventListener('click', () => { CONFIG.def_3dComp = !CONFIG.def_3dComp; updateDefenseUI(); speak("3D補償" + (CONFIG.def_3dComp?"開啟":"關閉")); });
    if(DOM.btnDefIris) DOM.btnDefIris.addEventListener('click', () => { CONFIG.def_iris = !CONFIG.def_iris; updateDefenseUI(); speak("虹膜裁決" + (CONFIG.def_iris?"開啟":"關閉")); });
    
    // 誤報校正
    if(DOM.btnFalsePos) DOM.btnFalsePos.addEventListener('click', () => { 
        CONFIG.threshold -= 0.02; 
        speak("已降低疲勞標準"); 
        // 顯示氣泡通知
        const t = document.getElementById('toast-notification');
        if(t) {
            t.querySelector('.toast-message').innerText = `閾值降至 ${CONFIG.threshold.toFixed(2)}`;
            t.classList.add('show');
            setTimeout(()=>t.classList.remove('show'), 3000);
        }
    });

    // 麥克風開關 (視覺上切換，實際上不影響 Facemesh)
    if(DOM.btnMic) DOM.btnMic.addEventListener('click', () => { 
        STATE.micActive = !STATE.micActive; 
        if(STATE.micActive) {
            DOM.btnMic.classList.remove('off'); 
            DOM.btnMic.innerText = "🎤 麥克風 (開)";
        } else {
            DOM.btnMic.classList.add('off'); 
            DOM.btnMic.innerText = "🎤 麥克風 (關)";
        }
        speak(STATE.micActive ? "語音監控開啟" : "語音監控關閉"); 
    });

    // 測試按鈕
    if(DOM.btnVoiceTest) DOM.btnVoiceTest.addEventListener('click', () => speak("語音系統測試正常，音量良好。"));
    if(DOM.btnAudioTest) DOM.btnAudioTest.addEventListener('click', () => playTone(440, 'sine', 0.5));
    if(DOM.btnVibrateTest) DOM.btnVibrateTest.addEventListener('click', () => { if(navigator.vibrate) navigator.vibrate(500); });

    // 戰功牆 Modal 控制
    if(DOM.btnLogTrigger) DOM.btnLogTrigger.addEventListener('click', () => DOM.modal.style.display = 'flex');
    if(DOM.btnCloseLog) DOM.btnCloseLog.addEventListener('click', () => DOM.modal.style.display = 'none');
    
    // 圖表顯示切換
    if(DOM.toggleChart) DOM.toggleChart.addEventListener('click', () => {
        const c = DOM.chartContainer;
        c.style.display = (c.style.display === 'none' || c.style.display === '') ? 'block' : 'none';
    });
    
    // 影像顯示切換 (省電模式)
    if(DOM.toggleDisplay) DOM.toggleDisplay.addEventListener('click', () => {
        STATE.displayActive = !STATE.displayActive;
        DOM.toggleDisplay.innerText = STATE.displayActive ? "關閉影像顯示" : "開啟影像顯示";
    });

    // 重啟鏡頭
    if(DOM.toggleCamera) DOM.toggleCamera.addEventListener('click', () => {
        location.reload(); // 最安全的重啟方式
    });
    
    console.log("V20.2 Event Listeners Attached.");
}; // 結束 window.onload
