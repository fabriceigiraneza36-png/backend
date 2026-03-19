/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEED DATA - FAQs, Services, Tips, Virtual Tours
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require("path");
const fs = require("fs");

// Load environment variables from .env file
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      const value = valueParts.join("=").trim();
      if (key && value) {
        process.env[key.trim()] = value;
      }
    }
  });
  console.log("✅ Loaded environment variables from .env");
}

const { query } = require("../config/db");

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════════════════

const faqsData = [
  { question: "What destinations does Altuvera offer tours to?", answer: "Altuvera offers curated tours across East Africa including Rwanda, Kenya, Tanzania, and Uganda. Our destinations include gorilla trekking in Rwanda, safaris in the Serengeti and Masai Mara, mountain climbing expeditions, and cultural experiences.", category: "destinations", sort_order: 1 },
  { question: "How do I book a tour with Altuvera?", answer: "You can book directly through our website by selecting your preferred destination and filling out the booking form. Our team will contact you within 24 hours to discuss details and provide a customized itinerary.", category: "booking", sort_order: 2 },
  { question: "What is included in the tour price?", answer: "Our tour packages typically include accommodation, meals as specified, transportation during the tour, park fees, professional guide services, and airport transfers. Specific inclusions vary by package - please check your itinerary.", category: "pricing", sort_order: 3 },
  { question: "Do I need a visa for East African countries?", answer: "Visa requirements vary by nationality. Most visitors to Rwanda, Kenya, Uganda, and Tanzania require a visa. East African Tourist Visas are available for multiple countries. We recommend checking with your local embassy.", category: "travel", sort_order: 4 },
  { question: "What is the best time to visit East Africa?", answer: "The best time for safaris is during the dry season (June-October). For gorilla trekking, any time is good but drier months (June-August, December-February) are preferred. Mountain climbing is best from June-August and December-March.", category: "travel", sort_order: 5 },
  { question: "Is Altuvera suitable for families with children?", answer: "Yes! We offer family-friendly tours with age-appropriate activities. Some tours have minimum age requirements (especially gorilla trekking at 15+). We customize itineraries to make trips enjoyable for all ages.", category: "family", sort_order: 6 },
  { question: "What safety measures does Altuvera have in place?", answer: "Your safety is our priority. We work with certified guides, maintain emergency protocols, provide first aid kits, have 24/7 support, and conduct thorough risk assessments for all activities. Travel insurance is strongly recommended.", category: "safety", sort_order: 7 },
  { question: "Can Altuvera accommodate dietary restrictions?", answer: "Absolutely! We accommodate vegetarian, vegan, gluten-free, halal, kosher, and other dietary requirements. Please inform us at booking and we'll ensure all restaurants and accommodations can meet your needs.", category: "services", sort_order: 8 },
  { question: "What is your cancellation policy?", answer: "Cancellations made 30+ days before departure receive a full refund. 15-29 days: 50% refund. Less than 15 days: no refund. Specific terms may vary for peak seasons and special packages.", category: "booking", sort_order: 9 },
  { question: "Do I need vaccinations for East Africa?", answer: "Yellow fever vaccination is required for entry to some countries if arriving from endemic areas. Other recommended vaccinations include hepatitis A/B, typhoid, cholera, and routine immunizations. Consult your doctor 4-6 weeks before travel.", category: "health", sort_order: 10 }
];

