const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });
const FormData = require('form-data');

// ============================
// MODE SWITCH: 'api' | 'bot'
// Set ke 'bot' untuk pakai Puppeteer (menembus antrean web)
// Set ke 'api' untuk pakai API Key langsung
// ============================
const MODE = process.env.MODE || 'bot';
console.log(`[Server] Mode aktif: ${MODE.toUpperCase()}`);

// ============================
// API MODE: Load API Keys
// ============================
const ACCOUNTS_FILE = path.join(__dirname, 'api_keys.txt');
let apiKeys = [];
let currentKeyIndex = 0;

function loadApiKeys() {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            const data = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
            const matches = data.match(/sk-[a-zA-Z0-9]+/g);
            if (matches) {
                apiKeys = [...new Set(matches)];
                console.log(`[Server] Loaded ${apiKeys.length} API keys dari api_keys.txt`);
            }
        }
    } catch (e) {
        console.error('[Server] Error loading API keys:', e.message);
    }
}

function getNextApiKey() {
    if (apiKeys.length === 0) return null;
    const key = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return key;
}

// ============================
// BOT MODE: Load Puppeteer Worker
// ============================
let botWorker = null;
if (MODE === 'bot') {
    try {
        botWorker = require('./puppeteer-worker');
        botWorker.loadAccounts();
    } catch(e) {
        console.error('[Server] Gagal memuat puppeteer-worker.js:', e.message);
    }
} else {
    loadApiKeys();
}

