// src/utils/pagination.js
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require('../config/constants');

class Pagination {
  constructor(query) {
    this.page = Math.max(1, parseInt(query.page, 10) || 1);
    this.limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE)
    );
    this.offset = (this.page - 1) * this.limit;
    this.sortBy = query.sortBy || 'created_at';
    this.sortOrder = query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    this.search = query.search || '';
  }

  getParams() {
    return {
      limit: this.limit,
      offset: this.offset,
      sortBy: this.sortBy,
      sortOrder: this.sortOrder,
      search: this.search,
    };
  }

  getMeta(totalCount) {
    const totalPages = Math.ceil(totalCount / this.limit);
    return {
      page: this.page,
      limit: this.limit,
      totalCount,
      totalPages,
      hasNextPage: this.page < totalPages,
      hasPrevPage: this.page > 1,
    };
  }
}

module.exports = Pagination;