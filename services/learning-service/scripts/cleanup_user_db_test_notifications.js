const { MongoClient } = require('mongodb');

async function cleanup() {
  const uri = 'mongodb://admin:securepassword123@mongodb:27017/user_db?authSource=admin';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('user_db');
    const collection = db.collection('notifications');

    const beforeCount = await collection.countDocuments();
    console.log('Total notifications before cleanup:', beforeCount);

    const result = await collection.deleteMany({
      $or: [
        { title: { $regex: '11/2024|12/2024|03/2026' } },
        { message: { $regex: '11/2024|12/2024|03/2026' } }
      ]
    });

    console.log(`Deleted ${result.deletedCount} test notifications from user_db.`);
    const afterCount = await collection.countDocuments();
    console.log('Remaining notifications in user_db:', afterCount);
  } finally {
    await client.close();
  }
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
