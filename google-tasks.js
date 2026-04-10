const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const querystring = require('querystring');

const TOKEN_PATH = path.join(app.getPath('userData'), 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const PORT = 3000;

class GoogleTasksHandler {
    constructor() {
        this.clientConfig = null;
        this.tokens = null;
        this.server = null;
    }

    /**
     * 기본 https 요청 헬퍼
     */
    async _request(options, postData = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data ? JSON.parse(data) : {});
                    } else {
                        reject(new Error(`API Error (${res.statusCode}): ${data}`));
                    }
                });
            });
            req.on('error', (e) => reject(e));
            if (postData) {
                req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
            }
            req.end();
        });
    }

    async initialize() {
        try {
            if (!fs.existsSync(CREDENTIALS_PATH)) return false;
            const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
            const credentials = JSON.parse(content);
            this.clientConfig = credentials.installed || credentials.web;

            if (fs.existsSync(TOKEN_PATH)) {
                this.tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
                // 만료 체크 후 갱신 로직 필요 (여기서는 단순 로드)
                return true;
            }
        } catch (error) {
            console.error('GoogleTasks 초기화 실패:', error);
        }
        return false;
    }

    /**
     * 액세스 토큰 갱신
     */
    async refreshToken() {
        if (!this.tokens || !this.tokens.refresh_token) return;

        const postData = querystring.stringify({
            client_id: this.clientConfig.client_id,
            client_secret: this.clientConfig.client_secret,
            refresh_token: this.tokens.refresh_token,
            grant_type: 'refresh_token',
        });

        const options = {
            hostname: 'oauth2.googleapis.com',
            path: '/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length
            }
        };

        const newTokens = await this._request(options, postData);
        this.tokens = { ...this.tokens, ...newTokens };
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(this.tokens));
    }

    async authenticate() {
        return new Promise((resolve, reject) => {
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + 
                querystring.stringify({
                    client_id: this.clientConfig.client_id,
                    redirect_uri: `http://localhost:${PORT}`,
                    response_type: 'code',
                    scope: 'https://www.googleapis.com/auth/tasks',
                    access_type: 'offline',
                    prompt: 'consent'
                });

            if (this.server) this.server.close();

            this.server = http.createServer(async (req, res) => {
                try {
                    const parsedUrl = url.parse(req.url, true);
                    const code = parsedUrl.query.code;

                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end('<h1>인증되었습니다!</h1><p>앱으로 돌아가셔도 됩니다.</p>');
                        this.server.close();

                        const postData = querystring.stringify({
                            client_id: this.clientConfig.client_id,
                            client_secret: this.clientConfig.client_secret,
                            code: code,
                            redirect_uri: `http://localhost:${PORT}`,
                            grant_type: 'authorization_code'
                        });

                        const options = {
                            hostname: 'oauth2.googleapis.com',
                            path: '/token',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                                'Content-Length': postData.length
                            }
                        };

                        this.tokens = await this._request(options, postData);
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(this.tokens));
                        resolve(true);
                    }
                } catch (e) {
                    reject(e);
                }
            }).listen(PORT, () => {
                shell.openExternal(authUrl);
            });
        });
    }

    /**
     * REST API 호출 (공통 인증 헤더 포함)
     */
    async _get(path) {
        try {
            return await this._call('GET', path);
        } catch (e) {
            // 토큰 만료 시 1회 갱신 시도
            await this.refreshToken();
            return await this._call('GET', path);
        }
    }

    async _call(method, path, body = null) {
        if (!this.tokens) throw new Error('인증되지 않음');
        
        const options = {
            hostname: 'tasks.googleapis.com',
            path: `/tasks/v1${path}`,
            method: method,
            headers: {
                'Authorization': `Bearer ${this.tokens.access_token}`,
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
        }

        return await this._request(options, body);
    }

    async listTasks() {
        const data = await this._get('/lists/@default/tasks');
        return data.items || [];
    }

    async addTask(title) {
        return await this._call('POST', '/lists/@default/tasks', { title });
    }

    async updateTask(taskId, completed) {
        const status = completed ? 'completed' : 'needsAction';
        return await this._call('PATCH', `/lists/@default/tasks/${taskId}`, { status });
    }

    async deleteTask(taskId) {
        await this._call('DELETE', `/lists/@default/tasks/${taskId}`);
        return true;
    }
}

module.exports = new GoogleTasksHandler();
