const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const googleTasks = require('./google-tasks');

let mainWindow;
let tray;

const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    let state = { width: 350, height: 450, x: undefined, y: undefined };
    try {
        if (fs.existsSync(WINDOW_STATE_PATH)) {
            state = JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf8'));
        }
    } catch (e) {}

    // 창 위치가 화면 밖으로 나갔는지 확인하여 보정
    if (state.x !== undefined && state.y !== undefined) {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some(display => {
            return state.x >= display.bounds.x &&
                   state.y >= display.bounds.y &&
                   state.x < (display.bounds.x + display.bounds.width) &&
                   state.y < (display.bounds.y + display.bounds.height);
        });
        if (!isVisible) {
            state.x = undefined;
            state.y = undefined;
        }
    }
    return state;
}

function saveWindowState() {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(bounds));
}

function createWindow() {
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
        backgroundColor: '#00000000', // 투명도 안정성 확보
        alwaysOnTop: true,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // 트레이 설정 추가
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
    
    // 초기 로딩 시 로그인 상태 확인 및 테스크 목록 전송
    mainWindow.webContents.on('did-finish-load', async () => {
        const isLoggedIn = await googleTasks.initialize();
        mainWindow.webContents.send('auth-status', isLoggedIn);
        if (isLoggedIn) {
            try {
                const tasks = await googleTasks.listTasks();
                mainWindow.webContents.send('tasks-data', tasks);
            } catch (e) {
                console.error('초기 태스크 로드 실패:', e);
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
