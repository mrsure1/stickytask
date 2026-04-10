const { app, BrowserWindow, ipcMain, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
// googleTasks는 필요할 때 지연 로딩합니다.
let googleTasks;
function getTasksHandler() {
    if (!googleTasks) googleTasks = require('./google-tasks');
    return googleTasks;
}

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
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        show: false, // 창 준비 전까지 숨김
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // 창이 준비되면 즉시 표시 (30초 지연 방지)
    mainWindow.once('ready-to-show', () => {
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
        setTimeout(async () => {
            try {
                const handler = getTasksHandler();
                const isLoggedIn = await handler.initialize();
                mainWindow.webContents.send('auth-status', isLoggedIn);
                if (isLoggedIn) {
                    const tasks = await handler.listTasks();
                    mainWindow.webContents.send('tasks-data', tasks);
                }
            } catch (e) {
                console.error('데이터 초기 로딩 오류:', e);
            }
        }, 100);
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
        const handler = getTasksHandler();
        const success = await handler.authenticate();
        if (success) {
            const tasks = await handler.listTasks();
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
    return await getTasksHandler().listTasks();
});

ipcMain.handle('add-task', async (event, title) => {
    return await getTasksHandler().addTask(title);
});

ipcMain.handle('update-task', async (event, { taskId, completed }) => {
    return await getTasksHandler().updateTask(taskId, completed);
});

ipcMain.handle('delete-task', async (event, taskId) => {
    return await getTasksHandler().deleteTask(taskId);
});

ipcMain.on('close-app', () => {
    saveWindowState();
    app.quit();
});

ipcMain.on('minimize-app', () => {
    mainWindow.minimize();
});
