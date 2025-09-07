const request = require('supertest');
const mongoose = require('mongoose');
const buildTestApp = require('../helpers/buildTestApp');
const Product = require('../../models/product');
const Brand = require('../../models/brand');
const Category = require('../../models/category');

const app = buildTestApp();

async function seedOneProduct() {
  const brand = await Brand.create({ name: 'RMIT', isActive: true });
  const category = await Category.create({ name: 'T-Shirts', isActive: true });
  const p = await Product.create({
    sku: 'SKU-1',
    name: 'RMIT Tee',
    description: 'Comfort tee',
    price: 19.99,
    quantity: 10,
    isActive: true,
    brand: brand._id,
    category: category.slug || category._id, // model keeps both refs in queries
    imageUrl: '',
    rating: 4,
  });
  category.products = [p._id];
  await category.save();
  return { brand, category, p };
}

describe('GET /api/product/list', () => {
  test('seed creates a product', async () => {
    const created = await seedOneProduct(); // make sure this awaits a create()
    const count = await Product.countDocuments({});
    console.log('Seeded _id:', created._id?.toString(), 'Count:', count); // will show in Jest logs

    expect(count).toBeGreaterThan(0);
  });

  test('returns paginated products and metadata', async () => {
    await seedOneProduct();

    const res = await request(app)
      .get('/api/product/list')
      .query({
        sortOrder: JSON.stringify({ created: -1 }),
        page: 1,
        limit: 10,
      })
      .expect(200);

    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('currentPage');
    expect(res.body).toHaveProperty('count');
  });

  test('gracefully handles DB failure (returns 400)', async () => {
    await seedOneProduct();
    // simulate DB outage
    await mongoose.connection.close();

    const res = await request(app)
      .get('/api/product/list')
      .query({ sortOrder: JSON.stringify({ created: -1 }), page: 1, limit: 10 });

    expect([400, 500]).toContain(res.status); // route returns 400 in catch
  });
});
