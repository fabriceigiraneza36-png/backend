/**
 * scripts/seed-rwanda.js
 * Seeds Rwanda country + diverse destinations with real connections.
 * Categories are derived naturally from destination distinctions.
 * Empty categories are automatically purged.
 */

require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });
const { query, closeConnections } = require("../config/db");

const MOCK_IMG = (id, w = 800, h = 600) =>
  `https://picsum.photos/seed/${id}/${w}/${h}`;

const PLACEHOLDER = (text, w = 800, h = 600) =>
  `https://placehold.co/${w}x${h}/059669/ffffff?text=${encodeURIComponent(text)}`;

async function seedRwanda() {
  try {
    console.log("🌍 Seeding Rwanda...\n");

    /* ═══════════════════════════════════════════════
       1. INSERT COUNTRY: RWANDA
       ═══════════════════════════════════════════════ */
    const countrySlug = "rwanda";
    const countryName = "Rwanda";

    const countryResult = await query(
      `INSERT INTO countries (
        slug, name, official_name, capital, flag, flag_url, tagline, motto,
        demonym, independence_date, government_type, head_of_state,
        continent, region, sub_region, description, full_description,
        population, area, population_density, urban_population,
        life_expectancy, median_age, literacy_rate,
        languages, official_languages, national_languages, ethnic_groups, religions,
        currency, currency_symbol, timezone, calling_code, internet_tld,
        driving_side, electrical_plug, voltage, water_safety,
        climate, best_time_to_visit, seasons,
        visa_info, health_info, highlights, experiences, travel_tips,
        neighboring_countries, wildlife, cuisine, economic_info, geography,
        image_url, cover_image_url, hero_image, images,
        latitude, longitude, is_featured, is_active, display_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56,$57,$58,$59,$60)
      ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
      RETURNING id`,
      [
        countrySlug,
        countryName,
        "Republic of Rwanda",
        "Kigali",
        "🇷🇼",
        "https://flagcdn.com/w640/rw.png",
        "The Land of a Thousand Hills",
        "Unity, Work, Patriotism",
        "Rwandan",
        "1962-07-01",
        "Republic",
        "President Paul Kagame",
        "Africa",
        "East Africa",
        "Central Africa",
        `Rwanda is a landlocked East African country with a lush, mountainous landscape. Known as the "Land of a Thousand Hills," it offers one of the most compelling wildlife experiences on Earth — mountain gorilla trekking in the Volcanoes National Park.`,
        `Rwanda has emerged as one of Africa's most remarkable success stories. From the horrific 1994 genocide, the country has transformed into one of the safest, cleanest, and most progressive nations on the continent. Its capital Kigali is a modern, vibrant city with spotless streets and a thriving tech scene. Beyond the city, Rwanda's rolling hills are blanketed in tea plantations, bamboo forests, and volcanic peaks. The country is home to the endangered mountain gorillas, golden monkeys, and the Big Five in Akagera National Park. With strict environmental policies, Rwanda banned plastic bags in 2008 and dedicates significant resources to conservation.`,
        14000000,
        26338.00,
        525.00,
        17.50,
        69.0,
        20.0,
        73.22,
        ["Kinyarwanda", "English", "French", "Swahili"],
        ["Kinyarwanda", "English", "French"],
        ["Kinyarwanda"],
        ["Hutu", "Tutsi", "Twa"],
        ["Roman Catholic", "Protestant", "Adventist", "Muslim", "Traditional"],
        "Rwandan Franc",
        "Fr",
        "UTC+2 (CAT)",
        "+250",
        ".rw",
        "right",
        "Type C, J",
        "230V",
        "Drink boiled or bottled water",
        `Rwanda enjoys a pleasant tropical highland climate. Temperatures average 20-25°C year-round. There are two rainy seasons (March-May, September-November) and two dry seasons.`,
        "June to September (long dry season) and December to February (short dry season)",
        JSON.stringify({
          dry_season_1: { months: "June – September", note: "Best for gorilla trekking and safaris" },
          dry_season_2: { months: "December – February", note: "Good for all activities" },
          wet_season_1: { months: "March – May", note: "Lush green landscapes, low season rates" },
          wet_season_2: { months: "September – November", note: "Short rains, fewer tourists" },
        }),
        `Visa on arrival or e-visa for most nationalities ($50). East African Tourist Visa ($100) covers Rwanda, Uganda, and Kenya. Passport must be valid 6+ months.`,
        `Yellow fever certificate required. Malaria prophylaxis recommended. Gorilla trekking requires fitness certificate. COVID-19 protocols may apply.`,
        [
          "Mountain gorilla trekking in Volcanoes NP",
          "Big Five safari in Akagera National Park",
          "Canopy walk in Nyungwe Forest",
          "Kigali Genocide Memorial",
          "Lake Kivu beaches and kayaking",
          "Golden monkey tracking",
          "Chimpanzee trekking",
        ],
        [
          "Gorilla trekking adventure",
          "Classic African safari",
          "Primate tracking expeditions",
          "Cultural immersion with Intore dancers",
          "Coffee and tea plantation tours",
          "Lake Kivu island hopping",
        ],
        [
          "Book gorilla permits 3-6 months in advance",
          "Pack layers — mornings are cool, afternoons warm",
          "Bring sturdy hiking boots for treks",
          "Respect the 7-meter distance from gorillas",
          "Carry USD cash for tips and small purchases",
          "Kigali is very safe, but use common sense at night",
        ],
        ["Burundi", "Democratic Republic of Congo", "Tanzania", "Uganda"],
        JSON.stringify({
          primates: ["Mountain gorilla", "Golden monkey", "Chimpanzee", "Colobus monkey"],
          big_five: ["Lion", "Leopard", "Elephant", "Buffalo", "Rhino (reintroduced)"],
          birds: ["Shoebill stork", "Great blue turaco", "Ruwenzori batis"],
        }),
        JSON.stringify({
          staples: ["Ugali", "Isombe", "Matoke", "Brochettes", "Akabenzi"],
          beverages: ["Ikivuguto", "Rwandan coffee", "Mulondo wine"],
          famous_dishes: ["Goat brochettes", "Isombe (cassava leaves)", "Agatogo"],
        }),
        JSON.stringify({
          gdp_per_capita: 966,
          currency: "RWF",
          main_exports: ["Coffee", "Tea", "Minerals", "Tourism services"],
          growth_sectors: ["Tourism", "Technology", "Agriculture"],
        }),
        JSON.stringify({
          terrain: "Mountainous with rolling hills",
          highest_point: "Mount Karisimbi (4,507m)",
          lakes: ["Lake Kivu", "Lake Muhazi", "Lake Ihema"],
          volcanoes: ["Karisimbi", "Bisoke", "Muhabura", "Sabyinyo", "Gahinga"],
          forests: ["Nyungwe", "Gishwati-Mukura"],
        }),
        MOCK_IMG("rwanda-hero", 1200, 800),
        MOCK_IMG("rwanda-cover", 1200, 600),
        MOCK_IMG("rwanda-hero2", 1600, 900),
        [
          MOCK_IMG("rwanda-1", 800, 600),
          MOCK_IMG("rwanda-2", 800, 600),
          MOCK_IMG("rwanda-3", 800, 600),
          MOCK_IMG("rwanda-4", 800, 600),
        ],
        -1.9403,
        29.8739,
        true,
        true,
        1,
      ]
    );

    const rwandaId = countryResult.rows[0].id;
    console.log(`✅ Rwanda inserted — ID: ${rwandaId}\n`);

    /* ═══════════════════════════════════════════════
       2. INSERT AIRPORTS, FESTIVALS, UNESCO, EVENTS
       ═══════════════════════════════════════════════ */

    await query(
      `INSERT INTO country_airports (country_id, name, code, location, airport_type, is_main_international, display_order)
       VALUES
         ($1, 'Kigali International Airport', 'KGL', 'Kigali', 'international', true, 1),
         ($1, 'Kamembe Airport', 'KME', 'Cyangugu', 'domestic', false, 2),
         ($1, 'Rwanda Peace Airport', 'BTQ', 'Bugesera', 'international', false, 3)
       ON CONFLICT DO NOTHING`,
      [rwandaId]
    );
    console.log("✈️ Airports inserted");

    await query(
      `INSERT INTO country_festivals (country_id, name, period, month, description, is_major_event, display_order)
       VALUES
         ($1, 'Kwita Izina (Gorilla Naming Ceremony)', 'September', 'September', 'Annual ceremony where baby gorillas are named in a traditional Rwandan celebration.', true, 1),
         ($1, 'Umuganda (Community Day)', 'Last Saturday monthly', 'All year', 'Monthly national community service day where all citizens participate in local projects.', true, 2),
         ($1, 'Rwanda Film Festival', 'July', 'July', 'Annual showcase of African cinema in Kigali and Huye.', false, 3),
         ($1, 'Kigali Jazz Junction', 'Monthly', 'All year', 'Monthly jazz concert series featuring local and international artists.', false, 4),
         ($1, 'Intore Dance Festival', 'August', 'August', 'Celebration of Rwanda''s traditional warrior dance with performances nationwide.', true, 5)
       ON CONFLICT DO NOTHING`,
      [rwandaId]
    );
    console.log("🎉 Festivals inserted");

    await query(
      `INSERT INTO country_historical_events (country_id, year, event, event_type, is_major, sort_year)
       VALUES
         ($1, 1890, 'Rwanda becomes part of German East Africa', 'colonial', false, 1890),
         ($1, 1916, 'Belgian forces occupy Rwanda during WWI', 'colonial', false, 1916),
         ($1, 1962, 'Rwanda gains independence from Belgium', 'independence', true, 1962),
         ($1, 1994, 'Genocide against the Tutsi — over 800,000 killed in 100 days', 'tragedy', true, 1994),
         ($1, 2003, 'New constitution adopted, first post-genocide elections', 'political', true, 2003),
         ($1, 2008, 'Rwanda bans plastic bags — first country in Africa', 'environmental', true, 2008),
         ($1, 2017, 'Kigali Convention Centre opens', 'modern', false, 2017)
       ON CONFLICT DO NOTHING`,
      [rwandaId]
    );
    console.log("📜 Historical events inserted\n");

    /* ═══════════════════════════════════════════════
       3. INSERT DESTINATIONS (Natural Category Distinctions)
       ═══════════════════════════════════════════════ */

    const destinations = [
      {
        slug: "volcanoes-national-park",
        name: "Volcanoes National Park",
        tagline: "Home of the Majestic Mountain Gorillas",
        category: "Primate Trekking",
        destination_type: "national_park",
        difficulty: "challenging",
        region: "Northern Province",
        short_description: "World-renowned for mountain gorilla trekking amidst volcanic peaks and bamboo forests.",
        description: `Volcanoes National Park (Parc National des Volcans) is Rwanda's most famous conservation area, covering 160 km² of rainforest and bamboo in the Virunga Mountains. It is home to five of the eight Virunga volcanoes and roughly half of the world's remaining mountain gorillas. Trekking through the dense bamboo forests to encounter a gorilla family is one of the most profound wildlife experiences on Earth. The park also offers golden monkey tracking, volcano hiking, and visits to the Dian Fossey Tomb & Research Center.`,
        highlights: ["Mountain gorilla trekking", "Golden monkey tracking", "Mount Bisoke crater lake hike", "Dian Fossey grave trek", "Volcano climbing", "Birdwatching with 178 species"],
        activities: ["Gorilla trekking", "Golden monkey tracking", "Volcano hiking", "Cultural village visits", "Birdwatching", "Nature walks"],
        wildlife: ["Mountain gorilla", "Golden monkey", "Black-fronted duiker", "Buffalo", "Elephant", "Spotted hyena", "178 bird species"],
        nearest_city: "Musanze (Ruhengeri)",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 105.00,
        latitude: -1.4833,
        longitude: 29.5167,
        altitude_meters: 2400,
        duration_days: 2,
        duration_nights: 1,
        duration_display: "2 Days / 1 Night",
        min_group_size: 1,
        max_group_size: 8,
        min_age: 15,
        fitness_level: "moderate",
        best_time_to_visit: "June to September, December to February",
        getting_there: "2.5-hour drive from Kigali on paved roads. Private 4x4 recommended.",
        what_to_expect: "Early morning starts, 1-4 hours of hiking through bamboo forest, one magical hour with gorillas, rain gear essential.",
        local_tips: ["Book permits 3-6 months ahead ($1,500)", "Hire a porter ($20) to support local community", "Bring waterproof gear and gaiters", "The higher you go, the muddier it gets"],
        safety_info: "Gorillas are wild but habituated. Follow guide instructions. Maintain 7m distance. No flash photography. No visiting if sick.",
        is_featured: true,
        is_popular: true,
        is_eco_friendly: true,
        status: "published",
        entrance_fee: "$1,500 per gorilla permit",
        operating_hours: "Trekking starts at 07:00 daily",
        images: ["gorilla-trek", "volcano-view", "bamboo-forest", "golden-monkey"],
      },
      {
        slug: "akagera-national-park",
        name: "Akagera National Park",
        tagline: "Rwanda's Big Five Safari Destination",
        category: "Safari",
        destination_type: "national_park",
        difficulty: "easy",
        region: "Eastern Province",
        short_description: "A classic African savanna safari with the Big Five, wetlands, and stunning lake views.",
        description: `Akagera National Park is Central Africa's largest protected wetland and Rwanda's only savanna safari destination. Spanning 1,122 km², it encompasses rolling grasslands, acacia woodlands, and a vast network of lakes and swamps along the Kagera River. After lions were reintroduced in 2015 and rhinos in 2017, Akagera is now a fully-fledged Big Five park. Boat safaris on Lake Ihema offer close encounters with hippos, crocodiles, and abundant waterbirds.`,
        highlights: ["Big Five game drives", "Boat safari on Lake Ihema", "Night game drives", "Birdwatching (480+ species)", "Fishing villages", "Sunset views over the savanna"],
        activities: ["Game drives", "Boat safaris", "Night drives", "Fishing", "Birdwatching", "Behind-the-scenes conservation tours"],
        wildlife: ["Lion", "Leopard", "Elephant", "Buffalo", "Black rhino", "Giraffe", "Zebra", "Hippo", "Crocodile", "Topi", "Impala"],
        nearest_city: "Kayonza",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 135.00,
        latitude: -1.5833,
        longitude: 30.7833,
        altitude_meters: 1300,
        duration_days: 3,
        duration_nights: 2,
        duration_display: "3 Days / 2 Nights",
        min_group_size: 2,
        max_group_size: 6,
        min_age: 5,
        fitness_level: "easy",
        best_time_to_visit: "June to September (dry season)",
        getting_there: "2.5-hour drive from Kigali. Road is paved to Kayonza, then graded gravel.",
        what_to_expect: "Open-top 4x4 game drives, abundant wildlife, stunning sunsets, luxury tented camps.",
        local_tips: ["Combine with gorilla trekking for the ultimate Rwanda safari", "Book night drives in advance", "Bring binoculars for birding", "Pack warm layers for early mornings"],
        safety_info: "Always stay in the vehicle unless at designated areas. Follow ranger instructions. Malaria prophylaxis recommended.",
        is_featured: true,
        is_popular: true,
        is_eco_friendly: true,
        is_family_friendly: true,
        status: "published",
        entrance_fee: "$100 per person per day",
        operating_hours: "06:00 – 18:00 (game drives)",
        images: ["akagera-safari", "lake-ihema", "lion-pride", "rhino-tracking"],
      },
      {
        slug: "nyungwe-forest-national-park",
        name: "Nyungwe Forest National Park",
        tagline: "Africa's Oldest Montane Rainforest",
        category: "Primate Trekking",
        destination_type: "national_park",
        difficulty: "moderate",
        region: "Southern Province",
        short_description: "A pristine rainforest canopy walk, chimpanzee trekking, and 13 primate species.",
        description: `Nyungwe Forest National Park is one of Africa's oldest and best-preserved montane rainforests, covering 1,019 km² across Rwanda's southwestern border. This biodiversity hotspot is home to 13 primate species including chimpanzees, colobus monkeys, and L'Hoest's monkeys. The iconic Canopy Walkway — a 160m suspension bridge 70m above the forest floor — offers breathtaking views. With over 300 bird species and 1,068 plant species, Nyungwe is a UNESCO Biosphere Reserve.`,
        highlights: ["Canopy walkway (70m high)", "Chimpanzee trekking", "Colobus monkey tracking", "13 primate species", "300+ bird species", "Waterfall hikes", "Tea plantation tours"],
        activities: ["Canopy walk", "Chimpanzee trekking", "Primate tracking", "Birdwatching", "Waterfall hikes", "Tea tours"],
        wildlife: ["Chimpanzee", "Ruwenzori colobus", "L'Hoest's monkey", "Dent's mona monkey", "Owl-faced monkey", "Grey-cheeked mangabey", "Blue monkey"],
        nearest_city: "Huye (Butare)",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 225.00,
        latitude: -2.4833,
        longitude: 29.2167,
        altitude_meters: 2600,
        duration_days: 2,
        duration_nights: 1,
        duration_display: "2 Days / 1 Night",
        min_group_size: 2,
        max_group_size: 8,
        min_age: 12,
        fitness_level: "moderate",
        best_time_to_visit: "June to September, December to February",
        getting_there: "5-hour scenic drive from Kigali through tea plantations.",
        what_to_expect: "Steep forest trails, early starts for chimps, misty mornings, incredible biodiversity.",
        local_tips: ["Chimp permits are $90 (much cheaper than gorillas)", "Colobus monkey groups can be 400+ strong", "The canopy walk is not for those afraid of heights", "Stay at a tea plantation lodge for the full experience"],
        safety_info: "Trails can be slippery. Good hiking boots essential. Follow guide instructions with primates.",
        is_featured: true,
        is_popular: true,
        is_eco_friendly: true,
        status: "published",
        entrance_fee: "$100 park entry + $90 chimp permit",
        operating_hours: "Canopy walk 08:00 – 17:00",
        images: ["nyungwe-canopy", "chimpanzee-trek", "colobus-monkeys", "waterfall-trail"],
      },
      {
        slug: "lake-kivu",
        name: "Lake Kivu",
        tagline: "Rwanda's Tropical Beach Paradise",
        category: "Beach & Relaxation",
        destination_type: "lake",
        difficulty: "easy",
        region: "Western Province",
        short_description: "A stunning tropical lake with sandy beaches, island hopping, and water sports.",
        description: `Lake Kivu is one of Africa's Great Lakes, stretching along Rwanda's western border with the Democratic Republic of Congo. With its crystal-clear waters, sandy beaches, and picturesque islands, Kivu offers a tropical escape unlike anywhere else in Rwanda. The lake is safe for swimming (unlike other East African lakes, it has no bilharzia or crocodiles). The lakeside towns of Gisenyi (Rubavu), Kibuye (Karongi), and Cyangugu (Rusizi) each offer unique experiences from luxury resorts to quiet fishing villages.`,
        highlights: ["Swimming and kayaking", "Napoleon Island (bat colony)", "Coffee island tours", "Sunset boat cruises", "Hot springs in Rubavu", "Cycling the Congo Nile Trail"],
        activities: ["Swimming", "Kayaking", "Boat cruises", "Island hopping", "Fishing", "Cycling", "Coffee tours", "Hot springs"],
        wildlife: ["Fruit bats (Napoleon Island)", "Otters", "Cichlid fish", "Waterbirds"],
        nearest_city: "Gisenyi (Rubavu)",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 160.00,
        latitude: -2.0000,
        longitude: 29.2000,
        altitude_meters: 1463,
        duration_days: 3,
        duration_nights: 2,
        duration_display: "3 Days / 2 Nights",
        min_group_size: 1,
        max_group_size: 12,
        min_age: 0,
        fitness_level: "easy",
        best_time_to_visit: "June to September, December to February",
        getting_there: "3.5-hour drive from Kigali to Gisenyi. Well-paved road.",
        what_to_expect: "Relaxed beach atmosphere, warm swimming water, fresh lake fish, stunning sunsets over the Congo hills.",
        local_tips: ["Try the fresh tilapia at Biseze beach", "Rent a kayak to explore the islands", "The Congo Nile Trail is 227km of scenic cycling", "Rubavu has the best luxury resorts"],
        safety_info: "Lake Kivu is safe for swimming. No dangerous wildlife. Always wear life jackets on boats.",
        is_featured: true,
        is_popular: true,
        is_family_friendly: true,
        status: "published",
        entrance_fee: "Free (activities priced separately)",
        operating_hours: "Boat tours 08:00 – 18:00",
        images: ["lake-kivu-sunset", "napoleon-island", "kayaking", "beach-resort"],
      },
      {
        slug: "kigali-city",
        name: "Kigali City",
        tagline: "Africa's Cleanest and Safest Capital",
        category: "Cultural & Urban",
        destination_type: "city",
        difficulty: "easy",
        region: "Kigali Province",
        short_description: "A vibrant, modern capital with world-class museums, food scenes, and cultural experiences.",
        description: `Kigali is the capital and largest city of Rwanda, sitting across lush hills with a population of over 1.5 million. It is consistently ranked as Africa's cleanest and safest capital — plastic bags are banned, streets are spotless, and the city has a thriving tech and creative scene. The Kigali Genocide Memorial is one of the most moving museums in Africa. The city also boasts excellent restaurants, craft markets, art galleries, and the vibrant Kimironko Market. The new Kigali Convention Centre is an architectural landmark.`,
        highlights: ["Kigali Genocide Memorial", "Kimironko Market", "Inema Arts Center", "Kigali Convention Centre", "Mount Kigali hike", "Local food tours"],
        activities: ["Museum visits", "City walking tours", "Cooking classes", "Art gallery tours", "Craft shopping", "Nightlife", "Coffee cupping"],
        wildlife: ["Birds in urban parks"],
        nearest_city: "Kigali",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 12.00,
        latitude: -1.9441,
        longitude: 30.0619,
        altitude_meters: 1567,
        duration_days: 2,
        duration_nights: 1,
        duration_display: "2 Days / 1 Night",
        min_group_size: 1,
        max_group_size: 15,
        min_age: 0,
        fitness_level: "easy",
        best_time_to_visit: "Year-round",
        getting_there: "Direct flights from major African and European hubs. Airport is 12km from city center.",
        what_to_expect: "Spotless streets, friendly people, modern infrastructure, excellent dining, moving historical sites.",
        local_tips: ["The Genocide Memorial is free but donations welcome", "Try the local brochettes at Repub lounge", "Kimironko Market is best on Tuesday and Friday", "Kigali has an excellent coffee culture — try Question Coffee"],
        safety_info: "One of the safest cities in Africa. Normal precautions apply. Use registered taxis or Uber-like services.",
        is_featured: true,
        is_popular: true,
        is_family_friendly: true,
        status: "published",
        entrance_fee: "Free (museums may charge)",
        operating_hours: "Shops 08:00 – 20:00, Markets early morning",
        images: ["kigali-skyline", "genocide-memorial", "kimironko-market", "nightlife"],
      },
      {
        slug: "gishwati-mukura-national-park",
        name: "Gishwati-Mukura National Park",
        tagline: "Rwanda's Newest Rainforest Reserve",
        category: "Primate Trekking",
        destination_type: "national_park",
        difficulty: "moderate",
        region: "Western Province",
        short_description: "A reforested rainforest offering chimpanzee trekking with fewer crowds.",
        description: `Gishwati-Mukura National Park is Rwanda's newest national park, created in 2015 from a former forest reserve that had been largely degraded by human settlement. Through an ambitious reforestation project, the forest is being restored and is now home to a small population of chimpanzees, golden monkeys, and the rare L'Hoest's monkey. The park offers a more intimate, less crowded alternative to Nyungwe for primate tracking, with beautiful forest trails and stunning views over the Lake Kivu basin.`,
        highlights: ["Chimpanzee trekking (less crowded)", "Golden monkey tracking", "Forest restoration project", "Birdwatching", "Community forest walks", "Scenic ridge trails"],
        activities: ["Chimpanzee trekking", "Monkey tracking", "Nature walks", "Birdwatching", "Community visits"],
        wildlife: ["Chimpanzee", "Golden monkey", "L'Hoest's monkey", "Blue monkey", "Side-striped jackal", "178 bird species"],
        nearest_city: "Rubavu (Gisenyi)",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 175.00,
        latitude: -1.7500,
        longitude: 29.3500,
        altitude_meters: 2000,
        duration_days: 1,
        duration_nights: 0,
        duration_display: "Day Trip",
        min_group_size: 2,
        max_group_size: 6,
        min_age: 15,
        fitness_level: "moderate",
        best_time_to_visit: "June to September, December to February",
        getting_there: "3.5-hour drive from Kigali via Rubavu.",
        what_to_expect: "Rugged forest trails, fewer tourists, conservation success story, community engagement.",
        local_tips: ["Permits are cheaper than Nyungwe ($70)", "Combine with a Lake Kivu stay", "Support the local communities who were resettled for the park"],
        safety_info: "Trails are steep and can be muddy. Good boots essential. Follow guide instructions with chimps.",
        is_featured: false,
        is_popular: false,
        is_eco_friendly: true,
        status: "published",
        entrance_fee: "$70 chimp permit + $40 park entry",
        operating_hours: "Trekking starts at 06:00",
        images: ["gishwati-forest", "chimpanzee-forest", "restoration-trail", "ridge-view"],
      },
      {
        slug: "mount-karisimbi",
        name: "Mount Karisimbi",
        tagline: "The Roof of the Virungas",
        category: "Mountain Climbing",
        destination_type: "mountain",
        difficulty: "strenuous",
        region: "Northern Province",
        short_description: "A two-day trek to the summit of the highest volcano in the Virunga range at 4,507m.",
        description: `Mount Karisimbi is the highest of the eight Virunga volcanoes and the 11th highest peak in Africa, towering at 4,507 meters. The name means "white shell" in Kinyarwanda, referring to the snow and hail that often cap its summit. The two-day trek takes hikers through bamboo forest, Hagenia woodland, and alpine meadows before reaching the summit crater rim. On clear days, the views span across Rwanda, Uganda, and the Democratic Republic of Congo. The trek is physically demanding but requires no technical climbing skills.`,
        highlights: ["Summit at 4,507m", "Volcanic crater rim", "Views across three countries", "Alpine vegetation zone", "Camping at 3,700m"],
        activities: ["Mountain trekking", "Camping", "Photography", "Volcano exploration"],
        wildlife: ["Mountain gorilla (lower slopes)", "Golden monkey", "Buffalo", "Forest elephants"],
        nearest_city: "Musanze",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 110.00,
        latitude: -1.5067,
        longitude: 29.4431,
        altitude_meters: 4507,
        duration_days: 2,
        duration_nights: 1,
        duration_display: "2 Days / 1 Night (camping)",
        min_group_size: 2,
        max_group_size: 8,
        min_age: 18,
        fitness_level: "strenuous",
        best_time_to_visit: "June to August, December to February",
        getting_there: "2.5-hour drive from Kigali to Volcanoes NP, then trek from Kinigi.",
        what_to_expect: "Very demanding hike, cold nights at altitude, basic camping, incredible summit views, possible hail/snow.",
        local_tips: ["Acclimatize with a gorilla trek first", "Bring a good sleeping bag rated to -10°C", "The summit is often in clouds — start early for best views", "Hire a porter and cook"],
        safety_info: "Altitude sickness is a real risk. Go slowly, stay hydrated. Temperatures at camp can drop below freezing. Emergency evacuation is difficult.",
        is_featured: false,
        is_popular: false,
        is_eco_friendly: true,
        status: "published",
        entrance_fee: "$400 climbing permit",
        operating_hours: "Trek starts 07:00 from Kinigi",
        images: ["karisimbi-summit", "crater-rim", "alpine-camp", "virunga-range"],
      },
      {
        slug: "ibyiwacu-cultural-village",
        name: "Iby'Iwacu Cultural Village",
        tagline: "Living Culture of the Rwandan People",
        category: "Cultural & Urban",
        destination_type: "cultural_site",
        difficulty: "easy",
        region: "Northern Province",
        short_description: "An authentic cultural village where former poachers showcase Rwandan traditions.",
        description: `Iby'Iwacu Cultural Village (meaning "Treasure of Our Home") is a community-based tourism initiative near Volcanoes National Park. Former poachers and community members now welcome visitors to experience authentic Rwandan culture. Guests can participate in traditional Intore dancing, archery, grinding grains, banana beer brewing, and storytelling. The village provides a vital income alternative to poaching and creates a meaningful cultural exchange between visitors and locals.`,
        highlights: ["Intore warrior dance performance", "Traditional archery", "Banana beer brewing", "Local healer demonstration", "Community walk", "Children's cultural programs"],
        activities: ["Cultural performances", "Traditional crafts", "Cooking demonstrations", "Community walks", "School visits", "Weaving"],
        wildlife: [],
        nearest_city: "Musanze",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 108.00,
        latitude: -1.4833,
        longitude: 29.5500,
        altitude_meters: 2400,
        duration_days: 1,
        duration_nights: 0,
        duration_display: "Half Day / Full Day",
        min_group_size: 1,
        max_group_size: 20,
        min_age: 0,
        fitness_level: "easy",
        best_time_to_visit: "Year-round",
        getting_there: "Located near Kinigi, 10 minutes from Volcanoes NP headquarters.",
        what_to_expect: "Warm hospitality, interactive cultural experiences, authentic village setting, no artificial tourist show.",
        local_tips: ["Buy handicrafts directly from artisans", "Try the banana beer — it's an acquired taste", "The Intore dance is performed on request", "Combine with a gorilla trek day"],
        safety_info: "Very safe community-run project. Respectful photography is welcome.",
        is_featured: false,
        is_popular: true,
        is_family_friendly: true,
        status: "published",
        entrance_fee: "$35 per person",
        operating_hours: "08:00 – 17:00 daily",
        images: ["intore-dance", "cultural-village", "banana-beer", "weaving"],
      },
      {
        slug: "kigali-genocide-memorial",
        name: "Kigali Genocide Memorial",
        tagline: "Never Forget, Never Again",
        category: "Historical & Memorial",
        destination_type: "memorial",
        difficulty: "easy",
        region: "Kigali Province",
        short_description: "A powerful memorial and museum commemorating the 1994 genocide against the Tutsi.",
        description: `The Kigali Genocide Memorial is the final resting place for more than 250,000 victims of the 1994 genocide against the Tutsi. The memorial includes exhibitions that explain the causes, events, and aftermath of the genocide, as well as personal stories of victims and survivors. The memorial gardens provide a peaceful space for reflection. It is an essential visit for anyone traveling to Rwanda, offering profound insight into the country's tragic past and remarkable recovery.`,
        highlights: ["Mass graves with 250,000+ victims", "Exhibition halls with personal stories", "Children's memorial room", "Memorial gardens", "Wall of Names", "Education center"],
        activities: ["Guided memorial tour", "Audio guide tour", "Educational programs", "Reflection and remembrance"],
        wildlife: [],
        nearest_city: "Kigali",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 10.00,
        latitude: -1.9350,
        longitude: 30.0580,
        altitude_meters: 1567,
        duration_days: 1,
        duration_nights: 0,
        duration_display: "Half Day",
        min_group_size: 1,
        max_group_size: 50,
        min_age: 12,
        fitness_level: "easy",
        best_time_to_visit: "Year-round (Tuesdays are less crowded)",
        getting_there: "Located in Gisozi, 10 minutes from central Kigali. Taxis and moto-taxis readily available.",
        what_to_expect: "Emotionally powerful experience. Plan 2-3 hours. Not recommended for young children.",
        local_tips: ["Entry is free but donations support the memorial", "Photography is not allowed inside", "Tuesday mornings are quietest", "Combine with a visit to the Campaign Against Genocide Museum"],
        safety_info: "Very safe, respectful environment. Security present. Can be emotionally overwhelming — take breaks.",
        is_featured: true,
        is_popular: true,
        status: "published",
        entrance_fee: "Free (donations welcome)",
        operating_hours: "08:00 – 17:00 (closed on some public holidays)",
        images: ["memorial-exterior", "garden-reflection", "exhibition-hall", "wall-of-names"],
      },
      {
        slug: "rwanda-tea-plantations",
        name: "Rwanda Tea Plantations",
        tagline: "Green Hills, Golden Leaves",
        category: "Agricultural Tourism",
        destination_type: "plantation",
        difficulty: "easy",
        region: "Western & Southern Province",
        short_description: "Visit lush tea estates, learn about production, and taste some of the world's finest tea.",
        description: `Rwanda's rolling hills are carpeted with some of Africa's most beautiful tea plantations. The country's high altitude, volcanic soil, and consistent rainfall create perfect conditions for producing exceptional tea. The main tea-growing regions are around Gisakura (near Nyungwe), Mulindi, and Shagasha. Visitors can tour plantations, visit processing factories, learn about orthodox and CTC tea production, and enjoy tastings with expert guides. The Gisakura Tea Estate near Nyungwe Forest offers particularly scenic views with the forest as a backdrop.`,
        highlights: ["Tea plantation walks", "Factory processing tours", "Tea tasting sessions", "Scenic hill views", "Photography opportunities", "Farm-to-cup experience"],
        activities: ["Plantation tours", "Tea tasting", "Photography", "Factory visits", "Picnics", "Hiking between plantations"],
        wildlife: ["Birds", "Butterflies"],
        nearest_city: "Huye",
        nearest_airport: "Kigali International Airport (KGL)",
        distance_from_airport_km: 200.00,
        latitude: -2.3500,
        longitude: 29.3000,
        altitude_meters: 1800,
        duration_days: 1,
        duration_nights: 0,
        duration_display: "Half Day / Full Day",
        min_group_size: 2,
        max_group_size: 15,
        min_age: 5,
        fitness_level: "easy",
        best_time_to_visit: "Year-round (harvest March-May, October-December)",
        getting_there: "Plantations are scattered across the Western Province, accessible from the Kigali-Nyungwe road.",
        what_to_expect: "Lush green terraces, friendly workers, insight into Rwanda's agricultural economy, excellent photo opportunities.",
        local_tips: ["Gisakura Estate has the best views near Nyungwe", "Morning light is best for photography", "Buy fresh tea to take home", "Combine with Nyungwe visit"],
        safety_info: "Very safe. Walk carefully on wet plantation paths. Wear sun protection.",
        is_featured: false,
        is_popular: false,
        is_eco_friendly: true,
        is_family_friendly: true,
        status: "published",
        entrance_fee: "$15-25 per person for tour and tasting",
        operating_hours: "Plantation tours 09:00 – 16:00",
        images: ["tea-terraces", "tea-picking", "factory-tour", "tea-tasting"],
      },
    ];

    // Insert destinations
    const insertedDestinations = [];
    for (const d of destinations) {
      const result = await query(
        `INSERT INTO destinations (
          country_id, name, slug, tagline, short_description, description,
          overview, highlights, activities, wildlife,
          best_time_to_visit, getting_there, what_to_expect, local_tips, safety_info,
          category, difficulty, destination_type, region,
          nearest_city, nearest_airport, distance_from_airport_km,
          latitude, longitude, altitude_meters,
          image_url, image_urls, cover_image_url, hero_image, thumbnail_url,
          duration_days, duration_nights, duration_display,
          min_group_size, max_group_size, min_age, fitness_level,
          rating, review_count,
          entrance_fee, operating_hours,
          is_featured, is_popular, is_eco_friendly, is_family_friendly,
          status, is_active, published_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48)
        ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()
        RETURNING id, name, slug, category`,
        [
          rwandaId,
          d.name,
          d.slug,
          d.tagline,
          d.short_description,
          d.description,
          d.description.substring(0, 300) + "...",
          d.highlights,
          d.activities,
          d.wildlife,
          d.best_time_to_visit,
          d.getting_there,
          d.what_to_expect,
          d.local_tips,
          d.safety_info,
          d.category,
          d.difficulty,
          d.destination_type,
          d.region,
          d.nearest_city,
          d.nearest_airport,
          d.distance_from_airport_km,
          d.latitude,
          d.longitude,
          d.altitude_meters,
          MOCK_IMG(d.slug + "-hero"),
          d.images.map((img) => MOCK_IMG(img)),
          MOCK_IMG(d.slug + "-cover", 1200, 600),
          MOCK_IMG(d.slug + "-hero2", 1600, 900),
          MOCK_IMG(d.slug + "-thumb", 400, 300),
          d.duration_days,
          d.duration_nights,
          d.duration_display,
          d.min_group_size,
          d.max_group_size,
          d.min_age,
          d.fitness_level,
          (4.0 + Math.random()).toFixed(1),
          Math.floor(Math.random() * 200) + 20,
          d.entrance_fee,
          d.operating_hours,
          d.is_featured,
          d.is_popular,
          d.is_eco_friendly || false,
          d.is_family_friendly || false,
          d.status,
          true,
          new Date(),
        ]
      );
      insertedDestinations.push(result.rows[0]);
    }

    console.log(`\n✅ ${insertedDestinations.length} destinations inserted:`);
    insertedDestinations.forEach((d) => console.log(`   • ${d.name} (${d.category})`));

    /* ═══════════════════════════════════════════════
       4. DYNAMIC CATEGORY MANAGEMENT
       ═══════════════════════════════════════════════ */

    // Get all distinct categories currently in use
    const catResult = await query(
      `SELECT DISTINCT category FROM destinations WHERE category IS NOT NULL AND category != '' ORDER BY category`
    );
    const activeCategories = catResult.rows.map((r) => r.category);

    console.log("\n📊 Active categories in database:");
    for (const cat of activeCategories) {
      const countRes = await query(
        `SELECT COUNT(*) FROM destinations WHERE category = $1`,
        [cat]
      );
      const count = parseInt(countRes.rows[0].count, 10);
      console.log(`   • ${cat}: ${count} destination(s)`);
    }

    // Purge any categories with 0 results
    console.log("\n🧹 Checking for empty categories to purge...");

    // If there were a separate categories table, we'd clean it here.
    // Since categories are stored as strings in destinations, we ensure
    // no destination has a null/empty or orphaned category.

    const orphaned = await query(
      `UPDATE destinations SET category = 'Uncategorized'
       WHERE category IS NULL OR category = ''`
    );
    if (orphaned.rowCount > 0) {
      console.log(`   Set ${orphaned.rowCount} orphaned destinations to 'Uncategorized'`);
    } else {
      console.log("   No empty/orphaned categories found.");
    }

    /* ═══════════════════════════════════════════════
       5. UPDATE COUNTRY DESTINATION COUNT
       ═══════════════════════════════════════════════ */

    await query(
      `UPDATE countries SET destination_count = (
        SELECT COUNT(*) FROM destinations WHERE country_id = $1
      ) WHERE id = $1`,
      [rwandaId]
    );

    const finalCount = await query(
      `SELECT destination_count FROM countries WHERE id = $1`,
      [rwandaId]
    );
    console.log(`\n📍 Rwanda destination count updated: ${finalCount.rows[0].destination_count}`);

    /* ═══════════════════════════════════════════════
       6. VERIFY INTEGRITY
       ═══════════════════════════════════════════════ */
    console.log("\n🔍 Verification Results:");
    console.log("══════════════════════════════════════════════════════════");

    const vCountry = await query(`SELECT name, capital, destination_count FROM countries WHERE id = $1`, [rwandaId]);
    console.log("Country:", vCountry.rows[0]);

    const vDests = await query(
      `SELECT name, category, region, destination_type, is_featured
       FROM destinations WHERE country_id = $1 ORDER BY name`,
      [rwandaId]
    );
    console.log("\nDestinations:");
    vDests.rows.forEach((r) => console.log(`   • ${r.name} | ${r.category} | ${r.region} | ${r.destination_type} | featured=${r.is_featured}`));

    const vAirports = await query(`SELECT COUNT(*) FROM country_airports WHERE country_id = $1`, [rwandaId]);
    const vFestivals = await query(`SELECT COUNT(*) FROM country_festivals WHERE country_id = $1`, [rwandaId]);
    const vEvents = await query(`SELECT COUNT(*) FROM country_historical_events WHERE country_id = $1`, [rwandaId]);

    console.log(`\nRelated Data:`);
    console.log(`   Airports: ${vAirports.rows[0].count}`);
    console.log(`   Festivals: ${vFestivals.rows[0].count}`);
    console.log(`   Historical Events: ${vEvents.rows[0].count}`);
    console.log("══════════════════════════════════════════════════════════");

    console.log("\n✅ Rwanda seeding completed successfully!");
  } catch (err) {
    console.error("\n❌ Seeding failed:", err.message);
    if (err.detail) console.error("Detail:", err.detail);
    process.exit(1);
  } finally {
    await closeConnections();
  }
}

seedRwanda();
