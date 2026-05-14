const axios = require('axios'); axios.get('https://www.dreamfaceapp.com/apps/dreamact').then(r => console.log(r.data.match(/src=\"([^\"]+\.js)\"/g))).catch(e => console.log(e.message));
