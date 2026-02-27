exports.cacheMiddleware = (duration) => {
  return (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    res.set("Cache-Control", `public, max-age=${duration}`);
    next();
  };
};