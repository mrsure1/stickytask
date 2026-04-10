const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const googleTasks = require('./google-tasks');

let mainWindow;
let splashWindow;
let tray;

const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    let state = { width: 350, height: 450, x: undefined, y: undefined };
    try {
        if (fs.existsSync(WINDOW_STATE_PATH)) {
            state = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'));
        }
    } catch (e) {}

    // 디스플레이 조회가 성능을 저하시킬 수 있으므로 단순화함
    return state;
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

function saveWindowState() {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(bounds));
}

function createWindow() {
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
        show: false, // 창 준비 전까지 숨김
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // 창이 준비되면 스플래시를 닫고 메인 창 표시
    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
        }
        mainWindow.show();
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
    
    // 비동기 데이터 로딩은 창이 뜨고 나서 진행
    mainWindow.webContents.on('did-finish-load', async () => {
        try {
            const isLoggedIn = await googleTasks.initialize();
            mainWindow.webContents.send('auth-status', isLoggedIn);
            if (isLoggedIn) {
                const tasks = await googleTasks.listTasks();
                mainWindow.webContents.send('tasks-data', tasks);
            }
        } catch (e) {
            console.error('데이터 초기 로딩 오류:', e);
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
    return await googleTasks.addTask(title);
});

ipcMain.handle('update-task', async (event, { taskId, completed }) => {
    return await googleTasks.updateTask(taskId, completed);
});

ipcMain.handle('delete-task', async (event, taskId) => {
    return await googleTasks.deleteTask(taskId);
});

ipcMain.on('close-app', () => {
    saveWindowState();
    app.quit();
});

ipcMain.on('minimize-app', () => {
    mainWindow.minimize();
});
