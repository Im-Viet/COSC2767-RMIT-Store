const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  await mongoose.connect(uri, {
    useNewUrlParser: true, useUnifiedTopology: true,
  });
  mongoose.set('debug', true);
});

afterEach(async () => {
  const conn = mongoose.connection;
  if (conn.readyState !== 1) return; // not connected, skip cleanup
  const { collections } = conn;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongo) await mongo.stop();
});
