// test-api.js
// Run with: node test-api.js

const testData = {
  name: "John Doe",
  email: "test@example.com",
  phone: "+1234567890",
  subject: "Test Safari Inquiry",
  message: "This is a test message to verify the email system is working correctly. I am interested in booking a safari.",
  tripType: "safari",
  travelDate: "2024-06-15",
  travelers: "2"
};

async function testAPI() {
  console.log('🧪 Testing API...\n');
  
  try {
    // Test health endpoint
    console.log('1️⃣ Testing health endpoint...');
    const healthRes = await fetch('http://localhost:5000/api/health');
    const healthData = await healthRes.json();
    console.log('Health:', healthData);
    
    // Test contact endpoint
    console.log('\n2️⃣ Testing contact endpoint...');
    console.log('Sending:', JSON.stringify(testData, null, 2));
    
    const contactRes = await fetch('http://localhost:5000/api/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });
    
    console.log('Status:', contactRes.status);
    const contactData = await contactRes.json();
    console.log('Response:', JSON.stringify(contactData, null, 2));
    
    if (contactData.success) {
      console.log('\n✅ SUCCESS! Check your email.');
    } else {
      console.log('\n❌ FAILED:', contactData.message);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testAPI();