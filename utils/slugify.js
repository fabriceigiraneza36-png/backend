const toAsciiSlug = (input) => {
  const raw = String(input ?? "").trim();
  if (!raw) return "";

  const normalized = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  return normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
};

module.exports = toAsciiSlug;

