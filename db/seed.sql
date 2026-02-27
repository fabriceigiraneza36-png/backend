-- =============================================
--  TRAVEL APP – COMPLETE SEED DATA (NO PRICES)
-- =============================================

-- Clear existing data
TRUNCATE TABLE subscribers RESTART IDENTITY CASCADE;
TRUNCATE TABLE site_settings RESTART IDENTITY CASCADE;
TRUNCATE TABLE contact_messages RESTART IDENTITY CASCADE;
TRUNCATE TABLE bookings RESTART IDENTITY CASCADE;
TRUNCATE TABLE destination_images RESTART IDENTITY CASCADE;
TRUNCATE TABLE virtual_tours RESTART IDENTITY CASCADE;
TRUNCATE TABLE gallery RESTART IDENTITY CASCADE;
TRUNCATE TABLE faqs RESTART IDENTITY CASCADE;
TRUNCATE TABLE tips RESTART IDENTITY CASCADE;
TRUNCATE TABLE posts RESTART IDENTITY CASCADE;
TRUNCATE TABLE team_members RESTART IDENTITY CASCADE;
TRUNCATE TABLE services RESTART IDENTITY CASCADE;
TRUNCATE TABLE destinations RESTART IDENTITY CASCADE;
TRUNCATE TABLE countries RESTART IDENTITY CASCADE;
TRUNCATE TABLE pages RESTART IDENTITY CASCADE;
TRUNCATE TABLE admin_users RESTART IDENTITY CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- SITE SETTINGS (WhatsApp, Contact Info)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO site_settings (key, value) VALUES
('whatsapp_number', '+254700000000'),
('whatsapp_message', 'Hello! I am interested in booking a trip. Please help me plan my adventure.'),
('contact_email', 'info@altuvera.com'),
('contact_phone', '+254700000000'),
('site_name', 'Altuvera Travel'),
('site_tagline', 'Discover Africa''s Wonders'),
('instagram', 'https://instagram.com/altuvera'),
('facebook', 'https://facebook.com/altuvera'),
('twitter', 'https://twitter.com/altuvera'),
('youtube', 'https://youtube.com/altuvera');

-- ═══════════════════════════════════════════════════════════════
-- 1. ADMIN USERS (password: 123)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active) VALUES
('admin', 'admin@altuvera.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G.xvjHnZQ.CZQK', 'System Administrator', 'superadmin', true),
('john', 'john@altuvera.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G.xvjHnZQ.CZQK', 'John Smith', 'admin', true),
('sarah', 'sarah@altuvera.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G.xvjHnZQ.CZQK', 'Sarah Johnson', 'editor', true),
('mike', 'mike@altuvera.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G.xvjHnZQ.CZQK', 'Mike Wilson', 'editor', true),
('emma', 'emma@altuvera.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G.xvjHnZQ.CZQK', 'Emma Davis', 'viewer', true);

-- ═══════════════════════════════════════════════════════════════
-- 2. COUNTRIES
-- ═══════════════════════════════════════════════════════════════
INSERT INTO countries (name, slug, description, short_description, continent, capital, currency, language, timezone, best_time_to_visit, visa_info, latitude, longitude, is_featured, is_active) VALUES
(
  'Ethiopia',
  'ethiopia',
  'Ethiopia, officially the Federal Democratic Republic of Ethiopia, is a landlocked country in the Horn of Africa. It is the oldest independent country in Africa and one of the oldest in the world. With dramatic landscapes, incredible biodiversity, and rich cultural heritage, Ethiopia offers travelers a truly unique experience.',
  'Land of Origins - Ancient history meets stunning landscapes',
  'Africa',
  'Addis Ababa',
  'Ethiopian Birr (ETB)',
  'Amharic, Oromo, Tigrinya, English',
  'EAT (UTC+3)',
  'October to March (dry season)',
  'Most nationalities can obtain a visa on arrival or e-visa.',
  9.1450,
  40.4897,
  true,
  true
),
(
  'Kenya',
  'kenya',
  'Kenya is a country in East Africa with coastline on the Indian Ocean. It encompasses savannah, lakelands, the dramatic Great Rift Valley and mountain highlands. Home to wildlife like lions, elephants and rhinos, Kenya is world-famous for its classic safaris.',
  'Safari Paradise - Home of the Great Migration',
  'Africa',
  'Nairobi',
  'Kenyan Shilling (KES)',
  'Swahili, English',
  'EAT (UTC+3)',
  'July to October (Great Migration), January to February',
  'E-visa required for most nationalities. Apply online at evisa.go.ke',
  -0.0236,
  37.9062,
  true,
  true
),
(
  'Tanzania',
  'tanzania',
  'Tanzania is an East African country known for its vast wilderness areas including the Serengeti and Kilimanjaro. Offshore lie the tropical islands of Zanzibar, with Arabic influences, and Mafia, with marine parks home to whale sharks and coral reefs.',
  'Roof of Africa - Serengeti, Kilimanjaro & Zanzibar',
  'Africa',
  'Dodoma',
  'Tanzanian Shilling (TZS)',
  'Swahili, English',
  'EAT (UTC+3)',
  'June to October (dry season), January to February',
  'Visa required. Available on arrival or e-visa online.',
  -6.3690,
  34.8888,
  true,
  true
),
(
  'Morocco',
  'morocco',
  'Morocco is a North African country bordering the Atlantic Ocean and Mediterranean Sea, distinguished by its Berber, Arabian and European cultural influences. From the Sahara desert to the Atlas Mountains to ancient medinas.',
  'Gateway to Africa - Where desert meets the sea',
  'Africa',
  'Rabat',
  'Moroccan Dirham (MAD)',
  'Arabic, Berber, French',
  'WET (UTC+0/+1)',
  'March to May, September to November',
  'Visa-free for many nationalities for up to 90 days.',
  31.7917,
  -7.0926,
  true,
  true
),
(
  'South Africa',
  'south-africa',
  'South Africa is a country on the southernmost tip of the African continent, marked by several distinct ecosystems. From Kruger National Park to Cape Town''s Table Mountain to the Garden Route, it offers incredible diversity.',
  'Rainbow Nation - Where worlds meet',
  'Africa',
  'Pretoria',
  'South African Rand (ZAR)',
  'English, Afrikaans, Zulu, Xhosa',
  'SAST (UTC+2)',
  'May to September (dry/winter), November to March (summer)',
  'Visa-free for many nationalities for up to 90 days.',
  -30.5595,
  22.9375,
  true,
  true
),
(
  'Egypt',
  'egypt',
  'Egypt is home to one of the world''s oldest civilizations. The Pyramids of Giza, the Great Sphinx, and the treasures of Tutankhamun make Egypt a cornerstone of ancient history and modern wonder.',
  'Land of Pharaohs - Ancient wonders await',
  'Africa',
  'Cairo',
  'Egyptian Pound (EGP)',
  'Arabic',
  'EET (UTC+2)',
  'October to April (cooler months)',
  'E-visa available for most nationalities.',
  26.8206,
  30.8025,
  false,
  true
),
(
  'Rwanda',
  'rwanda',
  'Rwanda is known as the "Land of a Thousand Hills" and is famous for its breathtaking scenery and mountain gorillas. The country has made remarkable progress and is now one of the safest nations in Africa.',
  'Land of a Thousand Hills - Gorillas and green valleys',
  'Africa',
  'Kigali',
  'Rwandan Franc (RWF)',
  'Kinyarwanda, French, English, Swahili',
  'CAT (UTC+2)',
  'June to September, December to February',
  'Visa on arrival available for all nationalities.',
  -1.9403,
  29.8739,
  false,
  true
);

