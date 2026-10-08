
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const db = require("./db");

const app = express();
const publicDir = path.join(__dirname, "public");
// Curated homepage picks, resolved live from OMDb and cached in featured.json.
const FEATURED_TITLES = [
  "The Dark Knight",
  "Inception",
  "Interstellar",
  "Avengers: Endgame",
  "Dune: Part Two",
  "The Shawshank Redemption",
  "Spider-Man: Across the Spider-Verse",
  "Oppenheimer",
  "Whiplash",
  "Parasite"
];
const featuredCache = new Map();
const trailerSearchCache = new Map();
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const TMDB_API_KEY = (process.env.TMDB_API_KEY || "").trim();

function formatTrailerResult(videoId, title) {
  const sanitizedId = typeof videoId === "string" ? videoId.trim() : "";
  const validId = YOUTUBE_VIDEO_ID_PATTERN.test(sanitizedId) ? sanitizedId : "";

  return {
    videoId: validId,
    title: typeof title === "string" ? title : "",
    watchUrl: validId ? `https://www.youtube.com/watch?v=${validId}` : "",
    embeddable: Boolean(validId)
  };
}

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

async function enrichMovieWithMetadata(movie) {
  if (!movie || movie.imdbRating || !process.env.OMDB_API_KEY) {
    return movie;
  }

  try {
    const response = await axios.get("https://www.omdbapi.com/", {
      params: {
        apikey: process.env.OMDB_API_KEY,
        ...(movie.imdbID
          ? { i: movie.imdbID }
          : { t: movie.title, y: movie.year || undefined })
      }
    });
    const details = response.data;

    if (details?.Response === "True") {
      movie.imdbRating = details.imdbRating && details.imdbRating !== "N/A"
        ? details.imdbRating : "N/A";

      if (!movie.poster && details.Poster && details.Poster !== "N/A") {
        movie.poster = details.Poster;
      }

      if (!movie.imdbID && details.imdbID) {
        movie.imdbID = details.imdbID;
      }

      if ((!movie.genre || movie.genre === "Unknown") && details.Genre) {
        movie.genre = details.Genre;
      }
    }
  } catch (error) {
    console.warn(`Could not load OMDb rating for ${movie.title}:`, error.message);
  }

  return movie;
}

// READ - get all movies
app.get("/api/movies", async (req, res) => {
  const movies = db.read();
  const enrichedMovies = await Promise.all(
    movies.map(movie => enrichMovieWithMetadata(movie))
  );

  db.write(enrichedMovies);
  res.json(enrichedMovies);
});

// FEATURED - homepage picks, an entirely separate list from the watchlist
app.get("/api/featured", async (req, res) => {
  try {
    const cached = db.readFeatured();
    if (cached.length > 0) {
      return res.json(cached);
    }

    if (!process.env.OMDB_API_KEY) {
      return res.status(500).json({
        message: "OMDb API key is not configured."
      });
    }

    const seedResults = await Promise.all(FEATURED_TITLES.map(async title => {
      if (featuredCache.has(title)) return featuredCache.get(title);

      const response = await axios.get("https://www.omdbapi.com/", {
        params: { apikey: process.env.OMDB_API_KEY, t: title, plot: "short" }
      });

      const details = response.data;
      const featured = details?.Response === "True" && details.Type === "movie"
        ? {
          imdbID: details.imdbID,
          title: details.Title,
          year: details.Year,
          poster: details.Poster && details.Poster !== "N/A" ? details.Poster : "",
          imdbRating: details.imdbRating && details.imdbRating !== "N/A"
            ? details.imdbRating : "",
          plot: details.Plot && details.Plot !== "N/A" ? details.Plot : "",
          genre: details.Genre && details.Genre !== "N/A" ? details.Genre : "",
          released: details.Released && details.Released !== "N/A" ? details.Released : "",
          runtime: details.Runtime && details.Runtime !== "N/A" ? details.Runtime : "",
          director: details.Director && details.Director !== "N/A" ? details.Director : "",
          writer: details.Writer && details.Writer !== "N/A" ? details.Writer : "",
          actors: details.Actors && details.Actors !== "N/A" ? details.Actors : "",
          language: details.Language && details.Language !== "N/A" ? details.Language : "",
          country: details.Country && details.Country !== "N/A" ? details.Country : "",
          awards: details.Awards && details.Awards !== "N/A" ? details.Awards : "",
          metascore: details.Metascore && details.Metascore !== "N/A" ? details.Metascore : "",
          imdbVotes: details.imdbVotes && details.imdbVotes !== "N/A" ? details.imdbVotes : "",
          boxOffice: details.BoxOffice && details.BoxOffice !== "N/A" ? details.BoxOffice : "",
          rated: details.Rated && details.Rated !== "N/A" ? details.Rated : ""
        }
        : null;

      featuredCache.set(title, featured);
      return featured;
    }));

    const featuredMovies = seedResults.filter(Boolean);

    if (featuredMovies.length === 0) {
      return res.status(502).json({
        message: "Could not load featured movies right now."
      });
    }

    db.writeFeatured(featuredMovies);
    res.json(featuredMovies);
  } catch (error) {
    console.error("Featured movies lookup failed:", error.message);
    res.status(500).json({
      message: "Could not load featured movies. Please try again."
    });
  }
});

