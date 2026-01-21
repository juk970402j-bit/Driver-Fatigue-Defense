/* [JS] V20.3 Ultimate - Part 1/3: Core Math & Audio Engine */

window.onload = function() {
    console.log("V20.3 Ultimate System Initializing...");
    
    // ==========================================
    // 1. DOM 綁定
    // ==========================================
    const DOM = {
        video: document.querySelector('.input_video'),
        canvas: document.querySelector('.output_canvas'),
        ctx: document.querySelector('.output_canvas') ? document.querySelector('.output_canvas').getContext('2d') : null,
        loader: document.getElementById('loader'),
        
        // 顯示元件
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
        
        // 控制按鈕
        btnBoot: document.getElementById('boot-btn'),
        btnMic: document.getElementById('btn-mic-toggle'),
        btnFalsePos: document.getElementById('btn-false-positive'),
        
        // 新增開關
        btnVisual: document.getElementById('btn-visual-toggle'), // 三段視覺
        btnCamera: document.getElementById('btn-camera-toggle'), // 鏡頭開關
        toggleDisplay: document.getElementById('toggleDisplay'), // 黑幕
        toggleGrid: document.getElementById('toggleGridBtn'),    // 井字線
        
        // 防禦核心
        btnDefCalib: document.getElementById('btn-def-calib'),
        btnDef3D: document.getElementById('btn-def-3d'),
        btnDefIris: document.getElementById('btn-def-iris'),
        defenseInfo: document.getElementById('defense-info-text'),
        
        // 音量與設定
        sliderAlarm: document.getElementById('volAlarmSlider'),
        sliderVoice: document.getElementById('volVoiceSlider'),
        
        // 戰功牆與黑幕
        modal: document.getElementById('changelog-modal'),
        btnLogTrigger: document.getElementById('changelog-trigger'),
        btnCloseLog: document.getElementById('close-changelog'),
        blackScreen: document.getElementById('black-screen-overlay'),
        chartContainer: document.getElementById('chartContainer')
    };

    // ==========================================
    // 2. 參數設定 (V20.3 Tuned)
    // ==========================================
    const CONFIG = {
        // A. 基礎門檻 (會被校準覆蓋)
        default_threshold: 0.25,
        
        // B. 瞇瞇眼雙重門檻 (Dual-Threshold)
        // 這會根據校準結果自動下修，這裡是初始值
        warn_ratio: 0.85,  // EAR < 基干值 * 0.85 -> 警告 (L1)
        crit_ratio: 0.50,  // EAR < 基干值 * 0.50 -> 危險 (L3 - 只有一條線)
        
        // C. 防禦開關預設
        def_dualCalib: true,
        def_3dComp: true,
        def_iris: true,    // 預設開啟虹膜
        
        // D. 音效頻率
        freq_L2: 600,      // 畢...畢... (方向燈)
        freq_L3: 880       // 畢!畢! (空襲)
    };

    let STATE = {
        cameraActive: false,
        audioUnlocked: false,
        micActive: false,
        strategy: 'conservative',
        
        // 校準狀態
        isCalibrating: false,
        baselineEAR: 0.28, // 預設基準值
        
        // 直屏狀態
        isVertical: false,
        
        // 計數器
        lastFrameTime: Date.now(),
        frameCount: 0,
        startTime: Date.now(),
        alarmCount: 0,
        
        // 開關狀態
        displayActive: true,
        visualMode: 0, // 0:精細, 1:方框, 2:關閉
        cameraStreamOn: true,
        showGrid: false
    };

    let DATA = {
        closedFrameHistory: [],
        closedSeconds: 0,
        chartData: []
    };

    // 外部物件
    let faceMesh = null;
    let camera = null;
    let audioCtx = null;
    let chart = null;

    // ==========================================
    // 3. 音訊與直屏引擎
    // ==========================================
    
    // 初始化音訊
    async function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        STATE.audioUnlocked = true;
        if(DOM.btnAudioStatus) {
            DOM.btnAudioStatus.innerText = "🔓 音效引擎就緒";
            DOM.btnAudioStatus.classList.replace('system-btn', 'green-btn');
        }
    }

    function speak(text, priority = false) {
        if (!window.speechSynthesis) return;
        if (priority) window.speechSynthesis.cancel(); // 緊急插播
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-TW';
        u.volume = DOM.sliderVoice ? (DOM.sliderVoice.value / 100) : 1;
        window.speechSynthesis.speak(u);
    }

    // V20.3 遊覽車方向燈音效
    function playTone(freq, duration, type = 'square') {
        if (!STATE.audioUnlocked || !audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        const vol = DOM.sliderAlarm ? (DOM.sliderAlarm.value / 100) : 1;
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + duration + 0.1);
    }

    // V20.3 直屏偵測器 (Vertical Detector)
    function checkOrientation() {
        // 簡單判斷：如果 寬 < 高，就是直屏
        const w = window.innerWidth;
        const h = window.innerHeight;
        STATE.isVertical = (w < h);
        return STATE.isVertical;
    }

    // ==========================================
    // 4. 數學運算 (Math Core)
    // ==========================================

    function calculateEAR(landmarks, indices) {
        const d = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
        
        // V20.3 直屏座標修正 (Matrix Rotation)
        // 如果是直屏模式，我們把 x, y 座標互換來欺騙算法
        const getP = (idx) => {
            let p = landmarks[idx];
            if (STATE.isVertical) {
                // 模擬旋轉 90 度後的相對關係
                return { x: p.y, y: p.x }; 
            }
            return p;
        };

        const p1 = getP(indices[0]), p4 = getP(indices[3]);
        const p2 = getP(indices[1]), p6 = getP(indices[5]);
        const p3 = getP(indices[2]), p5 = getP(indices[4]);
        return (d(p2, p6) + d(p3, p5)) / (2.0 * d(p1, p4));
    }

    function calculateHeadPose(landmarks) {
        const W = DOM.canvas.width, H = DOM.canvas.height;
        const nose = landmarks[1], chin = landmarks[152];
        const left = landmarks[226], right = landmarks[446];
        // 簡易 3D 估算
        let pitch = (nose.y * H - chin.y * H) / H * 100 + 50; 
        let yaw = ((nose.x * W - (left.x + right.x)/2 * W) / (Math.abs(left.x - right.x) * W)) * 100;
        return { pitch: pitch - 50, yaw: yaw }; 
    }

    // V20.3 新增：虹膜垂直位置 (Iris Verticality)
    // 用於判斷「低頭滑手機」vs「真的閉眼」
    function calculateIris(landmarks) {
        // 取左眼虹膜中心(468) 與 左眼上眼瞼(159) 下眼瞼(145) 的距離比
        const iris = landmarks[468];
        const upper = landmarks[159];
        const lower = landmarks[145];
        
        // 計算虹膜是否偏下 (0.0=上, 1.0=下)
        const distTotal = Math.abs(upper.y - lower.y);
        const distIris = Math.abs(upper.y - iris.y);
        
        if(distTotal === 0) return 0.5;
        return distIris / distTotal; // > 0.6 代表往下看
    }

