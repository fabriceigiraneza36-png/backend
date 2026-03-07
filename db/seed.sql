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
  (
    'Ethiopia is one of Africa''s most historically significant destinations, combining ancient civilizations, alpine trekking, volcanic frontiers, monastic heritage, and highland biodiversity.' || E'\n' ||
    (SELECT string_agg(format('Ethiopia dossier line %s: practical guidance on heritage corridors, highland logistics, protected areas, culture etiquette, health planning, and sustainable community travel.', g), E'\n')
     FROM generate_series(1, 320) AS g)
  ),
  'Ancient civilizations, highland trekking, and living heritage',
  'Africa',
  'Addis Ababa',
  'Ethiopian Birr (ETB)',
  'Amharic, Oromo, Tigrinya, English',
  'EAT (UTC+3)',
  'October to March (dry season)',
  'E-visa available for most nationalities; check latest rules before travel.',
  9.1450,
  40.4897,
  true,
  true
),
(
  'Kenya',
  'kenya',
  (
    'Kenya delivers world-class safari ecosystems, dramatic Rift Valley landscapes, coastal Swahili culture, and modern conservation-led tourism infrastructure.' || E'\n' ||
    (SELECT string_agg(format('Kenya dossier line %s: operational details on migration windows, reserve zoning, aviation links, safety protocols, cultural immersion, and impact-conscious itineraries.', g), E'\n')
     FROM generate_series(1, 320) AS g)
  ),
  'Premier safari circuits and Indian Ocean coast experiences',
  'Africa',
  'Nairobi',
  'Kenyan Shilling (KES)',
  'Swahili, English',
  'EAT (UTC+3)',
  'June to October; January to February',
  'Electronic Travel Authorization required for most visitors.',
  -0.0236,
  37.9062,
  true,
  true
),
(
  'Tanzania',
  'tanzania',
  (
    'Tanzania pairs iconic wildlife parks with mountain expeditions and Indian Ocean islands, making it one of East Africa''s most complete destination portfolios.' || E'\n' ||
    (SELECT string_agg(format('Tanzania dossier line %s: route-planning notes for northern and southern circuits, climbing strategies, marine extensions, permits, and responsible visitor management.', g), E'\n')
     FROM generate_series(1, 320) AS g)
  ),
  'Legendary safaris, Kilimanjaro ascents, and Zanzibar coastlines',
  'Africa',
  'Dodoma',
  'Tanzanian Shilling (TZS)',
  'Swahili, English',
  'EAT (UTC+3)',
  'June to October; December to February',
  'Visa required for many nationalities; e-visa and on-arrival options exist.',
  -6.3690,
  34.8888,
  true,
  true
),
(
  'Uganda',
  'uganda',
  (
    'Uganda is a high-value adventure destination with gorilla trekking, chimpanzee tracking, Nile headwaters, vast savannah parks, and strong community tourism programs.' || E'\n' ||
    (SELECT string_agg(format('Uganda dossier line %s: planning intelligence for permit timing, primate protocols, inland flight links, rainfall patterns, and conservation contribution models.', g), E'\n')
     FROM generate_series(1, 320) AS g)
  ),
  'Primate expeditions, Nile adventures, and diverse savannah parks',
  'Africa',
  'Kampala',
  'Ugandan Shilling (UGX)',
  'English, Swahili, Luganda',
  'EAT (UTC+3)',
  'June to August; December to February',
  'E-visa available; yellow fever certificate is typically required.',
  1.3733,
  32.2903,
  true,
  true
),
(
  'Rwanda',
  'rwanda',
  (
    'Rwanda offers premium eco-tourism centered on mountain gorillas, rainforest primates, recovering savannah ecosystems, lake leisure, and highly efficient national logistics.' || E'\n' ||
    (SELECT string_agg(format('Rwanda dossier line %s: destination intelligence on trekking standards, park management, domestic connectivity, urban safety, and high-end sustainable tourism practices.', g), E'\n')
     FROM generate_series(1, 320) AS g)
  ),
  'Premium conservation tourism with mountains, forests, and lakes',
  'Africa',
  'Kigali',
  'Rwandan Franc (RWF)',
  'Kinyarwanda, English, French, Swahili',
  'CAT (UTC+2)',
  'June to September; December to February',
  'Visa on arrival for many nationalities; East Africa Tourist Visa available.',
  -1.9403,
  29.8739,
  true,
  true
);

-- 3. DESTINATIONS (NO PRICES)
-- ═══════════════════════════════════════════════════════════════
INSERT INTO destinations (country_id, name, slug, description, short_description, image_url, category, latitude, longitude, rating, review_count, duration, difficulty, highlights, included, not_included, best_season, is_featured, is_active) VALUES
-- Ethiopia
(1, 'Lalibela Rock-Hewn Churches', 'lalibela-rock-hewn-churches',
  'UNESCO-listed monolithic churches carved directly into volcanic tuff, supported by active liturgical traditions and exceptional heritage interpretation opportunities.',
  'UNESCO sacred architecture carved from living rock',
  '/uploads/lalibela-1.jpg', 'Cultural', 12.0319, 39.0474, 4.93, 1620, '2-3 days', 'Moderate',
  ARRAY['Rock-hewn church complexes', 'Orthodox liturgy', 'Heritage interpretation', 'Pilgrimage routes', 'Historic manuscripts', 'Sunrise and golden-hour photography'],
  ARRAY['Expert heritage guide', 'Site entry permissions', 'Airport transfers', 'Boutique accommodation options', 'Cultural briefing', 'Local support team'],
  ARRAY['International flights', 'Travel insurance', 'Premium camera permits', 'Personal purchases', 'Visa fees', 'Alcoholic beverages'],
  'October to March', true, true),