-- ═══════════════════════════════════════════════════════════════
-- 3. DESTINATIONS (NO PRICES)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO destinations (country_id, name, slug, description, short_description, image_url, category, latitude, longitude, rating, review_count, duration, difficulty, highlights, best_season, is_featured, is_active) VALUES
-- Ethiopia
(1, 'Lalibela Rock-Hewn Churches', 'lalibela-rock-hewn-churches',
  'Lalibela is famous for its rock-cut monolithic churches. The 11 medieval churches were carved out of rock in the 12th century and are considered one of the greatest architectural wonders of the medieval world.',
  'UNESCO World Heritage 12th-century rock churches carved from living stone',
  '/uploads/lalibela-1.jpg', 'Cultural', 12.0319, 39.0474, 4.92, 1247, '2-3 days', 'Moderate',
  ARRAY['Rock-Hewn Churches', 'Religious Ceremonies', 'Ethiopian Orthodox Christianity', 'Medieval Architecture'],
  'September to March', true, true),

(1, 'Simien Mountains National Park', 'simien-mountains',
  'UNESCO World Heritage Site featuring dramatic mountain scenery with jagged peaks, deep valleys, and rare wildlife including Gelada baboons and Ethiopian wolves.',
  'Dramatic escarpments, endemic wildlife, and world-class trekking',
  '/uploads/simien-1.jpg', 'Nature', 13.1833, 38.0667, 4.88, 892, '3-7 days', 'Challenging',
  ARRAY['Gelada Baboons', 'Dramatic Escarpments', 'Walia Ibex', 'Ethiopian Wolf', 'High-Altitude Trekking'],
  'October to March', true, true),

(1, 'Danakil Depression', 'danakil-depression',
  'One of the hottest, driest, and lowest places on Earth featuring sulfur springs, acid pools, salt flats, and the permanent lava lake of Erta Ale volcano.',
  'Otherworldly volcanic landscape - one of Earth''s most extreme environments',
  '/uploads/danakil-1.jpg', 'Adventure', 14.2417, 40.3000, 4.75, 634, '3-4 days', 'Extreme',
  ARRAY['Erta Ale Volcano', 'Sulfur Springs', 'Dallol Hydrothermal Field', 'Salt Caravans'],
  'November to February', true, true),

(1, 'Omo Valley', 'omo-valley',
  'Home to some of the most fascinating tribal cultures in Africa with unique traditions, body decorations, and ceremonies.',
  'Encounter ancient tribal cultures and diverse ethnic traditions',
  '/uploads/omo-valley-1.jpg', 'Cultural', 5.5000, 36.0000, 4.70, 521, '4-6 days', 'Moderate',
  ARRAY['Tribal Communities', 'Body Painting', 'Bull Jumping Ceremony', 'Local Markets'],
  'September to March', true, true),

(1, 'Lake Tana & Blue Nile Falls', 'lake-tana-blue-nile',
  'Ethiopia''s largest lake with island monasteries and the spectacular Blue Nile Falls nearby.',
  'Island monasteries and thundering waterfalls',
  '/uploads/lake-tana-1.jpg', 'Nature', 12.0000, 37.2500, 4.65, 743, '1-2 days', 'Easy',
  ARRAY['Island Monasteries', 'Blue Nile Falls', 'Birdwatching', 'Boat Trips'],
  'September to November', false, true),

-- Kenya
(2, 'Maasai Mara National Reserve', 'maasai-mara',
  'One of Africa''s most magnificent game reserves, famous for the annual Great Migration and exceptional predator populations.',
  'Africa''s premier safari destination - witness the Great Migration',
  '/uploads/maasai-mara-1.jpg', 'Wildlife', -1.4061, 35.0167, 4.95, 2341, '3-5 days', 'Easy',
  ARRAY['Great Migration', 'Big Five', 'Hot Air Balloon Safaris', 'Maasai Culture'],
  'July to October', true, true),

(2, 'Amboseli National Park', 'amboseli',
  'Famous for large elephant herds and breathtaking views of Mount Kilimanjaro.',
  'Elephants against the backdrop of Mount Kilimanjaro',
  '/uploads/amboseli-1.jpg', 'Wildlife', -2.6527, 37.2606, 4.82, 1567, '2-3 days', 'Easy',
  ARRAY['Elephant Herds', 'Kilimanjaro Views', 'Birdwatching', 'Maasai Villages'],
  'June to October, January to February', true, true),

(2, 'Diani Beach', 'diani-beach',
  'Award-winning white sand beach on the Indian Ocean coast with pristine waters and swaying palms.',
  'Award-winning white sand beach on the Indian Ocean',
  '/uploads/diani-1.jpg', 'Beach', -4.3167, 39.5667, 4.78, 1823, '3-7 days', 'Easy',
  ARRAY['White Sand Beach', 'Snorkeling', 'Scuba Diving', 'Water Sports'],
  'January to March, June to October', false, true),

