// [NOT-58] Quick test - paste this in the side panel console

// First, verify database is available
if (!window.database) {
  console.error('❌ Run this in the SIDE PANEL console, not the page console!');
} else {
  console.log('✅ Database found! Creating test note...');

  // Create one simple test note
  window.database.addNote({
    id: crypto.randomUUID(),
    text: 'React Hooks Tutorial - Learn useState and useEffect',
    userNote: 'Great React tutorial',
    tags: ['#react', '#javascript', '#hooks'],
    url: 'https://react.dev/hooks',
    metadata: {
      title: 'React Hooks Tutorial',
      siteName: 'React.dev',
      favicon: 'https://react.dev/favicon.ico'
    },
    timestamp: Date.now(),
    readLater: false,
    starred: false,
    html: ''
  }).then(() => {
    console.log('✅ Test note created!');
    console.log('📝 Now capture a React-related page to see tag suggestions appear!');
  });
}