(1, 'Simien Mountains National Park', 'simien-mountains',
  'Alpine escarpments, endemic wildlife, and multi-day trekking routes across one of Africa''s most dramatic highland landscapes.',
  'High-altitude trekking and endemic wildlife corridors',
  '/uploads/simien-1.jpg', 'Nature', 13.1833, 38.0667, 4.89, 1185, '3-6 days', 'Challenging',
  ARRAY['Gelada troops', 'Walia ibex habitat', 'Ethiopian wolf range', 'Cliff-edge trekking', 'UNESCO landscapes', 'Mountain sunrise camps'],
  ARRAY['Certified mountain guide', 'Park permits', 'Camping logistics', 'Cook and support crew', 'Ground transfers', 'Emergency coordination'],
  ARRAY['Trekking gear rental', 'Personal porter upgrades', 'International evacuation cover', 'Private room supplements', 'Tips', 'Alcoholic drinks'],
  'October to March', true, true),
(1, 'Danakil Depression', 'danakil-depression',
  'Extreme geological frontier featuring hydrothermal fields, active volcanism, salt caravans, and one of the lowest terrestrial points on earth.',
  'Volcanic extremes and surreal geothermal terrain',
  '/uploads/danakil-1.jpg', 'Adventure', 14.2417, 40.3000, 4.77, 780, '3-4 days', 'Extreme',
  ARRAY['Dallol hydrothermal formations', 'Erta Ale lava systems', 'Afar salt trade routes', 'Desert expedition camping', 'Geological photography', 'Remote frontier travel'],
  ARRAY['Specialized expedition team', 'Security escort protocols', '4x4 logistics', 'Camping setup', 'Hydration planning', 'Field meals'],
  ARRAY['High-end personal gear', 'Satellite communication add-ons', 'Visa fees', 'Insurance', 'Private charter options', 'Premium beverages'],
  'November to February', true, true),
(1, 'Omo Valley Cultural Landscapes', 'omo-valley',
  'Culturally rich southern corridor featuring diverse ethnic traditions, ceremonial events, and community-led cultural interpretation.',
  'Ethnographic journeys through southern Ethiopia',
  '/uploads/omo-valley-1.jpg', 'Cultural', 5.5000, 36.0000, 4.71, 690, '4-6 days', 'Moderate',
  ARRAY['Community visits', 'Ceremonial calendars', 'Cultural etiquette briefings', 'Local market circuits', 'Portrait-focused experiences', 'Responsible cultural tourism'],
  ARRAY['Community liaison guide', 'Ground transport', 'Accommodation planning', 'Cultural access fees', 'Translation support', 'Safety briefings'],
  ARRAY['Personal gifts', 'Premium camera permissions', 'Visa costs', 'Travel insurance', 'Laundry services', 'Optional domestic flights'],
  'September to March', true, true),
(1, 'Bale Mountains National Park', 'bale-mountains',
  'Afro-alpine plateau ecosystem with rare mammals, moorland trekking, and strong potential for specialized birding expeditions.',
  'Afro-alpine biodiversity and premium trekking routes',
  '/uploads/bale-mountains-1.jpg', 'Nature', 6.8333, 39.7500, 4.74, 540, '2-4 days', 'Moderate',
  ARRAY['Afro-alpine habitats', 'Endemic mammals', 'Birding hotspots', 'Scenic moorlands', 'Forest trails', 'Conservation research zones'],
  ARRAY['Park access', 'Local naturalist guide', 'Vehicle support', 'Picnic logistics', 'Water provisions', 'Trip coordination'],
  ARRAY['Binocular rental', 'Insurance', 'Visa expenses', 'Personal equipment', 'Tips', 'Private room upgrades'],
  'October to February', false, true),
-- Kenya
(2, 'Maasai Mara National Reserve', 'maasai-mara',
  'Iconic reserve known for predator density, migration dynamics, and professionally managed safari concessions.',
  'Flagship safari reserve with migration action',
  '/uploads/maasai-mara-1.jpg', 'Wildlife', -1.4061, 35.0167, 4.96, 3100, '3-5 days', 'Easy',
  ARRAY['Big Five tracking', 'Migration crossings', 'Game-drive circuits', 'Maasai community visits', 'Sunrise drives', 'Aerial safari options'],
  ARRAY['Professional guide', 'Reserve entry fees', 'Shared safari vehicle', 'Daily game drives', 'Bottled water', 'Operational support'],
  ARRAY['Balloon safari fees', 'Premium drinks', 'Visa fees', 'Insurance', 'Tips', 'International flights'],
  'July to October', true, true),
