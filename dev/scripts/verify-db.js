/**
 * IndexedDB Verification Script for Gloss [NOT-7]
 *
 * PURPOSE: Validates that IndexedDB is correctly configured and operational.
 * This standalone script can be pasted into Chrome DevTools console to verify:
 * - Dexie.js is loaded
 * - KnowledgeClipperDB database can be opened
 * - Required tables (notes, metadata) exist
 * - Basic CRUD operations function correctly
 *
 * USAGE: Open Chrome DevTools in the extension panel, paste this entire file, and press Enter.
 */

(async function verifyIndexedDB() {
  console.log('🔍 Starting IndexedDB Verification...');

  const testNoteId = 'verify-test-' + Date.now();
  let verificationDb = null;

  try {
    // Step 1: Check if Dexie is available
    if (typeof Dexie === 'undefined') {
      console.error('❌ FAILED: Dexie.js is not loaded');
      return;
    }
    console.log('✅ Dexie.js found');

    // Step 2: Attempt to open the database
    verificationDb = new Dexie('KnowledgeClipperDB');
    verificationDb.version(1).stores({
      notes: 'id, timestamp, *tags',
      metadata: 'key'
    });

    await verificationDb.open();
    console.log('✅ Database "KnowledgeClipperDB" opened');

    // Step 3: Verify tables exist by checking schema
    const tables = verificationDb.tables.map(table => table.name);

    if (!tables.includes('notes')) {
      console.error('❌ FAILED: Table "notes" does not exist');
      return;
    }
    console.log('✅ Table "notes" exists');

    if (!tables.includes('metadata')) {
      console.error('❌ FAILED: Table "metadata" does not exist');
      return;
    }
    console.log('✅ Table "metadata" exists');

    // Step 4: Perform CRUD Test

    // CREATE (Write)
    const testNote = {
      id: testNoteId,
      text: 'Verification test note',
      userNote: 'This is a test note created by the verification script',
      tags: ['test', 'verification'],
      url: 'about:blank',
      timestamp: Date.now(),
      metadata: {
        title: 'Verification Test',
        siteName: 'Test'
      }
    };

    await verificationDb.notes.add(testNote);
    console.log('✅ CRUD Test: Write successful');

    // READ
    const retrievedNote = await verificationDb.notes.get(testNoteId);
    if (!retrievedNote || retrievedNote.id !== testNoteId) {
      console.error('❌ FAILED: CRUD Test - Read failed or returned incorrect data');
      return;
    }
    console.log('✅ CRUD Test: Read successful');

    // DELETE
    await verificationDb.notes.delete(testNoteId);
    const deletedCheck = await verificationDb.notes.get(testNoteId);
    if (deletedCheck !== undefined) {
      console.error('❌ FAILED: CRUD Test - Delete failed, note still exists');
      return;
    }
    console.log('✅ CRUD Test: Delete successful');

    // Step 5: Final validation
    console.log('🎉 Verification Complete: IndexedDB is healthy');

  } catch (error) {
    console.error('❌ Verification failed with error:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  } finally {
    // Cleanup: Close the database connection
    if (verificationDb) {
      verificationDb.close();
    }
  }
})();