// Normalize a value for tolerant comparison (case, punctuation, spacing).
const normalizeForCompare = value => String(value ?? "")
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/['’]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

// Pull the 4-digit release year out of an OMDb year/release value.
const extractYear = value => {
  const match = String(value ?? "").match(/\d{4}/);
  return match ? match[0] : "";
};

// Detect an installment marker so we never return a different entry in a
// series ("Part Three" trailer when the user asked for "Part One").
const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const ROMAN_NUMBERS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10
};

function extractPartNumber(value) {
  const text = String(value ?? "").toLowerCase();

  const partMatch = text.match(/\bpart\s+(\d+|[a-z]+)\b/);
  if (partMatch) {
    const token = partMatch[1];
    const numeric = /^\d+$/.test(token)
      ? Number(token)
      : WORD_NUMBERS[token];
    if (numeric) return numeric;
  }

  // Only treat a bare roman numeral as an installment when it follows the
  // title words, e.g. "Star Wars Episode I".
  const romanMatch = text.match(/episode\s+([ivx]+)\b/);
  if (romanMatch && ROMAN_NUMBERS[romanMatch[1]]) {
    return ROMAN_NUMBERS[romanMatch[1]];
  }

  return null;
}

// Map an OMDb detail response onto the fields the watchlist stores.
function toWatchlistShape(details) {
  const value = key =>
    typeof details[key] === "string" && details[key] !== "N/A" ? details[key] : "";

  return {
    title: value("Title"),
    genre: value("Genre"),
    year: value("Year"),
    poster: value("Poster"),
    imdbID: value("imdbID"),
    imdbRating: value("imdbRating"),
    plot: value("Plot"),
    rated: value("Rated"),
    released: value("Released"),
    runtime: value("Runtime"),
    director: value("Director"),
    writer: value("Writer"),
    actors: value("Actors"),
    language: value("Language"),
    country: value("Country"),
    awards: value("Awards"),
    ratings: Array.isArray(details.Ratings) ? details.Ratings : [],
    metascore: value("Metascore"),
    imdbVotes: value("imdbVotes"),
    type: value("Type"),
    boxOffice: value("BoxOffice")
  };
}

async function fetchOmdbDetails(imdbID) {
  const response = await axios.get("https://www.omdbapi.com/", {
    params: { apikey: process.env.OMDB_API_KEY, i: imdbID, plot: "short" }
  });

  return response.data?.Response === "True" ? response.data : null;
}

async function fetchOmdbSearch(title, year) {
  const response = await axios.get("https://www.omdbapi.com/", {
    params: {
      apikey: process.env.OMDB_API_KEY,
      s: title,
      ...(year ? { y: year } : {})
    }
  });

  if (response.data?.Response === "False") return [];

  return Array.isArray(response.data?.Search) ? response.data.Search : [];
}