(2, 'Amboseli National Park', 'amboseli',
  'Elephant-rich ecosystem with uninterrupted views of Kilimanjaro and extensive wetland-driven biodiversity.',
  'Elephants and iconic Kilimanjaro panoramas',
  '/uploads/amboseli-1.jpg', 'Wildlife', -2.6527, 37.2606, 4.84, 1980, '2-3 days', 'Easy',
  ARRAY['Elephant family herds', 'Kilimanjaro viewpoints', 'Wetland birdlife', 'Open savannah drives', 'Cultural village extensions', 'Photographic hides'],
  ARRAY['Park permits', 'Driver-guide', 'Game drives', 'Transfer coordination', 'Refreshments', 'Support hotline'],
  ARRAY['Premium camera gear', 'Personal insurance', 'Visa', 'Optional charter flights', 'Laundry', 'Tips'],
  'June to October', true, true),
(2, 'Diani Beach & South Coast', 'diani-beach',
  'Indian Ocean coastal destination with reef activities, white-sand beaches, and luxury leisure infrastructure.',
  'East Africa''s premier beach extension',
  '/uploads/diani-1.jpg', 'Beach', -4.3167, 39.5667, 4.80, 2140, '3-6 days', 'Easy',
  ARRAY['Coral reef snorkeling', 'Kite and paddle sports', 'Beachfront resorts', 'Colobus conservation zones', 'Sunset dhow options', 'Spa and wellness'],
  ARRAY['Beach resort coordination', 'Airport-hotel transfers', 'Excursion booking support', 'Breakfast package', 'Safety briefing', 'Local concierge'],
  ARRAY['Marine park surcharges', 'Alcoholic beverages', 'Visa fees', 'Insurance', 'Premium excursions', 'Personal shopping'],
  'January to March; June to October', false, true),
(2, 'Lake Nakuru National Park', 'lake-nakuru',
  'Compact Rift Valley reserve recognized for rhino conservation, birdlife concentrations, and efficient safari accessibility.',
  'Rift Valley sanctuary for rhino and birding',
  '/uploads/nakuru-1.jpg', 'Wildlife', -0.3667, 36.0833, 4.73, 1290, '1-2 days', 'Easy',
  ARRAY['Black and white rhino', 'Rift escarpment scenery', 'Lake-edge birdlife', 'Leopard sightings', 'Baboon cliffs', 'Day-safari convenience'],
  ARRAY['Park entry', 'Guide services', 'Game drives', 'Picnic logistics', 'Bottled water', 'Transport support'],
  ARRAY['Private guide supplements', 'Insurance', 'Visa', 'Tips', 'Premium meals', 'Personal purchases'],
  'Year-round', false, true),
(2, 'Lamu Old Town & Archipelago', 'lamu-island',
  'UNESCO Swahili heritage destination blending coastal culture, dhow traditions, and relaxed island pacing.',
  'Historic Swahili culture and island leisure',
  '/uploads/lamu-1.jpg', 'Cultural', -2.2717, 40.9020, 4.81, 910, '2-4 days', 'Easy',
  ARRAY['UNESCO old town walks', 'Dhow sunset cruises', 'Swahili architecture', 'Island beaches', 'Cultural cuisine', 'Festival-ready itineraries'],
  ARRAY['Heritage walking guide', 'Boat logistics', 'Accommodation handling', 'Transfer planning', 'Cultural orientation', 'Trip support'],
  ARRAY['Festival premiums', 'Insurance', 'Visa', 'Tips', 'Alcoholic beverages', 'Luxury upgrades'],
  'Year-round', false, true),
-- Tanzania
(3, 'Serengeti National Park', 'serengeti',
  'Global benchmark safari ecosystem with extensive predator populations and annual migration cycles.',
  'Legendary plains safari with migration dynamics',
  '/uploads/serengeti-1.jpg', 'Wildlife', -2.3333, 34.8333, 4.97, 3520, '4-7 days', 'Easy',
  ARRAY['Migration corridors', 'Predator encounters', 'Acacia savannah drives', 'Balloon routes', 'Luxury camp zones', 'Photographic itineraries'],
  ARRAY['Park fees', 'Guide and vehicle', 'Game drives', 'Camp logistics', 'Water supply', 'Operations support'],
  ARRAY['Balloon add-on', 'Insurance', 'Visa', 'Alcoholic beverages', 'Tips', 'International flights'],
  'June to October; December to March', true, true),
(3, 'Mount Kilimanjaro', 'kilimanjaro',
  'Africa''s highest summit expedition with multi-route ascents, acclimatization protocols, and mountain safety planning.',
  'High-altitude expedition to Africa''s highest peak',
  '/uploads/kilimanjaro-1.jpg', 'Adventure', -3.0674, 37.3556, 4.91, 2290, '6-9 days', 'Challenging',
  ARRAY['Summit objective', 'Acclimatization design', 'Multi-route options', 'Glacier viewpoints', 'Camp progression', 'Altitude safety systems'],
  ARRAY['Park and rescue fees', 'Mountain guides', 'Porter team', 'Camping equipment', 'Meals on trek', 'Emergency protocols'],
  ARRAY['Personal climbing gear', 'Insurance', 'Visa', 'Hotel before/after trek', 'Tips', 'Private toilet tent'],
  'January to March; June to October', true, true),
