// server/tests/setup.js
const mongoose = require('mongoose');

jest.setTimeout(20000);

afterEach(async () => {
  // Only clean when connected (1 = connected)
  if (mongoose.connection?.readyState === 1) {
    const { collections } = mongoose.connection;
    for (const key of Object.keys(collections)) {
      try {
        await collections[key].deleteMany({});
      } catch (e) {
        // ignore cleanup errors between connection churn
      }
    }
  }
});

afterAll(async () => {
  if (mongoose.connection?.readyState === 1) {
    await mongoose.connection.close();
  }
});
