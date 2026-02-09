/**
 * [NOT-58] Test Data Generator
 * Run this in the browser console while the side panel is open
 * to create test notes for vector search testing
 *
 * IMPORTANT: Open the Klue side panel FIRST before running this script!
 */

async function generateTestNotesForVectorSearch() {
  // Check if database is available
  if (typeof window.database === 'undefined') {
    console.error('❌ ERROR: window.database is not available!');
    console.log('📝 Please make sure:');
    console.log('   1. The Klue side panel is OPEN');
    console.log('   2. You are running this in the side panel console (not the main page console)');
    console.log('   3. Wait a few seconds for the panel to fully load');
    console.log('\n💡 To open the side panel:');
    console.log('   - Click the Klue extension icon, OR');
    console.log('   - Right-click on any page → "Save to Klue"');
    return;
  }

  console.log('🧪 [NOT-58] Generating test data for vector search...');

  const testNotes = [
    {
      text: 'Introduction to React Hooks - useState and useEffect explained',
      userNote: 'Great tutorial on React hooks',
      tags: ['#react', '#javascript', '#tutorial', '#frontend'],
      url: 'https://react.dev/hooks',
      metadata: {
        title: 'React Hooks Tutorial',
        siteName: 'React.dev',
        favicon: 'https://react.dev/favicon.ico',
        flexible_metadata: {
          type: 'article',
          readingTime: '8 min read'
        }
      }
    },
    {
      text: 'Building modern web applications with React and TypeScript',
      userNote: 'Advanced React patterns',
      tags: ['#react', '#typescript', '#webdev'],
      url: 'https://example.com/react-ts',
      metadata: {
        title: 'React + TypeScript Best Practices',
        siteName: 'Dev Blog',
        favicon: 'https://example.com/favicon.ico',
        flexible_metadata: {
          type: 'article',
          readingTime: '12 min read'
        }
      }
    },
    {
      text: 'awesome-react - A curated list of React resources',
      userNote: 'Useful React resources',
      tags: ['#react', '#resources', '#awesome-list'],
      url: 'https://github.com/enaqx/awesome-react',
      metadata: {
        title: 'awesome-react',
        siteName: 'GitHub',
        favicon: 'https://github.com/favicon.ico',
        flexible_metadata: {
          type: 'repo',
          stars: 65432,
          language: 'JavaScript'
        }
      }
    },
    {
      text: 'React Tutorial for Beginners - Complete Crash Course',
      userNote: 'Good video tutorial',
      tags: ['#react', '#tutorial', '#video'],
      url: 'https://youtube.com/watch?v=example',
      metadata: {
        title: 'React Crash Course',
        siteName: 'YouTube',
        favicon: 'https://youtube.com/favicon.ico',
        flexible_metadata: {
          type: 'video',
          duration: '3:45:22'
        }
      }
    },
    {
      text: 'Python data science tutorial with pandas and numpy',
      userNote: 'Data analysis basics',
      tags: ['#python', '#datascience', '#pandas'],
      url: 'https://example.com/python-ds',
      metadata: {
        title: 'Python Data Science Tutorial',
        siteName: 'Data Blog',
        favicon: 'https://example.com/favicon.ico',
        flexible_metadata: {
          type: 'article',
          readingTime: '15 min read'
        }
      }
    }
  ];

  let count = 0;
  for (const noteData of testNotes) {
    const note = {
      id: crypto.randomUUID(),
      html: '',
      text: noteData.text,
      userNote: noteData.userNote,
      tags: noteData.tags,
      url: noteData.url,
      metadata: noteData.metadata,
      timestamp: Date.now() - (count * 60000),
      readLater: false,
      starred: false
    };

    await window.database.addNote(note);
    count++;
    console.log(`✅ Created note ${count}: ${noteData.metadata.title}`);
  }

  console.log(`\n🎉 Created ${count} test notes!`);
  console.log('📊 Now indexing them for vector search...');

  // Trigger reindexing
  const allNotes = await window.database.getAllNotes();
  const response = await chrome.runtime.sendMessage({
    action: 'REINDEX_ALL',
    allNotes: allNotes
  });

  if (response.success) {
    console.log('✅ Vector indexing complete!');
    console.log('\n🧪 Test data ready! Try capturing a React-related page to see suggestions.');
  } else {
    console.error('❌ Vector indexing failed:', response.error);
  }
}

// Run the generator
generateTestNotesForVectorSearch();
