// Database Module - IndexedDB with Dexie.js
// Note: This file uses global Dexie - Service Worker must use storage-service.js instead
console.log('💾 Database module loading...');

// Dexie must be loaded via script tag (only works in DOM context)
if (typeof window.Dexie === 'undefined') {
    throw new Error('Dexie not loaded - ensure dexie.js script is loaded before database.js');
}

// Access global Dexie
const Dexie = window.Dexie;

// Initialize Dexie
export const db = new Dexie('KnowledgeClipperDB');

// Define schema
db.version(1).stores({
    notes: 'id, timestamp, *tags', // Primary key: id, Indexed: timestamp, Multi-entry index: tags
    metadata: 'key' // Store app metadata (migration flag, filter state, etc.)
});

// [NOT-18] Version 2: Add readLater index for efficient filtering
db.version(2).stores({
    notes: 'id, timestamp, *tags, readLater', // Added readLater index
    metadata: 'key'
});

// [NOT-25] Version 3: Add starred index for efficient filtering
db.version(3).stores({
    notes: 'id, timestamp, *tags, readLater, starred', // Added starred index
    metadata: 'key'
});

// [NOT-33] Version 4: Multi-image support (no new indexes, just schema structure change)
db.version(4).stores({
    notes: 'id, timestamp, *tags, readLater, starred', // No index changes
    metadata: 'key'
}).upgrade(async (tx) => {
    // [NOT-33] Migrate imageData (single string) to images (array of objects)
    console.log('🔄 [NOT-33] Migrating imageData to images array...');

    const notes = await tx.table('notes').toArray();
    let migratedCount = 0;

    for (const note of notes) {
        if (note.imageData && typeof note.imageData === 'string') {
            // Convert single imageData to images array
            note.images = [{
                id: crypto.randomUUID(),
                data: note.imageData,
                timestamp: note.timestamp || Date.now()
            }];

            // Remove old imageData field
            delete note.imageData;

            // Update the note
            await tx.table('notes').put(note);
            migratedCount++;
        } else if (!note.images) {
            // Initialize empty images array for notes without images
            note.images = [];
            await tx.table('notes').put(note);
        }
    }

    console.log(`✅ [NOT-33] Migrated ${migratedCount} notes with images`);
});

// [NOT-39] Version 5: Add ignoredConnections table for semantic match feedback
db.version(5).stores({
    notes: 'id, timestamp, *tags, readLater, starred', // No index changes
    metadata: 'key',
    ignoredConnections: '++id, noteId, contextUrl' // Store user feedback about irrelevant semantic matches
});

// [NOT-38/Refactor] Version 6: Move vector index storage to Dexie
db.version(6).stores({
    notes: 'id, timestamp, *tags, readLater, starred', // No index changes
    metadata: 'key',
    ignoredConnections: '++id, noteId, contextUrl',
    oramaIndex: '++id, timestamp' // Store serialized Orama index blobs
});

// [NOT-46] Version 7: Add chat tables for AI assistant
db.version(7).stores({
    notes: 'id, timestamp, *tags, readLater, starred', // No index changes
    metadata: 'key',
    ignoredConnections: '++id, noteId, contextUrl',
    oramaIndex: '++id, timestamp',
    chats: '++id, createdAt, updatedAt', // Chat sessions
    messages: '++id, chatId, timestamp' // Messages within chats (chatId indexed for efficient queries)
});

// [NOT-57] Version 8: Add flexible_metadata JSON field for dynamic metadata
db.version(8).stores({
    notes: 'id, timestamp, *tags, readLater, starred', // No index changes
    metadata: 'key',
    ignoredConnections: '++id, noteId, contextUrl',
    oramaIndex: '++id, timestamp',
    chats: '++id, createdAt, updatedAt',
    messages: '++id, chatId, timestamp'
}).upgrade(async (tx) => {
    // [NOT-57] Backfill all existing notes with empty flexible_metadata object
    console.log('🔄 [NOT-57] Adding flexible_metadata field to all notes...');

    const notes = await tx.table('notes').toArray();
    let updatedCount = 0;

    for (const note of notes) {
        if (!note.flexible_metadata) {
            // Initialize with empty object
            note.flexible_metadata = {};
            await tx.table('notes').put(note);
            updatedCount++;
        }
    }

    console.log(`✅ [NOT-57] Added flexible_metadata to ${updatedCount} notes`);
});

console.log('✅ Database schema defined');

/**
 * [NOT-38/Refactor] Save Orama index to Dexie
 * @param {Object} serializedIndex - The serialized Orama index
 */
export async function saveOramaIndex(serializedIndex) {
    try {
        // We only keep the latest index, so clear old ones first
        await db.oramaIndex.clear();
        await db.oramaIndex.add({
            timestamp: Date.now(),
            data: serializedIndex
        });
        console.log('💾 [NOT-38] Orama index saved to Dexie');
    } catch (error) {
        console.error('❌ Error saving Orama index to Dexie:', error);
        throw error;
    }
}