const servicesData = [
  { title: "Gorilla Trekking Expeditions", slug: "gorilla-trekking", description: "Experience the magic of mountain gorilla encounters in Rwanda and Uganda. Our expert guides lead you through misty forests for unforgettable wildlife encounters with these gentle giants.", short_description: "Life-changing encounters with mountain gorillas in their natural habitat", icon: "🦍", features: ["Professional tracking guides", "Small group sizes", "Park fees included", "Photography permits available"], is_featured: true, sort_order: 1 },
  { title: "Big Five Safari Adventures", slug: "big-five-safari", description: "Witness the magnificent wildlife of East Africa on expertly guided safari experiences. From the endless plains of the Serengeti to the acacia-dotted landscapes of the Masai Mara, encounter lions, elephants, rhinos, leopards, and buffalo.", short_description: "Classic African safaris featuring the Big Five wildlife", icon: "🦁", features: ["Luxury safari vehicles", "Experienced rangers", "Best wildlife hotspots", "Photography opportunities"], is_featured: true, sort_order: 2 },
  { title: "Mountain Climbing & Hiking", slug: "mountain-climbing", description: "Challenge yourself with ascents of Africa's great peaks including Mount Kilimanjaro, Mount Kenya, and Nyiragongo. Our climbing expeditions combine adventure with proper acclimatization for safe summits.", short_description: "Summit Africa's highest peaks with expert guidance", icon: "🏔️", features: ["Multiple route options", "Professional mountain guides", "Quality camping equipment", "Summit certificates"], is_featured: true, sort_order: 3 },
  { title: "Cultural Immersion Experiences", slug: "cultural-immersion", description: "Connect deeply with local communities through authentic cultural experiences. Visit traditional villages, learn local crafts, participate in ceremonies, and understand the rich heritage of East African peoples.", short_description: "Authentic connections with East African communities", icon: "🎭", features: ["Village visits", "Traditional meals", "Craft workshops", "Cultural performances"], is_featured: true, sort_order: 4 },
  { title: "Bird Watching Tours", slug: "bird-watching", description: "East Africa is a bird lover's paradise with over 1,500 species. Our specialized bird watching tours take you to prime locations for rare and endemic species sightings.", short_description: "Discover East Africa's incredible bird diversity", icon: "🦅", features: ["Expert ornithologists", "Rare species spots", "Optimal locations", "Field guides provided"], is_featured: false, sort_order: 5 },
  { title: "Luxury Honeymoon Packages", slug: "luxury-honeymoon", description: "Celebrate your love with romantic experiences in stunning locations. Private dinners, secluded accommodations, and exclusive experiences create perfect honeymoon memories.", short_description: "Romantic escapes in East Africa's most beautiful settings", icon: "💑", features: ["Private accommodations", "Couple's spa treatments", "Sunset dhow cruises", "Champagne celebrations"], is_featured: false, sort_order: 6 },
  { title: "Photography Expeditions", slug: "photography-expeditions", description: "Join professional wildlife photographers for specialized tours designed for capturing stunning images. Benefit from expert guidance on wildlife behavior and optimal shooting techniques.", short_description: "Capture breathtaking wildlife and landscapes", icon: "📷", features: ["Pro photographer guides", "Golden hour sessions", "Exclusive access", "Post-processing tips"], is_featured: false, sort_order: 7 },
  { title: "Water Adventures", slug: "water-adventures", description: "Explore East Africa's aquatic treasures through kayaking, snorkeling, and boat excursions. Discover vibrant coral reefs, freshwater lakes, and dramatic waterfalls.", short_description: "Aquatic adventures in lakes and coastal waters", icon: "🚣", features: ["Snorkeling equipment", "Lake expeditions", "Waterfall visits", "Island hopping"], is_featured: false, sort_order: 8 }
];

