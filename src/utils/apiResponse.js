'use strict';

class ApiResponse {
  static success(res, data = null, message = 'Success', statusCode = 200, meta = {}) {
    const response = {
      success: true,
      message,
      ...(data !== null && { data }),
      ...meta,
    };
    return res.status(statusCode).json(response);
  }

  static created(res, data, message = 'Created successfully') {
    return ApiResponse.success(res, data, message, 201);
  }

  static paginated(res, data, pagination, message = 'Success') {
    const response = {
      success: true,
      message,
      data,
      pagination,
    };
    res.setHeader('X-Total-Count', pagination.total);
    res.setHeader('X-Total-Pages', pagination.totalPages);
    return res.status(200).json(response);
  }

  static noContent(res) {
    return res.status(204).send();
  }
}

module.exports = ApiResponse;