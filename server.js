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

// Setup multer for file uploads
const upload = multer({ dest: 'uploads/' });
const FormData = require('form-data');

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
                console.log(`Loaded ${apiKeys.length} API keys dari api_keys.txt`);
            } else {
                console.log('Tidak ditemukan API Key berawalan sk- di dalam api_keys.txt');
            }
        } else {
            console.warn('File api_keys.txt tidak ditemukan! Silakan buat file ini dan paste list akun Anda.');
        }
    } catch (e) {
        console.error('Error loading API keys:', e.message);
    }
}

// Initial load
loadApiKeys();

// Helper to get the next valid API key
function getNextApiKey() {
    if (apiKeys.length === 0) return null;
    const key = apiKeys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    return key;
}

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
        
        console.log(`[Upload] Uploading to OSS...`);
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
        
        console.log(`[Upload] Getting final URL (reqId: ${reqId})...`);
        const finishRes = await axios.post('https://api.newportai.com/api/file/v1/policy_upload_finish',
            { reqId: reqId },
            { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
        );

        const finalUrl = (finishRes.data.data && finishRes.data.data.url) ? finishRes.data.data.url : finishRes.data.url;
        
        if (!finalUrl) {
            throw new Error('Upload finish response missing URL. Response: ' + JSON.stringify(finishRes.data));
        }

        // Clean URL by removing query params
        const cleanUrl = finalUrl.split('?')[0];
        console.log(`[Upload] Success! URL: ${cleanUrl}`);
        return cleanUrl;
    } catch (e) {
        console.error(`[Upload] Failed for ${fileName}:`, e.response ? JSON.stringify(e.response.data) : e.message);
        throw e;
    }
}

app.post('/api/dreamact', upload.fields([{ name: 'videoFile', maxCount: 1 }, { name: 'imageFile', maxCount: 1 }]), async (req, res) => {
    
    if (!req.files || !req.files.videoFile || !req.files.imageFile) {
        return res.status(400).json({ error: 'videoFile and imageFile are required' });
    }

    if (apiKeys.length === 0) {
        loadApiKeys();
        if (apiKeys.length === 0) {
            return res.status(500).json({ error: 'No API Keys available.' });
        }
    }

    let attempts = 0;
    const maxAttempts = Math.min(apiKeys.length, 50); 
    let lastErrorMsg = 'All attempted API keys failed or ran out of credits.';

    while (attempts < maxAttempts) {
        const apiKey = getNextApiKey();
        console.log(`\nAttempt ${attempts + 1}: Using API Key: ${apiKey.substring(0, 8)}...`);

        try {
            // Upload files to Newport OSS first
            const videoUrl = await uploadToNewport(req.files.videoFile[0].path, req.files.videoFile[0].originalname, apiKey);
            const imageUrl = await uploadToNewport(req.files.imageFile[0].path, req.files.imageFile[0].originalname, apiKey);

            // Initiate DreamAct task
            console.log(`Initiating DreamAct task...`);
            const response = await axios.post('http://api.newportai.com/api/async/wan/dreamact/2.1', {
                video: videoUrl,
                images: [imageUrl]
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            // Cleanup local temp files
            fs.unlinkSync(req.files.videoFile[0].path);
            fs.unlinkSync(req.files.imageFile[0].path);

            if (response.data.code !== 0 && response.data.code !== undefined) {
                const err = new Error(response.data.message || 'DreamAct Task Error');
                err.status = response.data.code === 13015 ? 429 : 400;
                err.isNewportError = true;
                throw err;
            }

            const responseData = response.data.data || response.data;
            if (responseData && responseData.taskId) {
                return res.json({ success: true, taskId: responseData.taskId, usedKey: apiKey });
            } else {
                throw new Error('Invalid API response: ' + JSON.stringify(response.data));
            }

        } catch (error) {
            const status = error.status || (error.response ? error.response.status : null);
            console.error(`API Key failed:`, error.response?.data || error.message);
            
            if (error.isNewportError) {
                lastErrorMsg = error.message;
            }

            if (status === 401 || status === 402 || status === 403 || status === 429) {
                attempts++;
                continue;
            } else {
                // Cleanup on generic error too
                try {
                   if (fs.existsSync(req.files.videoFile[0].path)) fs.unlinkSync(req.files.videoFile[0].path);
                   if (fs.existsSync(req.files.imageFile[0].path)) fs.unlinkSync(req.files.imageFile[0].path);
                } catch(e) {}
                
                return res.status(500).json({ error: error.message || 'Error communicating with DreamFace API' });
            }
        }
    }

    try {
        if (fs.existsSync(req.files.videoFile[0].path)) fs.unlinkSync(req.files.videoFile[0].path);
        if (fs.existsSync(req.files.imageFile[0].path)) fs.unlinkSync(req.files.imageFile[0].path);
    } catch(e) {}

    res.status(500).json({ error: lastErrorMsg });
});


// Polling endpoint
app.get('/api/task/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const apiKey = getNextApiKey();
    
    try {
        const response = await axios.post(`http://api.newportai.com/api/getAsyncResult`, {
            taskId: taskId
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Polling error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to poll task status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`DreamAct Web App running on http://localhost:${PORT}`);
});
