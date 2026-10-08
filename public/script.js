
const watchlist = document.getElementById("watchlist");
const searchResults = document.getElementById("searchResults");
const message = document.getElementById("message");
const genreFilters = document.getElementById("genreFilters");
const featuredMovie = document.getElementById("featuredMovie");
const featuredIndicators = document.getElementById("featuredIndicators");
const featuredCount = document.getElementById("featuredCount");
const quickPicks = document.getElementById("quickPicks");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let movies = [];
// Featured movies are loaded from their own endpoint and are never the watchlist.
let featuredMovies = [];
const omdbSearchResults = new Map();
let activeGenre = "all";
let featuredMovieIndex = -1;
let featuredRotationTimer;
let activeDetailsMovie = null;
let detailsRequestSequence = 0;
// Trailer theatre: plays each watchlist trailer in turn, auto-advancing.
let trailerQueue = [];
let trailerIndex = -1;
let trailerRequestSequence = 0;

// Escape text before placing it into HTML
function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = isError ? "message error" : "message";

  setTimeout(() => {
    message.classList.add("hidden");
  }, 3500);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong.");
  }

  return data;
}

function posterHTML(poster, title) {
  if (poster) {
    return `<img class="poster"
      src="${escapeHTML(poster)}"
      alt="${escapeHTML(title)} poster"
      onerror="this.outerHTML='<div class=&quot;poster-placeholder&quot;>No poster available</div>'">`;
  }

  return `<div class="poster-placeholder">No poster available</div>`;
}

function ratingLabel(rating) {
  const value = typeof rating === "string" ? rating.trim() : "";
  return value && value.toUpperCase() !== "N/A" ? `⭐ ${value}` : "N/A";
}

// OMDb returns genres as "Action, Adventure, Sci-Fi". Search results use the
// capitalised `Genre` field, saved watchlist movies use lowercase `genre`.
// Read both so a card never falls back to "Unknown".
function movieGenres(movie) {
  const raw = movie?.Genre || movie?.genre || "";
  const value = String(raw).trim();

  if (!value || value.toUpperCase() === "N/A" || value.toLowerCase() === "unknown") {
    return [];
  }

  return [...new Set(value
    .split(",")
    .map(genre => genre.trim())
    .filter(Boolean))]
    .filter(genre => genre.toUpperCase() !== "N/A");
}

// A compact, card-safe genre label: the first two genres joined by a bullet.
function genreBadgeLabel(movie, maxGenres = 2) {
  const genres = movieGenres(movie).slice(0, maxGenres);
  return genres.join(" • ");
}

