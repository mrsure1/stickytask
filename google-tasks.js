const { google } = require('googleapis');
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const SCOPES = ['https://www.googleapis.com/auth/tasks'];
const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const PORT = 3000; // 리다이렉트를 수신할 로컬 포트

class GoogleTasksHandler {
    constructor() {
        this.oAuth2Client = null;
        this.server = null;
    }

    /**
     * 초기화: credentials.json을 로드하고 oAuth2Client를 생성합니다.
     */
    async initialize() {
        try {
            if (!fs.existsSync(CREDENTIALS_PATH)) return false;

            const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
            const credentials = JSON.parse(content);
            const key = credentials.installed || credentials.web;
            
            this.oAuth2Client = new google.auth.OAuth2(
                key.client_id, 
                key.client_secret, 
                `http://localhost:${PORT}`
            );

            if (fs.existsSync(TOKEN_PATH)) {
                const token = fs.readFileSync(TOKEN_PATH, 'utf8');
                this.oAuth2Client.setCredentials(JSON.parse(token));
                return true;
            }
        } catch (error) {
            console.error('초기화 오류:', error);
        }
        return false;
    }

    /**
     * 로그인 프로세스 시작: 웹 서버를 열고 브라우저를 띄웁니다.
     */
    async authenticate() {
        return new Promise((resolve, reject) => {
            if (!this.oAuth2Client) {
                return reject(new Error('credentials.json 파일이 설정되지 않았습니다.'));
            }

            const authUrl = this.oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
            });

            // 인증 서버 중복 실행 방지
            if (this.server) this.server.close();

            this.server = http.createServer(async (req, res) => {
                try {
                    if (req.url.indexOf('/?') > -1) {
                        const qs = new url.URL(req.url, `http://localhost:${PORT}`).searchParams;
                        const code = qs.get('code');
                        
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>인증되었습니다!</h1><p>이제 이 창을 닫고 앱으로 돌아가셔도 됩니다.</p>');
                        this.server.close();
                        
                        const { tokens } = await this.oAuth2Client.getToken(code);
                        this.oAuth2Client.setCredentials(tokens);
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                        
                        resolve(true);
                    }
                } catch (e) {
                    reject(e);
                }
            }).listen(PORT, () => {
                shell.openExternal(authUrl); // 브라우저 열기
            });
        });
    }

    /**
     * 태스크 목록 조회
     */
    async listTasks() {
        if (!this.oAuth2Client) return [];
        const service = google.tasks({ version: 'v1', auth: this.oAuth2Client });
        const res = await service.tasks.list({ tasklist: '@default' });
        return res.data.items || [];
    }

    /**
     * 태스크 추가
     */
    async addTask(title) {
        if (!this.oAuth2Client) return null;
        const service = google.tasks({ version: 'v1', auth: this.oAuth2Client });
        const res = await service.tasks.insert({
            tasklist: '@default',
            requestBody: { title }
        });
        return res.data;
    }

    /**
     * 태스크 상태 업데이트
     */
    async updateTask(taskId, completed) {
        if (!this.oAuth2Client) return null;
        const service = google.tasks({ version: 'v1', auth: this.oAuth2Client });
        const status = completed ? 'completed' : 'needsAction';
        const res = await service.tasks.patch({
            tasklist: '@default',
            task: taskId,
            requestBody: { status }
        });
        return res.data;
    }

    /**
     * 태스크 삭제
     */
    async deleteTask(taskId) {
        if (!this.oAuth2Client) return null;
        const service = google.tasks({ version: 'v1', auth: this.oAuth2Client });
        await service.tasks.delete({
            tasklist: '@default',
            task: taskId
        });
        return true;
    }
}

module.exports = new GoogleTasksHandler();