const tipsData = [
  { slug: "packing-for-safari", summary: "Essential packing list for your African safari adventure. Don't leave home without these must-have items.", body: "When packing for an African safari, less is more. Bring neutral-colored clothing (avoid white and bright colors), layers for temperature changes, sturdy walking shoes, a good camera with extra batteries, binoculars, and a daypack. Don't forget sunscreen, insect repellent, and a wide-brimmed hat.", category: "packing", trip_phase: "preparation", priority_level: 5, read_time_minutes: 5, checklist: ["Neutral clothing", "Camera and binoculars", "Sunscreen SPF 50+", "Insect repellent", "Comfortable walking shoes", "Daypack"], tags: ["safari", "packing", "tips"], icon: "🎒", is_featured: true, is_active: true },
  { slug: "gorilla-trekking-preparation", summary: "What you need to know before your gorilla trekking expedition.", body: "Gorilla trekking is physically demanding - expect 2-6 hours of hiking through dense forest at high altitude. Train beforehand with cardio exercises. Pack rain gear, gloves for grabbing vegetation, and drinking water. Remember: you're visiting wild animals in their natural habitat.", category: "gorilla", trip_phase: "preparation", priority_level: 5, read_time_minutes: 6, checklist: ["Physical fitness preparation", "Rain gear", "Gardening gloves", "Water bottle", "Snacks", "Camera with fast lens"], tags: ["gorilla", "trekking", "preparation"], icon: "🦍", is_featured: true, is_active: true },
  { slug: "photography-tips-safari", summary: "Master wildlife photography with these professional tips.", body: "Use a fast shutter speed (1/500s or faster) to freeze animal motion. Shoot during golden hours for best light. Keep your ISO high enough for proper exposure. Learn animal behavior to anticipate shots. Be patient - wildlife photography requires waiting.", category: "photography", trip_phase: "during", priority_level: 4, read_time_minutes: 7, checklist: ["Fast memory cards", "Extra batteries", "Bean bag for stability", "Telephoto lens", "Polarizing filter"], tags: ["photography", "wildlife", "safari"], icon: "📷", is_featured: true, is_active: true },
  { slug: "health-and-safety-east-africa", summary: "Stay healthy and safe during your East African adventure.", body: "Drink only bottled water. Take antimalarial prophylaxis as prescribed. Get vaccinations well in advance. Use insect repellent containing DEET. Apply sunscreen regularly. Know emergency contact numbers. Travel with basic first aid supplies.", category: "health", trip_phase: "both", priority_level: 5, read_time_minutes: 8, checklist: ["Vaccinations up to date", "Antimalarial medication", "Travel insurance", "First aid kit", "Emergency contacts list"], tags: ["health", "safety", "travel"], icon: "🏥", is_featured: true, is_active: true },
  { slug: "cultural-etiquette-east-africa", summary: "Respect local customs and traditions with proper cultural etiquette.", body: "Dress modestly in rural areas. Always ask permission before photographing people. Learn basic greetings in local languages. Remove shoes when entering homes. Don't point with your finger - use your whole hand. Tipping is appreciated but not mandatory.", category: "culture", trip_phase: "during", priority_level: 3, read_time_minutes: 5, checklist: ["Learn basic greetings", "Respectful clothing", "Camera etiquette", "Tipping guidelines", "Local customs"], tags: ["culture", "etiquette", "respect"], icon: "🤝", is_featured: false, is_active: true },
  { slug: "best-time-visit-east-africa", summary: "Planning your trip? Here's when to visit different destinations.", body: "June-October is prime safari season (dry season). December-February is great for calving season. Gorilla trekking is year-round but best June-August and December-February. Mountain climbing has specific windows. Consider migration patterns for Serengeti.", category: "planning", trip_phase: "preparation", priority_level: 4, read_time_minutes: 6, checklist: ["Check weather patterns", "Consider crowds", "Book gorilla permits early", "Check migration timing"], tags: ["planning", "seasons", "timing"], icon: "📅", is_featured: false, is_active: true }
];

const virtualToursData = [
  { title: "Serengeti Wildlife Plains", slug: "serengeti-wildlife-plains", description: "Experience the vast golden savannah of the Serengeti from your screen. Watch wildebeest herds, lion prides, and elephant families in their natural habitat.", destination_id: null, video_url: "https://www.youtube.com/embed/example1", thumbnail_url: "https://images.unsplash.com/photo-1516426122078-c23e76319801?w=800", duration: "5:30", view_count: 15420, is_featured: true, is_active: true, sort_order: 1 },
  { title: "Mountain Gorilla Habitat", slug: "mountain-gorilla-habitat", description: "Step into the misty forests of Rwanda's Volcanoes National Park and observe the majestic mountain gorillas in their natural environment.", destination_id: null, video_url: "https://www.youtube.com/embed/example2", thumbnail_url: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800", duration: "7:15", view_count: 12350, is_featured: true, is_active: true, sort_order: 2 },
  { title: "Masai Mara Skybed Camp", slug: "masai-mara-skybed", description: "Sleep under the African stars in our exclusive skybed experience. Watch wildlife pass by from your elevated viewing platform.", destination_id: null, video_url: "https://www.youtube.com/embed/example3", thumbnail_url: "https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?w=800", duration: "4:45", view_count: 9870, is_featured: true, is_active: true, sort_order: 3 },
  { title: "Rwanda Genocide Memorial", slug: "rwanda-genocide-memorial", description: "A respectful virtual tour of the Kigali Genocide Memorial, offering insights into Rwanda's history and remarkable journey of reconciliation.", destination_id: null, video_url: "https://www.youtube.com/embed/example4", thumbnail_url: "https://images.unsplash.com/photo-1596309329797-fa6d8d8b0f3f?w=800", duration: "12:00", view_count: 8540, is_featured: false, is_active: true, sort_order: 4 },
  { title: "Victoria Falls Rainbow Experience", slug: "victoria-falls-rainbow", description: "Feel the thunder of one of the world's greatest waterfalls. Experience the spray, the rainbows, and the raw power of nature.", destination_id: null, video_url: "https://www.youtube.com/embed/example5", thumbnail_url: "https://images.unsplash.com/photo-1568430462989-44163eb1752f?w=800", duration: "6:20", view_count: 11200, is_featured: false, is_active: true, sort_order: 5 }
];

// ═══════════════════════════════════════════════════════════════════════════════
// SEED FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function seedFAQs() {
  console.log("📋 Seeding FAQs...");
  for (const faq of faqsData) {
    try {
      await query(
        `INSERT INTO faqs (question, answer, category, sort_order, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT DO NOTHING`,
        [faq.question, faq.answer, faq.category, faq.sort_order]
      );
    } catch (err) {
      console.log(`  ⚠ FAQ exists or error: ${faq.question.substring(0, 30)}...`);
    }
  }
  console.log("✅ FAQs seeded successfully!");
}