function posterCardHTML(movie, status) {
  const genre = genreBadgeLabel(movie) || "Genre unavailable";
  const rating = typeof movie.imdbRating === "string" && movie.imdbRating !== "N/A"
    ? `${movie.imdbRating}/10`
    : "--";
  const year = movieField(movie, "Year", "year") || "—";

  return `
    <div class="showcase-card-poster">
      ${posterHTML(movie.poster, movie.title)}
      <div class="showcase-card-poster-rail">
        <span class="poster-meta-tag">${escapeHTML(genre)}</span>
        <span class="showcase-card-score-badge">★ ${escapeHTML(rating)}</span>
      </div>
      <div class="showcase-card-hover-panel" aria-hidden="true">
        <span class="showcase-card-hover-kicker">Quick details</span>
        <div class="showcase-card-hover-grid">
          <div class="showcase-card-hover-stat">
            <span class="showcase-card-hover-label">Score</span>
            <span class="showcase-card-hover-value">${escapeHTML(rating)}</span>
          </div>
          <div class="showcase-card-hover-stat">
            <span class="showcase-card-hover-label">Year</span>
            <span class="showcase-card-hover-value">${escapeHTML(year)}</span>
          </div>
          <div class="showcase-card-hover-stat">
            <span class="showcase-card-hover-label">Status</span>
            <span class="showcase-card-hover-value">${escapeHTML(status)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFeaturedMovie(index) {
  if (featuredMovies.length === 0) {
    featuredMovieIndex = -1;
    featuredMovie.innerHTML = `<div class="featured-empty">Loading featured movies...</div>`;
    featuredIndicators.replaceChildren();
    featuredCount.textContent = "00 / 00";
    return;
  }

  featuredMovieIndex = (index + featuredMovies.length) % featuredMovies.length;
  const movie = featuredMovies[featuredMovieIndex];
  const genre = genreBadgeLabel(movie) || "Featured pick";
  const rating = typeof movie.imdbRating === "string" && movie.imdbRating !== "N/A"
    ? `${movie.imdbRating}/10`
    : "Not rated";
  const movieYear = movieField(movie, "Year", "year") || "—";
  const summary = movie.plot || `${movieYear} · ${movieGenres(movie).join(", ")}`;

  featuredMovie.innerHTML = `
    <article class="featured-poster-card">
      ${movie.poster
        ? `<img class="featured-poster" src="${escapeHTML(movie.poster)}" alt="${escapeHTML(movie.title)} poster">`
        : `<div class="featured-poster featured-poster-fallback">${escapeHTML(movie.title)}</div>`}
      <div class="featured-poster-shade"></div>
      <div class="featured-poster-rail">
        <span class="poster-meta-tag">${escapeHTML(genre)}</span>
        <span class="rating-badge">★ ${escapeHTML(rating)}</span>
      </div>
      <div class="featured-poster-copy">
        <p>${escapeHTML(movieYear)} · FEATURED</p>
        <h2>${escapeHTML(movie.title)}</h2>
        <span>${escapeHTML(summary)}</span>
        <button type="button" onclick="showFeaturedDetails('${escapeHTML(movie.imdbID)}')">View details <span aria-hidden="true">↗</span></button>
      </div>
    </article>
  `;

  featuredCount.textContent =
    `${String(featuredMovieIndex + 1).padStart(2, "0")} / ${String(featuredMovies.length).padStart(2, "0")}`;
  featuredIndicators.replaceChildren(...featuredMovies.map((featured, movieIndex) => {
    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.className = "hero-indicator";
    indicator.setAttribute("aria-label", `Show ${featured.title}`);
    indicator.setAttribute("aria-pressed", String(movieIndex === featuredMovieIndex));
    indicator.addEventListener("click", () => renderFeaturedMovie(movieIndex));
    return indicator;
  }));
}

function renderQuickPicks() {
  const picks = featuredMovies.slice(0, 4);

  quickPicks.innerHTML = picks.map(movie => `
    <button class="quick-pick" type="button" data-title="${escapeHTML(movie.title)}">
      ${escapeHTML(movie.title)}
    </button>
  `).join("");
}

function startFeaturedAutoplay() {
  clearInterval(featuredRotationTimer);

  if (featuredMovies.length < 2 || prefersReducedMotion.matches) return;

  featuredRotationTimer = setInterval(() => {
    if (!document.hidden) renderFeaturedMovie(featuredMovieIndex + 1);
  }, 5200);
}

function renderGenreFilters() {
  const genres = [...new Set(movies.flatMap(movieGenres))]
    .sort((first, second) => first.localeCompare(second));
  const options = [{ label: "All genres", value: "all" },
    ...genres.map(genre => ({ label: genre, value: genre }))];

  genreFilters.innerHTML = options.map(option => `
    <button class="genre-chip${activeGenre === option.value ? " is-active" : ""}"
      type="button" data-genre="${escapeHTML(option.value)}"
      aria-pressed="${activeGenre === option.value}">${escapeHTML(option.label)}</button>
  `).join("");
}

// Load the homepage featured movies, independently of the watchlist
async function loadFeaturedMovies() {
  try {
    featuredMovies = await request("/api/featured");
    renderFeaturedMovie(featuredMovieIndex < 0 ? 0 : featuredMovieIndex);
    renderQuickPicks();
    startFeaturedAutoplay();
  } catch (error) {
    featuredMovie.innerHTML = `<div class="featured-empty">${escapeHTML(error.message)}</div>`;
    featuredIndicators.replaceChildren();
    featuredCount.textContent = "00 / 00";
  }
}

// Manual carousel controls, also independent of the watchlist.
document.getElementById("featuredPrev").addEventListener("click", () => {
  renderFeaturedMovie(featuredMovieIndex - 1);
  startFeaturedAutoplay();
});

document.getElementById("featuredNext").addEventListener("click", () => {
  renderFeaturedMovie(featuredMovieIndex + 1);
  startFeaturedAutoplay();
});

// Load movies from the database
async function loadMovies() {
  try {
    movies = await request("/api/movies");
    renderGenreFilters();
    renderMovies();
    updateStats();
  } catch (error) {
    showMessage(error.message, true);
  }
}

// Update the dashboard counters
function updateStats() {
  const watched = movies.filter(movie => movie.watched).length;
  const favorites = movies.filter(movie => movie.favorite).length;
  const ratings = movies
    .map(movie => Number.parseFloat(movie.imdbRating))
    .filter(Number.isFinite);
  const averageRating = ratings.length
    ? (ratings.reduce((total, rating) => total + rating, 0) / ratings.length).toFixed(1)
    : "--";

  document.getElementById("totalCount").textContent = movies.length;
  document.getElementById("averageRating").textContent = averageRating;
  document.getElementById("watchedCount").textContent = watched;
  document.getElementById("favoriteCount").textContent = favorites;
  document.getElementById("heroCount").textContent = movies.length;
  document.getElementById("collectionCount").textContent = movies.length;
  document.getElementById("headerCount").textContent = movies.length;
}

// Display saved movies with search, filter, and sorting
function renderMovies() {
  const search = document.getElementById("filterInput")
    .value.trim().toLowerCase();

  const status = document.getElementById("statusFilter").value;
  const sort = document.getElementById("sortSelect").value;

  let filtered = movies.filter(movie => {
    const matchesTitle = movie.title.toLowerCase().includes(search);
    const matchesGenre = activeGenre === "all" || movieGenres(movie).includes(activeGenre);

    const matchesStatus =
      status === "all" ||
      (status === "watched" && movie.watched) ||
      (status === "unwatched" && !movie.watched) ||
      (status === "favorites" && movie.favorite);

    return matchesTitle && matchesGenre && matchesStatus;
  });

  if (sort === "title") {
    filtered.sort((a, b) => a.title.localeCompare(b.title));
  } else if (sort === "year") {
    filtered.sort((a, b) => Number(b.year) - Number(a.year));
  } else {
    filtered.sort((a, b) => b.id - a.id);
  }

  if (filtered.length === 0) {
    watchlist.innerHTML =
      `<div class="empty-state">
        <h3>${status === "favorites" ? "No favorite movies yet" : activeGenre !== "all" ? `No ${escapeHTML(activeGenre)} movies found` : "Your watchlist is empty"}</h3>
        <p>Add a movie or change your search filters.</p>
      </div>`;
    return;
  }

  watchlist.innerHTML = filtered.map(movie => `
    <article class="movie-card">
      ${posterCardHTML(movie, movie.watched ? "Watched" : "To Watch")}
      <div class="movie-info">
        <div class="movie-heading">
          <h3>${escapeHTML(movie.title)}</h3>
          <button class="favorite-button${movie.favorite ? " is-favorite" : ""}"
            type="button"
            aria-label="${movie.favorite ? "Remove from" : "Add to"} favorites: ${escapeHTML(movie.title)}"
            aria-pressed="${Boolean(movie.favorite)}"
            onclick="toggleFavorite(${movie.id})">${movie.favorite ? "❤️" : "♡"}</button>
        </div>
        <div class="movie-meta">
          <p>${escapeHTML(movie.year)} · ${escapeHTML(movie.genre)}</p>
          <span class="movie-rating">${escapeHTML(ratingLabel(movie.imdbRating))}</span>
        </div>
        <span class="status ${movie.watched ? "" : "to-watch"}">
          ${movie.watched ? "Watched" : "To Watch"}
        </span>

        <div class="movie-actions">
          <button class="secondary"
            onclick="toggleWatched(${movie.id})">
            ${movie.watched ? "Mark To Watch" : "Mark Watched"}
          </button>
          <button class="secondary"
            onclick="showDetails(${movie.id})">Details</button>
          <button class="danger"
            onclick="deleteMovie(${movie.id})">Remove from Watchlist</button>
        </div>
      </div>
    </article>
  `).join("");
}

// Add a movie manually, but only after OMDb confirms the title/year/genre.
document.getElementById("addForm").addEventListener("submit",
  async event => {
    event.preventDefault();

    const form = event.target;
    const submitButton = form.querySelector("button[type=submit]");
    const originalLabel = submitButton.textContent;
    const movie = {
      title: document.getElementById("movieTitle").value.trim(),
      genre: document.getElementById("movieGenre").value.trim(),
      year: document.getElementById("movieYear").value.trim()
    };

    submitButton.disabled = true;
    submitButton.textContent = "Checking OMDb...";

    try {
      const validation = await request("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(movie)
      });

      // Only the official OMDb record is ever saved.
      await addMovieToWatchlist(validation.movie);
      form.reset();
      showMessage(`${validation.movie.title} verified and added to your watchlist!`);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
);

document.getElementById("headerSearchForm").addEventListener("submit", event => {
  event.preventDefault();
  document.getElementById("searchInput").value =
    document.getElementById("headerSearchInput").value.trim();
  document.getElementById("searchForm").requestSubmit();
});

quickPicks.addEventListener("click", event => {
  const button = event.target.closest("[data-title]");
  if (!button) return;

  document.getElementById("searchInput").value = button.dataset.title;
  document.getElementById("searchForm").requestSubmit();
});

genreFilters.addEventListener("click", event => {
  const button = event.target.closest("[data-genre]");
  if (!button) return;

  activeGenre = button.dataset.genre;
  renderGenreFilters();
  renderMovies();
});

// Search OMDb
document.getElementById("searchForm").addEventListener("submit",
  async event => {
    event.preventDefault();

    const title = document.getElementById("searchInput").value.trim();
    omdbSearchResults.clear();
    searchResults.innerHTML = `<p>Searching...</p>`;

    try {
      const results = await request(
        `/api/lookup?title=${encodeURIComponent(title)}`
      );

      if (results.length === 0) {
        searchResults.innerHTML =
          `<div class="empty-state">No movies found. Try another title.</div>`;
        return;
      }

      results.forEach(movie => omdbSearchResults.set(movie.imdbID, movie));

      searchResults.innerHTML = results.map(movie => {
        const alreadyAdded = movies.some(savedMovie => savedMovie.imdbID === movie.imdbID);
        const cardTitle = movieField(movie, "Title", "title") || "Untitled";
        const cardYear = movieField(movie, "Year", "year") || "—";
        const cardType = movieField(movie, "Type", "type") || "movie";
        const cardRating = movieField(movie, "imdbRating") || "N/A";

        return `
        <article class="movie-card">
          ${posterCardHTML(movie, "Ready to add")}
          <div class="movie-info">
            <h3>${escapeHTML(cardTitle)}</h3>
            <div class="movie-meta">
              <p>${escapeHTML(cardYear)} · ${escapeHTML(cardType)}</p>
              <span class="movie-rating">${escapeHTML(ratingLabel(cardRating))}</span>
            </div>
            <div class="movie-actions">
              <button type="button" data-add-imdb-id="${escapeHTML(movie.imdbID)}"
                ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Already Added" : "Add to Watchlist"}</button>
              <button class="secondary"
                onclick="showOnlineDetails('${escapeHTML(movie.imdbID)}')">
                Details
              </button>
            </div>
          </div>
        </article>
      `;
      }).join("");
    } catch (error) {
      searchResults.innerHTML = "";
      showMessage(error.message, true);
    }
  }
);

searchResults.addEventListener("click", event => {
  const button = event.target.closest("[data-add-imdb-id]");
  if (!button || button.disabled) return;

  const selectedMovie = omdbSearchResults.get(button.dataset.addImdbId);
  if (!selectedMovie) {
    showMessage("Could not find the selected OMDb movie. Search again and retry.", true);
    return;
  }

  addMovieToWatchlist(selectedMovie, button)
    .then(added => {
      showMessage(added ? "Movie added from OMDb!" : "This movie is already in your watchlist.");
    })
    .catch(error => showMessage(error.message, true));
});

// Add movies from either the manual form or OMDb to the shared watchlist.
async function addMovieToWatchlist(movie, button) {
  const originalLabel = button?.textContent;
  let added = false;
  if (button) {
    button.disabled = true;
    button.textContent = "Adding...";
  }

  const movieData = {
    title: movie.Title || movie.title,
    genre: movie.Genre || movie.genre || "Unknown",
    year: movie.Year || movie.year,
    poster: movie.Poster || movie.poster || "",
    imdbID: movie.imdbID || "",
    imdbRating: movie.imdbRating || "",
    plot: movie.Plot || movie.plot || "",
    rated: movie.Rated || movie.rated || "",
    released: movie.Released || movie.released || "",
    runtime: movie.Runtime || movie.runtime || "",
    director: movie.Director || movie.director || "",
    writer: movie.Writer || movie.writer || "",
    actors: movie.Actors || movie.actors || "",
    language: movie.Language || movie.language || "",
    country: movie.Country || movie.country || "",
    awards: movie.Awards || movie.awards || "",
    ratings: movie.Ratings || movie.ratings || [],
    metascore: movie.Metascore || movie.metascore || "",
    imdbVotes: movie.imdbVotes || "",
    type: movie.Type || movie.type || "",
    boxOffice: movie.BoxOffice || movie.boxOffice || ""
  };

  try {
    await request("/api/movies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(movieData)
    });

    added = true;
    if (button) button.textContent = "Added ✓";
    await loadMovies();
    return true;
  } catch (error) {
    if (error.message.includes("already in your watchlist")) {
      if (button) button.textContent = "Already Added";
      return false;
    }

    if (button && !added) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
    throw error;
  }
}

// Reusable confirmation modal. Returns a Promise<boolean> instead of
// using the browser's native confirm() dialog.
const confirmDialog = document.getElementById("confirmDialog");
const confirmAccept = document.getElementById("confirmAccept");
const confirmCancel = document.getElementById("confirmCancel");
const confirmMessage = document.getElementById("confirmMessage");

let confirmResolver = null;

function closeConfirmDialog(result) {
  if (confirmDialog.open) confirmDialog.close();
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

function askConfirm({ title, message, acceptLabel = "Remove", cancelLabel = "Cancel" }) {
  // A second request while one is open resolves the first as cancelled.
  if (confirmResolver) closeConfirmDialog(false);

  document.getElementById("confirmTitle").textContent = title;
  confirmMessage.textContent = message;
  confirmAccept.textContent = acceptLabel;
  confirmCancel.textContent = cancelLabel;

  if (!confirmDialog.open) confirmDialog.showModal();

  confirmAccept.focus();

  return new Promise(resolve => {
    confirmResolver = resolve;
  });
}

if (confirmAccept) {
  confirmAccept.addEventListener("click", () => closeConfirmDialog(true));
}

if (confirmCancel) {
  confirmCancel.addEventListener("click", () => closeConfirmDialog(false));
}

if (confirmDialog) {
  // Cancel via Escape, backdrop click, or native close.
  confirmDialog.addEventListener("close", () => closeConfirmDialog(false));
  confirmDialog.addEventListener("click", event => {
    if (event.target === confirmDialog) closeConfirmDialog(false);
  });
}

// Delete a movie after confirmation
async function deleteMovie(id, closeDetails = false) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return false;

  const confirmed = await askConfirm({
    title: "Remove from watchlist?",
    message: `"${movie.title}" will be removed from your watchlist. This cannot be undone.`,
    acceptLabel: "Remove",
    cancelLabel: "Cancel"
  });

  if (!confirmed) return false;

  try {
    await request(`/api/movies/${id}`, { method: "DELETE" });
    await loadMovies();
    if (closeDetails) document.getElementById("detailsDialog").close();
    showMessage("Movie deleted.");
    return true;
  } catch (error) {
    showMessage(error.message, true);
    return false;
  }
}

// Toggle watched status
async function toggleWatched(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  try {
    await request(`/api/movies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watched: !movie.watched })
    });

    await loadMovies();
    showMessage("Watch status updated.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

// Toggle favorite status
async function toggleFavorite(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  try {
    await request(`/api/movies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !movie.favorite })
    });

    await loadMovies();
    showMessage(movie.favorite ? "Removed from favorites." : "Added to favorites.");
  } catch (error) {
    showMessage(error.message, true);
  }
}

function movieField(movie, ...keys) {
  for (const key of keys) {
    const value = movie?.[key];
    if (typeof value === "string" && value.trim() && value.toUpperCase() !== "N/A") {
      return value.trim();
    }
  }
  return "";
}

function findSavedDetailsMovie() {
  if (!activeDetailsMovie) return null;
  if (activeDetailsMovie.savedId !== null) {
    return movies.find(movie => movie.id === activeDetailsMovie.savedId) || null;
  }
  return activeDetailsMovie.imdbID
    ? movies.find(movie => movie.imdbID === activeDetailsMovie.imdbID) || null
    : null;
}

function updateDetailsActions() {
  const savedMovie = findSavedDetailsMovie();
  const favoriteButton = document.getElementById("detailsFavoriteButton");
  const watchlistButton = document.getElementById("detailsWatchlistButton");
  if (!favoriteButton || !watchlistButton) return;

  favoriteButton.classList.toggle("is-favorite", Boolean(savedMovie?.favorite));
  favoriteButton.setAttribute("aria-pressed", String(Boolean(savedMovie?.favorite)));
  favoriteButton.textContent = savedMovie?.favorite ? "♥ Favorite" : "♡ Favorite";
  watchlistButton.textContent = savedMovie
    ? "Remove from Watchlist"
    : "Add to Watchlist";
}

function showTrailerUnavailable() {
  const player = document.getElementById("movieTrailer");
  if (!player) return;

  player.innerHTML = `
    <div class="trailer-unavailable">
      <span aria-hidden="true">▶</span>
      <div>
        <strong>Trailer unavailable</strong>
        <p>We couldn't find a YouTube trailer for this movie.</p>
      </div>
    </div>
  `;
}

async function loadMovieTrailer(title, year, requestSequence) {
  const player = document.getElementById("movieTrailer");
  if (!player) return;

  try {
    const trailer = await request(
      `/api/trailer?title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`
    );
    if (requestSequence !== detailsRequestSequence) return;

    const trailerId = typeof trailer.videoId === "string"
      ? trailer.videoId.trim()
      : "";
    const fallbackVideoId = trailerId || (typeof trailer.watchUrl === "string"
      ? trailer.watchUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || ""
      : "");

    if (!/^[A-Za-z0-9_-]{11}$/.test(fallbackVideoId)) {
      showTrailerUnavailable();
      return;
    }

    const trailerUrl = `https://www.youtube.com/watch?v=${fallbackVideoId}`;
    const embedUrl = `https://www.youtube-nocookie.com/embed/${fallbackVideoId}?rel=0&autoplay=1&playsinline=1`;

    // Play the trailer inline so a click on "Details" starts the video
    // immediately instead of only offering an external link.
    player.innerHTML = `
      <iframe
        src="${embedUrl}"
        title="${escapeHTML(title)} trailer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"></iframe>
      <a href="${trailerUrl}" target="_blank" rel="noreferrer noopener" class="details-trailer-link">
        Watch trailer on YouTube
      </a>
    `;
    player.removeAttribute("role");
  } catch {
    if (requestSequence === detailsRequestSequence) showTrailerUnavailable();
  }
}

// Reuse the same YouTube video id validation the details view uses.
function resolveTrailerVideoId(trailer) {
  const direct = typeof trailer?.videoId === "string" ? trailer.videoId.trim() : "";
  const fromUrl = typeof trailer?.watchUrl === "string"
    ? trailer.watchUrl.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || ""
    : "";
  const videoId = direct || fromUrl;
  return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "";
}

function trailerEmbedUrl(videoId, autoplay = true) {
  const params = ["rel=0", "playsinline=1"];
  if (autoplay) params.push("autoplay=1");
  // enablejsapi lets us detect when a trailer ends so we can advance.
  params.push("enablejsapi=1", `origin=${encodeURIComponent(window.location.origin)}`);
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.join("&")}`;
}

function renderTrailerStage(message) {
  const stage = document.getElementById("trailerStage");
  if (!stage) return;
  stage.innerHTML = message;
}

// Play the queued trailer at `index`, fetching its video id on demand.
async function playTrailerAt(index) {
  const progress = document.getElementById("trailerProgress");
  const titleEl = document.getElementById("trailerDialogTitle");
  const metaEl = document.getElementById("trailerDialogMeta");

  if (!trailerQueue.length || index < 0 || index >= trailerQueue.length) {
    trailerIndex = -1;
    if (titleEl) titleEl.textContent = "Trailer theatre";
    if (progress) progress.textContent = "";
    renderTrailerStage(`
      <div class="trailer-unavailable">
        <span aria-hidden="true">▶</span>
        <div>
          <strong>No trailers queued</strong>
          <p>Add movies to your watchlist to play their trailers.</p>
        </div>
      </div>`);
    return;
  }

  trailerIndex = index;
  const movie = trailerQueue[index];
  const requestId = ++trailerRequestSequence;

  if (titleEl) titleEl.textContent = movie.title;
  if (metaEl) metaEl.textContent = [movie.year, movie.genre].filter(Boolean).join(" · ");
  if (progress) progress.textContent = `${index + 1} of ${trailerQueue.length}`;
  renderTrailerStage(`
    <div class="trailer-loading"><span aria-hidden="true"></span>Finding a trailer...</div>`);

  let videoId = "";
  try {
    const trailer = await request(
      `/api/trailer?title=${encodeURIComponent(movie.title)}&year=${encodeURIComponent(movie.year || "")}`
    );
    videoId = resolveTrailerVideoId(trailer);
  } catch {
    videoId = "";
  }

  // A newer request (user pressed Next/Previous) supersedes this one.
  if (requestId !== trailerRequestSequence) return;

  const stage = document.getElementById("trailerStage");
  if (!stage) return;

  if (!videoId) {
    stage.innerHTML = `
      <div class="trailer-unavailable">
        <span aria-hidden="true">▶</span>
        <div>
          <strong>Trailer unavailable</strong>
          <p>We couldn't find a trailer for ${escapeHTML(movie.title)}. Skipping ahead...</p>
        </div>
      </div>`;
    // Do not stall the queue on a missing trailer.
    window.setTimeout(() => {
      if (requestId === trailerRequestSequence) playTrailerAt(index + 1);
    }, 2200);
    return;
  }

  const iframeId = "trailerTheatreFrame";
  stage.innerHTML = `<iframe
    id="${iframeId}"
    src="${trailerEmbedUrl(videoId)}"
    title="${escapeHTML(movie.title)} trailer"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowfullscreen></iframe>`;

  // Auto-advance to the next trailer when the current one finishes.
  const frame = document.getElementById(iframeId);
  if (frame) {
    frame.addEventListener("load", () => {
      try {
        frame.contentWindow.postMessage(
          JSON.stringify({ event: "listening", id: String(movie.id), channel: "widget" }),
          "*"
        );
      } catch {
        // Cross-origin messaging unavailable - manual controls still work.
      }
    });
  }
}

function openTrailerTheatre() {
  // Play trailers for whatever the watchlist currently shows (filters apply).
  trailerQueue = movies.map(movie => ({
    id: movie.id,
    title: movie.title,
    year: movie.year,
    genre: movie.genre
  }));

  const dialog = document.getElementById("trailerDialog");
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  void playTrailerAt(0);
}

function stepTrailer(offset) {
  if (!trailerQueue.length) return;
  const nextIndex = trailerIndex + offset;
  void playTrailerAt(Math.min(Math.max(nextIndex, 0), trailerQueue.length - 1));
}

// YouTube's IFrame API posts this when a video ends.
window.addEventListener("message", event => {
  let payload = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return;
    }
  }
  if (payload?.event === "onStateChange" && Number(payload.info) === 0) {
    stepTrailer(1);
  }
});

function renderMovieDetails(movie, savedMovie = null) {
  const title = movieField(movie, "Title", "title") || "Unknown title";
  const year = movieField(movie, "Year", "year");
  const genre = movieField(movie, "Genre", "genre");
  const imdbID = movieField(movie, "imdbID") || savedMovie?.imdbID || "";
  const rating = movieField(movie, "imdbRating");
  const poster = movieField(movie, "Poster", "poster");
  const plot = movieField(movie, "Plot", "plot");
  const genres = genre.split(",").map(value => value.trim()).filter(Boolean);
  const facts = [
    ["Released", movieField(movie, "Released", "released")],
    ["Rated", movieField(movie, "Rated", "rated")],
    ["Runtime", movieField(movie, "Runtime", "runtime")],
    ["Director", movieField(movie, "Director", "director")],
    ["Writer", movieField(movie, "Writer", "writer")],
    ["Actors", movieField(movie, "Actors", "actors")],
    ["Language", movieField(movie, "Language", "language")],
    ["Country", movieField(movie, "Country", "country")],
    ["Awards", movieField(movie, "Awards", "awards")],
    ["Metascore", movieField(movie, "Metascore", "metascore")],
    ["IMDb votes", movieField(movie, "imdbVotes")],
    ["Box office", movieField(movie, "BoxOffice", "boxOffice")]
  ].filter(([, value]) => value);

  activeDetailsMovie = {
    data: movie,
    imdbID,
    savedId: savedMovie?.id ?? null,
    title,
    year
  };

  document.getElementById("detailsContent").innerHTML = `
    <div class="movie-detail-layout">
      <div class="movie-detail-poster">
        ${posterHTML(poster, title)}
      </div>
      <div class="movie-detail-copy">
        <p class="eyebrow">OMDb MOVIE PROFILE</p>
        <h2>${escapeHTML(title)}</h2>
        <div class="movie-detail-badges">
          ${year ? `<span class="movie-detail-badge">${escapeHTML(year)}</span>` : ""}
          <span class="rating-badge">★ ${escapeHTML(rating ? `${rating}/10` : "Not rated")}</span>
          ${genres.map(value => `<span class="movie-detail-badge">${escapeHTML(value)}</span>`).join("")}
        </div>
        <p class="movie-detail-plot">${escapeHTML(plot || "Plot details are unavailable.")}</p>
        <div class="movie-detail-actions">
          <button id="detailsFavoriteButton" class="details-favorite-button" type="button"></button>
          <button id="detailsWatchlistButton" class="details-watchlist-button" type="button"></button>
        </div>
        ${facts.length ? `
          <dl class="movie-detail-facts">
            ${facts.map(([label, value]) => `
              <div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>
            `).join("")}
          </dl>
        ` : ""}
      </div>
    </div>
    <section class="movie-trailer-section" aria-labelledby="movieTrailerTitle">
      <div class="movie-trailer-heading">
        <div>
          <p class="eyebrow">WATCH NEXT</p>
          <h3 id="movieTrailerTitle">YouTube Trailer</h3>
        </div>
        <span class="trailer-source-badge">YOUTUBE</span>
      </div>
      <div class="movie-trailer-player" id="movieTrailer" role="status" aria-live="polite">
        <div class="trailer-loading"><span aria-hidden="true"></span>Finding a trailer...</div>
      </div>
    </section>
  `;

  updateDetailsActions();
  const detailsDialog = document.getElementById("detailsDialog");
  if (!detailsDialog.open) detailsDialog.showModal();

  const requestSequence = ++detailsRequestSequence;
  document.getElementById("detailsFavoriteButton").addEventListener("click", async () => {
    try {
      let saved = findSavedDetailsMovie();
      if (!saved) {
        await addMovieToWatchlist(activeDetailsMovie.data);
        saved = findSavedDetailsMovie();
      }
      if (saved) await toggleFavorite(saved.id);
      updateDetailsActions();
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  document.getElementById("detailsWatchlistButton").addEventListener("click", async () => {
    const saved = findSavedDetailsMovie();
    if (saved) {
      await deleteMovie(saved.id, true);
      return;
    }

    try {
      await addMovieToWatchlist(activeDetailsMovie.data);
      updateDetailsActions();
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  void loadMovieTrailer(title, year, requestSequence);
}

// Show details for a saved movie
async function showDetails(id) {
  const movie = movies.find(item => item.id === id);
  if (!movie) return;

  if (movie.imdbID) {
    await showOnlineDetails(movie);
    return;
  }

  renderMovieDetails(movie, movie);
}

// Load extended OMDb details without coupling trailer lookup to OMDb.
async function showOnlineDetails(savedMovieOrImdbID) {
  const savedMovie = typeof savedMovieOrImdbID === "object"
    ? savedMovieOrImdbID
    : movies.find(item => item.imdbID === savedMovieOrImdbID);
  const imdbID = savedMovie
    ? savedMovie.imdbID
    : savedMovieOrImdbID;

  try {
    const movie = await request(`/api/movie/${encodeURIComponent(imdbID)}`);
    renderMovieDetails(movie, savedMovie);
  } catch (error) {
    const fallback = savedMovie
      || omdbSearchResults.get(imdbID)
      || movies.find(item => item.imdbID === imdbID)
      || featuredMovies.find(item => item.imdbID === imdbID);

    if (fallback) {
      renderMovieDetails(fallback, savedMovie);
      return;
    }

    showMessage("Movie details are temporarily unavailable. Please try again later.", true);
  }
}

document.getElementById("closeDetails").addEventListener("click", () => {
  document.getElementById("detailsDialog").close();
});

document.getElementById("detailsDialog").addEventListener("close", () => {
  detailsRequestSequence += 1;
  activeDetailsMovie = null;
});

// Trailer theatre controls: play the whole watchlist in one continuous session.
const playAllTrailersButton = document.getElementById("playAllTrailers");
if (playAllTrailersButton) {
  playAllTrailersButton.addEventListener("click", openTrailerTheatre);
}

document.getElementById("trailerPrev").addEventListener("click", () => stepTrailer(-1));
document.getElementById("trailerNext").addEventListener("click", () => stepTrailer(1));

document.getElementById("closeTrailerDialog").addEventListener("click", () => {
  document.getElementById("trailerDialog").close();
});

document.getElementById("trailerDialog").addEventListener("close", () => {
  // Stop playback and drop the queue so audio never leaks in the background.
  trailerRequestSequence += 1;
  trailerQueue = [];
  trailerIndex = -1;
  renderTrailerStage(`
    <div class="trailer-loading"><span aria-hidden="true"></span>Finding trailers...</div>`);
});

// Update the visible list whenever filters change
document.getElementById("filterInput").addEventListener("input", renderMovies);
document.getElementById("statusFilter").addEventListener("change", renderMovies);
document.getElementById("sortSelect").addEventListener("change", renderMovies);

// Open the details page for a featured movie (works even if unsaved)
async function showFeaturedDetails(imdbID) {
  const savedMovie = movies.find(movie => movie.imdbID === imdbID) || null;
  await showOnlineDetails(savedMovie || imdbID);
}

// Dark / light theme switch (colour theme only - no layout change)
const themeToggle = document.getElementById("themeToggle");

if (themeToggle) {
  const applyTheme = theme => {
    const isLight = theme === "light";
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.setAttribute("aria-label",
      isLight ? "Switch to dark mode" : "Switch to light mode");
    const icon = themeToggle.querySelector(".theme-toggle-icon");
    if (icon) icon.textContent = isLight ? "☀" : "☾";
    try {
      localStorage.setItem("cinelist-theme", theme);
    } catch {
      // storage unavailable - theme still applies for this page view
    }
  };

  const currentTheme = document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
  applyTheme(currentTheme);

  themeToggle.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light"
      ? "dark"
      : "light";
    applyTheme(next);
  });
}

// Start the application
loadMovies();
loadFeaturedMovies();