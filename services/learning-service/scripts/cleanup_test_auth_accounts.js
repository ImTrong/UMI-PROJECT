const { MongoClient, ObjectId } = require('mongodb');

async function cleanupTestAuthAccounts() {
  const uri = 'mongodb://admin:securepassword123@mongodb:27017/auth_db?authSource=admin';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db('auth_db');

    const testEmails = [
      'qa_student_isolated@elearning.local',
      'test_student_http_isolated@elearning.local'
    ];
    const testIds = [
      new ObjectId('6ad2be1185c6133a40b7543f'),
      new ObjectId('6ad2c1ff85c6133a40b75443')
    ];

    console.log('--- Cleaning Up Verified Test Accounts from auth_db ---');
    const delTokens = await db.collection('verification_tokens').deleteMany({ email: { $in: testEmails } });
    console.log(`Deleted verification tokens: ${delTokens.deletedCount}`);

    const delSessions = await db.collection('device_sessions').deleteMany({ userId: { $in: testIds } });
    console.log(`Deleted device sessions: ${delSessions.deletedCount}`);

    const delRefresh = await db.collection('refresh_tokens').deleteMany({ userId: { $in: testIds } });
    console.log(`Deleted refresh tokens: ${delRefresh.deletedCount}`);

    const delUsers = await db.collection('users').deleteMany({ _id: { $in: testIds } });
    console.log(`Deleted test users: ${delUsers.deletedCount}`);

    const remainingUsers = await db.collection('users').find({}, { projection: { email: 1, fullName: 1 } }).toArray();
    console.log('\nRemaining Users in auth_db:');
    console.log(JSON.stringify(remainingUsers, null, 2));

  } finally {
    await client.close();
  }
}

cleanupTestAuthAccounts().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