(2, 'Lake Nakuru National Park', 'lake-nakuru',
  'Famous for flamingo populations and as a rhino sanctuary protecting both black and white rhinos.',
  'Pink flamingos, rhino sanctuary, and diverse birdlife',
  '/uploads/nakuru-1.jpg', 'Wildlife', -0.3667, 36.0833, 4.72, 1102, '1-2 days', 'Easy',
  ARRAY['Flamingos', 'Rhino Sanctuary', 'Birdwatching', 'Leopard Sightings'],
  'Year-round', false, true),

(2, 'Lamu Island', 'lamu-island',
  'UNESCO World Heritage Swahili town with narrow streets and a pace of life unchanged for centuries.',
  'UNESCO World Heritage Swahili town - step back in time',
  '/uploads/lamu-1.jpg', 'Cultural', -2.2717, 40.9020, 4.80, 687, '2-4 days', 'Easy',
  ARRAY['Swahili Architecture', 'Dhow Cruises', 'Historical Sites', 'Beach Relaxation'],
  'Year-round', false, true),

-- Tanzania
(3, 'Serengeti National Park', 'serengeti',
  'Tanzania''s most famous park, home to the largest lion population in Africa and the spectacular annual migration.',
  'The endless plains - Africa''s most iconic safari destination',
  '/uploads/serengeti-1.jpg', 'Wildlife', -2.3333, 34.8333, 4.96, 2876, '4-7 days', 'Easy',
  ARRAY['Great Migration', 'Big Five', 'Balloon Safaris', 'Vast Wilderness'],
  'June to October, December to March', true, true),

(3, 'Mount Kilimanjaro', 'kilimanjaro',
  'Africa''s highest peak at 5,895 meters, offering an incredible journey through multiple climate zones.',
  'Climb Africa''s highest peak - the Roof of Africa',
  '/uploads/kilimanjaro-1.jpg', 'Adventure', -3.0674, 37.3556, 4.90, 1654, '6-9 days', 'Challenging',
  ARRAY['Summit Climb', 'Glacier Views', 'Multiple Routes', 'Diverse Ecosystems'],
  'January to March, June to October', true, true),

(3, 'Zanzibar Island', 'zanzibar',
  'The Spice Island with pristine beaches, rich history, and unique Swahili culture.',
  'The Spice Island - beaches, history, and Swahili culture',
  '/uploads/zanzibar-1.jpg', 'Beach', -6.1659, 39.2026, 4.85, 2134, '4-7 days', 'Easy',
  ARRAY['Stone Town', 'Spice Tours', 'White Sand Beaches', 'Snorkeling'],
  'June to October, December to February', true, true),

(3, 'Ngorongoro Crater', 'ngorongoro-crater',
  'The world''s largest intact volcanic caldera, home to approximately 25,000 large animals.',
  'The world''s largest intact volcanic caldera - Africa''s Eden',
  '/uploads/ngorongoro-1.jpg', 'Wildlife', -3.2000, 35.5000, 4.88, 1987, '1-2 days', 'Easy',
  ARRAY['Big Five', 'Volcanic Crater', 'Dense Wildlife', 'Flamingos'],
  'June to September, December to February', true, true),

(3, 'Lake Manyara National Park', 'lake-manyara',
  'Compact gem known for tree-climbing lions and vast flocks of flamingos.',
  'Tree-climbing lions and flamingo-lined alkaline lake',
  '/uploads/manyara-1.jpg', 'Wildlife', -3.3833, 35.8333, 4.62, 876, '1 day', 'Easy',
  ARRAY['Tree-Climbing Lions', 'Flamingos', 'Rift Valley Views', 'Elephant Herds'],
  'June to October', false, true),

-- Morocco
(4, 'Marrakech Medina', 'marrakech-medina',
  'The vibrant heart of Morocco with UNESCO-listed medina, maze of souks, and the famous Djemaa el-Fna square.',
  'Morocco''s vibrant heart - souks, palaces, and endless energy',
  '/uploads/marrakech-1.jpg', 'Cultural', 31.6295, -7.9811, 4.78, 3421, '3-4 days', 'Easy',
  ARRAY['Djemaa el-Fna', 'Souks', 'Bahia Palace', 'Traditional Hammams'],
  'March to May, September to November', true, true),

(4, 'Sahara Desert (Merzouga)', 'sahara-merzouga',
  'The quintessential Sahara experience with towering orange sand dunes rising up to 150 meters.',
  'Golden dunes, camel treks, and starlit desert nights',
  '/uploads/sahara-1.jpg', 'Adventure', 31.1453, -4.0145, 4.85, 1876, '2-3 days', 'Moderate',
  ARRAY['Camel Trekking', 'Desert Camping', 'Sunrise/Sunset Views', 'Sandboarding'],
  'October to April', true, true),

(4, 'Fes Medina', 'fes-medina',
  'Morocco''s cultural and spiritual capital with the world''s oldest university and largest car-free urban area.',
  'The world''s largest car-free urban area - medieval magic',
  '/uploads/fes-1.jpg', 'Cultural', 34.0181, -5.0078, 4.72, 1654, '2-3 days', 'Easy',
  ARRAY['Chouara Tannery', 'Al-Qarawiyyin', 'Medieval Medina', 'Traditional Crafts'],
  'March to May, September to November', false, true),

(4, 'Chefchaouen', 'chefchaouen',
  'The Blue Pearl of Morocco nestled in the Rif Mountains with entire medina painted in shades of blue.',
  'The Blue Pearl - Morocco''s most photogenic mountain town',
  '/uploads/chefchaouen-1.jpg', 'Cultural', 35.1688, -5.2636, 4.80, 1432, '1-2 days', 'Easy',
  ARRAY['Blue-Painted Streets', 'Mountain Hiking', 'Photography', 'Relaxed Atmosphere'],
  'April to June, September to November', true, true),

(4, 'Atlas Mountains', 'atlas-mountains',
  'North Africa''s highest peaks with trekking, Berber villages, and stunning scenery.',
  'North Africa''s highest peaks and traditional Berber villages',
  '/uploads/atlas-1.jpg', 'Nature', 31.0600, -7.9000, 4.68, 987, '2-5 days', 'Challenging',
  ARRAY['Mount Toubkal', 'Berber Villages', 'Mountain Trekking', 'Scenic Valleys'],
  'April to November', false, true),