async function seedServices() {
  console.log("⚙️ Seeding Services...");
  for (const service of servicesData) {
    try {
      await query(
        `INSERT INTO services (title, slug, description, short_description, icon, features, is_featured, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           short_description = EXCLUDED.short_description,
           icon = EXCLUDED.icon,
           features = EXCLUDED.features,
           is_featured = EXCLUDED.is_featured,
           sort_order = EXCLUDED.sort_order`,
        [service.title, service.slug, service.description, service.short_description, service.icon, service.features, service.is_featured, service.sort_order]
      );
    } catch (err) {
      console.log(`  ⚠ Service error: ${service.title}`);
    }
  }
  console.log("✅ Services seeded successfully!");
}

async function seedTips() {
  console.log("💡 Seeding Travel Tips...");
  for (const tip of tipsData) {
    try {
      await query(
        `INSERT INTO tips (slug, summary, body, category, trip_phase, priority_level, read_time_minutes, checklist, tags, icon, is_featured, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (slug) DO UPDATE SET
           summary = EXCLUDED.summary,
           body = EXCLUDED.body,
           category = EXCLUDED.category,
           is_featured = EXCLUDED.is_featured`,
        [tip.slug, tip.summary, tip.body, tip.category, tip.trip_phase, tip.priority_level, tip.read_time_minutes, tip.checklist, tip.tags, tip.icon, tip.is_featured, tip.is_active]
      );
    } catch (err) {
      console.log(`  ⚠ Tip error: ${tip.slug}`);
    }
  }
  console.log("✅ Travel Tips seeded successfully!");
}

async function seedVirtualTours() {
  console.log("🎬 Seeding Virtual Tours...");
  for (const tour of virtualToursData) {
    try {
      await query(
        `INSERT INTO virtual_tours (title, slug, description, destination_id, video_url, thumbnail_url, duration, view_count, is_featured, is_active, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           view_count = EXCLUDED.view_count,
           is_featured = EXCLUDED.is_featured`,
        [tour.title, tour.slug, tour.description, tour.destination_id, tour.video_url, tour.thumbnail_url, tour.duration, tour.view_count, tour.is_featured, tour.is_active, tour.sort_order]
      );
    } catch (err) {
      console.log(`  ⚠ Virtual tour error: ${tour.slug}`);
    }
  }
  console.log("✅ Virtual Tours seeded successfully!");
}

async function seedSiteSettings() {
  console.log("⚙️ Seeding Site Settings...");
  const settings = [
    { key: "company_name", value: "Altuvera Travel" },
    { key: "company_tagline", value: "True Adventures In High Places & Deep Culture" },
    { key: "whatsapp_number", value: "+250788123456" },
    { key: "support_email", value: "support@altuvera.com" },
    { key: "booking_email", value: "bookings@altuvera.com" },
    { key: "facebook_url", value: "https://facebook.com/altuvera" },
    { key: "instagram_url", value: "https://instagram.com/altuvera" },
    { key: "twitter_url", value: "https://twitter.com/altuvera" }
  ];
  
  for (const setting of settings) {
    await query(
      `INSERT INTO site_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [setting.key, setting.value]
    );
  }
  console.log("✅ Site Settings seeded successfully!");
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    console.log("\n🚀 Starting public data seed...\n");
    
    // Test connection
    await query("SELECT 1");
    console.log("✅ Database connection established\n");
    
    // Run all seeds
    await seedFAQs();
    await seedServices();
    await seedTips();
    await seedVirtualTours();
    await seedSiteSettings();
    
    console.log("\n🎉 All public data seeded successfully!");
    console.log("\n📊 Summary:");
    console.log(`   - ${faqsData.length} FAQs`);
    console.log(`   - ${servicesData.length} Services`);
    console.log(`   - ${tipsData.length} Travel Tips`);
    console.log(`   - ${virtualToursData.length} Virtual Tours`);
    console.log(`   - ${8} Site Settings`);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