(3, 'Zanzibar Island', 'zanzibar',
  'Indian Ocean extension combining Stone Town heritage, reef activities, and high-end beach inventory.',
  'Historic island culture with premium beach escapes',
  '/uploads/zanzibar-1.jpg', 'Beach', -6.1659, 39.2026, 4.86, 2760, '4-7 days', 'Easy',
  ARRAY['Stone Town heritage', 'Spice estates', 'Coral reefs', 'Dhow sailing', 'Boutique resorts', 'Beach leisure'],
  ARRAY['Island transfers', 'Accommodation handling', 'Guide services', 'Orientation tour', 'Breakfast plan', 'Support team'],
  ARRAY['Marine activity fees', 'Insurance', 'Visa', 'Premium dining', 'Tips', 'Personal shopping'],
  'June to October; December to February', true, true),
(3, 'Ngorongoro Conservation Area', 'ngorongoro-crater',
  'Volcanic caldera ecosystem with concentrated wildlife viewing and integrated conservation-use planning.',
  'World-famous crater floor game viewing',
  '/uploads/ngorongoro-1.jpg', 'Wildlife', -3.2000, 35.5000, 4.89, 2410, '1-2 days', 'Easy',
  ARRAY['Crater floor safaris', 'Dense wildlife populations', 'Scenic rim overlooks', 'Birding opportunities', 'Cultural boma add-ons', 'High-yield sightings'],
  ARRAY['Conservation fees', 'Guide and transport', 'Descent permits', 'Game drive logistics', 'Packed lunch', 'Operational support'],
  ARRAY['Insurance', 'Visa', 'Tips', 'Premium beverages', 'Private guide surcharge', 'Flight costs'],
  'June to September; December to February', true, true),
(3, 'Ruaha National Park', 'ruaha-national-park',
  'Low-density southern circuit park favored for exclusive game drives and strong predator-prey interactions.',
  'Remote wilderness safari with fewer vehicles',
  '/uploads/ruaha-1.jpg', 'Wildlife', -7.7500, 34.9500, 4.78, 860, '3-4 days', 'Moderate',
  ARRAY['Remote safari experience', 'Lion-pride territories', 'Baobab landscapes', 'Riverine birdlife', 'Walking safari options', 'Exclusive camps'],
  ARRAY['Park access', 'Guide and vehicle', 'Camp coordination', 'Game drives', 'Water supplies', 'Safety briefings'],
  ARRAY['Charter supplements', 'Insurance', 'Visa', 'Tips', 'Laundry', 'Premium drinks'],
  'June to October', false, true),
-- Uganda
(4, 'Bwindi Impenetrable Forest', 'bwindi-impenetrable-forest',
  'Mountain gorilla habitat with strict permit systems, high-value conservation impact, and elite trekking experiences.',
  'Premium gorilla trekking in ancient rainforest',
  '/uploads/bwindi-1.jpg', 'Wildlife', -1.0520, 29.6200, 4.95, 1830, '2-4 days', 'Challenging',
  ARRAY['Gorilla family tracking', 'Conservation permits', 'Rainforest immersion', 'Community tourism projects', 'Porter support options', 'Photography briefings'],
  ARRAY['Gorilla permit handling', 'Expert tracker guide', 'Park access', 'Transfer logistics', 'Accommodation planning', 'Pre-trek briefing'],
  ARRAY['Visa fees', 'Insurance', 'Personal porter fees', 'Tips', 'Premium lodges', 'Personal equipment'],
  'June to August; December to February', true, true),
(4, 'Queen Elizabeth National Park', 'queen-elizabeth-national-park',
  'Diverse park system offering savannah game drives, Kazinga Channel boat safaris, and crater-lake landscapes.',
  'Multi-ecosystem safari with boat and game drive mix',
  '/uploads/queen-elizabeth-1.jpg', 'Wildlife', -0.1925, 30.0919, 4.79, 1040, '2-3 days', 'Easy',
  ARRAY['Kazinga Channel cruises', 'Tree-climbing lion sector', 'Savannah circuits', 'Birding records', 'Crater-lake views', 'Chimp tracking extensions'],
  ARRAY['Park permits', 'Guide and driver', 'Boat safari booking', 'Transport coordination', 'Water provisions', 'Support operations'],
  ARRAY['Chimp permits', 'Insurance', 'Visa', 'Tips', 'Premium drinks', 'Private charter transfers'],
  'Year-round', true, true),
(4, 'Murchison Falls National Park', 'murchison-falls',
  'Uganda''s largest park featuring Nile delta game viewing and one of the region''s most powerful waterfall systems.',
  'Nile delta safaris and dramatic waterfall encounters',
  '/uploads/murchison-1.jpg', 'Wildlife', 2.3000, 31.7500, 4.76, 980, '2-4 days', 'Easy',
  ARRAY['Murchison Falls viewpoints', 'Nile boat cruises', 'Delta wildlife zones', 'Savannah game drives', 'Top-of-falls hike', 'Birding hotspots'],
  ARRAY['Park entry', 'Boat permits', 'Guide services', 'Game drives', 'Ground transfers', 'Trip support'],
  ARRAY['Insurance', 'Visa', 'Tips', 'Premium beverages', 'Optional charter', 'Personal gear'],
  'December to February; June to September', false, true),