-- South Africa
(5, 'Kruger National Park', 'kruger',
  'South Africa''s flagship safari destination and one of Africa''s largest game reserves with incredible wildlife diversity.',
  'South Africa''s premier Big Five safari destination',
  '/uploads/kruger-1.jpg', 'Wildlife', -24.0000, 31.5000, 4.90, 3234, '3-5 days', 'Easy',
  ARRAY['Big Five', 'Self-Drive Safari', 'Luxury Lodges', 'Night Drives'],
  'May to September', true, true),

(5, 'Cape Town & Table Mountain', 'cape-town',
  'One of the world''s most beautiful cities nestled between Table Mountain and the Atlantic Ocean.',
  'Where mountain meets ocean - one of the world''s most beautiful cities',
  '/uploads/cape-town-1.jpg', 'Urban', -33.9249, 18.4241, 4.92, 4521, '4-7 days', 'Easy',
  ARRAY['Table Mountain', 'Cape Point', 'Robben Island', 'V&A Waterfront'],
  'November to March', true, true),

(5, 'Garden Route', 'garden-route',
  'One of South Africa''s most scenic drives with pristine beaches, ancient forests, and dramatic coastline.',
  'South Africa''s most scenic coastal drive',
  '/uploads/garden-route-1.jpg', 'Nature', -33.9900, 22.5000, 4.82, 1876, '3-5 days', 'Easy',
  ARRAY['Coastal Scenery', 'Tsitsikamma', 'Bungee Jumping', 'Whale Watching'],
  'Year-round', true, true),

(5, 'Stellenbosch Wine Region', 'stellenbosch',
  'The heart of South African wine country with over 150 wine estates set against dramatic mountain backdrops.',
  'World-class wine estates in stunning mountain scenery',
  '/uploads/stellenbosch-1.jpg', 'Cultural', -33.9346, 18.8667, 4.75, 1543, '1-3 days', 'Easy',
  ARRAY['Wine Tasting', 'Cape Dutch Architecture', 'Gourmet Dining', 'Mountain Views'],
  'October to April', false, true),

(5, 'Drakensberg Mountains', 'drakensberg',
  'The Dragon Mountains with dramatic peaks, world-class hiking, and ancient San rock art.',
  'Dragon Mountains - dramatic peaks and ancient rock art',
  '/uploads/drakensberg-1.jpg', 'Nature', -29.0000, 29.5000, 4.78, 1234, '2-5 days', 'Challenging',
  ARRAY['Hiking Trails', 'San Rock Art', 'Mountain Scenery', 'Waterfalls'],
  'March to May, September to November', false, true);

-- ═══════════════════════════════════════════════════════════════
-- 4. DESTINATION IMAGES
-- ═══════════════════════════════════════════════════════════════
INSERT INTO destination_images (destination_id, image_url, thumbnail_url, caption, is_primary, sort_order) VALUES
(1, '/uploads/lalibela-1.jpg', '/uploads/lalibela-1-thumb.jpg', 'Church of St. George from above', true, 1),
(1, '/uploads/lalibela-2.jpg', '/uploads/lalibela-2-thumb.jpg', 'Interior of Bet Medhane Alem', false, 2),
(1, '/uploads/lalibela-3.jpg', '/uploads/lalibela-3-thumb.jpg', 'Priest holding ancient cross', false, 3),
(2, '/uploads/simien-1.jpg', '/uploads/simien-1-thumb.jpg', 'Dramatic escarpment views', true, 1),
(2, '/uploads/simien-2.jpg', '/uploads/simien-2-thumb.jpg', 'Gelada baboons grooming', false, 2),
(6, '/uploads/mara-1.jpg', '/uploads/mara-1-thumb.jpg', 'Wildebeest crossing the Mara River', true, 1),
(6, '/uploads/mara-2.jpg', '/uploads/mara-2-thumb.jpg', 'Lion pride at sunrise', false, 2),
(11, '/uploads/serengeti-1.jpg', '/uploads/serengeti-1-thumb.jpg', 'Endless plains at golden hour', true, 1),
(11, '/uploads/serengeti-2.jpg', '/uploads/serengeti-2-thumb.jpg', 'Leopard in acacia tree', false, 2),
(22, '/uploads/capetown-1.jpg', '/uploads/capetown-1-thumb.jpg', 'Table Mountain and city skyline', true, 1),
(22, '/uploads/capetown-2.jpg', '/uploads/capetown-2-thumb.jpg', 'Bo-Kaap colorful houses', false, 2);

-- ═══════════════════════════════════════════════════════════════
-- 5. SERVICES (NO PRICES - Contact via WhatsApp)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO services (title, slug, description, short_description, icon, image_url, features, is_featured, sort_order, is_active) VALUES
(
  'Guided Safari Tours',
  'guided-safari-tours',
  'Experience Africa''s incredible wildlife with our expert guides. Our safari tours range from group adventures to exclusive private safaris. All tours include professional naturalist guides, quality vehicles, and unforgettable wildlife encounters. Contact us on WhatsApp for personalized quotes.',
  'Expert-led wildlife adventures across Africa',
  'binoculars',
  '/uploads/service-safari.jpg',
  ARRAY['Professional naturalist guides', 'Quality 4x4 safari vehicles', 'Park entrance fees included', 'Complimentary binoculars', 'Wildlife guarantee program'],
  true, 1, true
),
(
  'Cultural Immersion Tours',
  'cultural-tours',
  'Go beyond the surface with authentic cultural experiences. Meet local communities, participate in traditional ceremonies, learn ancient crafts, and share meals with families. Contact us to design your perfect cultural journey.',
  'Authentic connections with local communities',
  'users',
  '/uploads/service-cultural.jpg',
  ARRAY['Local community visits', 'Traditional craft workshops', 'Home-cooked meals', 'Cultural performances', 'Community support initiatives'],
  true, 2, true
),
(
  'Mountain Trekking',
  'mountain-trekking',
  'Conquer Africa''s greatest peaks with our experienced mountain guides. From Kilimanjaro to the Simien Mountains, we provide complete trekking packages including equipment, permits, guides, and porters. Reach out for customized itineraries.',
  'Summit Africa''s legendary peaks',
  'mountain',
  '/uploads/service-trekking.jpg',
  ARRAY['Certified mountain guides', 'Quality camping equipment', 'All permits included', 'Porter services', 'Emergency evacuation coverage'],
  true, 3, true
),
(
  'Luxury Accommodations',
  'luxury-accommodations',
  'Stay in Africa''s finest lodges and camps. We partner with award-winning properties that combine exceptional comfort with authentic experiences. From tented camps under the stars to boutique lodges with panoramic views.',
  'Exceptional stays in remarkable places',
  'star',
  '/uploads/service-luxury.jpg',
  ARRAY['Award-winning properties', 'All-inclusive options', 'Private guides available', 'Spa and wellness', 'Fine dining experiences'],
  true, 4, true
),
(
  'Airport Transfers',
  'airport-transfers',
  'Start and end your journey smoothly with our reliable transfer services. Professional drivers, comfortable vehicles, and 24/7 availability ensure hassle-free travel.',
  'Reliable, comfortable airport pickups',
  'car',
  '/uploads/service-transfer.jpg',
  ARRAY['Flight monitoring', '24/7 availability', 'Meet and greet service', 'Comfortable vehicles', 'Professional drivers'],
  false, 5, true
),
(
  'Photography Tours',
  'photography-tours',
  'Capture Africa''s beauty with our specialized photography tours. Led by professional wildlife photographers, these tours focus on optimal lighting, unique angles, and patient observation.',
  'Capture unforgettable moments',
  'camera',
  '/uploads/service-photo.jpg',
  ARRAY['Professional photographer guides', 'Optimal positioning', 'Extended game drives', 'Post-processing workshops', 'Small group sizes'],
  true, 6, true
),
(
  'Family Adventures',
  'family-adventures',
  'Create lifelong memories with family-friendly adventures. Our family tours are designed for all ages, with appropriate pacing, engaging activities, and child-friendly accommodations.',
  'Adventures for all ages',
  'heart',
  '/uploads/service-family.jpg',
  ARRAY['Child-friendly itineraries', 'Educational activities', 'Family rooms', 'Flexible schedules', 'Kid-approved meals'],
  false, 7, true
);

