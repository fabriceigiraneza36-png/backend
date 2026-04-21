/**
 * Test Cloudinary Configuration
 *
 * Run this script to verify your Cloudinary setup is working correctly.
 *
 * Usage: node test-cloudinary.js
 */

require("dotenv").config();
const { cloudinary, isCloudinaryConfigured } = require("./config/cloudinary");

async function testCloudinary() {
  console.log("🧪 Testing Cloudinary Configuration...\n");

  // Check configuration
  if (!isCloudinaryConfigured) {
    console.log("❌ Cloudinary is not configured!");
    console.log("Please set the following environment variables:");
    console.log("  CLOUDINARY_CLOUD_NAME=your_cloud_name");
    console.log("  CLOUDINARY_API_KEY=your_api_key");
    console.log("  CLOUDINARY_API_SECRET=your_api_secret");
    console.log("\nOr set CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name");
    return;
  }

  console.log("✅ Cloudinary is configured");

  try {
    // Test connection by getting account info
    const account = await cloudinary.api.ping();
    console.log("✅ Cloudinary connection successful");
    console.log("📊 Account Status:", account.status);

    // Get usage stats
    const usage = await cloudinary.api.usage();
    console.log("📈 Usage Stats:");
    console.log(`   - Plan: ${usage.plan}`);
    console.log(`   - Credits Used: ${usage.credits?.used || 'N/A'}`);
    console.log(`   - Credits Limit: ${usage.credits?.limit || 'N/A'}`);
    console.log(`   - Objects: ${usage.objects?.usage || 'N/A'}`);

    console.log("\n🎉 Cloudinary is ready for uploads!");

  } catch (error) {
    console.log("❌ Cloudinary test failed:");
    console.log("Error:", error.message);

    if (error.message.includes("Invalid credentials")) {
      console.log("\n💡 Check your credentials - they might be incorrect");
    } else if (error.message.includes("network")) {
      console.log("\n💡 Check your internet connection");
    }
  }
}

// Run test if executed directly
if (require.main === module) {
  testCloudinary().catch(console.error);
}

module.exports = { testCloudinary };