/* --- Part 1 結束，請接續 Part 2 --- */
/* [JS] V20.3 Ultimate - Part 2/3: Calibration & Main Loop */

    // ==========================================
    // 5. 遊覽車校準儀式 (The Tour Bus Protocol)
    // ==========================================
    function startCalibration() {
        if(STATE.isCalibrating) return;
        STATE.isCalibrating = true;
        
        let samples = [];
        let timeLeft = 7; // 7秒儀式
        
        speak("開始校準，請保持自然平視", true);
        if(navigator.vibrate) navigator.vibrate(200);

        // UI 倒數顯示
        const originalText = DOM.btnDefCalib.innerHTML;
        DOM.btnDefCalib.classList.add('active', 'orange');
        
        const timer = setInterval(() => {
            timeLeft--;
            
            // 視覺倒數
            DOM.btnDefCalib.innerHTML = `<span style="font-size:1.2rem">⏳ ${timeLeft}s</span>`;
            
            // 聽覺/觸覺節奏 (畢... 畢... 畢...)
            if (timeLeft > 0) {
                playTone(600, 0.05, 'sine'); // 輕柔提示音
                if(navigator.vibrate) navigator.vibrate(50);
            }

            // 結束校準
            if (timeLeft <= 0) {
                clearInterval(timer);
                finishCalibration(samples);
                DOM.btnDefCalib.innerHTML = originalText; // 恢復按鈕
                DOM.btnDefCalib.classList.remove('orange');
                updateDefenseUI();
            }
        }, 1000);

        // 綁定採樣函數 (暫存於 STATE)
        STATE.calibrationSampler = (ear) => {
            // 加權邏輯：去頭去尾
            // 由於這裡是每幀呼叫，我們之後統一處理
            samples.push({ t: 7 - timeLeft, val: ear });
        };
    }

    function finishCalibration(samples) {
        STATE.isCalibrating = false;
        STATE.calibrationSampler = null; // 移除採樣器

        if (samples.length < 30) {
            speak("採樣不足，校準失敗");
            return;
        }

        // 加權平均算法 (Weighted Average)
        let sum = 0;
        let weightTotal = 0;

        samples.forEach(s => {
            let w = 1;
            // 頭 (0-1.5s): 不穩定 -> 權重 0.1
            if (s.t < 1.5) w = 0.1;
            // 尾 (5.5-7s): 收尾 -> 權重 0.1
            else if (s.t > 5.5) w = 0.1;
            // 中 (1.5-5.5s): 黃金區 -> 權重 1.0
            else w = 1.0;

            sum += s.val * w;
            weightTotal += w;
        });

        const avg = sum / weightTotal;
        
        // 設定基準值 (Baseline)
        STATE.baselineEAR = avg;
        
        // 自動推導雙重閾值
        // 警戒線: 基準值的 85% (稍微閉眼)
        CONFIG.warn_ratio = avg * 0.85;
        // 死亡線: 基準值的 50% (只剩一條線)
        CONFIG.crit_ratio = avg * 0.50;
        
        // 更新主閾值 (用於顯示)
        CONFIG.default_threshold = CONFIG.warn_ratio;

        speak(`校準完成，基準值 ${avg.toFixed(2)}`);
        
        // 顯示通知
        const t = document.getElementById('toast-notification');
        if(t) {
            t.querySelector('.toast-title').innerText = "系統校準完畢";
            t.querySelector('.toast-message').innerText = `警戒: ${CONFIG.warn_ratio.toFixed(2)} | 危險: ${CONFIG.crit_ratio.toFixed(2)}`;
            t.classList.add('show');
            setTimeout(()=>t.classList.remove('show'), 4000);
        }
    }

    // ==========================================
    // 6. 視覺處理循環 (The Main Loop)
    // ==========================================
    function onResults(results) {
        STATE.frameCount++;
        
        // A. 畫布準備
        DOM.canvas.width = DOM.video.videoWidth;
        DOM.canvas.height = DOM.video.videoHeight;
        DOM.ctx.save();
        DOM.ctx.clearRect(0, 0, DOM.canvas.width, DOM.canvas.height);

        // B. 偵測直屏 (每 30 幀檢查一次，節省效能)
        if (STATE.frameCount % 30 === 0) checkOrientation();

        // C. 繪製影像 (黑幕模式下不繪製，省電)
        if (STATE.displayActive && results.image) {
            DOM.ctx.drawImage(results.image, 0, 0, DOM.canvas.width, DOM.canvas.height);
        } else if (!STATE.displayActive) {
            // 黑幕模式：強制全黑，只留一點點提示
            DOM.ctx.fillStyle = "#000000";
            DOM.ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);
        }

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            
            // --- 核心運算 ---
            const leftIndices = [33, 160, 158, 133, 153, 144];
            const rightIndices = [362, 385, 387, 263, 373, 380];
            
            let avgEAR = (calculateEAR(landmarks, leftIndices) + calculateEAR(landmarks, rightIndices)) / 2;
            
            // 3D 補償
            const pose = calculateHeadPose(landmarks);
            if (CONFIG.def_3dComp) {
                avgEAR = avgEAR * (1 - (pose.pitch * 0.0025)); // 稍微增強補償力道
            }

            // 虹膜裁決 (解決低頭誤判)
            if (CONFIG.def_iris) {
                const irisPos = calculateIris(landmarks); // 0~1, 越大越往下看
                if (irisPos > 0.65) {
                    // 偵測到正在往下看，給予 EAR 加分，防止誤判閉眼
                    avgEAR += 0.05; 
                }
            }

            // --- 校準採樣 ---
            if (STATE.isCalibrating && STATE.calibrationSampler) {
                STATE.calibrationSampler(avgEAR);
            }

            // --- 疲勞判定 (非線性累積) ---
            // 1. 死亡線判斷 (只有一條線) -> 極速累積
            const isCritical = avgEAR < CONFIG.crit_ratio;
            // 2. 警戒線判斷 (瞇瞇眼) -> 緩慢累積
            const isWarning = avgEAR < CONFIG.warn_ratio;

            if (isCritical) {
                // Turbo Mode: 每秒 +2.0秒 (極快)
                DATA.closedSeconds += (1/30) * 2.0;
            } else if (isWarning) {
                // Slow Mode: 每秒 +0.3秒 (緩慢)
                DATA.closedSeconds += (1/30) * 0.3;
            } else {
                // 回血機制 (清醒時快速歸零)
                DATA.closedSeconds = Math.max(0, DATA.closedSeconds - (1/30)*2.0);
            }
            
            // PERCLOS 計算
            DATA.closedFrameHistory.push(isWarning ? 1 : 0);
            if (DATA.closedFrameHistory.length > 150) DATA.closedFrameHistory.shift();
            const perclos = DATA.closedFrameHistory.reduce((a,b)=>a+b,0) / DATA.closedFrameHistory.length;

            // --- 視覺繪製 (根據三段開關) ---
            if (STATE.displayActive) {
                const eyeColor = isWarning ? '#ef4444' : '#10b981'; // 紅/綠
                
                // Mode 0: 精細 (綠色眼框 + 眉毛)
                if (STATE.visualMode === 0 && window.FACEMESH_RIGHT_EYE) {
                    const lw = isWarning ? 3 : 1;
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_RIGHT_EYE, {color: eyeColor, lineWidth: lw});
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_LEFT_EYE, {color: eyeColor, lineWidth: lw});
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_RIGHT_EYEBROW, {color: '#3b82f6', lineWidth: 1}); // 眉毛
                    drawConnectors(DOM.ctx, landmarks, FACEMESH_LEFT_EYEBROW, {color: '#3b82f6', lineWidth: 1});
                }
                // Mode 1: 簡易 (紅色方框) - V19.6 風格
                else if (STATE.visualMode === 1) {
                    const x = landmarks[1].x * DOM.canvas.width;
                    const y = landmarks[1].y * DOM.canvas.height;
                    DOM.ctx.strokeStyle = eyeColor;
                    DOM.ctx.lineWidth = 2;
                    DOM.ctx.strokeRect(x - 50, y - 60, 100, 120);
                }
                
                // 井字線 (Grid)
                if (STATE.showGrid) {
                    DOM.ctx.strokeStyle = "rgba(0, 255, 0, 0.3)";
                    DOM.ctx.lineWidth = 1;
                    DOM.ctx.beginPath();
                    // 畫兩條橫線、兩條直線
                    const w = DOM.canvas.width, h = DOM.canvas.height;
                    DOM.ctx.moveTo(w*0.33, 0); DOM.ctx.lineTo(w*0.33, h);
                    DOM.ctx.moveTo(w*0.66, 0); DOM.ctx.lineTo(w*0.66, h);
                    DOM.ctx.moveTo(0, h*0.33); DOM.ctx.lineTo(w, h*0.33);
                    DOM.ctx.moveTo(0, h*0.66); DOM.ctx.lineTo(w, h*0.66);
                    DOM.ctx.stroke();
                }
            }

            // --- UI 數值更新 ---
            if(DOM.mPerclos) DOM.mPerclos.innerText = (perclos*100).toFixed(1) + "%";
            if(DOM.mPitch) DOM.mPitch.innerText = pose.pitch.toFixed(1) + "°";
            if(DOM.mYaw) DOM.mYaw.innerText = pose.yaw.toFixed(1) + "°";
            
            // 時間格式化
            const elapsed = Math.floor((Date.now() - STATE.startTime)/1000);
            const mins = Math.floor(elapsed/60).toString().padStart(2,'0');
            const secs = (elapsed%60).toString().padStart(2,'0');
            if(DOM.mTime) DOM.mTime.innerText = `${mins}:${secs}`;
            
            if (DOM.mFPS) {
                const fps = Math.round(1000 / (Date.now() - STATE.lastFrameTime));
                DOM.mFPS.innerText = fps + " FPS";
            }
            STATE.lastFrameTime = Date.now();

            // --- 警報觸發 (三級警報 Logic) ---
            // 邏輯：看 DATA.closedSeconds (累積秒數)
            
            // L3: 危險 (累積 > 2.0s 或 PERCLOS > 80%)
            if (DATA.closedSeconds > 2.0 || perclos > 0.8) {
                DOM.status.className = "status-text danger";
                DOM.status.innerHTML = `<span class="line-1">🚨 危險 (L3)</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
                DOM.video.parentElement.classList.add('critical-alert'); // 紅框閃爍特效

                if (STATE.frameCount % 10 === 0) { // 急促頻率
                    playTone(CONFIG.freq_L3, 0.1, 'sawtooth'); // 刺耳音
                    if(navigator.vibrate) navigator.vibrate([300, 100, 300]); // 長震動
                }
                // 警報計數
                if (DATA.closedSeconds > 2.0 && DATA.closedSeconds < 2.1) {
                    STATE.alarmCount++;
                    if(DOM.mAlarms) DOM.mAlarms.innerText = STATE.alarmCount + " 次";
                    speak("危險，危險", true);
                }
            
            // L2: 警告 (累積 > 1.0s)
            } else if (DATA.closedSeconds > 1.0) {
                DOM.status.className = "status-text warning";
                DOM.status.innerHTML = `<span class="line-1">⚠️ 警告 (L2)</span><span class="line-2">閉眼 ${(DATA.closedSeconds).toFixed(1)}s</span>`;
                DOM.video.parentElement.classList.remove('critical-alert');
                
                if (STATE.frameCount % 30 === 0) { // 方向燈頻率 (每秒1次)
                    playTone(CONFIG.freq_L2, 0.1, 'square'); // 嘟...嘟...
                    if(navigator.vibrate) navigator.vibrate(200); // 短震動
                }
                if (DATA.closedSeconds > 1.0 && DATA.closedSeconds < 1.1) {
                    speak("請保持清醒");
                }

            // L1: 提醒 (眼睛微瞇/警戒線)
            } else if (isWarning) {
                DOM.status.className = "status-text safe"; // 保持綠底，但文字變黃
                DOM.status.style.color = "var(--c-warn)";
                DOM.status.innerHTML = `<span class="line-1">👀 注意精神</span><span class="line-2">EAR: ${avgEAR.toFixed(2)}</span>`;
                DOM.video.parentElement.classList.remove('critical-alert');
            
            // 安全
            } else {
                DOM.status.className = "status-text safe";
                DOM.status.style.color = "var(--c-safe)";
                DOM.status.innerHTML = `<span class="line-1">✅ 監控中</span><span class="line-2">EAR: ${avgEAR.toFixed(2)}</span>`;
                DOM.video.parentElement.classList.remove('critical-alert');
            }

            // --- 圖表更新 ---
            if (chart && STATE.frameCount % 5 === 0) {
                chart.data.datasets[0].data.push(perclos * 100);
                chart.data.datasets[0].data.shift();
                chart.update('none');
            }
        }
        DOM.ctx.restore();
    }

    // 輔助 UI 更新
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
        if(CONFIG.def_dualCalib) txt.push("校準");
        if(CONFIG.def_3dComp) txt.push("3D");
        if(CONFIG.def_iris) txt.push("虹膜");
        if(DOM.defenseInfo) DOM.defenseInfo.innerText = "策略: " + (txt.join('+') || "基本");
    }

/* --- Part 2 結束，請接續 Part 3 --- */
/* [JS] V20.3 Ultimate - Part 3/3: Event Listeners & System Control */

    // ==========================================
    // 7. 事件監聽 (神經接駁)
    // ==========================================
    
    // A. 系統啟動
    if(DOM.btnBoot) {
        DOM.btnBoot.addEventListener('click', async () => {
            document.getElementById('system-boot-overlay').style.display = 'none';
            await initAudio();
            
            DOM.loader.style.display = 'flex';
            
            // 初始化圖表
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

            // 初始化 MediaPipe
            faceMesh = new FaceMesh({locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
            faceMesh.setOptions({
                maxNumFaces: 1, 
                refineLandmarks: true, 
                minDetectionConfidence: 0.5, 
                minTrackingConfidence: 0.5
            });
            faceMesh.onResults(onResults);

            // 初始化相機
            camera = new Camera(DOM.video, {
                onFrame: async () => { 
                    if(STATE.cameraStreamOn) await faceMesh.send({image: DOM.video}); 
                },
                width: 1280, height: 720
            });
            
            await camera.start();
            DOM.loader.style.display = 'none';
            STATE.cameraActive = true;
            STATE.startTime = Date.now();
            
            speak("系統啟動，請進行校準");
        });
    }

    // B. 防禦核心操作
    // 遊覽車校準儀式
    if(DOM.btnDefCalib) DOM.btnDefCalib.addEventListener('click', () => { 
        startCalibration(); 
    });
    
    // 3D 補償開關
    if(DOM.btnDef3D) DOM.btnDef3D.addEventListener('click', () => { 
        CONFIG.def_3dComp = !CONFIG.def_3dComp; 
        updateDefenseUI(); 
        speak("3D補償" + (CONFIG.def_3dComp?"開啟":"關閉")); 
    });
    
    // 虹膜裁決開關
    if(DOM.btnDefIris) DOM.btnDefIris.addEventListener('click', () => { 
        CONFIG.def_iris = !CONFIG.def_iris; 
        updateDefenseUI(); 
        speak("虹膜裁決" + (CONFIG.def_iris?"開啟":"關閉")); 
    });

    // 智慧誤報校正 (Smart Correction)
    if(DOM.btnFalsePos) DOM.btnFalsePos.addEventListener('click', () => {
        // 1. 讀取當前基準
        let currentWarn = CONFIG.warn_ratio;
        // 2. 微調 (放寬 0.02)
        // 但不能無限放寬，設定上限為基準值的 95%
        if (currentWarn > STATE.baselineEAR * 0.95) {
            speak("無法再放寬標準");
            return;
        }
        
        CONFIG.warn_ratio += 0.02; // 放寬警戒線
        CONFIG.crit_ratio += 0.01; // 放寬死亡線
        CONFIG.default_threshold = CONFIG.warn_ratio;
        
        speak("已放寬疲勞標準");
        
        // 顯示通知
        const t = document.getElementById('toast-notification');
        if(t) {
            t.querySelector('.toast-title').innerText = "誤報校正";
            t.querySelector('.toast-message').innerText = `新警戒值: ${CONFIG.warn_ratio.toFixed(2)}`;
            t.classList.add('show');
            setTimeout(()=>t.classList.remove('show'), 3000);
        }
    });

    // C. 視覺與系統控制
    // 三段視覺切換
    if(DOM.btnVisual) DOM.btnVisual.addEventListener('click', () => {
        STATE.visualMode = (STATE.visualMode + 1) % 3;
        const modes = ["👁️ 標記 (精細)", "🟥 標記 (方框)", "❌ 標記 (關閉)"];
        DOM.btnVisual.innerText = modes[STATE.visualMode];
    });

    // 鏡頭完全開關
    if(DOM.btnCamera) DOM.btnCamera.addEventListener('click', () => {
        STATE.cameraStreamOn = !STATE.cameraStreamOn;
        if(STATE.cameraStreamOn) {
            DOM.btnCamera.innerText = "📷 鏡頭 (開)";
            DOM.btnCamera.classList.remove('off');
            camera.start();
        } else {
            DOM.btnCamera.innerText = "📷 鏡頭 (關)";
            DOM.btnCamera.classList.add('off');
            // 停止串流以省電
            const stream = DOM.video.srcObject;
            if(stream) {
                const tracks = stream.getTracks();
                tracks.forEach(track => track.stop());
            }
        }
    });

    // 黑幕模式 (Deep Sleep / Fake Lock)
    if(DOM.toggleDisplay) DOM.toggleDisplay.addEventListener('click', () => {
        STATE.displayActive = !STATE.displayActive;
        
        if (!STATE.displayActive) {
            // 進入黑幕
            if(DOM.blackScreen) DOM.blackScreen.style.display = 'flex';
            speak("進入直屏黑幕模式");
        } else {
            // 喚醒
            if(DOM.blackScreen) DOM.blackScreen.style.display = 'none';
        }
    });
    
    // 黑幕喚醒 (雙擊)
    let lastTap = 0;
    if(DOM.blackScreen) DOM.blackScreen.addEventListener('click', (e) => {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        if (tapLength < 500 && tapLength > 0) {
            // Double Tap Detected
            STATE.displayActive = true;
            DOM.blackScreen.style.display = 'none';
            speak("系統喚醒");
            e.preventDefault();
        }
        lastTap = currentTime;
    });

    // 井字線
    if(DOM.toggleGrid) DOM.toggleGrid.addEventListener('click', () => {
        STATE.showGrid = !STATE.showGrid;
        if(STATE.showGrid) {
            DOM.toggleGrid.classList.remove('off');
            DOM.toggleGrid.innerText = "井字格線 (開)";
        } else {
            DOM.toggleGrid.classList.add('off');
            DOM.toggleGrid.innerText = "井字格線 (關)";
        }
    });

    // D. 其他功能
    if(DOM.toggleDark) DOM.toggleDark.addEventListener('change', (e) => document.body.classList.toggle('dark-mode', e.target.checked));
    
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
    if(DOM.btnVoiceTest) DOM.btnVoiceTest.addEventListener('click', () => speak("語音系統測試正常"));
    if(DOM.btnAudioTest) DOM.btnAudioTest.addEventListener('click', () => playTone(600, 0.5, 'square'));
    if(DOM.btnVibrateTest) DOM.btnVibrateTest.addEventListener('click', () => { if(navigator.vibrate) navigator.vibrate([200, 100, 200]); });

    // 戰功牆與圖表
    if(DOM.btnLogTrigger) DOM.btnLogTrigger.addEventListener('click', () => DOM.modal.style.display = 'flex');
    if(DOM.btnCloseLog) DOM.btnCloseLog.addEventListener('click', () => DOM.modal.style.display = 'none');
    if(DOM.toggleChart) DOM.toggleChart.addEventListener('click', () => {
        const c = DOM.chartContainer;
        c.style.display = (c.style.display === 'none' || c.style.display === '') ? 'block' : 'none';
    });
    
    // 歷史牆手風琴效果
    const historyHeaders = document.querySelectorAll('.history-header');
    historyHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const group = header.parentElement;
            group.classList.toggle('active');
        });
    });

    console.log("V20.3 Event Listeners Attached. System Ready.");
}; // 結束 window.onload