-- ═══════════════════════════════════════════════════════════════
-- 6. TEAM MEMBERS (with WhatsApp)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO team_members (name, role, bio, image_url, email, phone, whatsapp, social_links, sort_order, is_active) VALUES
(
  'Amara Okonkwo',
  'Founder & CEO',
  'Amara founded Altuvera with a vision to share Africa''s incredible diversity with the world. With over 20 years in the travel industry, she has built partnerships with communities across the continent.',
  '/uploads/team-amara.jpg',
  'amara@altuvera.com',
  '+254 700 000 001',
  '+254700000001',
  '{"linkedin": "https://linkedin.com/in/amara-okonkwo", "twitter": "https://twitter.com/amaraokonkwo"}',
  1, true
),
(
  'David Kimani',
  'Head of Operations',
  'David ensures every trip runs flawlessly. A former safari guide with 15 years of field experience, he now oversees all operational aspects from logistics to emergency response.',
  '/uploads/team-david.jpg',
  'david@altuvera.com',
  '+254 700 000 002',
  '+254700000002',
  '{"linkedin": "https://linkedin.com/in/davidkimani"}',
  2, true
),
(
  'Sofia Mendes',
  'Travel Design Director',
  'Sofia crafts bespoke itineraries that transform trips into transformative journeys. With a background in anthropology, she creates personalized adventures connecting travelers with each destination.',
  '/uploads/team-sofia.jpg',
  'sofia@altuvera.com',
  '+254 700 000 003',
  '+254700000003',
  '{"linkedin": "https://linkedin.com/in/sofiamendes", "instagram": "https://instagram.com/sofiamendes"}',
  3, true
),
(
  'James Mwangi',
  'Lead Safari Guide',
  'James is one of East Africa''s most respected safari guides. Born in the shadow of Mount Kenya, he has tracked wildlife for over 18 years with encyclopedic knowledge of animal behavior.',
  '/uploads/team-james.jpg',
  'james@altuvera.com',
  '+254 700 000 004',
  '+254700000004',
  '{"instagram": "https://instagram.com/jamestheguide"}',
  4, true
),
(
  'Zara Ahmed',
  'Customer Experience Manager',
  'Zara is dedicated to ensuring every guest feels valued and supported. Her multilingual skills (English, Swahili, Arabic, French) serve our global clientele.',
  '/uploads/team-zara.jpg',
  'zara@altuvera.com',
  '+254 700 000 005',
  '+254700000005',
  '{"linkedin": "https://linkedin.com/in/zaraahmed"}',
  5, true
);

