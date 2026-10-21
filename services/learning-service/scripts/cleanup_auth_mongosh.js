const authDb = db.getSiblingDB('auth_db');

const testEmails = [
  'qa_student_isolated@elearning.local',
  'test_student_http_isolated@elearning.local'
];
const testIds = [
  ObjectId('6ad2be1185c6133a40b7543f'),
  ObjectId('6ad2c1ff85c6133a40b75443')
];

print('=== CLEANING UP VERIFIED TEST ACCOUNTS FROM auth_db ===');
const delTokens = authDb.verification_tokens.deleteMany({ email: { $in: testEmails } });
print('Deleted verification tokens:', delTokens.deletedCount);

const delSessions = authDb.device_sessions.deleteMany({ userId: { $in: testIds } });
print('Deleted device sessions:', delSessions.deletedCount);

const delRefresh = authDb.refresh_tokens.deleteMany({ userId: { $in: testIds } });
print('Deleted refresh tokens:', delRefresh.deletedCount);

const delUsers = authDb.users.deleteMany({ _id: { $in: testIds } });
print('Deleted test users:', delUsers.deletedCount);

print('\nRemaining Users in auth_db:');
print(JSON.stringify(authDb.users.find({}, { email: 1, fullName: 1 }).toArray(), null, 2));
