const http = require('http');
const opts = 'http://localhost:3000/api/countries?featured=true';
http.get(opts, res => {
  console.log('STATUS', res.statusCode);
  let body='';
  res.on('data', c => body += c);
  res.on('end', () => {
    console.log('BODY:', body);
  });
}).on('error', e => console.error('ERR', e));
