const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "movies.json");
// Featured movies live in their own store, completely separate from the watchlist.
const FEATURED_FILE = path.join(__dirname, "featured.json");

// Create an empty database if it does not exist
if (!fs.existsSync(FILE)) {
  fs.writeFileSync(FILE, "[]");
}

if (!fs.existsSync(FEATURED_FILE)) {
  fs.writeFileSync(FEATURED_FILE, "[]");
}

// Read all movies
exports.read = () => {
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
};

// Save all movies
exports.write = (movies) => {
  fs.writeFileSync(FILE, JSON.stringify(movies, null, 2));
};

// Read the homepage featured movies (never the user's watchlist)
exports.readFeatured = () => {
  return JSON.parse(fs.readFileSync(FEATURED_FILE, "utf8"));
};

// Save the homepage featured movies
exports.writeFeatured = (movies) => {
  fs.writeFileSync(FEATURED_FILE, JSON.stringify(movies, null, 2));
};