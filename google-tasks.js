const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
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

    async initialize() {
        try {
            if (!fs.existsSync(CREDENTIALS_PATH)) return false;
            const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
            const credentials = JSON.parse(content);
            this.clientConfig = credentials.installed || credentials.web;

            if (fs.existsSync(TOKEN_PATH)) {
                this.tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
                // 만료 체크 후 갱신은 API 호출 시 401 에러를 받으면 처리합니다.
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
        if (!this.tokens || !this.tokens.refresh_token) {
            console.warn('refresh_token이 없습니다. 다시 로그인해야 합니다.');
            throw new Error('No refresh token available');
        }

        const postData = querystring.stringify({
            client_id: this.clientConfig.client_id,
            client_secret: this.clientConfig.client_secret,
            refresh_token: this.tokens.refresh_token,
            grant_type: 'refresh_token',
        });

        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: postData
            });

            if (!response.ok) {
                const errText = await response.text();
                if (errText.includes('invalid_grant')) {
                    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
                    this.tokens = null;
                }
                throw new Error(`Token refresh failed: ${response.status} ${errText}`);
            }

            const newTokens = await response.json();
            // refresh_token이 응답에 없을 수 있으므로 기존 것 유지
            this.tokens = { ...this.tokens, ...newTokens };
            fs.writeFileSync(TOKEN_PATH, JSON.stringify(this.tokens));
            return true;
        } catch (error) {
            console.error('Token refresh error:', error);
            throw error;
        }
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

                        const response = await fetch('https://oauth2.googleapis.com/token', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                            body: postData
                        });

                        if (!response.ok) {
                            throw new Error(`Auth failed: ${await response.text()}`);
                        }

                        this.tokens = await response.json();
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
    async _call(method, path, body = null, isRetry = false) {
        if (!this.tokens) throw new Error('인증되지 않음');
        
        const url = `https://tasks.googleapis.com/tasks/v1${path}`;
        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${this.tokens.access_token}`,
                'Accept': 'application/json'
            }
        };

        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        let response = await fetch(url, options);

        // 401 Unauthorized일 경우 토큰 갱신 후 1회 재시도
        if (response.status === 401 && !isRetry) {
            console.log('Access token expired. Refreshing token...');
            await this.refreshToken();
            // 재시도 시 토큰이 갱신되었으므로 옵션의 헤더 업데이트
            options.headers['Authorization'] = `Bearer ${this.tokens.access_token}`;
            response = await fetch(url, options);
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error (${response.status}): ${errorText}`);
        }

        // 응답 본문이 없는 경우(DELETE 등) 빈 객체 반환
        if (response.status === 204) {
            return {};
        }

        return await response.json();
    }

    async listTasks() {
        const data = await this._call('GET', '/lists/@default/tasks?showCompleted=true&showHidden=true');
        return data.items || [];
    }

    async addTask(title) {
        return await this._call('POST', '/lists/@default/tasks', { title });
    }

    async updateTask(taskId, completed) {
        const status = completed ? 'completed' : 'needsAction';
        return await this._call('PATCH', `/lists/@default/tasks/${taskId}`, { id: taskId, status });
    }

    async deleteTask(taskId) {
        await this._call('DELETE', `/lists/@default/tasks/${taskId}`);
        return true;
    }
}

module.exports = new GoogleTasksHandler();