(4, 'Jinja & Source of the Nile', 'jinja-source-of-the-nile',
  'Adventure and leisure hub centered on white-water rafting, river activities, and boutique riverside stays.',
  'Nile adventure capital with rafting and river leisure',
  '/uploads/jinja-1.jpg', 'Adventure', 0.4478, 33.2026, 4.70, 1320, '1-3 days', 'Moderate',
  ARRAY['White-water rafting', 'River kayaking', 'Sunset cruises', 'Bungee options', 'Adventure safety systems', 'Riverside hospitality'],
  ARRAY['Activity coordination', 'Safety equipment', 'Transfer planning', 'Guide support', 'Hydration package', 'Operations desk'],
  ARRAY['Insurance', 'Visa', 'Premium adventure bundles', 'Tips', 'Personal shopping', 'Alcoholic drinks'],
  'Year-round', false, true),
(4, 'Kidepo Valley National Park', 'kidepo-valley-national-park',
  'Remote northeastern wilderness with low visitor density, dramatic mountain backdrops, and unique arid-zone wildlife.',
  'Remote frontier safari for advanced explorers',
  '/uploads/kidepo-1.jpg', 'Wildlife', 3.7000, 33.9500, 4.82, 610, '3-5 days', 'Moderate',
  ARRAY['Exclusive game drives', 'Arid savannah species', 'Mountain panoramas', 'Karamoja culture links', 'Night-sky photography', 'Remote-lodge stays'],
  ARRAY['Park permits', 'Guide and vehicle', 'Logistics planning', 'Ground support', 'Meals coordination', 'Security briefings'],
  ARRAY['Insurance', 'Visa', 'Charter flight add-ons', 'Tips', 'Premium beverages', 'Personal equipment'],
  'December to March', true, true),
-- Rwanda
(5, 'Volcanoes National Park', 'volcanoes-national-park',
  'High-end mountain gorilla destination with strict sustainability controls and premium trekking operations.',
  'Rwanda''s flagship gorilla and volcano ecosystem',
  '/uploads/volcanoes-rwanda-1.jpg', 'Wildlife', -1.4833, 29.5500, 4.96, 2100, '2-3 days', 'Challenging',
  ARRAY['Gorilla encounters', 'Golden monkey tracking', 'Volcanic ridge trails', 'Dian Fossey legacy sites', 'Conservation financing', 'Luxury lodge portfolio'],
  ARRAY['Permit processing', 'Expert park guide', 'Trek logistics', 'Transport support', 'Briefings', 'On-ground coordination'],
  ARRAY['Insurance', 'Visa', 'Tips', 'Premium add-ons', 'Personal porter fees', 'Private transfers'],
  'June to September; December to February', true, true),
(5, 'Nyungwe Forest National Park', 'nyungwe-forest-national-park',
  'One of Africa''s oldest montane rainforests featuring canopy walks, chimp tracking, and extensive biodiversity corridors.',
  'Montane rainforest with canopy and primate experiences',
  '/uploads/nyungwe-1.jpg', 'Nature', -2.4833, 29.2000, 4.83, 990, '2-3 days', 'Moderate',
  ARRAY['Canopy walkway', 'Chimp trekking', 'Birding endemics', 'Tea-estate landscapes', 'Forest trail network', 'Conservation interpretation'],
  ARRAY['Park permits', 'Guide support', 'Trail logistics', 'Transport planning', 'Orientation briefing', 'Operations support'],
  ARRAY['Insurance', 'Visa', 'Tips', 'Premium accommodation upgrades', 'Personal gear', 'Optional add-ons'],
  'June to September', true, true),
(5, 'Akagera National Park', 'akagera-national-park',
  'Restored savannah ecosystem with successful predator reintroduction and easy-access game viewing from Kigali.',
  'Conservation success story with Big Five viewing',
  '/uploads/akagera-1.jpg', 'Wildlife', -1.9000, 30.7000, 4.78, 920, '1-2 days', 'Easy',
  ARRAY['Big Five restoration', 'Lake circuits', 'Boat safaris', 'Day-safari efficiency', 'Scenic wetlands', 'Community-linked conservation'],
  ARRAY['Park entry', 'Guide and vehicle', 'Game-drive operations', 'Water provision', 'Transport coordination', 'Support services'],
  ARRAY['Insurance', 'Visa', 'Tips', 'Premium meals', 'Private guide supplements', 'Accommodation upgrades'],
  'Year-round', false, true),
(5, 'Lake Kivu & Karongi', 'lake-kivu-karongi',
  'Lakefront relaxation destination with kayaking, coffee experiences, and boutique wellness-oriented lodges.',
  'Scenic lake leisure and soft adventure extension',
  '/uploads/lake-kivu-1.jpg', 'Beach', -2.0700, 29.3500, 4.72, 740, '2-4 days', 'Easy',
  ARRAY['Kayak coastlines', 'Island visits', 'Coffee farm links', 'Wellness stays', 'Sunset lake cruises', 'Cycling routes'],
  ARRAY['Accommodation support', 'Transfer planning', 'Activity coordination', 'Breakfast inclusion', 'Local assistance', 'Travel briefings'],
  ARRAY['Insurance', 'Visa', 'Tips', 'Premium excursions', 'Personal purchases', 'Alcoholic drinks'],
  'June to September', false, true),
