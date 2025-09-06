const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const apiRoutes = require('../../routes/api'); // mounts /auth, /product, etc.

module.exports = function buildTestApp() {
  const app = express();
  app.use(cors());
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json());
  app.use('/api', apiRoutes); // BASE_API_URL is 'api' per .env.example
  return app;
};
