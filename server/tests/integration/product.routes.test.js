const request = require('supertest');
const mongoose = require('mongoose');
const buildTestApp = require('../helpers/buildTestApp');
const Product = require('../../models/product');
const Brand = require('../../models/brand');
const Category = require('../../models/category');

const app = buildTestApp();

async function seedOneProduct() {
  // ensure slugs exist because the API does Category.findOne({ slug }) / Brand.findOne({ slug })
  const brand = await Brand.create({ name: 'RMIT', slug: 'rmit', isActive: true });
  const category = await Category.create({ name: 'T-Shirts', slug: 't-shirts', isActive: true });

  const p = await Product.create({
    sku: 'SKU-1',
    name: 'RMIT Tee',
    slug: 'rmit-tee',
    description: 'Comfort tee',
    price: 19.99,
    quantity: 10,
    isActive: true,
    brand: brand._id,          // product stores brand ObjectId
    category: category._id,
    averageRating: 4,          // store average rating
    imageUrl: ''
  });

  await Category.updateOne({ _id: category._id }, { $set: { products: [p._id] } });
  return { brand, category, p };
}

describe('GET /api/product/list', () => {
  test('seed creates a product', async () => {
    const { p } = await seedOneProduct();
    const count = await Product.countDocuments({});
    expect(count).toBeGreaterThan(0);
  });

  test('returns paginated products and metadata', async () => {
    await seedOneProduct();

    const res = await request(app)
      .get('/api/product/list')
      .query({
        sortOrder: JSON.stringify({ created: -1 }),
        rating: JSON.stringify(0),    // Product has 0 rating (no reviews)
        min: JSON.stringify(10),      // Lower than our product's price of 19.99
        max: JSON.stringify(25),      // Higher than our product's price of 19.99
      }).expect(200);

    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body).toHaveProperty('currentPage');
    expect(res.body).toHaveProperty('count');
  });


  test('gracefully handles DB failure (returns 400)', async () => {
    const spy = jest.spyOn(Product, 'aggregate').mockRejectedValue(new Error('db down'));

    await request(app)
      .get('/api/product/list')
      .query({
        sortOrder: JSON.stringify({ created: -1 }),
        rating: JSON.stringify(0),
        price: JSON.stringify({ min: 0, max: 999999 }),
        page: '1',
        limit: '10'
      })
      .expect(400);

    spy.mockRestore();
  });
});
