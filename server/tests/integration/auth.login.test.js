const request = require('supertest');
const bcrypt = require('bcryptjs');
const buildTestApp = require('../helpers/buildTestApp');
const User = require('../../models/user');
const { EMAIL_PROVIDER } = require('../../constants');
const { ROLES } = require('../../constants');

const app = buildTestApp();

async function seedAdmin(email = 'admin@rmit.edu.vn', password = 'mypassword') {
  const hash = await bcrypt.hash(password, 10);
  return User.create({
    email,
    password: hash,
    provider: EMAIL_PROVIDER.Email,
    role: ROLES.Admin,
    firstName: 'admin',
    lastName: 'admin'
  });
}

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await seedAdmin();
  });

  const email = 'admin@rmit.edu.vn';
  const password = 'mypassword';

  test('logs in with valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
  });

  test('rejects invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });
});
