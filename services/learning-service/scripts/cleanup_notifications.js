const dbUser = db.getSiblingDB('user_db');
const res = dbUser.notifications.deleteMany({
  $or: [
    { title: { $regex: '11/2024|12/2024|11/2025|03/2026' } },
    { message: { $regex: '11/2024|12/2024|11/2025|03/2026' } }
  ]
});
print('Deleted test notifications:', res.deletedCount);
print('Remaining notifications in user_db:', dbUser.notifications.countDocuments());
