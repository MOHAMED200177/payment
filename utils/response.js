/**
 * Standard API envelope for new and migrated endpoints.
 * Legacy handlers may still return { status, data: { data } }.
 */
function sendSuccess(res, statusCode, payload = {}) {
  const { message, data, meta } = payload;
  const body = {
    success: true,
    status: 'success',
    ...(message && { message }),
    ...(data !== undefined && { data }),
    ...(meta && { meta }),
  };
  return res.status(statusCode).json(body);
}

function sendPaginated(res, { data, page, limit, total, message }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return res.status(200).json({
    success: true,
    status: 'success',
    ...(message && { message }),
    data,
    meta: {
      page,
      limit,
      total,
      pages,
      hasNextPage: page < pages,
      hasPrevPage: page > 1,
    },
  });
}

module.exports = { sendSuccess, sendPaginated };
