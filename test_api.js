const axios = require('axios');
const fs = require('fs');
const keys = fs.readFileSync('api_keys.txt', 'utf8').match(/sk-[a-zA-Z0-9]+/g);
const key = keys[0];

const videoUrl = "https://dreamapi-oss.oss-cn-hongkong.aliyuncs.com/example.mp4";
const imageUrl = "https://dreamapi-oss.oss-cn-hongkong.aliyuncs.com/example.jpg";

const tests = [
  { videoUrl: videoUrl, imageUrl: imageUrl },
  { videoUrl: videoUrl, imageUrls: [imageUrl] },
  { srcVideoUrl: videoUrl, srcImageUrl: imageUrl },
  { srcVideoUrl: videoUrl, imageUrls: [imageUrl] },
  { driveVideoUrl: videoUrl, imageUrls: [imageUrl] },
  { drivingVideoUrl: videoUrl, imageUrls: [imageUrl] },
  { drivingVideoUrl: videoUrl, imageUrl: imageUrl },
  { driveVideoUrl: videoUrl, imageUrl: imageUrl },
  { video_url: videoUrl, image_url: imageUrl },
  { src_video_url: videoUrl, src_image_url: imageUrl }
];

async function run() {
  for (let i=0; i<tests.length; i++) {
    try {
      console.log(`Test ${i}:`, Object.keys(tests[i]));
      const res = await axios.post('http://api.newportai.com/api/async/wan/dreamact/2.1', tests[i], {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      console.log('SUCCESS:', res.data);
      if (res.data.code === 0 || res.data.taskId) {
        break;
      }
    } catch(e) {
      console.log('Error:', e.response?.data?.message || e.message);
    }
  }
}
run();
