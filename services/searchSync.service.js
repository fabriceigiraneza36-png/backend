// services/searchSync.service.js
// Meilisearch sync service for tour data

const { query } = require('../config/db');
const { toursIndex } = require('../config/meilisearch');

/**
 * Transform a destination record from PostgreSQL to Meilisearch document format
 */
const transformTourForIndex = (dest) => ({
  id: dest.id,
  title: dest.title || dest.name,
  country: dest.country || '',
  price: dest.price || 0,
  duration: dest.duration || '',
  category: dest.category || '',
  description: (dest.description || '').substring(0, 500), // Limit description for search
  image: dest.image || '',
});

/**
 * Fetch all destinations from PostgreSQL
 */
const fetchAllTours = async () => {
  const result = await query(
    `SELECT 
      d.id,
      d.name AS title,
      d.description,
      d.category,
      d.duration_display AS duration,
      d.image_url AS image,
      d.price,
      c.name AS country
     FROM destinations d
     LEFT JOIN countries c ON d.country_id = c.id
     WHERE d.is_active = true 
     ORDER BY d.id ASC`
  );
  return result.rows;
};

/**
 * Sync all tours to Meilisearch index
 */
const syncAllToursToIndex = async () => {
  try {
    console.log('Fetching tours from PostgreSQL...');
    const tours = await fetchAllTours();
    console.log(`Found ${tours.length} tours to index`);

    if (tours.length === 0) {
      console.log('No tours to sync');
      return { success: true, synced: 0 };
    }

    // Transform tours to Meilisearch documents
    const documents = tours.map(transformTourForIndex);

    // Add/update documents in Meilisearch
    const task = await toursIndex.addDocuments(documents, {
      primaryKey: 'id',
    });

    console.log(`Sync task created: ${task.taskUid}`);
    console.log(`Indexed ${documents.length} tours`);

    // Wait for task completion
    await toursIndex.waitForTask(task.taskUid);
    console.log('Sync completed successfully');

    return { success: true, synced: documents.length, taskUid: task.taskUid };
  } catch (error) {
    console.error('Sync failed:', error);
    throw error;
  }
};

/**
 * Add or update a single tour in the index
 */
const addTourToIndex = async (tour) => {
  try {
    const document = transformTourForIndex(tour);
    const task = await toursIndex.addDocuments([document], {
      primaryKey: 'id',
    });
    await toursIndex.waitForTask(task.taskUid);
    console.log(`Tour ${tour.id} added to index`);
    return { success: true, taskUid: task.taskUid };
  } catch (error) {
    console.error(`Failed to add tour ${tour?.id} to index:`, error);
    throw error;
  }
};

/**
 * Update a tour in the index
 */
const updateTourInIndex = async (tour) => {
  try {
    const document = transformTourForIndex(tour);
    const task = await toursIndex.updateDocuments([document]);
    await toursIndex.waitForTask(task.taskUid);
    console.log(`Tour ${tour.id} updated in index`);
    return { success: true, taskUid: task.taskUid };
  } catch (error) {
    console.error(`Failed to update tour ${tour?.id} in index:`, error);
    throw error;
  }
};

/**
 * Delete a tour from the index
 */
const deleteTourFromIndex = async (tourId) => {
  try {
    const task = await toursIndex.deleteDocument(tourId);
    await toursIndex.waitForTask(task.taskUid);
    console.log(`Tour ${tourId} deleted from index`);
    return { success: true, taskUid: task.taskUid };
  } catch (error) {
    console.error(`Failed to delete tour ${tourId} from index:`, error);
    throw error;
  }
};

module.exports = {
  syncAllToursToIndex,
  addTourToIndex,
  updateTourInIndex,
  deleteTourFromIndex,
  fetchAllTours,
};