(5, 'Kigali City & Memorial Experience', 'kigali-city-memorial',
  'Modern, clean, and efficient capital experience combining design-forward hospitality, culinary growth, and essential historical learning.',
  'Urban culture, cuisine, and responsible memory tourism',
  '/uploads/kigali-1.jpg', 'Urban', -1.9441, 30.0619, 4.75, 1110, '1-2 days', 'Easy',
  ARRAY['Kigali Genocide Memorial', 'Contemporary art spaces', 'Specialty coffee trails', 'Local design markets', 'City safety and cleanliness', 'Urban food scene'],
  ARRAY['City guide', 'Transport support', 'Entry coordination', 'Cultural orientation', 'Operational assistance', 'Day-plan optimization'],
  ARRAY['Insurance', 'Visa', 'Premium dining', 'Tips', 'Personal shopping', 'Private security upgrade'],
  'Year-round', true, true);

-- Upgrade destination media to online, location-based URLs.
UPDATE destinations
SET
  image_url = 'https://source.unsplash.com/1600x900/?' || REPLACE(slug, '-', '+') || '+travel',
  image_urls = ARRAY[
    'https://source.unsplash.com/1600x900/?' || REPLACE(slug, '-', '+') || '+travel',
    'https://source.unsplash.com/1600x900/?' || REPLACE(slug, '-', '+') || '+landscape',
    'https://source.unsplash.com/1600x900/?' || REPLACE(slug, '-', '+') || '+nature'
  ];

-- ═══════════════════════════════════════════════════════════════
-- 4. DESTINATION IMAGES
-- ═══════════════════════════════════════════════════════════════
INSERT INTO destination_images (destination_id, image_url, thumbnail_url, caption, is_primary, sort_order)
SELECT
  d.id,
  u.image_url,
  REPLACE(u.image_url, '1600x900', '640x360'),
  d.name || ' image ' || u.sort_order,
  (u.sort_order = 1),
  u.sort_order