// VALIDATE - confirm a user-supplied title/year/genre really matches an OMDb movie.
// Returns the full OMDb record on success so the client saves official data.
app.post("/api/validate", async (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  const year = String(req.body?.year ?? "").trim();
  const genre = typeof req.body?.genre === "string" ? req.body.genre.trim() : "";

  if (!title) {
    return res.status(400).json({
      valid: false,
      reason: "empty",
      message: "Movie not found. Please enter a valid movie title."
    });
  }

  if (!process.env.OMDB_API_KEY) {
    return res.status(500).json({
      valid: false,
      reason: "omdb_key",
      message: "OMDb API key is not configured."
    });
  }

  try {
    let candidates = await fetchOmdbSearch(title, extractYear(year));

    // A wrong year can make OMDb return nothing, so retry without it and
    // report the year mismatch precisely instead of a generic "not found".
    if (candidates.length === 0 && year) {
      const withoutYear = await fetchOmdbSearch(title, "");
      if (withoutYear.length > 0) {
        return res.status(422).json({
          valid: false,
          reason: "year",
          message: "The movie year does not match the OMDb data.",
          closestTitle: withoutYear[0].Title,
          actualYear: withoutYear[0].Year
        });
      }
    }

    if (candidates.length === 0) {
      return res.status(404).json({
        valid: false,
        reason: "not_found",
        message: "Movie not found. Please enter a valid movie title."
      });
    }

    // Prefer an exact title match; otherwise take the best-ranked hit.
    const normalizedTitle = normalizeForCompare(title);
    const exactMatch = candidates.find(candidate =>
      normalizeForCompare(candidate.Title) === normalizedTitle
    );

    const chosen = exactMatch || candidates[0];
    const details = await fetchOmdbDetails(chosen.imdbID);

    if (!details) {
      return res.status(404).json({
        valid: false,
        reason: "not_found",
        message: "Movie not found. Please enter a valid movie title."
      });
    }

    if (details.Type && details.Type !== "movie") {
      return res.status(422).json({
        valid: false,
        reason: "not_movie",
        message: `"${details.Title}" is a ${details.Type}, not a movie.`
      });
    }

    if (year) {
      const submittedYear = extractYear(year);
      const actualYear = extractYear(details.Year) || extractYear(details.Released);

      if (submittedYear !== actualYear) {
        return res.status(422).json({
          valid: false,
          reason: "year",
          message: "The movie year does not match the OMDb data.",
          actualYear: actualYear
        });
      }
    }

    if (genre) {
      const omdbGenres = String(details.Genre || "")
        .split(",")
        .map(normalizeForCompare)
        .filter(Boolean);
      const submittedGenre = normalizeForCompare(genre);

      if (!omdbGenres.includes(submittedGenre)) {
        return res.status(422).json({
          valid: false,
          reason: "genre",
          message: "The movie genre does not match the OMDb data.",
          actualGenre: details.Genre
        });
      }
    }

    res.json({ valid: true, movie: toWatchlistShape(details) });
  } catch (error) {
    console.error("Validation failed:", error.message);
    res.status(500).json({
      valid: false,
      reason: "lookup_failed",
      message: "Could not verify this movie with OMDb. Please try again."
    });
  }
});

// CREATE - add a movie
app.post("/api/movies", async (req, res) => {
  const {
    title, genre, year, poster, imdbID, imdbRating, plot, rated, released,
    runtime, director, writer, actors, language, country, awards, ratings,
    metascore, imdbVotes, type, boxOffice
  } = req.body;
  const enteredTitle = typeof title === "string" ? title.trim() : "";
  const enteredGenre = typeof genre === "string" ? genre.trim() : "";
  const enteredYear = String(year ?? "").trim();
  const enteredImdbID = typeof imdbID === "string" ? imdbID.trim() : "";
  const metadataValue = value =>
    typeof value === "string" && value !== "N/A" ? value : "";

  if (!enteredTitle || !enteredGenre || !enteredYear) {
    return res.status(400).json({
      message: "Title, genre, and year are required."
    });
  }

  const movies = db.read();
  const normalizeTitle = value => String(value || "")
    .trim().replace(/\s+/g, " ").toLowerCase();

  // Block duplicates by IMDb ID (reliable), falling back to title+year.
  const duplicate = movies.some(movie => {
    if (enteredImdbID) {
      if (movie.imdbID && movie.imdbID === enteredImdbID) return true;
    }

    return normalizeTitle(movie.title) === normalizeTitle(enteredTitle) &&
      String(movie.year) === enteredYear;
  });

  if (duplicate) {
    return res.status(409).json({
      message: "This movie is already in your watchlist."
    });
  }

  const movie = {
    id: Date.now(),
    title: enteredTitle,
    genre: enteredGenre,
    year: enteredYear,
    watched: false,
    favorite: false,
    poster: typeof poster === "string" && poster !== "N/A" ? poster : "",
    imdbID: enteredImdbID,
    imdbRating: metadataValue(imdbRating),
    plot: metadataValue(plot),
    rated: metadataValue(rated),
    released: metadataValue(released),
    runtime: metadataValue(runtime),
    director: metadataValue(director),
    writer: metadataValue(writer),
    actors: metadataValue(actors),
    language: metadataValue(language),
    country: metadataValue(country),
    awards: metadataValue(awards),
    ratings: Array.isArray(ratings) ? ratings : [],
    metascore: metadataValue(metascore),
    imdbVotes: metadataValue(imdbVotes),
    type: metadataValue(type),
    boxOffice: metadataValue(boxOffice)
  };

  movies.push(movie);
  db.write(movies);

  res.status(201).json(movie);
});