/**
 * [NOT-38/Refactor] Load Orama index from Dexie
 * @returns {Promise<Object|null>} - Serialized index or null
 */
export async function loadOramaIndex() {
    try {
        const latest = await db.oramaIndex.orderBy('timestamp').reverse().first();
        return latest ? latest.data : null;
    } catch (error) {
        console.error('❌ Error loading Orama index from Dexie:', error);
        return null;
    }
}

/**
 * Data Migration - Move existing notes from chrome.storage.local to IndexedDB
 * This runs once when the extension updates to use IndexedDB
 */
export async function migrateFromChromeStorage() {
    console.log('🔄 Checking for data migration...');

    try {
        // Check if migration already happened using IndexedDB metadata
        const migrationRecord = await db.metadata.get('migration_completed');
        if (migrationRecord && migrationRecord.value === true) {
            console.log('✅ Migration already completed');
            return;
        }

        // Get existing notes from chrome.storage.local
        const { savedNotes = [] } = await chrome.storage.local.get('savedNotes');

        if (savedNotes.length > 0) {
            console.log(`🔄 Migrating ${savedNotes.length} notes from chrome.storage to IndexedDB...`);

            // Add all notes to IndexedDB
            await db.notes.bulkAdd(savedNotes);

            console.log('✅ Migration successful!');

            // Mark migration as complete in IndexedDB
            await db.metadata.put({ key: 'migration_completed', value: true });

            // Remove from chrome.storage to free up space
            await chrome.storage.local.remove('savedNotes');
        } else {
            console.log('📭 No existing notes to migrate');
            await db.metadata.put({ key: 'migration_completed', value: true });
        }
    } catch (error) {
        console.error('❌ Migration error:', error);
        // Don't set migration flag so it will retry next time
        throw error;
    }
}

/**
 * Add a new note
 * @param {Object} note - Note object with id, text, userNote, tags, url, metadata, timestamp
 * @param {Object} [note.flexible_metadata={}] - [NOT-57] Dynamic JSON object for domain-specific metadata (e.g., GitHub stars, YouTube duration)
 * @returns {Promise<string>} - Returns the note ID
 */
export async function addNote(note) {
    try {
        // [NOT-57] Ensure flexible_metadata exists (default to empty object)
        if (!note.flexible_metadata) {
            note.flexible_metadata = {};
        }

        const id = await db.notes.add(note);
        console.log('✅ Note added to IndexedDB:', id);
        return id;
    } catch (error) {
        console.error('❌ Error adding note:', error);
        throw error;
    }
}

/**
 * Get all notes
 * @returns {Promise<Array>} - Returns array of all notes
 */
export async function getAllNotes() {
    try {
        const notes = await db.notes.toArray();
        console.log(`📚 Retrieved ${notes.length} notes from IndexedDB`);
        return notes;
    } catch (error) {
        console.error('❌ Error getting notes:', error);
        throw error;
    }
}

/**
 * Delete a note by ID
 * @param {string} noteId - The ID of the note to delete
 * @returns {Promise<void>}
 */
export async function deleteNote(noteId) {
    try {
        await db.notes.delete(noteId);
        console.log('✅ Note deleted from IndexedDB:', noteId);
    } catch (error) {
        console.error('❌ Error deleting note:', error);
        throw error;
    }
}

/**
 * Get notes by tag
 * @param {string} tag - Tag to filter by
 * @returns {Promise<Array>} - Returns array of notes with the tag
 */
export async function getNotesByTag(tag) {
    try {
        const notes = await db.notes.where('tags').equals(tag).toArray();
        return notes;
    } catch (error) {
        console.error('❌ Error getting notes by tag:', error);
        throw error;
    }
}

/**
 * Search notes by text content
 * @param {string} query - Search query
 * @returns {Promise<Array>} - Returns array of matching notes
 */
export async function searchNotes(query) {
    try {
        const searchLower = query.toLowerCase();

        // Use Dexie's filter for better performance (executed in IndexedDB if possible)
        const results = await db.notes.filter(note => {
            const searchableText = [
                note.text || '',
                note.userNote || '',
                note.metadata?.siteName || '',
                note.metadata?.title || ''
            ].join(' ').toLowerCase();

            return searchableText.includes(searchLower);
        }).toArray();

        return results;
    } catch (error) {
        console.error('❌ Error searching notes:', error);
        throw error;
    }
}

/**
 * Update a note
 * @param {string} noteId - ID of note to update
 * @param {Object} updates - Object with fields to update
 * @returns {Promise<void>}
 */
export async function updateNote(noteId, updates) {
    try {
        await db.notes.update(noteId, updates);
        console.log('✅ Note updated in IndexedDB:', noteId);
    } catch (error) {
        console.error('❌ Error updating note:', error);
        throw error;
    }
}

/**
 * Get notes count
 * @returns {Promise<number>} - Returns total number of notes
 */
export async function getNotesCount() {
    try {
        return await db.notes.count();
    } catch (error) {
        console.error('❌ Error getting notes count:', error);
        throw error;
    }
}