FROM destinations d
CROSS JOIN LATERAL unnest(d.image_urls) WITH ORDINALITY AS u(image_url, sort_order);

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
  'Kigali: A Complete Modern City Guide',
  'kigali-modern-city-guide',
  E'# Kigali: A Complete Modern City Guide\n\n## Don''t Miss\n- Kigali Genocide Memorial\n- Niyo Art Gallery\n- Kimironko Market\n- Nyamirambo cultural walk\n\n## Best Neighborhoods\n- Kiyovu\n- Kimihurura\n- Nyarutarama\n- Nyamirambo\n\nContact us to plan your Kigali city extension.',
  'Your complete guide to Kigali: culture, design, food, and responsible history experiences.',
  '/uploads/post-kigali.jpg', 'Sofia Mendes', '/uploads/team-sofia.jpg', 'Destinations',
  ARRAY['Kigali', 'Rwanda', 'City Guide'],
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
INSERT INTO tips (
  headline, slug, summary, body, category, trip_phase, audience, difficulty_level,
  priority_level, read_time_minutes, checklist, tags, icon, source_url, cta_text, cta_url,
  sort_order, is_featured, is_active
) VALUES
(
  'Build A Safari-Ready Packing System',
  'build-safari-ready-packing-system',
  'A layered packing framework that keeps luggage efficient while covering altitude shifts, safari dust, and evening temperature drops.',
  'Use a three-layer clothing model: breathable base, insulating mid-layer, and wind-resistant outer shell. Pack neutral tones, two quick-dry trousers, one warm fleece, and a compressible rain layer. Keep medication, documents, and power bank in cabin luggage. For camera users, carry silica gel packs for moisture control and a dust brush for lenses.',
  'Packing',
  'pre-trip',
  'all-travelers',
  'all-levels',
  1,
  5,
  ARRAY['Pack neutral lightweight layers', 'Separate cabin essentials', 'Include cold-morning layer', 'Use soft duffel for bush flights', 'Carry universal adapters'],
  ARRAY['packing', 'safari', 'gear', 'planning'],
  'luggage',
  'https://www.iata.org/',
  'Message us for a personalized packing checklist',
  'https://wa.me/254700000000',
  1,
  true,
  true
),
(
  'Plan Health & Vaccination Timeline Early',
  'plan-health-vaccination-timeline-early',
  'A practical medical timeline that reduces travel risk and prevents last-minute vaccine or prescription delays.',
  'Book a travel clinic appointment 4-6 weeks before departure. Confirm yellow fever requirements, discuss malaria prophylaxis based on your exact route, and prepare a personal medication summary letter. Carry a compact first-aid kit with oral rehydration salts, antihistamines, and blister care.',
  'Health',
  'pre-trip',
  'all-travelers',
  'all-levels',
  1,
  4,
  ARRAY['Book travel clinic visit', 'Check yellow fever rules', 'Start malaria plan', 'Prepare medication letter', 'Pack personal first-aid kit'],
  ARRAY['health', 'vaccines', 'malaria', 'safety'],
  'shield',
  'https://www.who.int/',
  'Ask us for destination-specific health prep',
  'https://wa.me/254700000000',
  2,
  true,
  true
),
(
  'Use Wildlife Viewing Etiquette That Protects Both Guests And Animals',
  'wildlife-viewing-ethics-guide',
  'Field-tested behavior standards for responsible sightings and safer safari operations.',
  'Maintain quiet observation when predators are active, avoid sudden standing in open vehicles, and never request off-track driving where it is prohibited. Respect animal right-of-way at crossings and avoid flash photography at close range. Ethical behavior improves long-term conservation outcomes and often leads to better, calmer sightings.',
  'Safety',
  'on-trip',
  'all-travelers',
  'all-levels',
  1,
  4,
  ARRAY['Follow guide instructions', 'Keep noise low during sightings', 'Avoid flash at close range', 'Do not feed wildlife', 'Respect park driving rules'],
  ARRAY['safety', 'wildlife', 'ethics', 'conservation'],
  'paw',
  'https://www.iucn.org/',
  'Chat with us about responsible safari conduct',
  'https://wa.me/254700000000',
  3,
  true,
  true
),
(
  'Design Better Game Drives Around Light And Animal Behavior',
  'design-better-game-drives',
  'How to time daily drives for stronger sightings, better photos, and less travel fatigue.',
  'Prioritize dawn and late-afternoon drives when temperatures are lower and predator activity increases. Use midday for rest, backup charging, and route planning. For photographers, pair focal length strategy with light direction: wider glass at golden hour for environmental scenes, longer glass for behavior shots at distance.',
  'Field Strategy',
  'on-trip',
  'photographers',
  'intermediate',
  2,
  5,
  ARRAY['Leave before sunrise', 'Rest during midday heat', 'Reposition by light direction', 'Carry spare batteries', 'Log key sightings daily'],
  ARRAY['game-drive', 'photography', 'wildlife', 'timing'],
  'camera',
  'https://www.nationalgeographic.com/',
  'Get a custom photography-friendly itinerary',
  'https://wa.me/254700000000',
  4,
  false,
  true
),
(
  'Structure Travel Insurance For Remote East Africa Itineraries',
  'remote-east-africa-insurance-structure',
  'A checklist for selecting insurance that is adequate for remote parks, trekking, and regional flight changes.',
  'Confirm your policy includes emergency medical evacuation, trip interruption, missed regional connections, and adventure activities like trekking or rafting. Save digital and printed copies of policy numbers, emergency phone lines, and claim procedures. Insurance is most effective when you understand exclusions before departure.',
  'Planning',
  'pre-trip',
  'all-travelers',
  'all-levels',
  1,
  4,
  ARRAY['Verify evacuation coverage', 'Confirm adventure activity cover', 'Store emergency contacts offline', 'Read exclusions section', 'Keep policy docs in cloud + print'],
  ARRAY['insurance', 'risk-management', 'planning'],
  'file-text',
  'https://www.iatatravelcentre.com/',
  'Ask us what coverage levels we recommend',
  'https://wa.me/254700000000',
  5,
  true,
  true
),
(
  'Add Cultural Context To Every Destination Day',
  'add-cultural-context-daily',
  'Small intentional actions that create deeper, respectful cultural interactions across East Africa.',
  'Learn basic greetings before arrival, request community-led experiences, and ask permission before portrait photography. Choose local guides and artisan markets where possible so tourism spend remains in host communities. Cultural depth improves trip quality and contributes directly to sustainable local economies.',
  'Culture',
  'on-trip',
  'all-travelers',
  'all-levels',
  2,
  3,
  ARRAY['Learn local greetings', 'Ask consent before portraits', 'Support local artisans', 'Book community-led activities', 'Carry small denomination cash'],
  ARRAY['culture', 'responsible-travel', 'community'],
  'message-circle',
  'https://www.unwto.org/',
  'Ask for community-first itinerary options',
  'https://wa.me/254700000000',
  6,
  false,
  true
),
(
  'Manage Hydration, Sun, And Energy Across Multi-Day Safaris',
  'manage-hydration-sun-energy',
  'An easy daily protocol to reduce fatigue and keep decision quality high during long game-drive sequences.',
  'Start each morning with water and electrolytes, apply SPF 30+ before first drive, and reapply after lunch. Use brimmed hats and breathable sleeves to reduce heat load. Keep protein snacks accessible in your daypack to stabilize energy during extended sightings.',
  'Health',
  'on-trip',
  'all-travelers',
  'all-levels',
  2,
  3,
  ARRAY['Carry reusable bottle', 'Use electrolytes daily', 'Apply and reapply sunscreen', 'Wear sun-protective layers', 'Pack high-protein snacks'],
  ARRAY['hydration', 'sun-safety', 'wellbeing'],
  'droplet',
  'https://www.cdc.gov/',
  'Get our daily field health checklist',
  'https://wa.me/254700000000',
  7,
  false,
  true
),
(
  'Coordinate Documents, Cash, And Border Logistics Professionally',
  'coordinate-documents-cash-border-logistics',
  'A documentation workflow for multi-country East Africa itineraries with fewer delays and fewer errors.',
  'Keep passport validity above six months, maintain printed and digital visa confirmations, and carry proof of onward travel where required. Split emergency cash between wallet and luggage and inform your bank of travel dates. Organize transport vouchers, park permits, and insurance references in a single offline folder.',
  'Documents',
  'pre-trip',
  'all-travelers',
  'all-levels',
  1,
  4,
  ARRAY['Check passport validity', 'Store visa approvals offline', 'Carry backup cash', 'Inform your bank', 'Centralize permits and vouchers'],
  ARRAY['documents', 'visas', 'logistics', 'compliance'],
  'clipboard-list',
  'https://www.iata.org/en/services/compliance/timatic/',
  'Ask us for a country-by-country visa brief',
  'https://wa.me/254700000000',
  8,
  true,
  true
);

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
('Sunrise Over the Serengeti', 'Golden light across migration plains', '/uploads/gallery/serengeti-sunrise.jpg', '/uploads/gallery/thumb-serengeti-sunrise.jpg', 'Landscape', 'Serengeti', 3, 11, 'James Mwangi', 1, true, true),
('Elephant Herd in Amboseli', 'Elephants crossing with Kilimanjaro backdrop', '/uploads/gallery/elephants-amboseli.jpg', '/uploads/gallery/thumb-elephants-amboseli.jpg', 'Wildlife', 'Amboseli', 2, 7, 'James Mwangi', 2, true, true),
('Church of St. George', 'Cross-shaped church carved into Lalibela stone', '/uploads/gallery/lalibela-george.jpg', '/uploads/gallery/thumb-lalibela-george.jpg', 'Culture', 'Lalibela', 1, 1, 'Thomas Bekele', 3, true, true),
('Gorilla Trail in Bwindi', 'Trackers and trekkers in dense rainforest', '/uploads/gallery/bwindi-gorilla.jpg', '/uploads/gallery/thumb-bwindi-gorilla.jpg', 'Wildlife', 'Bwindi', 4, 16, 'Thomas Bekele', 4, true, true),
('Zanzibar Beach Sunset', 'Palm silhouettes along the Indian Ocean', '/uploads/gallery/zanzibar-sunset.jpg', '/uploads/gallery/thumb-zanzibar-sunset.jpg', 'Beach', 'Zanzibar', 3, 13, 'Sofia Mendes', 5, true, true),
('Lion at Maasai Mara', 'Early morning lion scan in open grasslands', '/uploads/gallery/mara-lion.jpg', '/uploads/gallery/thumb-mara-lion.jpg', 'Wildlife', 'Maasai Mara', 2, 6, 'James Mwangi', 6, true, true),
('Nyungwe Canopy Walk', 'Suspended bridge above montane forest canopy', '/uploads/gallery/nyungwe-canopy.jpg', '/uploads/gallery/thumb-nyungwe-canopy.jpg', 'Nature', 'Nyungwe', 5, 22, 'Sofia Mendes', 7, true, true),
('Kigali Design District', 'Modern urban spaces and local creative hubs', '/uploads/gallery/kigali-design.jpg', '/uploads/gallery/thumb-kigali-design.jpg', 'Urban', 'Kigali', 5, 25, 'Sofia Mendes', 8, true, true),
('Wildebeest Movement', 'Large herds traversing Serengeti corridor', '/uploads/gallery/migration.jpg', '/uploads/gallery/thumb-migration.jpg', 'Wildlife', 'Serengeti', 3, 11, 'James Mwangi', 9, true, true),
('Kidepo Valley Plains', 'Remote savannah framed by rugged ridges', '/uploads/gallery/kidepo.jpg', '/uploads/gallery/thumb-kidepo.jpg', 'Landscape', 'Kidepo Valley', 4, 20, 'Sofia Mendes', 10, true, true);