// ============================
// UPLOAD HELPER (API mode only)
// ============================
async function uploadToNewport(filePath, fileName, apiKey) {
    try {
        console.log(`[Upload] Requesting policy for ${fileName}...`);
        const policyRes = await axios.post('https://api.newportai.com/api/file/v1/get_policy',
            { Enum: "Dream-CN" },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        if (policyRes.data.code !== 0 && policyRes.data.code !== undefined) {
            const err = new Error(policyRes.data.message || 'Policy Error');
            err.status = policyRes.data.code === 13015 ? 429 : 400;
            err.isNewportError = true;
            throw err;
        }

        const policyData = policyRes.data.data || policyRes.data;
        const { accessId, policy, signature, dir, callback } = policyData;

        const form = new FormData();
        form.append('policy', policy);
        form.append('OSSAccessKeyId', accessId);
        form.append('success_action_status', '200');
        form.append('signature', signature);
        form.append('key', dir + fileName);
        form.append('callback', callback);
        form.append('file', fs.createReadStream(filePath), fileName);

        const ossRes = await axios.post('https://dreamapi-oss.oss-cn-hongkong.aliyuncs.com', form, {
            headers: form.getHeaders(),
            timeout: 60000
        });

        const reqId = (ossRes.data.data && ossRes.data.data.reqId) ? ossRes.data.data.reqId : ossRes.data.reqId;

        const finishRes = await axios.post('https://api.newportai.com/api/file/v1/policy_upload_finish',
            { reqId },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        const finalUrl = (finishRes.data.data && finishRes.data.data.url) ? finishRes.data.data.url : finishRes.data.url;
        if (!finalUrl) throw new Error('Upload finish response missing URL: ' + JSON.stringify(finishRes.data));

        const cleanUrl = finalUrl.split('?')[0];
        console.log(`[Upload] Success: ${cleanUrl}`);
        return cleanUrl;
    } catch (e) {
        console.error(`[Upload] Failed for ${fileName}:`, e.response ? JSON.stringify(e.response.data) : e.message);
        throw e;
    }
}

// ============================
// MAIN ROUTE: POST /api/dreamact
// ============================
app.post('/api/dreamact', upload.fields([{ name: 'videoFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]), async (req, res) => {
    if (!req.files || !req.files.videoFile || !req.files.imageFile) {
        return res.status(400).json({ error: 'videoFile dan imageFile harus diisi' });
    }

    const videoPath = req.files.videoFile[0].path;
    const imagePath = req.files.imageFile[0].path;
    const videoName = req.files.videoFile[0].originalname;
    const imageName = req.files.imageFile[0].originalname;

    // Resolve full absolute paths for puppeteer
    const absVideoPath = path.resolve(videoPath);
    const absImagePath = path.resolve(imagePath);

    // ---- BOT MODE ----
    if (MODE === 'bot') {
        if (!botWorker) {
            return res.status(500).json({ error: 'Bot worker tidak tersedia. Pastikan puppeteer-worker.js ada.' });
        }

        try {
            console.log(`[Server] [BOT MODE] Memulai browser bot...`);
            const resultVideoUrl = await botWorker.runDreamActBot(absVideoPath, absImagePath);

            // Cleanup
            try { fs.unlinkSync(videoPath); fs.unlinkSync(imagePath); } catch(e) {}

            // Bot mode langsung return hasil video URL (bukan taskId)
            return res.json({
                success: true,
                mode: 'bot',
                resultUrl: resultVideoUrl
            });

        } catch (error) {
            try { fs.unlinkSync(videoPath); fs.unlinkSync(imagePath); } catch(e) {}
            console.error('[Server] [BOT MODE] Error:', error.message);
            return res.status(500).json({ error: error.message });
        }
    }

    // ---- API MODE ----
    if (apiKeys.length === 0) {
        loadApiKeys();
        if (apiKeys.length === 0) {
            return res.status(500).json({ error: 'Tidak ada API Key tersedia di api_keys.txt' });
        }
    }

    let attempts = 0;
    const maxAttempts = Math.min(apiKeys.length, 50);
    let lastErrorMsg = 'Semua API key gagal atau service busy.';

    while (attempts < maxAttempts) {
        const apiKey = getNextApiKey();
        console.log(`\n[API MODE] Attempt ${attempts + 1}/${maxAttempts}: Key ${apiKey.substring(0, 8)}...`);

        try {
            const videoUrl = await uploadToNewport(videoPath, videoName, apiKey);
            const imageUrl = await uploadToNewport(imagePath, imageName, apiKey);

            const response = await axios.post('http://api.newportai.com/api/async/wan/dreamact/2.1', {
                video: videoUrl,
                images: [imageUrl]
            }, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 15000
            });

            try { fs.unlinkSync(videoPath); fs.unlinkSync(imagePath); } catch(e) {}

            if (response.data.code !== 0 && response.data.code !== undefined) {
                const err = new Error(response.data.message || 'DreamAct Task Error');
                err.status = response.data.code === 13015 ? 429 : 400;
                err.isNewportError = true;
                throw err;
            }

            const responseData = response.data.data || response.data;
            if (responseData && responseData.taskId) {
                return res.json({ success: true, mode: 'api', taskId: responseData.taskId });
            }
            throw new Error('Invalid API response: ' + JSON.stringify(response.data));

        } catch (error) {
            const status = error.status || (error.response ? error.response.status : null);
            console.error(`[API MODE] Key gagal:`, error.response?.data || error.message);

            if (error.isNewportError) lastErrorMsg = error.message;

            if (status === 401 || status === 402 || status === 403 || status === 429) {
                attempts++;
                continue;
            } else {
                try { fs.unlinkSync(videoPath); fs.unlinkSync(imagePath); } catch(e) {}
                return res.status(500).json({ error: error.message });
            }
        }
    }

    try { fs.unlinkSync(videoPath); fs.unlinkSync(imagePath); } catch(e) {}
    res.status(500).json({ error: lastErrorMsg });
});

// ============================
// POLLING ROUTE (API mode only)
// ============================
app.get('/api/task/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const apiKey = getNextApiKey();

    if (!apiKey) {
        return res.status(500).json({ error: 'Tidak ada API key untuk polling' });
    }

    try {
        const response = await axios.post('http://api.newportai.com/api/getAsyncResult',
            { taskId },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );
        res.json(response.data);
    } catch (error) {
        console.error('[Server] Polling error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Gagal mengambil status task' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\nDreamAct Web App running on http://localhost:${PORT}`);
    console.log(`Mode: ${MODE.toUpperCase()}\n`);
});
