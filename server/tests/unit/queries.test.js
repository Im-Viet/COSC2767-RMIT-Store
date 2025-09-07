const { getStoreProductsQuery } = require('../../utils/queries');

describe('utils/queries.getStoreProductsQuery', () => {
  test('builds pipeline with rating and price filters', () => {
    const pipeline = getStoreProductsQuery(10, 100, 4);
    const asString = JSON.stringify(pipeline);
    expect(asString).toContain('"price":{"$gte":10,"$lte":100}');
    // rating filter appears as $gte; function keeps structure even if rating falsy
    expect(asString).toContain('"averageRating":{"$gte":4}');
    // includes lookups / addFields stages
    expect(asString).toContain('$lookup');
    expect(asString).toContain('$addFields');
  });
});