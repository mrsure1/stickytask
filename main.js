const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const googleTasks = require('./google-tasks');

let mainWindow;
let splashWindow;
let tray;

const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const TASK_CACHE_PATH = path.join(app.getPath('userData'), 'task-cache.json');

function loadWindowState() {
    let state = { width: 350, height: 450, x: undefined, y: undefined };
    try {
        if (fs.existsSync(WINDOW_STATE_PATH)) {
            state = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'));
        }
    } catch (e) {}
    return state;
}

function saveWindowState() {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(bounds));
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

function createSplashScreen() {
    splashWindow = new BrowserWindow({
        width: 300,
        height: 400,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        center: true,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });
    splashWindow.loadFile('splash.html');
}

function createWindow() {
    // 1. 비동기 데이터 로딩 미리 시작 (윈도우 생성과 병렬)
    const initPromise = googleTasks.initialize().catch(() => false);

    createSplashScreen();

    const state = loadWindowState();

    mainWindow = new BrowserWindow({
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        minWidth: 280,
        minHeight: 200,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        show: false,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // 트레이 설정
    tray = new Tray(path.join(__dirname, 'icon.ico'));
    const contextMenu = Menu.buildFromTemplate([
        { label: 'StickyTask 보이기', click: () => mainWindow.show() },
        { label: '개발자 도구 열기', click: () => mainWindow.webContents.openDevTools({ mode: 'detach' }) },
        { type: 'separator' },
        { label: '종료', click: () => app.quit() }
    ]);
    tray.setToolTip('StickyTask - Google Tasks 연동');
    tray.setContextMenu(contextMenu);

    mainWindow.loadFile('index.html');

    // 창이 준비되면 즉시 표시 (데이터 로딩과 무관하게 UI 먼저 노출)
    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }
        mainWindow.show();
    });

    // 페이지 로드 완료 시 로직 최적화
    mainWindow.webContents.on('did-finish-load', async () => {
        // 2. 캐시된 데이터를 즉시 전송 (가장 중요: 체감 속도 향상)
        const cached = getCachedTasks();
        if (cached && cached.length > 0) {
            mainWindow.webContents.send('tasks-data', cached);
            mainWindow.webContents.send('auth-status', true);
        }

        try {
            // 미리 시작한 초기화 결과 대기
            const isLoggedIn = await initPromise;
            
            if (isLoggedIn) {
                mainWindow.webContents.send('auth-status', true);
                // 3. 백그라운드에서 실제 데이터 업데이트
                const tasks = await googleTasks.listTasks();
                mainWindow.webContents.send('tasks-data', tasks);
                saveTaskCache(tasks); // 최신 데이터 캐시 업데이트
            } else {
                mainWindow.webContents.send('auth-status', false);
            }
        } catch (e) {
            console.error('데이터 로딩 중 오류:', e);
            // 캐시 데이터가 없으면 로그인 필요 상태로
            if (!cached || cached.length === 0) {
                mainWindow.webContents.send('auth-status', false);
            }
        }
    });

    mainWindow.on('close', saveWindowState);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// IPC 핸들러: 로그인 요청
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
        console.error('로그인 실패:', error);
        event.sender.send('auth-error', error.message);
    }
});

// IPC 핸들러: 태스크 관리
ipcMain.handle('get-tasks', async () => {
    return await googleTasks.listTasks();
});

ipcMain.handle('add-task', async (event, title) => {
    const newTask = await googleTasks.addTask(title);
    if (newTask) {
        const tasks = await googleTasks.listTasks();
        saveTaskCache(tasks);
    }
    return newTask;
});

ipcMain.handle('update-task', async (event, { taskId, completed }) => {
    const result = await googleTasks.updateTask(taskId, completed);
    const tasks = await googleTasks.listTasks();
    saveTaskCache(tasks);
    return result;
});

ipcMain.handle('delete-task', async (event, taskId) => {
    const result = await googleTasks.deleteTask(taskId);
    const tasks = await googleTasks.listTasks();
    saveTaskCache(tasks);
    return result;
});

ipcMain.on('close-app', () => {
    saveWindowState();
    app.quit();
});

ipcMain.on('minimize-app', () => {
    mainWindow.minimize();
});