// UPDATE - edit a movie
app.put("/api/movies/:id", (req, res) => {
  const movies = db.read();
  const movie = movies.find(
    item => item.id === Number(req.params.id)
  );

  if (!movie) {
    return res.status(404).json({
      message: "Movie not found."
    });
  }

  const { title, genre, year, watched, favorite } = req.body;

  if (title !== undefined) {
    if (!title.trim()) {
      return res.status(400).json({
        message: "Title cannot be empty."
      });
    }
    const updatedTitle = title.trim();
    movie.title = updatedTitle;
  }

  if (genre !== undefined) movie.genre = genre.trim();
  if (year !== undefined) movie.year = String(year).trim();
  if (watched !== undefined) movie.watched = Boolean(watched);
  if (favorite !== undefined) movie.favorite = Boolean(favorite);

  db.write(movies);
  res.json(movie);
});

// DELETE - remove a movie
app.delete("/api/movies/:id", (req, res) => {
  const movies = db.read();
  const updatedMovies = movies.filter(
    movie => movie.id !== Number(req.params.id)
  );

  if (movies.length === updatedMovies.length) {
    return res.status(404).json({
      message: "Movie not found."
    });
  }

  db.write(updatedMovies);
  res.json({ message: "Movie deleted successfully." });
});

// OMDb LOOKUP - search movies online
app.get("/api/lookup", async (req, res) => {
  try {
    const title = req.query.title;

    if (!title || !title.trim()) {
      return res.status(400).json({
        message: "Please enter a movie title."
      });
    }

    if (!process.env.OMDB_API_KEY) {
      return res.status(500).json({
        message: "OMDb API key is not configured."
      });
    }

    const response = await axios.get(
      "https://www.omdbapi.com/",
      {
        params: {
          apikey: process.env.OMDB_API_KEY,
          s: title.trim()
        }
      }
    );

    if (response.data.Response === "False") {
      return res.json([]);
    }

    const results = await Promise.all(response.data.Search.map(async movie => {
      let imdbRating = "N/A";
      let omdbDetails = {};

      try {
        const details = await axios.get("https://www.omdbapi.com/", {
          params: {
            apikey: process.env.OMDB_API_KEY,
            i: movie.imdbID
          }
        });

        if (details.data?.Response === "True") {
          omdbDetails = details.data;
          imdbRating = details.data.imdbRating || "N/A";
        }
      } catch (error) {
        console.warn(`Could not load OMDb rating for ${movie.Title}:`, error.message);
      }

      return {
        ...omdbDetails,
        imdbID: movie.imdbID,
        title: omdbDetails.Title || movie.Title,
        year: omdbDetails.Year || movie.Year,
        type: omdbDetails.Type || movie.Type,
        // OMDb's Genre was previously dropped, leaving cards with no genre.
        genre: omdbDetails.Genre && omdbDetails.Genre !== "N/A"
          ? omdbDetails.Genre
          : "Unknown",
        poster: omdbDetails.Poster && omdbDetails.Poster !== "N/A"
          ? omdbDetails.Poster
          : movie.Poster !== "N/A" ? movie.Poster : "",
        imdbRating
      };
    }));

    res.json(results);
  } catch (error) {
    console.error("OMDb lookup failed:", error.message);

    res.status(500).json({
      message: "Could not connect to OMDb. Please try again."
    });
  }
});

