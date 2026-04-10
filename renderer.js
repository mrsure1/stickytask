const { ipcRenderer } = require('electron');
const Store = require('electron-store');
const store = new Store();

const taskInput = document.getElementById('task-input');
const addBtn = document.getElementById('add-btn');
const taskList = document.getElementById('task-list');
const closeBtn = document.getElementById('close-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const settingsBtn = document.getElementById('settings-btn');
const loginBtn = document.getElementById('login-btn');
const syncStatus = document.getElementById('sync-status');
const settingsOverlay = document.getElementById('settings-overlay');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const opacitySlider = document.getElementById('opacity-slider');
const colorDots = document.querySelectorAll('.color-dot');

let googleTasks = [];

// 설정 로드 및 적용
function loadSettings() {
    const bgColor = store.get('bg-color', '#fff176');
    const headerColor = store.get('header-color', '#fdd835');
    const opacity = store.get('opacity', 1.0);

    document.documentElement.style.setProperty('--sticky-bg', bgColor);
    document.documentElement.style.setProperty('--sticky-header', headerColor);
    document.documentElement.style.setProperty('--sticky-opacity', opacity);
    opacitySlider.value = opacity;

    // 활성 색상 표시
    colorDots.forEach(dot => {
        if (dot.dataset.color === bgColor) dot.classList.add('active');
        else dot.classList.remove('active');
    });
}

loadSettings();

// 설정 제어
settingsBtn.addEventListener('click', () => settingsOverlay.classList.toggle('hidden'));
saveSettingsBtn.addEventListener('click', () => settingsOverlay.classList.add('hidden'));

// 색상 변경
colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
        const color = dot.dataset.color;
        const header = dot.dataset.header;
        
        document.documentElement.style.setProperty('--sticky-bg', color);
        document.documentElement.style.setProperty('--sticky-header', header);
        
        store.set('bg-color', color);
        store.set('header-color', header);
        
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
    });
});

// 투명도 변경
opacitySlider.addEventListener('input', (e) => {
    const opacity = e.target.value;
    document.documentElement.style.setProperty('--sticky-opacity', opacity);
    store.set('opacity', opacity);
});

let googleTasks = [];

// 창 제어
closeBtn.addEventListener('click', () => ipcRenderer.send('close-app'));
minimizeBtn.addEventListener('click', () => ipcRenderer.send('minimize-app'));

// 로그인 버튼 클릭
loginBtn.addEventListener('click', () => {
    ipcRenderer.send('google-login');
    syncStatus.innerText = '로그인 중...';
});

// 인증 상태 수신
ipcRenderer.on('auth-status', (event, isLoggedIn) => {
    if (isLoggedIn) {
        loginBtn.innerText = '로그아웃';
        syncStatus.innerText = 'Google Tasks 동기화됨';
        loginBtn.style.display = 'none'; // 로그인 시 버튼 숨김 (또는 로그아웃으로 변경)
    } else {
        loginBtn.innerText = 'Google 로그인';
        syncStatus.innerText = '로그인 필요';
    }
});

// 에러 핸들링
ipcRenderer.on('auth-error', (event, message) => {
    alert('인증 오류: ' + message);
    syncStatus.innerText = '로그인 오류';
});

// 태스크 데이터 수신 및 렌더링
ipcRenderer.on('tasks-data', (event, tasks) => {
    googleTasks = tasks;
    renderTasks();
});

function renderTasks() {
    taskList.innerHTML = '';
    
    if (googleTasks.length === 0) {
        taskList.innerHTML = '<li class="task-item empty">할 일이 없습니다.</li>';
        return;
    }

    googleTasks.forEach((task) => {
        const isCompleted = task.status === 'completed';
        const li = document.createElement('li');
        li.className = `task-item ${isCompleted ? 'completed' : ''}`;
        
        li.innerHTML = `
            <div class="checkbox" onclick="toggleTask('${task.id}', ${isCompleted})"></div>
            <div class="task-text">${task.title}</div>
            <div class="delete-task" onclick="deleteTask('${task.id}')">🗑</div>
        `;
        
        taskList.appendChild(li);
    });
}

// 할 일 추가
async function addTask() {
    const title = taskInput.value.trim();
    if (!title) return;

    try {
        const newTask = await ipcRenderer.invoke('add-task', title);
        if (newTask) {
            googleTasks.unshift(newTask);
            taskInput.value = '';
            renderTasks();
        }
    } catch (e) {
        // 오프라인/비인증 상태면 로컬에만 임시 추가 (선택적)
        console.error('태스크 추가 실패:', e);
    }
}

addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
});

// 할 일 상태 토글
window.toggleTask = async function(taskId, currentStatus) {
    try {
        const newStatus = !currentStatus;
        await ipcRenderer.invoke('update-task', { taskId, completed: newStatus });
        
        // 로컬 상태 업데이트
        const task = googleTasks.find(t => t.id === taskId);
        if (task) {
            task.status = newStatus ? 'completed' : 'needsAction';
            renderTasks();
        }
    } catch (e) {
        console.error('상태 업데이트 실패:', e);
    }
};

// 할 일 삭제
window.deleteTask = async function(taskId) {
    if (!confirm('할 일을 삭제하시겠습니까?')) return;
    
    try {
        await ipcRenderer.invoke('delete-task', taskId);
        googleTasks = googleTasks.filter(t => t.id !== taskId);
        renderTasks();
    } catch (e) {
        console.error('삭제 실패:', e);
    }
};

// 초기 실행 (필요한 경우 메인에서 데이터 올 때까지 대기)
