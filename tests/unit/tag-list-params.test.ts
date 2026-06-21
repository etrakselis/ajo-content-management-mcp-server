import { tagListParams } from '../../src/adobe/unified-tags-client';

// The Unified Tags API NPEs when sortBy is sent without a sortOrder, so the param
// builder defaults sortOrder to 'asc' whenever sortBy is present.
describe('tagListParams sortOrder defaulting', () => {
  test('defaults sortOrder to "asc" when sortBy is given without one', () => {
    expect(tagListParams({ sortBy: 'name' })).toMatchObject({ sortBy: 'name', sortOrder: 'asc' });
  });

  test('respects an explicit sortOrder', () => {
    expect(tagListParams({ sortBy: 'name', sortOrder: 'desc' })).toMatchObject({ sortBy: 'name', sortOrder: 'desc' });
  });

  test('omits sortOrder entirely when there is no sortBy', () => {
    const out = tagListParams({ limit: 10 });
    expect(out).not.toHaveProperty('sortOrder');
    expect(out).not.toHaveProperty('sortBy');
  });
});