-- ═══════════════════════════════════════════════════════════════
-- 7. BLOG POSTS
-- ═══════════════════════════════════════════════════════════════
INSERT INTO posts (title, slug, content, excerpt, image_url, author_name, author_avatar, category, tags, is_published, is_featured, view_count, read_time, published_at) VALUES
(
  'The Ultimate Guide to the Great Migration',
  'ultimate-guide-great-migration',
  E'# The Ultimate Guide to the Great Migration\n\nThe Great Migration is nature''s most spectacular show, involving over two million wildebeest, zebras, and gazelles.\n\n## When Does It Happen?\n\n- **December to March**: Calving season in the southern Serengeti\n- **April to May**: Long rains push herds north\n- **June to July**: Herds gather at the Grumeti River\n- **August to October**: Dramatic Mara River crossings\n- **November**: Return journey south\n\n## Best Viewing Spots\n\nThe most dramatic moments occur at the Mara River crossings. Contact us on WhatsApp to plan your migration safari.',
  'Everything you need to know about witnessing Africa''s greatest wildlife spectacle.',
  '/uploads/post-migration.jpg', 'James Mwangi', '/uploads/team-james.jpg', 'Wildlife',
  ARRAY['Safari', 'Wildlife', 'Tanzania', 'Kenya', 'Migration'],
  true, true, 15420, 12, '2024-01-15 10:00:00'
),
(
  '10 Essential Tips for Your First African Safari',
  'first-african-safari-tips',
  E'# 10 Essential Tips for Your First African Safari\n\n## 1. Pack Neutral Colors\nLeave bright whites and neons at home.\n\n## 2. Bring Quality Binoculars\nA good pair transforms your experience.\n\n## 3. Respect the Siesta\nMidday is hot and animals rest.\n\n## 4. Listen to Your Guide\nGuides read animal behavior and know safety protocols.\n\n## 5. Manage Expectations\nWildlife isn''t predictable.\n\nContact us on WhatsApp for personalized safari planning.',
  'First-time safari? Our guides share their top tips for making your African adventure unforgettable.',
  '/uploads/post-safari-tips.jpg', 'David Kimani', '/uploads/team-david.jpg', 'Travel Tips',
  ARRAY['Safari', 'Tips', 'First-Timer', 'Planning'],
  true, true, 12350, 8, '2024-02-20 09:00:00'
),
(
  'Ethiopia''s Hidden Treasures: Beyond Lalibela',
  'ethiopia-hidden-treasures',
  E'# Ethiopia''s Hidden Treasures\n\n## Tigray Rock Churches\nOver 120 rock-hewn churches, many older than Lalibela.\n\n## The Afar Depression\nOne of Earth''s most extreme environments.\n\n## Harar: The Fourth Holy City of Islam\nWalled city with famous hyena feeding.\n\nReach out on WhatsApp to plan your Ethiopian adventure.',
  'Discover Ethiopia''s lesser-known wonders: ancient churches, alien landscapes, and living cultures.',
  '/uploads/post-ethiopia.jpg', 'Thomas Bekele', '/uploads/team-thomas.jpg', 'Destinations',
  ARRAY['Ethiopia', 'Culture', 'History', 'Off-the-beaten-path'],
  true, true, 8930, 10, '2024-03-10 14:00:00'
),
(
  'Cape Town: A Complete City Guide',
  'cape-town-complete-guide',
  E'# Cape Town: A Complete City Guide\n\n## Don''t Miss\n- Table Mountain\n- Cape Point\n- Bo-Kaap\n- Robben Island\n\n## Best Neighborhoods\n- V&A Waterfront\n- Camps Bay\n- Woodstock\n- Constantia\n\nContact us to plan your Cape Town trip.',
  'Your complete guide to Cape Town: iconic sights, hidden gems, and local tips.',
  '/uploads/post-capetown.jpg', 'Precious Ndlovu', '/uploads/team-precious.jpg', 'Destinations',
  ARRAY['Cape Town', 'South Africa', 'City Guide'],
  true, true, 11280, 9, '2024-05-15 08:00:00'
),
(
  'Zanzibar: Spices, Beaches, and Stone Town',
  'zanzibar-complete-guide',
  E'# Zanzibar: Spices, Beaches, and Stone Town\n\n## Stone Town\nUNESCO-listed old quarter with narrow alleys and ornate doorways.\n\n## Beaches\n- Paje: Kitesurfing paradise\n- Nungwi: Best sunsets\n- Kendwa: Less tidal variation\n\n## Experiences\n- Spice Tour\n- Jozani Forest\n- Dhow Cruise\n\nMessage us on WhatsApp to book your Zanzibar escape.',
  'The complete guide to Zanzibar: historic Stone Town, pristine beaches, and spice tours.',
  '/uploads/post-zanzibar.jpg', 'David Kimani', '/uploads/team-david.jpg', 'Destinations',
  ARRAY['Zanzibar', 'Tanzania', 'Beach', 'History'],
  true, false, 7650, 8, '2024-07-10 10:00:00'
);

-- ═══════════════════════════════════════════════════════════════
-- 8. TRAVEL TIPS
-- ═══════════════════════════════════════════════════════════════
INSERT INTO tips (title, content, category, icon, sort_order, is_active) VALUES
('Pack Light, Layer Smart', 'African weather varies dramatically. Pack versatile, lightweight clothing in neutral colors (khaki, green, brown) that can be layered. Most lodges offer laundry service.', 'Packing', 'luggage', 1, true),
('Protect Against Malaria', 'Most safari areas are malaria zones. Consult a travel medicine specialist 4-6 weeks before departure. Use DEET-based repellent and sleep under mosquito nets.', 'Health', 'shield', 2, true),
('Respect Wildlife Distance', 'Never approach animals on foot without a guide. In vehicles, your guide knows safe distances. Never feed animals or use flash photography.', 'Safety', 'paw', 3, true),
('Stay Hydrated', 'The African sun is intense. Carry a reusable water bottle and drink regularly, even if not thirsty. Lodges always provide safe drinking water.', 'Health', 'droplet', 4, true),
('Bring Quality Optics', 'A good pair of binoculars (8x42 or 10x42) transforms your safari experience. You''ll spot distant animals and appreciate details you''d otherwise miss.', 'Gear', 'binoculars', 5, true),
('Embrace the Unexpected', 'Wildlife operates on its own schedule. You might see a leopard kill on day one or search for lions all week. Embrace unpredictability as part of the adventure.', 'Mindset', 'sun', 6, true),
('Travel Insurance is Essential', 'Never travel without comprehensive insurance including emergency medical evacuation. Safari areas are remote, and evacuation can cost $50,000+.', 'Planning', 'file-text', 7, true),
('Learn Some Local Phrases', 'Basic Swahili goes a long way: "Jambo" (hello), "Asante" (thank you), "Hakuna matata" (no worries). Locals appreciate the effort.', 'Culture', 'message-circle', 8, true);

-- ═══════════════════════════════════════════════════════════════
-- 9. FAQs (NO PRICE QUESTIONS)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO faqs (question, answer, category, sort_order, is_active) VALUES
('What is the best time to visit East Africa for safari?', 'The dry seasons offer the best wildlife viewing: June-October and January-February. The "green season" (March-May, November) offers lush landscapes, fewer tourists, and newborn animals.', 'Planning', 1, true),
('How far in advance should I book?', 'For peak season (July-October, December-January), book 6-12 months in advance. Shoulder season trips can be arranged 3-6 months ahead. Contact us on WhatsApp to start planning.', 'Booking', 2, true),
('Is Africa safe for travelers?', 'Yes, when traveling with reputable operators. Safari destinations have excellent safety records. Wildlife is managed by trained guides, and lodges maintain high security standards.', 'Safety', 3, true),
('What vaccines do I need for Africa?', 'Common recommendations include Yellow Fever, Hepatitis A and B, Typhoid, and malaria prophylaxis. Consult a travel medicine specialist 4-6 weeks before departure.', 'Health', 4, true),
('How do I get a quote for my trip?', 'Contact us via WhatsApp with your travel dates, destinations of interest, group size, and any special requirements. We''ll create a personalized itinerary and quote for you.', 'Booking', 5, true),
('What should I pack for safari?', 'Neutral-colored clothing, layers, comfortable walking shoes, hat, sunscreen, insect repellent, binoculars, camera, and medications. Most lodges offer laundry service.', 'Packing', 6, true),
('Can children go on safari?', 'Yes! Many lodges welcome families. Consider age requirements (some have minimums of 6-12 years), child-friendly activities, and attention spans. We specialize in family safari planning.', 'Families', 7, true),
('Do I need a visa?', 'Most visitors need visas. Many countries offer e-visas or visas on arrival (Kenya, Tanzania, Ethiopia, Rwanda). Contact us and we''ll provide guidance based on your nationality.', 'Documents', 8, true),
('What is your cancellation policy?', 'We offer flexible cancellation policies. Contact us via WhatsApp for details specific to your booking. We always recommend comprehensive travel insurance.', 'Booking', 9, true),
('How do I communicate with you during planning?', 'We primarily use WhatsApp for all communication. It''s fast, convenient, and allows us to share photos, documents, and updates easily. Click the WhatsApp button to start chatting!', 'Booking', 10, true);

