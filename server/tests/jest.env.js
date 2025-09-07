// runs before test files are evaluated
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test_secret_123'; // any non-empty string
