const checkAuth = require('../../utils/auth');

describe('utils/auth.checkAuth', () => {
  test('returns null when Authorization header missing', async () => {
    const req = { headers: {} };
    const token = await checkAuth(req);
    expect(token).toBeNull();
  });

  test('returns decoded token when Authorization header present', async () => {
    const fakeJwt = 'Bearer my.token.payload';
    const req = { headers: { authorization: fakeJwt } };
    const token = await checkAuth(req);
    // jwt.decode will return string if not a real JWT; we still expect a non-null truthy value
    expect(token).toBeTruthy();
  });
});