-- ═══════════════════════════════════════════════════════════════
-- 10. GALLERY
-- ═══════════════════════════════════════════════════════════════
INSERT INTO gallery (title, description, image_url, thumbnail_url, category, location, country_id, destination_id, photographer, sort_order, is_featured, is_active) VALUES
('Sunrise Over the Serengeti', 'Golden light breaks over the endless plains', '/uploads/gallery/serengeti-sunrise.jpg', '/uploads/gallery/thumb-serengeti-sunrise.jpg', 'Landscape', 'Serengeti', 3, 11, 'James Mwangi', 1, true, true),
('Elephant Herd Crossing', 'A family of elephants moves through the bush', '/uploads/gallery/elephants-crossing.jpg', '/uploads/gallery/thumb-elephants-crossing.jpg', 'Wildlife', 'Amboseli', 2, 7, 'James Mwangi', 2, true, true),
('Church of St. George', 'The iconic cross-shaped church carved from rock', '/uploads/gallery/lalibela-george.jpg', '/uploads/gallery/thumb-lalibela-george.jpg', 'Culture', 'Lalibela', 1, 1, 'Thomas Bekele', 3, true, true),
('Gelada Baboons', 'The bleeding-heart monkeys of the Simien Mountains', '/uploads/gallery/gelada.jpg', '/uploads/gallery/thumb-gelada.jpg', 'Wildlife', 'Simien Mountains', 1, 2, 'Thomas Bekele', 4, true, true),
('Zanzibar Beach Sunset', 'Palm trees silhouetted against a fiery sky', '/uploads/gallery/zanzibar-sunset.jpg', '/uploads/gallery/thumb-zanzibar-sunset.jpg', 'Beach', 'Nungwi', 3, 13, 'Sofia Mendes', 5, true, true),
('Lion in Morning Light', 'A male lion surveys his territory', '/uploads/gallery/lion-morning.jpg', '/uploads/gallery/thumb-lion-morning.jpg', 'Wildlife', 'Maasai Mara', 2, 6, 'James Mwangi', 6, true, true),
('Table Mountain Vista', 'Cape Town''s iconic landmark at golden hour', '/uploads/gallery/table-mountain.jpg', '/uploads/gallery/thumb-table-mountain.jpg', 'Landscape', 'Cape Town', 5, 22, 'Precious Ndlovu', 7, true, true),
('Marrakech Medina', 'The colorful maze of the old city', '/uploads/gallery/marrakech-medina.jpg', '/uploads/gallery/thumb-marrakech-medina.jpg', 'Culture', 'Marrakech', 4, 16, 'Sofia Mendes', 8, true, true),
('Wildebeest Migration', 'Thousands crossing the Mara River', '/uploads/gallery/migration.jpg', '/uploads/gallery/thumb-migration.jpg', 'Wildlife', 'Maasai Mara', 2, 6, 'James Mwangi', 9, true, true),
('Sahara Dunes', 'Golden dunes of Erg Chebbi at sunset', '/uploads/gallery/sahara-dunes.jpg', '/uploads/gallery/thumb-sahara-dunes.jpg', 'Landscape', 'Merzouga', 4, 17, 'Sofia Mendes', 10, true, true);

-- ═══════════════════════════════════════════════════════════════
-- 11. VIRTUAL TOURS
-- ═══════════════════════════════════════════════════════════════
INSERT INTO virtual_tours (title, slug, description, destination_id, video_url, thumbnail_url, duration, is_featured, sort_order, is_active) VALUES
('Lalibela Churches Virtual Walk', 'lalibela-virtual-walk', 'Experience the magnificent rock-hewn churches of Lalibela from your screen.', 1, 'https://youtube.com/watch?v=example1', '/uploads/vt-lalibela.jpg', '12 min', true, 1, true),
('Serengeti Safari Experience', 'serengeti-safari-experience', 'Join us on a virtual game drive through the endless plains.', 11, 'https://youtube.com/watch?v=example2', '/uploads/vt-serengeti.jpg', '15 min', true, 2, true),
('Maasai Mara Migration', 'mara-migration-tour', 'Witness the dramatic river crossings of the Great Migration.', 6, 'https://youtube.com/watch?v=example3', '/uploads/vt-mara.jpg', '10 min', true, 3, true),
('Zanzibar Stone Town Walk', 'zanzibar-stone-town', 'Explore the narrow alleys and historic buildings of Stone Town.', 13, 'https://youtube.com/watch?v=example4', '/uploads/vt-zanzibar.jpg', '8 min', false, 4, true),
('Cape Town Aerial Tour', 'cape-town-aerial', 'Soar over Table Mountain and the stunning Cape Peninsula.', 22, 'https://youtube.com/watch?v=example5', '/uploads/vt-capetown.jpg', '10 min', true, 5, true);

