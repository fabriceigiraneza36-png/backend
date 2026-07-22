// backend/test-destinations-crud.mjs
// Run: node test-destinations-crud.mjs
import http from 'http';

const BASE = 'http://localhost:3000';
let token = null;
let createdId = null;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (token) options.headers.Authorization = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function log(label, result) {
  const ok = result.status >= 200 && result.status < 300;
  console.log(`${ok ? '✅' : '❌'} [${result.status}] ${label}`);
  if (!ok || process.env.VERBOSE) {
    console.log('   Body:', JSON.stringify(result.body, null, 2).slice(0, 500));
  }
}

async function adminLogin() {
  console.log('\n── Step 1: Admin Login ──────────────────');
  const res = await request('POST', '/api/admin/auth/login', {
    email: 'altuverasafari@gmail.com',
    password: 'Admin@2024!',
  });
  await log('Admin login', res);
  if (res.status === 200 && res.body?.success) {
    token = res.body.data.token;
    console.log(`   Token acquired: ${token.slice(0, 20)}...`);
  } else {
    throw new Error('Admin login failed. Cannot proceed.');
  }
}

async function createDestination() {
  console.log('\n── Step 2: Create Destination ──────────');
  const payload = {
    name: 'Test Destination CRUD',
    country_id: 1,
    tagline: 'A test destination for CRUD verification',
    short_description: 'Short desc',
    description: 'Full description for testing.',
    category: 'safari',
    difficulty: 'moderate',
    region: 'East Africa',
    nearest_city: 'Musanze',
    nearest_airport: 'Kigali International',
    best_time_to_visit: 'Jun-Sep',
    latitude: -1.4938,
    longitude: 29.5348,
    altitude_meters: 1500,
    duration_days: 3,
    min_group_size: 1,
    max_group_size: 12,
    min_age: 10,
    fitness_level: 'moderate',
    highlights: ['Mountain view', 'Wildlife'],
    activities: ['Hiking', 'Photography'],
    wildlife: ['Gorillas', 'Birds'],
    status: 'draft',
    is_featured: true,
    is_popular: false,
    is_new: true,
    is_eco_friendly: true,
    is_family_friendly: false,
    meta_title: 'Test Destination',
    meta_description: 'SEO description for test destination',
  };

  const res = await request('POST', '/api/destinations', payload);
  await log('Create destination', res);
  if (res.status === 201 && res.body?.success) {
    createdId = res.body.data.id;
    console.log(`   Created ID: ${createdId}`);
  } else if (res.status === 409) {
    console.log('   Slug/name conflict, attempting with unique name...');
    payload.name = `Test Destination ${Date.now()}`;
    const retry = await request('POST', '/api/destinations', payload);
    await log('Create destination (retry)', retry);
    if (retry.status === 201 && retry.body?.success) {
      createdId = retry.body.data.id;
      console.log(`   Created ID: ${createdId}`);
    } else {
      throw new Error('Create destination failed on retry.');
    }
  } else {
    throw new Error('Create destination failed.');
  }
}

async function viewDestination() {
  console.log('\n── Step 3: View Destination ────────────');
  const res = await request('GET', `/api/destinations/${createdId}`);
  await log('Get destination by ID', res);
  if (res.status === 200) {
    console.log(`   Name: ${res.body?.data?.name}`);
  }
}

async function updateDestination() {
  console.log('\n── Step 4: Update Destination ──────────');
  const payload = {
    tagline: 'Updated tagline via CRUD test',
    description: 'Updated description via CRUD test.',
    is_featured: false,
    is_popular: true,
  };
  const res = await request('PUT', `/api/destinations/${createdId}`, payload);
  await log('Update destination', res);
  if (res.status === 200 && res.body?.success) {
    console.log(`   Updated tagline: ${res.body?.data?.tagline}`);
  } else {
    throw new Error('Update destination failed.');
  }
}

async function deleteDestination() {
  console.log('\n── Step 5: Delete Destination ──────────');
  const res = await request('DELETE', `/api/destinations/${createdId}`);
  await log('Delete destination', res);
  if (res.status === 200) {
    console.log('   Destination deleted successfully.');
  } else {
    throw new Error('Delete destination failed.');
  }
}

async function verifyDeleted() {
  console.log('\n── Step 6: Verify Deleted ──────────────');
  const res = await request('GET', `/api/destinations/${createdId}`);
  await log('Get deleted destination (expect soft-delete or 404)', res);
}

async function run() {
  console.log('🧪 Destinations CRUD Test\n');
  try {
    await adminLogin();
    await createDestination();
    await viewDestination();
    await updateDestination();
    await deleteDestination();
    await verifyDeleted();
    console.log('\n✨ All steps completed.\n');
  } catch (err) {
    console.error('\n💥 Test failed:', err.message);
    process.exit(1);
  }
}

run();