app.get("/api/trailer", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";
  const year = typeof req.query.year === "string" ? req.query.year.trim() : "";

  if (!title) {
    return res.status(400).json({ videoId: "", title: "" });
  }

  const cacheKey = `${title.toLowerCase()}|${year}`;
  if (trailerSearchCache.has(cacheKey)) {
    return res.json(trailerSearchCache.get(cacheKey));
  }

  try {
    if (TMDB_API_KEY) {
      const searchResponse = await axios.get("https://api.themoviedb.org/3/search/movie", {
        params: {
          api_key: TMDB_API_KEY,
          query: title,
          year: year || undefined,
          include_adult: false
        },
        timeout: 12000
      });

      const movie = Array.isArray(searchResponse.data?.results)
        ? searchResponse.data.results.find(result => {
            const matchesYear = !year || String(result.release_date || "").startsWith(String(year));
            const sameTitle = normalizeForCompare(result.title || result.original_title || "") === normalizeForCompare(title);
            return matchesYear && (sameTitle || normalizeForCompare(result.title || result.original_title || "").includes(normalizeForCompare(title)));
          }) || searchResponse.data.results[0]
        : null;

      if (movie?.id) {
        const videoResponse = await axios.get(`https://api.themoviedb.org/3/movie/${movie.id}/videos`, {
          params: { api_key: TMDB_API_KEY },
          timeout: 12000
        });

        const trailer = Array.isArray(videoResponse.data?.results)
          ? [...videoResponse.data.results]
              .filter(video => video.site === "YouTube" && (video.type === "Trailer" || video.type === "Teaser"))
              .sort((first, second) => Number(second.official) - Number(first.official))[0]
          : null;

        if (trailer?.key) {
          const result = formatTrailerResult(trailer.key, trailer.name || title);
          trailerSearchCache.set(cacheKey, result);
          return res.json(result);
        }
      }
    }

    const response = await axios.get("https://www.youtube.com/results", {
      params: { search_query: `${title} ${year} official trailer`.trim() },
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 12000,
      maxContentLength: 5_000_000
    });
    const candidates = [...response.data.matchAll(
      /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"[\s\S]*?"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/g
    )].slice(0, 40).map(match => {
      let videoTitle = match[2];
      try {
        videoTitle = JSON.parse(`"${videoTitle}"`);
      } catch {
        return null;
      }

      return { videoId: match[1], title: videoTitle };
    }).filter(candidate => candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate.videoId));

    const normalizeTitle = value => String(value || "")
      .toLowerCase()
      .replace(/\((?:19|20)\d{2}\)/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const titleWords = normalizeTitle(title).split(/\s+/).filter(Boolean);
    const requestedPart = extractPartNumber(title);
    const hasYear = Boolean(extractYear(year));

    const baseWords = titleWords.filter(word =>
      word !== "part" && word !== "episode" && !(word in WORD_NUMBERS) &&
      !(word in ROMAN_NUMBERS)
    );

    // The real title often omits the installment word ("Dune" not
    // "Dune: Part One"), so judge on the distinctive words only.
    const requiredWords = baseWords.length ? baseWords : titleWords;

    const rankedCandidates = candidates.map(candidate => {
      const normalizedCandidate = normalizeTitle(candidate.title);
      const candidateWords = new Set(normalizedCandidate.split(/\s+/).filter(Boolean));
      const hasTrailerLabel = /trailer|teaser/i.test(candidate.title);

      // Every distinctive word of the requested title must be present.
      const missingWords = requiredWords.filter(word => !candidateWords.has(word));
      const allWordsPresent = missingWords.length === 0;

      // The full title should read as one contiguous phrase.
      const contiguousMatch = normalizedCandidate.includes(normalizeTitle(title));

      // A candidate that leads with the title is far more likely to be right.
      const startsWithTitle = normalizedCandidate.startsWith(normalizeTitle(title));

      // Detect a conflicting installment ("Part Two" when we asked for "Part One").
      const candidatePart = extractPartNumber(candidate.title);
      const partConflict = requestedPart !== null && candidatePart !== null &&
        requestedPart !== candidatePart;

      // A different 4-digit year in the video title means the wrong movie.
      // A sequel/entry marker ("No Way Home", "Homecoming") also means the
      // wrong film, unless that marker belongs to the title we were asked
      // for, or the marker itself is what the user searched for.
      const candidateYear = extractYear(candidate.title);
      const yearConflict = hasYear && candidateYear && candidateYear !== extractYear(year);

      const normalizedRequest = normalizeTitle(title);
      const requestWords = new Set(normalizedRequest.split(/\s+/).filter(Boolean));
      const candidateMarker = candidate.title.match(
        /\b(no way home|far from home|homecoming|across the spider-?verse|into the spider-?verse|returns|reboot|revival)\b/i
      );
      const markerPhrase = candidateMarker
        ? normalizeTitle(candidateMarker[1])
        : "";
      // The marker is a problem only if the user did not search for it.
      const sequelMarker = Boolean(markerPhrase) &&
        !requestWords.has(markerPhrase.split(" ")[0]);

      // Penalise extra leading words ("Planet Dune" for a search on "Dune").
      const titleStart = normalizedCandidate.indexOf(normalizeTitle(title));
      const extraLeadingWords = titleStart > 0
        ? normalizedCandidate.slice(0, titleStart).split(/\s+/).filter(Boolean).length
        : 0;

      const score =
        (allWordsPresent ? 10 : 0) +
        (contiguousMatch ? 8 : 0) +
        (startsWithTitle ? 12 : 0) +
        (hasTrailerLabel ? 4 : 0) +
        (/official/i.test(candidate.title) ? 2 : 0) +
        (candidateYear && candidateYear === extractYear(year) ? 5 : 0) -
        (extraLeadingWords * 4) -
        missingWords.length * 8 -
        (partConflict ? 100 : 0) -
        (yearConflict ? 100 : 0);

      return {
        ...candidate,
        score,
        hasTrailerLabel,
        allWordsPresent,
        partConflict,
        yearConflict,
        sequelMarker
      };
    }).filter(candidate =>
      candidate.hasTrailerLabel &&
      candidate.allWordsPresent &&
      !candidate.partConflict &&
      !candidate.yearConflict &&
      !candidate.sequelMarker
    ).sort((first, second) => second.score - first.score);

    const result = rankedCandidates[0]
      ? formatTrailerResult(rankedCandidates[0].videoId, rankedCandidates[0].title)
      : formatTrailerResult("", "");
    trailerSearchCache.set(cacheKey, result);
    return res.json(result);
  } catch (error) {
    console.warn(`YouTube trailer lookup failed for ${title}:`, error.message);
    const unavailable = formatTrailerResult("", "");
    trailerSearchCache.set(cacheKey, unavailable);
    return res.json(unavailable);
  }
});

