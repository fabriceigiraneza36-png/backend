exports.cacheMiddleware = (duration) => {
  return (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    if (req.headers.authorization) {
      res.set("Cache-Control", "no-store");
    } else {
      res.set("Cache-Control", `public, max-age=${duration}`);
    }

    next();
  };
};