-- ═══════════════════════════════════════════════════════════════
-- 11. VIRTUAL TOURS
-- ═══════════════════════════════════════════════════════════════
INSERT INTO virtual_tours (title, slug, description, destination_id, video_url, thumbnail_url, duration, is_featured, sort_order, is_active) VALUES
('Lalibela Churches Virtual Walk', 'lalibela-virtual-walk', 'Explore Ethiopia''s sacred rock-hewn complexes with contextual narration.', 1, 'https://youtube.com/watch?v=example1', '/uploads/vt-lalibela.jpg', '12 min', true, 1, true),
('Serengeti Safari Experience', 'serengeti-safari-experience', 'Join a digital game drive across East Africa''s most iconic plains.', 11, 'https://youtube.com/watch?v=example2', '/uploads/vt-serengeti.jpg', '15 min', true, 2, true),
('Maasai Mara Migration', 'mara-migration-tour', 'Follow migration strategy and predator interactions in real time.', 6, 'https://youtube.com/watch?v=example3', '/uploads/vt-mara.jpg', '10 min', true, 3, true),
('Zanzibar Stone Town Walk', 'zanzibar-stone-town', 'Navigate historic alleys, markets, and seafront culture in Stone Town.', 13, 'https://youtube.com/watch?v=example4', '/uploads/vt-zanzibar.jpg', '8 min', false, 4, true),
('Nyungwe Canopy and Chimp Trail', 'nyungwe-canopy-trail', 'Aerial forest perspective and rainforest primate interpretation.', 22, 'https://youtube.com/watch?v=example5', '/uploads/vt-nyungwe.jpg', '10 min', true, 5, true);

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
('BK-240305-J1K2L3', 22, 4, 'Sarah Chen', 'sarah.c@email.com', '+86 10 12345678', '+861012345678', 'Chinese', '2024-10-05', '2024-10-12', 2, 'Luxury', 'Anniversary celebration', 'pending', 'Follow up on Nyungwe chimp and canopy experience preferences'),
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