function findLocalMovieById(imdbID) {
  const localMovies = db.read();
  return localMovies.find(movie => movie.imdbID === imdbID)
    || db.readFeatured().find(movie => movie.imdbID === imdbID)
    || null;
}

// Get detailed information for a selected movie
app.get("/api/movie/:imdbID", async (req, res) => {
  const imdbID = req.params.imdbID;

  if (!process.env.OMDB_API_KEY) {
    const localMovie = findLocalMovieById(imdbID);
    if (localMovie) {
      return res.json(localMovie);
    }

    return res.status(503).json({
      message: "Movie details are temporarily unavailable. The OMDb API key is not configured."
    });
  }

  try {
    const response = await axios.get(
      "https://www.omdbapi.com/",
      {
        params: {
          apikey: process.env.OMDB_API_KEY,
          i: imdbID,
          plot: "short"
        }
      }
    );

    if (response.data.Response === "False") {
      const localMovie = findLocalMovieById(imdbID);
      if (localMovie) {
        return res.json(localMovie);
      }

      return res.status(404).json({
        message: "Movie details not found."
      });
    }

    res.json(response.data);
  } catch (error) {
    const localMovie = findLocalMovieById(imdbID);
    if (localMovie) {
      return res.json(localMovie);
    }

    res.status(500).json({
      message: "Could not load movie details."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CineList running at http://localhost:${PORT}`);
});