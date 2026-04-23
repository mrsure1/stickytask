import { Preferences } from '@capacitor/preferences';
import { SocialLogin } from '@capgo/capacitor-social-login';

const taskInput = document.getElementById('task-input');
const addBtn = document.getElementById('add-btn');
const taskList = document.getElementById('task-list');
const settingsBtn = document.getElementById('settings-btn');
const loginBtn = document.getElementById('login-btn');
const syncStatus = document.getElementById('sync-status');
const settingsOverlay = document.getElementById('settings-overlay');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const opacitySlider = document.getElementById('opacity-slider');
const colorDots = document.querySelectorAll('.color-dot');

const WEB_CLIENT_ID = "483808761580-0fq6c3inteb6man1eve5mg0fciehf2fl.apps.googleusercontent.com";

let googleTasks = [];
let accessToken = null;

// 설정 로드 및 적용
async function loadSettings() {
    const { value: bgColor } = await Preferences.get({ key: 'bg-color' }) || { value: '#fff176' };
    const { value: headerColor } = await Preferences.get({ key: 'header-color' }) || { value: '#fdd835' };
    const { value: opacityStr } = await Preferences.get({ key: 'opacity' }) || { value: '1.0' };
    
    const opacity = parseFloat(opacityStr || '1.0');
    const safeOpacity = Math.max(0.2, opacity);

    document.documentElement.style.setProperty('--sticky-bg', bgColor || '#fff176');
    document.documentElement.style.setProperty('--sticky-header', headerColor || '#fdd835');
    document.documentElement.style.setProperty('--sticky-opacity', safeOpacity);
    opacitySlider.value = opacity;

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
    dot.addEventListener('click', async () => {
        const color = dot.dataset.color;
        const header = dot.dataset.header;
        
        document.documentElement.style.setProperty('--sticky-bg', color);
        document.documentElement.style.setProperty('--sticky-header', header);
        
        await Preferences.set({ key: 'bg-color', value: color });
        await Preferences.set({ key: 'header-color', value: header });
        
        colorDots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
    });
});

// 투명도 변경
opacitySlider.addEventListener('input', async (e) => {
    const opacity = parseFloat(e.target.value);
    const safeOpacity = Math.max(0.2, opacity);
    document.documentElement.style.setProperty('--sticky-opacity', safeOpacity);
    await Preferences.set({ key: 'opacity', value: opacity.toString() });
});

// Google 로그인 (Capacitor Social Login)
loginBtn.addEventListener('click', async () => {
    try {
        syncStatus.innerText = '로그인 시도 중...';
        
        const response = await SocialLogin.login({
            provider: 'google',
            options: {
                scopes: ['https://www.googleapis.com/auth/tasks']
            }
        });
        
        if (response.result.token) {
            accessToken = response.result.token.accessToken;
            syncStatus.innerText = 'Google 연동됨';
            loginBtn.style.display = 'none';
            await loadTasks();
        }
        
    } catch (err) {
        console.error('로그인 에러:', err);
        syncStatus.innerText = '로그인 실패';
        alert('로그인에 실패했습니다: ' + err.message);
    }
});

// 태스크 로드 (API 호출)
async function loadTasks() {
    if (!accessToken) return;
    
    try {
        const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await res.json();
        googleTasks = data.items || [];
        renderTasks();
    } catch (err) {
        console.error('태스크 로드 실패:', err);
    }
}

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
            <div class="checkbox" id="check-${task.id}"></div>
            <div class="task-text">${task.title}</div>
            <div class="delete-task" id="del-${task.id}">🗑</div>
        `;
        
        taskList.appendChild(li);

        document.getElementById(`check-${task.id}`).onclick = () => toggleTask(task.id, isCompleted);
        document.getElementById(`del-${task.id}`).onclick = () => deleteTask(task.id);
    });
}

// 태스크 추가
async function addTask() {
    const title = taskInput.value.trim();
    if (!title || !accessToken) return;

    try {
        const res = await fetch('https://tasks.googleapis.com/tasks/v1/lists/@default/tasks', {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ title })
        });
        const newTask = await res.json();
        googleTasks.unshift(newTask);
        taskInput.value = '';
        renderTasks();
    } catch (err) {
        console.error('추가 실패:', err);
    }
}

addBtn.addEventListener('click', addTask);
taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addTask();
        taskInput.blur();
    }
});

// 태스크 토글
async function toggleTask(taskId, currentStatus) {
    if (!accessToken) return;
    const newStatus = !currentStatus ? 'completed' : 'needsAction';
    
    try {
        await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status: newStatus })
        });
        
        const task = googleTasks.find(t => t.id === taskId);
        if (task) {
            task.status = newStatus;
            renderTasks();
        }
    } catch (err) {
        console.error('업데이트 실패:', err);
    }
}

// 태스크 삭제
async function deleteTask(taskId) {
    if (!accessToken || !confirm('삭제하시겠습니까?')) return;
    
    try {
        await fetch(`https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${taskId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        googleTasks = googleTasks.filter(t => t.id !== taskId);
        renderTasks();
    } catch (err) {
        console.error('삭제 실패:', err);
    }
}
