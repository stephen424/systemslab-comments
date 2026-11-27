process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.CORS_ORIGINS = 'http://localhost:5176';
process.env.APPS = 'practice,lifecycle';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/comments_test';