/**
 * [NOT-39] Add an ignored connection to prevent showing semantic matches
 * @param {string} noteId - The ID of the note to ignore
 * @param {string} contextUrl - The URL context where this connection should be ignored
 * @returns {Promise<void>}
 */
export async function addIgnoredConnection(noteId, contextUrl) {
    try {
        await db.ignoredConnections.add({
            noteId,
            contextUrl,
            timestamp: Date.now()
        });
        console.log('✅ [NOT-39] Ignored connection added:', noteId, contextUrl);
    } catch (error) {
        console.error('❌ [NOT-39] Error adding ignored connection:', error);
        throw error;
    }
}

/**
 * [NOT-39] Check if a connection is ignored for a specific context
 * @param {string} noteId - The ID of the note to check
 * @param {string} contextUrl - The URL context to check
 * @returns {Promise<boolean>} - Returns true if connection is ignored
 */
export async function isConnectionIgnored(noteId, contextUrl) {
    try {
        const result = await db.ignoredConnections
            .where('noteId').equals(noteId)
            .and(item => item.contextUrl === contextUrl)
            .first();
        return !!result;
    } catch (error) {
        console.error('❌ [NOT-39] Error checking ignored connection:', error);
        return false;
    }
}

/**
 * [NOT-39] Get all ignored connections for a specific context
 * @param {string} contextUrl - The URL context
 * @returns {Promise<Array>} - Returns array of ignored note IDs
 */
export async function getIgnoredConnectionsForContext(contextUrl) {
    try {
        const results = await db.ignoredConnections
            .where('contextUrl').equals(contextUrl)
            .toArray();
        return results.map(item => item.noteId);
    } catch (error) {
        console.error('❌ [NOT-39] Error getting ignored connections:', error);
        return [];
    }
}

/**
 * [NOT-46] Create a new chat session
 * @param {string} title - The title of the chat
 * @param {string} modelId - The model identifier (e.g., "anthropic/claude-3.5-sonnet")
 * @returns {Promise<number>} - Returns the chat ID
 */
export async function createChat(title, modelId) {
    try {
        const now = Date.now();
        const id = await db.chats.add({
            title: title || 'New Chat',
            modelId: modelId || 'openrouter/auto',
            createdAt: now,
            updatedAt: now
        });
        console.log('✅ [NOT-46] Chat created:', id);
        return id;
    } catch (error) {
        console.error('❌ [NOT-46] Error creating chat:', error);
        throw error;
    }
}

/**
 * [NOT-46] Add a message to a chat
 * @param {number} chatId - The chat ID
 * @param {string} role - Message role ("user" or "assistant")
 * @param {string} content - Message content
 * @returns {Promise<number>} - Returns the message ID
 */
export async function addMessage(chatId, role, content) {
    try {
        const id = await db.messages.add({
            chatId,
            role,
            content,
            timestamp: Date.now()
        });

        // Update chat's updatedAt timestamp
        await db.chats.update(chatId, { updatedAt: Date.now() });

        console.log('✅ [NOT-46] Message added to chat:', chatId);
        return id;
    } catch (error) {
        console.error('❌ [NOT-46] Error adding message:', error);
        throw error;
    }
}

/**
 * [NOT-46] Get all messages for a chat
 * @param {number} chatId - The chat ID
 * @returns {Promise<Array>} - Returns array of messages ordered by timestamp
 */
export async function getChatHistory(chatId) {
    try {
        const messages = await db.messages
            .where('chatId').equals(chatId)
            .sortBy('timestamp');
        return messages;
    } catch (error) {
        console.error('❌ [NOT-46] Error getting chat history:', error);
        throw error;
    }
}

/**
 * [NOT-46] Get the most recent chat
 * @returns {Promise<Object|null>} - Returns the most recent chat or null
 */
export async function getLatestChat() {
    try {
        const chat = await db.chats.orderBy('updatedAt').reverse().first();
        return chat || null;
    } catch (error) {
        console.error('❌ [NOT-46] Error getting latest chat:', error);
        return null;
    }
}

/**
 * [NOT-46] Delete a chat and all its messages
 * @param {number} chatId - The chat ID
 * @returns {Promise<void>}
 */
export async function deleteChat(chatId) {
    try {
        // Delete all messages in the chat
        await db.messages.where('chatId').equals(chatId).delete();
        // Delete the chat itself
        await db.chats.delete(chatId);
        console.log('✅ [NOT-46] Chat deleted:', chatId);
    } catch (error) {
        console.error('❌ [NOT-46] Error deleting chat:', error);
        throw error;
    }
}

// Attach to window for compatibility during refactor
window.database = {
    db,
    migrateFromChromeStorage,
    addNote,
    getAllNotes,
    deleteNote,
    getNotesByTag,
    searchNotes,
    updateNote,
    getNotesCount,
    addIgnoredConnection,
    isConnectionIgnored,
    getIgnoredConnectionsForContext,
    saveOramaIndex,
    loadOramaIndex,
    createChat,
    addMessage,
    getChatHistory,
    getLatestChat,
    deleteChat
};

console.log('✅ Database module ready');