-- ═══════════════════════════════════════════════════════════════
-- 12. PAGES
-- ═══════════════════════════════════════════════════════════════
INSERT INTO pages (title, slug, content, meta_title, meta_description, is_published) VALUES
('About Us', 'about', E'# About Altuvera Travel\n\nWe are a passionate team of travel enthusiasts dedicated to showcasing the beauty and diversity of Africa. Founded with a vision to create authentic, transformative travel experiences, we connect travelers with the soul of each destination.\n\n## Our Mission\n\nTo provide exceptional, personalized travel experiences that support local communities and preserve Africa''s natural and cultural heritage.\n\n## Why Choose Us\n\n- **Expert Local Knowledge**: Our team lives and breathes Africa\n- **Personalized Service**: Every trip is tailored to you\n- **Direct Communication**: Chat with us on WhatsApp anytime\n- **Sustainable Tourism**: We give back to communities\n\nContact us on WhatsApp to start planning your adventure!', 'About Us - Altuvera Travel', 'Learn about Altuvera Travel and our mission to share Africa with the world.', true),
('Contact Us', 'contact', E'# Contact Us\n\nWe''d love to hear from you! The best way to reach us is via WhatsApp.\n\n## WhatsApp\n\nClick the WhatsApp button on any page to start a conversation. We typically respond within a few hours.\n\n## Email\n\ninfo@altuvera.com\n\n## Office Hours\n\nMonday - Friday: 8am - 6pm (EAT)\nSaturday: 9am - 2pm (EAT)\nSunday: Closed (WhatsApp monitored)\n\nWe look forward to helping you plan your African adventure!', 'Contact Us - Altuvera Travel', 'Get in touch with Altuvera Travel via WhatsApp or email.', true),
('Terms & Conditions', 'terms', E'# Terms & Conditions\n\n## Booking Process\n\n1. Contact us via WhatsApp with your travel requirements\n2. We''ll create a personalized itinerary\n3. Review and confirm your trip\n4. Receive booking confirmation and travel documents\n\n## Cancellation Policy\n\nOur cancellation policies are flexible and discussed during booking. We always recommend travel insurance.\n\n## Responsibility\n\nAltuvera Travel acts as an agent for accommodation, transport, and activity providers. We are not liable for changes beyond our control.\n\nContact us on WhatsApp for any questions.', 'Terms & Conditions - Altuvera Travel', 'Terms and conditions for booking with Altuvera Travel.', true),
('Privacy Policy', 'privacy', E'# Privacy Policy\n\n## Information We Collect\n\nWe collect information you provide when contacting us, including name, email, phone number, and travel preferences.\n\n## How We Use Your Information\n\n- To plan and book your trips\n- To communicate with you\n- To improve our services\n\n## Data Security\n\nWe protect your personal information and never sell it to third parties.\n\nContact us on WhatsApp with any privacy questions.', 'Privacy Policy - Altuvera Travel', 'Privacy policy for Altuvera Travel.', true);

-- ═══════════════════════════════════════════════════════════════
-- 13. SAMPLE BOOKINGS (Inquiries via WhatsApp model)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO bookings (booking_number, destination_id, service_id, full_name, email, phone, whatsapp, nationality, travel_date, return_date, number_of_travelers, accommodation_type, special_requests, status, admin_notes) VALUES
('BK-240215-A1B2C3', 6, 1, 'Michael Johnson', 'michael.j@email.com', '+1 555 123 4567', '+15551234567', 'American', '2024-07-15', '2024-07-22', 2, 'Luxury Lodge', 'Honeymoon trip - any special arrangements appreciated', 'confirmed', 'VIP booking - arrange champagne on arrival'),
('BK-240220-D4E5F6', 11, 1, 'Emma Williams', 'emma.w@email.com', '+44 20 1234 5678', '+442012345678', 'British', '2024-08-01', '2024-08-10', 4, 'Mid-range', 'Family with 2 children (ages 8 and 12)', 'confirmed', 'Family safari - arranged kids activities'),
('BK-240301-G7H8I9', 1, 2, 'Hans Mueller', 'hans.m@email.de', '+49 30 12345678', '+493012345678', 'German', '2024-09-10', '2024-09-18', 1, 'Boutique', 'Interested in religious festivals if possible', 'pending', 'Check Meskel festival dates'),
('BK-240305-J1K2L3', 22, 4, 'Sarah Chen', 'sarah.c@email.com', '+86 10 12345678', '+861012345678', 'Chinese', '2024-10-05', '2024-10-12', 2, 'Luxury', 'Anniversary celebration', 'pending', 'Follow up on wine tour preferences'),
('BK-240310-M4N5O6', 12, 3, 'James Anderson', 'james.a@email.com', '+1 555 987 6543', '+15559876543', 'American', '2024-09-20', '2024-09-28', 1, 'Standard', 'Training for Kilimanjaro - need fitness advice', 'confirmed', 'Sent training guide, Lemosho route confirmed');

-- ═══════════════════════════════════════════════════════════════
-- 14. SAMPLE CONTACT MESSAGES
-- ═══════════════════════════════════════════════════════════════
INSERT INTO contact_messages (full_name, email, phone, whatsapp, subject, message, is_read) VALUES
('Alice Brown', 'alice.b@email.com', '+1 555 111 2222', '+15551112222', 'Group Safari Inquiry', 'Hi, I''m planning a safari for a group of 8 friends. We''re interested in Kenya and Tanzania for about 10 days in August. Can you help us plan something special?', false),
('Robert Taylor', 'robert.t@email.com', '+44 77 1234 5678', '+447712345678', 'Honeymoon Ideas', 'My fiancée and I are getting married in June and want to honeymoon in Africa. We love beaches and wildlife. What do you recommend?', true),
('Maria Garcia', 'maria.g@email.com', '+34 612 345 678', '+34612345678', 'Ethiopia Cultural Tour', 'I''m fascinated by Ethiopian history and would love to visit the rock churches. How many days do you recommend?', false),
('David Kim', 'david.k@email.com', '+82 10 1234 5678', '+821012345678', 'Photography Safari', 'I''m a wildlife photographer looking for the best locations in East Africa. Do you offer specialized photography tours?', true),
('Lisa Wang', 'lisa.w@email.com', '+86 138 1234 5678', '+8613812345678', 'Family Trip with Kids', 'We have two young children (4 and 7). Is Africa suitable for families? What would you recommend?', false);

-- ═══════════════════════════════════════════════════════════════
-- 15. SUBSCRIBERS
-- ═══════════════════════════════════════════════════════════════
INSERT INTO subscribers (email, is_active) VALUES
('newsletter1@email.com', true),
('newsletter2@email.com', true),
('newsletter3@email.com', true),
('newsletter4@email.com', true),
('newsletter5@email.com', true),
('unsubscribed@email.com', false);

-- ═══════════════════════════════════════════════════════════════
-- UPDATE DESTINATION COUNTS
-- ═══════════════════════════════════════════════════════════════
UPDATE countries SET destination_count = (
  SELECT COUNT(*) FROM destinations WHERE destinations.country_id = countries.id
);