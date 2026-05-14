const axios = require('axios');
const fs = require('fs');
const keys = fs.readFileSync('api_keys.txt', 'utf8').match(/sk-[a-zA-Z0-9]+/g);
const key = keys[0];

const videoUrl = "https://dreamapi-oss.oss-cn-hongkong.aliyuncs.com/example.mp4";
const imageUrl = "https://dreamapi-oss.oss-cn-hongkong.aliyuncs.com/example.jpg";
const payload = { srcVideoUrl: videoUrl, imageUrls: [imageUrl] };

const endpoints = [
  'http://api.newportai.com/api/async/dreamact',
  'http://api.newportai.com/api/async/wan/dreamact',
  'http://api.newportai.com/api/async/wan/dreamact/2.1',
  'http://api.newportai.com/api/async/wan/dreamact/2.0'
];

async function run() {
  for (let ep of endpoints) {
    try {
      console.log('Testing', ep);
      const res = await axios.post(ep, payload, {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      console.log('SUCCESS:', res.data);
    } catch(e) {
      console.log('Error:', e.response?.status, e.response?.data?.message || e.message);
    }
  }
}
run();
