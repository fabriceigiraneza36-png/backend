const http = require('http');

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'GET'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  console.log('Testing /api/destinations...');
  const dest = await makeRequest('/api/destinations?limit=2');
  console.log('Status:', dest.status);
  console.log('Data:', JSON.stringify(dest.data, null, 2));
  
  console.log('\nTesting /api/auth (root)...');
  const auth = await makeRequest('/api/auth');
  console.log('Status:', auth.status);
  console.log('Data:', JSON.stringify(auth.data, null, 2));
  
  console.log('\nTesting /api/health...');
  const health = await makeRequest('/api/health');
  console.log('Status:', health.status);
}

test().catch(console.error);
