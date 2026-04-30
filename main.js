const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const googleTasks = require('./google-tasks');

// [중요] 30초 로딩 지연의 핵심 원인 해결
// 1. 하드웨어 가속 이슈 (투명 창 생성 시 GPU 초기화 타임아웃 방지)
app.disableHardwareAcceleration();

// 2. 프록시 자동 검색(WPAD) 타임아웃 방지 (네트워크 환경에 따른 30초 지연 차단)
app.commandLine.appendSwitch('no-proxy-server');

let mainWindow;
let tray;

const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const TASK_CACHE_PATH = path.join(app.getPath('userData'), 'task-cache.json');

// 1. 빠른 시작을 위해 초기화 로직을 전역에서 즉시 시작하지 않고 함수 내로 이동
function loadWindowState() {
    let state = { width: 350, height: 450, x: undefined, y: undefined };
    try {
        if (fs.existsSync(WINDOW_STATE_PATH)) {
            const data = fs.readFileSync(WINDOW_STATE_PATH, 'utf8');
            state = JSON.parse(data);
        }
    } catch (e) {}
    return state;
}

function getCachedTasks() {
    try {
        if (fs.existsSync(TASK_CACHE_PATH)) {
            return JSON.parse(fs.readFileSync(TASK_CACHE_PATH, 'utf8'));
        }
    } catch (e) {}
    return [];
}

function saveTaskCache(tasks) {
    try {
        fs.writeFileSync(TASK_CACHE_PATH, JSON.stringify(tasks));
    } catch (e) {}
}

async function createWindow() {
    // 2. 스플래시 화면을 제거하고 바로 메인 창 생성 시작
    const state = loadWindowState();
    const cached = getCachedTasks();

    mainWindow = new BrowserWindow({
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        minWidth: 280,
        minHeight: 200,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000', // 배경색 투명
        alwaysOnTop: true,
        show: false, // 렌더링 준비 전까지 숨김
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            spellcheck: false, // 불필요한 기능 비활성화
        }
    });

    mainWindow.loadFile('index.html');

    // 3. 'ready-to-show' 대신 더 빠른 시점에 창을 띄울 수 있는지 시도
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        // 4. 창이 뜬 직후에 트레이 아이콘 등 무거운 작업 수행
        setupTray();
    });

    // 5. 데이터 로딩 로직 최적화
    mainWindow.webContents.on('did-finish-load', async () => {
        // 캐시 데이터 즉시 전송
        if (cached && cached.length > 0) {
            mainWindow.webContents.send('tasks-data', cached);
            mainWindow.webContents.send('auth-status', true);
        }

        try {
            const isLoggedIn = await googleTasks.initialize();
            if (isLoggedIn) {
                mainWindow.webContents.send('auth-status', true);
                const tasks = await googleTasks.listTasks();
                mainWindow.webContents.send('tasks-data', tasks);
                saveTaskCache(tasks);
            } else {
                mainWindow.webContents.send('auth-status', false);
            }
        } catch (e) {
            console.error('Data load error:', e);
            if (!cached || cached.length === 0) {
                mainWindow.webContents.send('auth-status', false);
            }
        }
    });

    mainWindow.on('close', () => {
        const bounds = mainWindow.getBounds();
        fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(bounds));
    });
}

function setupTray() {
    if (tray) return;
    try {
        tray = new Tray(path.join(__dirname, 'icon.ico'));
        const contextMenu = Menu.buildFromTemplate([
            { label: 'StickyTask 보이기', click: () => mainWindow.show() },
            { type: 'separator' },
            { label: '종료', click: () => app.quit() }
        ]);
        tray.setToolTip('StickyTask');
        tray.setContextMenu(contextMenu);
    } catch (e) {
        console.error('Tray setup error:', e);
    }
}

// 6. 싱글 인스턴스 보장 (중복 실행 방지 및 속도 향상)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            mainWindow.show();
        }
    });

    app.whenReady().then(createWindow);
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC 핸들러 (기존과 동일하지만 최적화된 응답 지향)
ipcMain.on('google-login', async (event) => {
    try {
        const success = await googleTasks.authenticate();
        if (success) {
            const tasks = await googleTasks.listTasks();
            event.sender.send('auth-status', true);
            event.sender.send('tasks-data', tasks);
            saveTaskCache(tasks);
        }
    } catch (error) {
        event.sender.send('auth-error', error.message);
    }
});

ipcMain.handle('add-task', async (event, title) => {
    return await googleTasks.addTask(title);
});

ipcMain.handle('update-task', async (event, { taskId, completed }) => {
    return await googleTasks.updateTask(taskId, completed);
});

ipcMain.handle('delete-task', async (event, taskId) => {
    return await googleTasks.deleteTask(taskId);
});

ipcMain.on('close-app', () => app.quit());
ipcMain.on('minimize-app', () => mainWindow.minimize());
